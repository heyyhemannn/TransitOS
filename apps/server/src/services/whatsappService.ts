import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import * as QRCode from 'qrcode';
import * as path from 'path';
import * as fs from 'fs';
import type { Response as ExpressResponse } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { usePrismaAuthState } from './whatsappDbAuth';
import { MessageType, MessageStatus } from '@prisma/client';

// Memory buffer for Baileys logs
export const baileysLogsBuffer: string[] = [];

// In-memory cache of sent message content for Baileys re-keying & retry handling
export const sentMessageCache = new Map<string, any>();

export function cacheSentMessage(keyId: string | null | undefined, messageContent: any) {
  if (!keyId) return;
  sentMessageCache.set(keyId, messageContent);
  if (sentMessageCache.size > 2000) {
    const firstKey = sentMessageCache.keys().next().value;
    if (firstKey) sentMessageCache.delete(firstKey);
  }
}

// Custom Pino logger for Baileys internals that writes to memory buffer
const baileysLogger = P(
  { level: 'warn' }, // 'warn' only — saves RAM on free tier
  {
    write(msg: string) {
      try {
        const parsed = JSON.parse(msg);
        const time = parsed.time ? new Date(parsed.time).toISOString() : new Date().toISOString();
        const levelVal = parsed.level;
        const levelName = levelVal === 30 ? 'INFO' : levelVal === 40 ? 'WARN' : levelVal >= 50 ? 'ERROR' : 'DEBUG';

        const extra: Record<string, any> = {};
        for (const [key, val] of Object.entries(parsed)) {
          if (!['level', 'time', 'msg', 'pid', 'hostname', 'service', 'v'].includes(key)) {
            extra[key] = val;
          }
        }

        const extraStr = Object.keys(extra).length > 0 ? ` | Extra: ${JSON.stringify(extra)}` : '';
        const formattedMsg = `${time} [${levelName}]: ${parsed.msg || ''}${extraStr}`;
        baileysLogsBuffer.push(formattedMsg);
      } catch {
        baileysLogsBuffer.push(msg.trim());
      }
      if (baileysLogsBuffer.length > 500) {
        baileysLogsBuffer.shift();
      }
    }
  }
);

// SSE clients map
const sseClients: Set<ExpressResponse> = new Set();

export function broadcastSSE(event: string, data: object) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

export function registerSSEClient(res: ExpressResponse) {
  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
  res.on('finish', () => {
    sseClients.delete(res);
  });
}

export function unregisterSSEClient(res: ExpressResponse) {
  sseClients.delete(res);
}

class WhatsAppService {
  sock: WASocket | null = null;
  isReady = false;
  isConnecting = false;
  qrBase64: string | null = null;
  connectedPhone: string | null = null;
  lastSentAt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.sock) {
      logger.info('Cleaning up old WhatsApp socket before (re)initialization...');
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.end(undefined);
      } catch (err) {
        logger.warn('Error closing old WhatsApp socket:', err);
      }
      this.sock = null;
    }

    logger.info('Initializing WhatsApp client via Baileys and Prisma Session Store...');
    this.isConnecting = true;
    this.isReady = false;
    broadcastSSE('status', { connected: false, phone: null, authenticating: true });

    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default;
      const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
      const makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
      const DisconnectReason = baileys.DisconnectReason;

      const { state, saveCreds } = await usePrismaAuthState();
      const { version } = await fetchLatestBaileysVersion();

      logger.info(`Using Baileys version: ${version.join('.')}`);

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        logger: baileysLogger,
        printQRInTerminal: false,
        msgRetryCounterCache: new Map() as any,
        generateHighQualityLinkPreview: false,
        browser: baileys.Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        getMessage: async (key) => {
          // 1. Check in-memory cache first (fastest path)
          if (key.id && sentMessageCache.has(key.id)) {
            return sentMessageCache.get(key.id);
          }

          if (key.id) {
            try {
              // 2. Look up by wamId column (new schema)
              let msg = await prisma.whatsAppMessage.findFirst({
                where: { wamId: key.id },
              });

              // 3. Fallback: old records stored wamId inside errorMessage as "[WAM_ID: xxx]"
              if (!msg) {
                msg = await prisma.whatsAppMessage.findFirst({
                  where: { errorMessage: { contains: key.id } },
                });
              }

              if (msg) {
                // For PDF receipt log entries, return the body as caption text
                const bodyText = msg.body.startsWith('[PDF') ? '' : msg.body;
                if (bodyText) {
                  // Cache it so future retries don't need another DB lookup
                  sentMessageCache.set(key.id, { conversation: bodyText });
                  return { conversation: bodyText };
                }
              }
            } catch (err) {
              logger.warn('[getMessage] DB lookup failed:', err);
            }
          }

          // 4. Last resort — return empty so WhatsApp doesn't crash;
          //    recipient may still see "Waiting" for very old messages
          //    but this prevents new messages from failing.
          return undefined;
        },
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Event listener for message receipt delivery updates (double ticks)
      this.sock.ev.on('message-receipt.update', async (receipts) => {
        for (const r of receipts) {
          const messageId = r.key.id;
          if (messageId) {
            try {
              await prisma.whatsAppMessage.updateMany({
                where: { wamId: messageId, status: MessageStatus.SENT },
                data: { status: MessageStatus.DELIVERED },
              });
            } catch (err) {
              logger.warn('Error updating DELIVERED status from receipt:', err);
            }
          }
        }
      });

      // Event listener for message updates (status 2 = Server ACK, status 3 = Delivery ACK)
      this.sock.ev.on('messages.update', async (updates) => {
        for (const u of updates) {
          const messageId = u.key.id;
          const statusVal = u.update.status;
          if (messageId && statusVal !== undefined && statusVal !== null) {
            try {
              let targetStatus: MessageStatus | null = null;
              // status 4 = Read, 3 = Delivered, 2 = Server ACK, 1 = Pending
              if (statusVal >= 4) {
                targetStatus = MessageStatus.DELIVERED; // read counts as delivered
              } else if (statusVal >= 3) {
                targetStatus = MessageStatus.DELIVERED;
              } else if (statusVal >= 2) {
                targetStatus = MessageStatus.SENT;
              }

              if (targetStatus) {
                await prisma.whatsAppMessage.updateMany({
                  where: { wamId: messageId },
                  data: { status: targetStatus },
                });
              }
            } catch (err) {
              logger.warn('Error updating status from messages.update:', err);
            }
          }
        }
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.isConnecting = true;
          this.isReady = false;
          try {
            const qrLib: any = QRCode;
            const toDataURL = qrLib.toDataURL || qrLib.default?.toDataURL || QRCode.toDataURL;
            this.qrBase64 = await toDataURL(qr);
            logger.info('WhatsApp QR Code generated — waiting for scan.');
            broadcastSSE('qr', { qr: this.qrBase64 });
          } catch (err) {
            logger.error('Failed to convert QR to base64:', err);
          }
        }

        if (connection === 'open') {
          this.isReady = true;
          this.isConnecting = false;
          this.qrBase64 = null;
          this.connectedPhone = this.sock?.user?.id?.split(':')[0] ?? null;
          logger.info(`WhatsApp connected. Phone: ${this.connectedPhone}`);
          broadcastSSE('status', { connected: true, phone: this.connectedPhone });
        }

        if (connection === 'close') {
          this.isReady = false;
          this.isConnecting = false;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

          this.connectedPhone = null;
          this.qrBase64 = null;
          broadcastSSE('status', { connected: false, phone: null });

          const isPaired = !!state.creds?.me;
          const isExplicitLogout = statusCode === DisconnectReason.loggedOut; // Only 401 explicit logout
          const shouldReconnect = !isExplicitLogout && isPaired;

          logger.warn(`WhatsApp connection closed. Code=${statusCode} IsPaired=${isPaired} ExplicitLogout=${isExplicitLogout} Reconnect=${shouldReconnect}`);

          if (isExplicitLogout) {
            logger.info('WhatsApp explicitly logged out from mobile app. Purging session.');
            const { clearSession } = await usePrismaAuthState();
            await clearSession();
            this.connectedPhone = null;
            this.qrBase64 = null;
            broadcastSSE('status', { connected: false, phone: null });
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          } else if (shouldReconnect) {
            logger.info('Paired session detected in DB/storage. Auto-reconnecting in background (3s)...');
            broadcastSSE('status', { connected: false, phone: null, connecting: true });

            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => {
              this.initialize().catch((err) => {
                logger.error('Failed to auto-reconnect WhatsApp in background:', err);
              });
            }, 3000);
          } else {
            // QR code expired before being scanned — do NOT auto-reinitialize.
            // Doing so creates an infinite loop of QR generation on Render free tier.
            // The user must manually click "Refresh QR" or "Reset & Re-Pair" in the UI.
            logger.info('WhatsApp QR code expired before scan. Staying offline — manual QR refresh required.');
            this.connectedPhone = null;
            broadcastSSE('status', { connected: false, phone: null });
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          }
        }
      });
    } catch (error) {
      logger.error('WhatsApp initialization error:', error);
      this.isConnecting = false;
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        this.initialize().catch((err) => {
          logger.error('Failed to retry WhatsApp initialization:', err);
        });
      }, 10000);
    }
  }

  async resetSession(): Promise<void> {
    logger.info('Manually resetting WhatsApp session and clearing session store...');
    this.isReady = false;
    this.isConnecting = false;
    this.connectedPhone = null;
    this.qrBase64 = null;
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('message-receipt.update');
        this.sock.ev.removeAllListeners('messages.update');
        this.sock.end(undefined);
      } catch { }
      this.sock = null;
    }
    const { clearSession } = await usePrismaAuthState();
    await clearSession();
    await this.initialize();
  }

  getStatus() {
    return {
      connected: this.isReady && !!this.sock,
      phone: this.connectedPhone,
      qrCode: this.qrBase64,
    };
  }

  getQR() {
    return this.qrBase64;
  }

  getConnecting() {
    return this.isConnecting;
  }

  public async ensureConnected(maxWaitMs = 8000): Promise<boolean> {
    if (this.isReady && this.sock) {
      return true;
    }

    // Check if paired session exists in DB
    try {
      const { state } = await usePrismaAuthState();
      const isPaired = !!state.creds?.me;
      if (!isPaired) {
        return false;
      }
    } catch {
      return false;
    }

    logger.info('WhatsApp connection inactive/closing. Triggering auto-reconnect...');
    this.initialize().catch((err) => {
      logger.error('Auto-reconnect initialization error:', err);
    });

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.isReady && this.sock) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return this.isReady && !!this.sock;
  }

  private formatPhone(phone: string): string {
    // All numbers in this system are Indian (+91) 10-digit mobile numbers.
    // Strip everything non-digit, take the last 10 digits, prepend 91.
    // Simple and impossible to double-prefix regardless of input format.
    const digits = phone.replace(/\D/g, '');
    const last10 = digits.slice(-10);
    return `91${last10}@s.whatsapp.net`;
  }

  private async getVerifiedJid(phone: string): Promise<{ jid: string; exists: boolean }> {
    const digits = phone.replace(/\D/g, '');
    const last10 = digits.slice(-10);
    const defaultJid = `91${last10}@s.whatsapp.net`;
    if (!this.sock) return { jid: defaultJid, exists: true };
    try {
      const results = await this.sock.onWhatsApp(`91${last10}`);
      if (results && results.length > 0) {
        const match = results.find((r) => r.exists);
        if (match && match.jid) {
          logger.info(`Resolved verified WhatsApp JID for ${phone}: ${match.jid}`);
          return { jid: match.jid, exists: true };
        }
        logger.warn(`Phone number ${phone} (91${last10}) is not registered on WhatsApp.`);
        return { jid: defaultJid, exists: false };
      }
    } catch (err) {
      logger.warn(`onWhatsApp check error for ${phone}, fallback to default JID ${defaultJid}:`, err);
    }
    return { jid: defaultJid, exists: true };
  }

  private async enforceRateLimit() {
    const elapsed = Date.now() - this.lastSentAt;
    if (elapsed < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 3000 - elapsed));
    }
    this.lastSentAt = Date.now();
  }

  private formatAmount(paise: number): string {
    return (paise / 100).toLocaleString('en-IN');
  }

  private formatMonth(month: number, year: number): string {
    return new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  }

  async sendMessage(
    phone: string,
    body: string,
    studentId: string | null = null,
    type: MessageType = MessageType.BROADCAST,
    retryCount = 0
  ): Promise<{ success: boolean; error?: string }> {
    const now = new Date();

    const isConnected = await this.ensureConnected();
    const isWsOpen = this.sock && (this.sock.ws as any)?.isOpen !== false;

    if (!isConnected || !this.sock || !isWsOpen) {
      const errMsg = 'WhatsApp connection stream is inactive. Please pair QR first.';
      logger.warn(`Cannot send message. Client stream inactive. Recipient: ${phone}`);
      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }

    const { jid, exists } = await this.getVerifiedJid(phone);
    if (!exists) {
      const errMsg = `Phone number ${phone} is not registered on WhatsApp.`;
      logger.warn(`Cannot send message. ${errMsg}`);
      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }

    try {
      await this.enforceRateLimit();

      let sentResult: any = null;

      if (type === MessageType.REMINDER_1) {
        const candidatePaths = [
          path.resolve(process.cwd(), 'apps/server/src/assets/payment_qr.jpg'),
          path.resolve(process.cwd(), 'src/assets/payment_qr.jpg'),
          path.resolve(__dirname, '../assets/payment_qr.jpg'),
          path.resolve(__dirname, '../../src/assets/payment_qr.jpg'),
        ];
        const qrImagePath = candidatePaths.find((p) => fs.existsSync(p)) ?? null;
        try {
          if (qrImagePath) {
            const imageBuffer = fs.readFileSync(qrImagePath);
            const msgContent = {
              image: imageBuffer,
              caption: body,
              mimetype: 'image/jpeg',
            };
            sentResult = await this.sock.sendMessage(jid, msgContent);
            if (sentResult?.key?.id) cacheSentMessage(sentResult.key.id, msgContent);
          } else {
            const msgContent = { text: body };
            sentResult = await this.sock.sendMessage(jid, msgContent);
            if (sentResult?.key?.id) cacheSentMessage(sentResult.key.id, msgContent);
          }
        } catch (mediaErr) {
          logger.error('Failed to send QR image media, falling back to text:', mediaErr);
          const msgContent = { text: body };
          sentResult = await this.sock.sendMessage(jid, msgContent);
          if (sentResult?.key?.id) cacheSentMessage(sentResult.key.id, msgContent);
        }
      } else {
        const msgContent = { text: body };
        sentResult = await this.sock.sendMessage(jid, msgContent);
        if (sentResult?.key?.id) cacheSentMessage(sentResult.key.id, msgContent);
      }

      const wamId = sentResult?.key?.id ?? null;

      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, wamId, status: MessageStatus.SENT, sentAt: now, createdAt: now },
      });
      return { success: true };
    } catch (err: any) {
      const errMsg = err?.message || 'Unknown send error in WhatsApp client';
      logger.error(`Failed to send WhatsApp message to ${phone}:`, err);

      const isConnErr =
        errMsg.toLowerCase().includes('connection') ||
        errMsg.toLowerCase().includes('closed') ||
        errMsg.toLowerCase().includes('socket') ||
        errMsg.toLowerCase().includes('stream');

      if (isConnErr && retryCount < 1) {
        logger.warn(`Connection drop detected (${errMsg}). Reconnecting and retrying send to ${phone}...`);
        this.isReady = false;
        await this.initialize().catch(() => { });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this.sendMessage(phone, body, studentId, type, retryCount + 1);
      }

      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }
  }

  private async buildTemplateBody(
    studentId: string,
    type: MessageType,
    extraVars?: Record<string, string>
  ): Promise<{ student: any; body: string }> {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { route: true },
    });
    if (!student) throw new Error(`Student ${studentId} not found`);

    const settings = await prisma.settings.findMany();
    const getSetting = (key: string) => settings.find((s) => s.key === key)?.value ?? '';

    const currentDate = new Date();
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();

    const vars: Record<string, string> = {
      parentName: student.parentName,
      studentName: student.name,
      amount: this.formatAmount(student.monthlyFee),
      month: this.formatMonth(month, year),
      upiId: getSetting('upiId'),
      businessName: getSetting('businessName'),
      adminWhatsapp: getSetting('adminWhatsapp'),
      receiptId: extraVars?.receiptId ?? '',
      ...extraVars,
    };

    let body = TEMPLATES[type] ?? '';
    if (extraVars?.message) {
      body = body.replaceAll('{message}', extraVars.message);
    }
    for (const [key, value] of Object.entries(vars)) {
      body = body.replaceAll(`{${key}}`, value);
    }
    return { student, body };
  }

  async sendTemplate(
    studentId: string,
    type: MessageType,
    extraVars?: Record<string, string>
  ): Promise<void> {
    const { student, body } = await this.buildTemplateBody(studentId, type, extraVars);
    await this.sendMessage(student.whatsappNumber, body, studentId, type);
  }

  /** Like sendTemplate but also stores paymentId on the log record for idempotency. */
  private async sendTemplateWithPayment(
    studentId: string,
    type: MessageType,
    paymentId: string,
    extraVars?: Record<string, string>
  ): Promise<void> {
    const { student, body } = await this.buildTemplateBody(studentId, type, extraVars);
    await this.sendMessageWithPayment(student.whatsappNumber, body, studentId, type, paymentId);
  }

  /** Like sendMessage but saves paymentId on the log record. */
  private async sendMessageWithPayment(
    phone: string,
    body: string,
    studentId: string | null,
    type: MessageType,
    paymentId: string,
    retryCount = 0
  ): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    const isConnected = await this.ensureConnected();
    const isWsOpen = this.sock && (this.sock.ws as any)?.isOpen !== false;

    if (!isConnected || !this.sock || !isWsOpen) {
      const errMsg = 'WhatsApp connection stream is inactive. Please pair QR first.';
      await prisma.whatsAppMessage.create({
        data: { studentId, paymentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }

    const { jid, exists } = await this.getVerifiedJid(phone);
    if (!exists) {
      const errMsg = `Phone number ${phone} is not registered on WhatsApp.`;
      await prisma.whatsAppMessage.create({
        data: { studentId, paymentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }

    try {
      await this.enforceRateLimit();
      const msgContent = { text: body };
      const sentResult = await this.sock.sendMessage(jid, msgContent);
      if (sentResult?.key?.id) cacheSentMessage(sentResult.key.id, msgContent);
      const wamId = sentResult?.key?.id ?? null;
      await prisma.whatsAppMessage.create({
        data: { studentId, paymentId, phone, type, body, wamId, status: MessageStatus.SENT, sentAt: now, createdAt: now },
      });
      return { success: true };
    } catch (err: any) {
      const errMsg = err?.message || 'Unknown send error';
      const isConnErr = errMsg.toLowerCase().includes('connection') || errMsg.toLowerCase().includes('closed') || errMsg.toLowerCase().includes('socket') || errMsg.toLowerCase().includes('stream');
      if (isConnErr && retryCount < 1) {
        this.isReady = false;
        await this.initialize().catch(() => { });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this.sendMessageWithPayment(phone, body, studentId, type, paymentId, retryCount + 1);
      }
      await prisma.whatsAppMessage.create({
        data: { studentId, paymentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }
  }

  async sendConfirmation(studentId: string, paymentId: string): Promise<void> {
    // ── Idempotency guard ────────────────────────────────────────────────────
    // If a CONFIRMATION (text or PDF) was already sent successfully for this
    // specific paymentId, skip entirely to prevent duplicate messages.
    const alreadySent = await prisma.whatsAppMessage.findFirst({
      where: {
        paymentId,
        type: MessageType.CONFIRMATION,
        status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
      },
    });
    if (alreadySent) {
      logger.info(`[Confirmation] Skipping duplicate send — paymentId ${paymentId} already has a SENT/DELIVERED confirmation (id: ${alreadySent.id}).`);
      return;
    }

    let payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { student: true },
    });
    if (!payment) return;

    let receiptUrl = payment.receiptUrl;
    if (!receiptUrl) {
      try {
        const { generateReceipt } = await import('./receiptService');
        receiptUrl = await generateReceipt(paymentId);

        // Re-fetch payment to get the updated record (with receiptUrl)
        const updatedPayment = await prisma.payment.findUnique({
          where: { id: paymentId },
          include: { student: true },
        });
        if (updatedPayment) {
          payment = updatedPayment;
        }
      } catch (err) {
        logger.error('Failed to auto-generate receipt in sendConfirmation:', err);
      }
    }

    const paidDate = payment.paidAt
      ? new Date(payment.paidAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      : new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

    const shortMonth = new Date(payment.year, payment.month - 1)
      .toLocaleString('en-US', { month: 'short' })
      .toUpperCase();
    const receiptId = `PAY-${shortMonth}${payment.year}-${paymentId.slice(-6).toUpperCase()}`;

    // 1. Send Text Confirmation Template — pass paymentId for idempotency tracking
    await this.sendTemplateWithPayment(studentId, MessageType.CONFIRMATION, paymentId, {
      receiptId,
      studentName: payment.student?.name ?? '',
      paidDate,
      amount: this.formatAmount(payment.amount),
      month: this.formatMonth(payment.month, payment.year),
    });

    logger.info(`[Confirmation] ${payment.student?.name}: text message sent. Sending bill in 1.5s…`);

    // 1.5s gap between text confirmation and PDF bill so WhatsApp delivers them in order
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 2. Send PDF bill — MANDATORY. Retries once automatically on failure.
    //    sendReceiptBill() is fully awaited, so the caller's sequential for-loop
    //    will not move to the next student until both message + bill are done.
    await this.sendReceiptBill(payment, receiptId, paymentId);
  }

  /**
   * Sends the PDF receipt/bill to the parent via WhatsApp.
   *
   * Design goals:
   *  - MANDATORY: retries once (4 s gap) if the PDF cannot be fetched or sent.
   *  - RATE-LIMITED: calls enforceRateLimit() before every send, same as text
   *    messages, so siblings sharing a phone number never flood the connection.
   *  - SEQUENTIAL: fully awaited by sendConfirmation(), which itself is fully
   *    awaited by the for-loop in payments.ts — so Student 1 text+bill finishes
   *    completely before Student 2 text+bill starts.
   */
  private async sendReceiptBill(
    payment: NonNullable<Awaited<ReturnType<typeof prisma.payment.findUnique>>> & { student: any },
    receiptId: string,
    paymentId: string,
    retryCount = 0,
  ): Promise<void> {
    const studentName = payment.student?.name ?? paymentId;

    const isConnected = await this.ensureConnected();
    if (!isConnected || !this.sock) {
      logger.error(`[Bill] Cannot send bill for ${studentName} — WhatsApp not connected.`);
      return;
    }

    const { jid, exists } = await this.getVerifiedJid(payment.student.whatsappNumber);
    if (!exists) {
      logger.error(`[Bill] Cannot send bill for ${studentName} — phone number not registered on WhatsApp.`);
      await prisma.whatsAppMessage.create({
        data: {
          studentId: payment.student.id,
          phone: payment.student.whatsappNumber,
          type: MessageType.CONFIRMATION,
          body: `[PDF Bill Receipt: ${receiptId}.pdf]`,
          status: MessageStatus.FAILED,
          errorMessage: 'Phone number not registered on WhatsApp',
          createdAt: new Date(),
        },
      });
      return;
    }
    const storagePath = `receipts/${payment.student.id}/${receiptId}.pdf`;
    let pdfBuffer: Buffer | null = null;

    // ── Source 1: LOCAL: prefix path ───────────────────────────────────────────
    if (payment.receiptUrl?.startsWith('LOCAL:')) {
      try {
        const pathInReceipts = payment.receiptUrl.replace('LOCAL:', '');
        const localFilePath = path.resolve(process.cwd(), 'storage', pathInReceipts);
        if (fs.existsSync(localFilePath)) {
          pdfBuffer = fs.readFileSync(localFilePath);
          logger.info(`[Bill] ${studentName}: read PDF from local storage (${pdfBuffer.length} bytes).`);
        }
      } catch (localErr) {
        logger.warn(`[Bill] ${studentName}: local storage read failed:`, localErr);
      }
    }

    // ── Source 2: Supabase cloud storage ───────────────────────────────────────
    if (!pdfBuffer) {
      try {
        const { supabase } = await import('../lib/supabase');
        logger.info(`[Bill] ${studentName}: downloading PDF from Supabase (${storagePath})…`);
        const { data, error } = await supabase.storage.from('receipts').download(storagePath);
        if (error) {
          logger.warn(`[Bill] ${studentName}: Supabase download error:`, error);
        } else if (data) {
          pdfBuffer = Buffer.from(await data.arrayBuffer());
          logger.info(`[Bill] ${studentName}: downloaded PDF from Supabase (${pdfBuffer.length} bytes).`);
        }
      } catch (storageErr) {
        logger.warn(`[Bill] ${studentName}: Supabase storage exception:`, storageErr);
      }
    }

    // ── Source 3: Conventional local disk fallback ─────────────────────────────
    if (!pdfBuffer) {
      try {
        const localFilePath = path.resolve(
          process.cwd(), 'storage', 'receipts', payment.student.id, `${receiptId}.pdf`,
        );
        if (fs.existsSync(localFilePath)) {
          pdfBuffer = fs.readFileSync(localFilePath);
          logger.info(`[Bill] ${studentName}: read PDF from fallback disk path (${pdfBuffer.length} bytes).`);
        }
      } catch (diskErr) {
        logger.warn(`[Bill] ${studentName}: disk fallback read failed:`, diskErr);
      }
    }

    // ── Send (or retry if buffer unavailable) ─────────────────────────────────
    if (!pdfBuffer) {
      if (retryCount < 1) {
        logger.warn(`[Bill] ${studentName}: PDF not available on attempt ${retryCount + 1}. Retrying in 4s…`);
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return this.sendReceiptBill(payment, receiptId, paymentId, retryCount + 1);
      }
      logger.error(`[Bill] ❌ ${studentName}: PDF unavailable after retry — bill NOT sent.`);
      return;
    }

    try {
      await this.enforceRateLimit(); // respect 3-second inter-message spacing

      const now = new Date();
      const pdfContent = {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: `${receiptId}.pdf`,
        caption: `🧾 Bill Receipt for ${payment.student.name} — ${this.formatMonth(payment.month, payment.year)}`,
      };
      const sentResult = await this.sock.sendMessage(jid, pdfContent);
      if (sentResult?.key?.id) cacheSentMessage(sentResult.key.id, pdfContent);

      const wamId = sentResult?.key?.id ?? null;

      await prisma.whatsAppMessage.create({
        data: {
          studentId: payment.student.id,
          paymentId: payment.id,
          phone: payment.student.whatsappNumber,
          type: MessageType.CONFIRMATION,
          body: `[PDF Bill Receipt: ${receiptId}.pdf]`,
          wamId,
          status: MessageStatus.SENT,
          sentAt: now,
          createdAt: now,
        },
      });

      logger.info(`[Bill] ✅ ${studentName}: receipt PDF sent successfully (${receiptId}.pdf).`);
    } catch (sendErr: any) {
      if (retryCount < 1) {
        logger.warn(`[Bill] ${studentName}: PDF send failed on attempt ${retryCount + 1}: ${sendErr?.message}. Retrying in 4s…`);
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return this.sendReceiptBill(payment, receiptId, paymentId, retryCount + 1);
      }

      const errMsg = sendErr?.message || 'Failed to send PDF receipt bill via WhatsApp';
      logger.error(`[Bill] ❌ ${studentName}: PDF send failed after retry — bill NOT delivered.`, sendErr);

      await prisma.whatsAppMessage.create({
        data: {
          studentId: payment.student.id,
          phone: payment.student.whatsappNumber,
          type: MessageType.CONFIRMATION,
          body: `[PDF Bill Receipt: ${receiptId}.pdf]`,
          status: MessageStatus.FAILED,
          errorMessage: errMsg,
          createdAt: new Date(),
        },
      });
    }
  }

  async sendCollectiveTemplate(
    studentIds: string[],
    type: MessageType,
    extraVars?: Record<string, string>
  ): Promise<void> {
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      include: { route: true },
    });
    if (students.length === 0) return;

    const firstStudent = students[0];
    const settings = await prisma.settings.findMany();
    const getSetting = (key: string) => settings.find(s => s.key === key)?.value ?? '';

    const currentDate = new Date();
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();

    const totalFee = students.reduce((sum, s) => sum + s.monthlyFee, 0);

    const studentList = students
      .map(s => `- ${s.name}: ₹${this.formatAmount(s.monthlyFee)}`)
      .join('\n');

    const joinedNames = students.map(s => s.name).join(' & ');

    const vars: Record<string, string> = {
      parentName: firstStudent.parentName,
      studentName: joinedNames,
      studentList: studentList,
      amount: this.formatAmount(totalFee),
      totalAmount: this.formatAmount(totalFee),
      month: this.formatMonth(month, year),
      upiId: getSetting('upiId'),
      businessName: getSetting('businessName'),
      adminWhatsapp: getSetting('adminWhatsapp'),
      receiptId: extraVars?.receiptId ?? '',
      ...extraVars,
    };

    let templateText = '';
    if (type === MessageType.BROADCAST) {
      templateText = extraVars?.message || '';
    } else if (type === MessageType.EMERGENCY) {
      templateText = TEMPLATES[MessageType.EMERGENCY];
    } else if (type === MessageType.CONFIRMATION) {
      templateText = TEMPLATES[MessageType.CONFIRMATION];
    } else {
      templateText = COLLECTIVE_TEMPLATES[type as keyof typeof COLLECTIVE_TEMPLATES] || TEMPLATES[type];
    }

    let body = templateText;
    for (const [key, value] of Object.entries(vars)) {
      body = body.replaceAll(`{${key}}`, value);
    }

    await this.sendMessage(firstStudent.whatsappNumber, body, firstStudent.id, type);
  }

  async broadcastToList(
    studentIds: string[],
    type: MessageType,
    extraVars?: Record<string, string>
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;

    let targetIds = studentIds;

    // For reminder message types, filter out students who have ALREADY paid for current month/year
    const isReminderType =
      type === MessageType.REMINDER_1 ||
      type === MessageType.REMINDER_2 ||
      type === MessageType.REMINDER_3 ||
      type === MessageType.FINAL;

    if (isReminderType) {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const month = nowIST.getMonth() + 1;
      const year = nowIST.getFullYear();

      const unpaidStudents = await prisma.student.findMany({
        where: {
          id: { in: studentIds },
          status: 'ACTIVE',
          NOT: {
            OR: [
              {
                payments: {
                  some: {
                    month,
                    year,
                    status: 'PAID',
                  },
                },
              },
              {
                feeSchedules: {
                  some: {
                    month,
                    year,
                    isPaid: true,
                  },
                },
              },
            ],
          },
        },
        select: { id: true },
      });

      targetIds = unpaidStudents.map((s) => s.id);
      logger.info(`Unpaid filter applied for reminder ${type}: ${targetIds.length}/${studentIds.length} students eligible`);
    }

    if (targetIds.length === 0) {
      logger.info(`No eligible unpaid students found to send ${type}.`);
      return { sent: 0, failed: 0 };
    }

    // 1. Fetch all eligible students in the list
    const students = await prisma.student.findMany({
      where: { id: { in: targetIds } },
    });

    // 2. Group by WhatsApp number (clean formatting to match correctly)
    const grouped: Record<string, typeof students> = {};
    for (const s of students) {
      const cleanPhone = s.whatsappNumber.replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      if (!grouped[formattedPhone]) {
        grouped[formattedPhone] = [];
      }
      grouped[formattedPhone].push(s);
    }

    // 3. Process each group sequentially
    for (const [phone, groupStudents] of Object.entries(grouped)) {
      try {
        if (groupStudents.length === 1) {
          // Single student, send standard template
          await this.sendTemplate(groupStudents[0].id, type, extraVars);
          sent++;
        } else {
          // Sibling group, send collective template
          logger.info(`Sending collective message to group ${phone} containing ${groupStudents.length} students.`);
          await this.sendCollectiveTemplate(groupStudents.map(s => s.id), type, extraVars);
          sent += groupStudents.length;
        }
        // Small delay between broadcasts to prevent connection bottlenecks
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        logger.error(`Failed to send broadcast/reminder to group ${phone}:`, err);
        failed += groupStudents.length;
      }
    }

    return { sent, failed };
  }

  async logout(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Clean up socket listeners and close stream BEFORE calling logout()
    // to prevent Baileys from firing connection.update events that trigger
    // spurious auto-reconnect attempts after a manual logout.
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('message-receipt.update');
        this.sock.ev.removeAllListeners('messages.update');
        await this.sock.logout().catch(() => { });
        this.sock.end(undefined);
      } catch (err) {
        logger.warn('Error during WhatsApp logout cleanup:', err);
      }
      this.sock = null;
    }
    // Clear session files/DB records so next initialize() shows a fresh QR
    const { clearSession } = await usePrismaAuthState();
    await clearSession();
    this.isReady = false;
    this.isConnecting = false;
    this.connectedPhone = null;
    this.qrBase64 = null;
    broadcastSSE('status', { connected: false, phone: null });
    // Auto-generate fresh QR code immediately
    this.initialize().catch((err) => logger.error('Post-logout init error:', err));
  }
}

export const whatsappService = new WhatsAppService();

// ─── Exported functions for backward compatibility ──────────────────────────
export async function initWhatsApp(): Promise<void> {
  await whatsappService.initialize();
}

export function getWhatsAppQR(): string | null {
  return whatsappService.getQR();
}

export function getWhatsAppStatus(): { connected: boolean; phone: string | null } {
  const status = whatsappService.getStatus();
  return {
    connected: status.connected,
    phone: status.phone,
  };
}

export async function syncWhatsAppStatus(): Promise<{ connected: boolean; phone: string | null }> {
  return getWhatsAppStatus();
}

export function getWhatsAppConnecting(): boolean {
  return whatsappService.getConnecting();
}

export async function sendWhatsAppMessage(
  phone: string,
  body: string,
  studentId: string | null = null,
  type: MessageType = MessageType.BROADCAST,
): Promise<{ success: boolean; error?: string }> {
  return whatsappService.sendMessage(phone, body, studentId, type);
}

export async function sendConfirmation(studentId: string, paymentId: string): Promise<void> {
  await whatsappService.sendConfirmation(studentId, paymentId);
}

const PAY_CONFIRM_URL = process.env.PAY_CONFIRM_URL ?? 'https://transitos.vercel.app/pay-confirm';

export const TEMPLATES: Record<MessageType, string> = {
  [MessageType.REMINDER_1]: `Dear {parentName},

Transport fee of ₹{amount} for {month} is now due.

🏫 Student: {studentName}

To pay and confirm:
1️⃣ Pay ₹{amount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

(Enter your Transaction ID/Ref No or upload a screenshot. Uploading screenshot is optional.)

Thank you,
{businessName}`,

  [MessageType.REMINDER_2]: `Dear {parentName},

🔔 Reminder: Transport fee of ₹{amount} for {month} is still pending.

🏫 Student: {studentName}

To pay and confirm:
1️⃣ Pay ₹{amount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

"_***If already paid, please submit or share the payment proof with us so we can verify (or ignore this message if the system has not updated your payment yet). If not paid, we kindly request you to pay the pending fee.***_"

Thank you,
{businessName}`,

  [MessageType.REMINDER_3]: `Dear {parentName},

⚠️ Final Reminder: Transport fee ₹{amount} for {month} is still unpaid.

🏫 Student: {studentName}

To pay and confirm:
1️⃣ Pay ₹{amount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

"_***If already paid, please submit or share the payment proof with us so we can verify (or ignore this message if the system has not updated your payment yet). If not paid, we kindly request you to pay the pending fee to prevent service disruption.***_"

Thank you,
{businessName}`,

  [MessageType.FINAL]: `🚨 URGENT: Dear {parentName},

Transport fee ₹{amount} for {month} is OVERDUE.

🏫 Student: {studentName}

Please pay immediately to ensure uninterrupted service:
1️⃣ Pay ₹{amount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

(Enter your Transaction ID/Ref No or upload a screenshot. Uploading screenshot is optional.)

Best regards,
{businessName}`,

  [MessageType.CONFIRMATION]: `✅ Payment Confirmed! Thank you! 🙏

Dear {parentName},

We have received your transport fee payment of ₹{amount} for {month}.

🏫 Student: {studentName}
🧾 Invoice No: {receiptId}
📅 Date: {paidDate}

Your payment bill/invoice is attached below. Thank you for your continued support!

Best regards,
{businessName}`,

  [MessageType.EMERGENCY]: `⚠️ Notice from {businessName}:

{message}

For any queries: {adminWhatsapp}`,

  [MessageType.BROADCAST]: `{message}`,
};

export const COLLECTIVE_TEMPLATES: Record<
  Exclude<MessageType, 'CONFIRMATION' | 'EMERGENCY' | 'BROADCAST'>,
  string
> = {
  [MessageType.REMINDER_1]: `Dear {parentName},

Transport fee for {month} is now due for your children.

🏫 Students:
{studentList}

Total Combined Fee: ₹{totalAmount}

To pay and confirm:
1️⃣ Pay ₹{totalAmount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

(Enter your Transaction ID/Ref No or upload a screenshot. Uploading screenshot is optional.)

Thank you,
{businessName}`,

  [MessageType.REMINDER_2]: `Dear {parentName},

🔔 Reminder: Transport fee for {month} is still pending for your children.

🏫 Students:
{studentList}

Total Combined Fee: ₹{totalAmount}

To pay and confirm:
1️⃣ Pay ₹{totalAmount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

"_***If already paid, please submit or share the payment proof with us so we can verify (or ignore this message if the system has not updated your payment yet). If not paid, we kindly request you to pay the pending fee.***_"

Thank you,
{businessName}`,

  [MessageType.REMINDER_3]: `Dear {parentName},

⚠️ Final Reminder: Transport fee for {month} is still unpaid for your children.

🏫 Students:
{studentList}

Total Combined Fee: ₹{totalAmount}

To pay and confirm:
1️⃣ Pay ₹{totalAmount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

"_***If already paid, please submit or share the payment proof with us so we can verify (or ignore this message if the system has not updated your payment yet). If not paid, we kindly request you to pay the pending fee to prevent service disruption.***_"

Thank you,
{businessName}`,

  [MessageType.FINAL]: `🚨 URGENT: Dear {parentName},

Transport fee for {month} is OVERDUE for your children.

🏫 Students:
{studentList}

Total Combined Fee: ₹{totalAmount}

Please pay immediately to ensure uninterrupted service:
1️⃣ Pay ₹{totalAmount} via UPI to: {upiId}
2️⃣ Confirm your payment here:
👉 ${PAY_CONFIRM_URL}

(Enter your Transaction ID/Ref No or upload a screenshot. Uploading screenshot is optional.)

Best regards,
{businessName}`,
};

export function formatTemplate(templateText: string, vars: Record<string, string>): string {
  let text = templateText;
  for (const [key, value] of Object.entries(vars)) {
    text = text.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  return text;
}

export function sendBroadcast(
  phones: string[],
  type: MessageType,
  variables: Record<string, string>,
  studentIdMap?: Record<string, string>,
): void {
  (async () => {
    const templateText = TEMPLATES[type] || '{body}';
    logger.info(`Starting WhatsApp broadcast for ${phones.length} recipients...`);

    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];
      const studentId = studentIdMap ? studentIdMap[phone] : null;

      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      const body = formatTemplate(templateText, variables);

      try {
        await sendWhatsAppMessage(phone, body, studentId, type);
      } catch (err) {
        logger.error(`Broadcast failed for recipient index ${i} (${phone}):`, err);
      }
    }

    logger.info(`WhatsApp broadcast of type ${type} completed for ${phones.length} recipients.`);
  })().catch((err) => {
    logger.error('Uncaught error in WhatsApp broadcast handler:', err);
  });
}

export function getWhatsAppDebugInfo() {
  const status = whatsappService.getStatus();
  return {
    socketExists: !!(whatsappService.sock),
    user: whatsappService.sock?.user ? { id: whatsappService.sock.user.id, name: whatsappService.sock.user.name } : null,
    isConnected: status.connected,
    isConnecting: whatsappService.getConnecting(),
    clientPhone: status.phone,
    qrLength: status.qrCode ? status.qrCode.length : 0,
    sessionFiles: [],
    baileysLogs: baileysLogsBuffer,
  };
}
