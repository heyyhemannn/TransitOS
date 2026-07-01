import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
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

  async initialize(): Promise<void> {
    logger.info('Initializing WhatsApp client via Baileys and Prisma Session Store...');
    this.isConnecting = true;
    broadcastSSE('status', { connected: false, phone: null, authenticating: true });

    try {
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
        syncFullHistory: false,
        browser: ['TransitOS', 'Chrome', '1.0.0'],
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.isConnecting = true;
          this.isReady = false;
          try {
            this.qrBase64 = await QRCode.toDataURL(qr);
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
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.connectedPhone = null;
          this.qrBase64 = null;
          broadcastSSE('status', { connected: false, phone: null });

          logger.warn(`WhatsApp connection closed. Code=${statusCode} Reconnect=${shouldReconnect}`);

          if (shouldReconnect) {
            // Re-initialize after 5 seconds
            setTimeout(() => {
              this.initialize().catch((err) => {
                logger.error('Failed to re-initialize WhatsApp:', err);
              });
            }, 5000);
          } else {
            // Logged out — clear session from DB
            logger.info('WhatsApp logged out. Clearing database session.');
            await prisma.whatsAppSession.deleteMany();
            // Restart to generate new QR
            setTimeout(() => {
              this.initialize().catch((err) => {
                logger.error('Failed to restart WhatsApp after logout:', err);
              });
            }, 3000);
          }
        }
      });
    } catch (error) {
      logger.error('WhatsApp initialization error:', error);
      setTimeout(() => this.initialize(), 10000);
    }
  }

  getStatus() {
    // Sync from live socket if possible
    if (this.sock?.user?.id) {
      this.isReady = true;
      this.isConnecting = false;
      this.connectedPhone = this.sock.user.id.split(':')[0];
    }
    return {
      connected: this.isReady,
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

  private formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    const withCountry = digits.startsWith('91') ? digits : `91${digits}`;
    return `${withCountry}@s.whatsapp.net`;
  }

  private async enforceRateLimit() {
    const elapsed = Date.now() - this.lastSentAt;
    if (elapsed < 3000) {
      await new Promise(resolve => setTimeout(resolve, 3000 - elapsed));
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
  ): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    const jid = this.formatPhone(phone);

    // Sync from live socket — most reliable check
    const actuallyConnected = !!(this.sock?.user?.id);
    if (actuallyConnected) {
      this.isReady = true;
      this.isConnecting = false;
      this.connectedPhone = this.sock!.user!.id.split(':')[0];
    }

    if (!actuallyConnected || !this.sock) {
      const errMsg = 'WhatsApp client is not connected. Please pair QR first.';
      logger.warn(`Cannot send message. Client not connected. Recipient: ${phone}`);
      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }

    try {
      await this.enforceRateLimit();

      if (type === MessageType.REMINDER_1) {
        // Attempt to send payment QR image as media
        try {
          const qrImagePath = path.resolve(process.cwd(), 'apps/server/src/assets/payment_qr.jpg');
          if (fs.existsSync(qrImagePath)) {
            const imageBuffer = fs.readFileSync(qrImagePath);
            await this.sock.sendMessage(jid, {
              image: imageBuffer,
              caption: body,
              mimetype: 'image/jpeg',
            });
          } else {
            logger.warn(`Payment QR image not found at ${qrImagePath}. Sending text only.`);
            await this.sock.sendMessage(jid, { text: body });
          }
        } catch (mediaErr) {
          logger.error('Failed to send QR image media, falling back to text:', mediaErr);
          await this.sock.sendMessage(jid, { text: body });
        }
      } else {
        await this.sock.sendMessage(jid, { text: body });
      }

      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, status: MessageStatus.SENT, sentAt: now, createdAt: now },
      });
      return { success: true };
    } catch (err: any) {
      const errMsg = err?.message || 'Unknown send error in WhatsApp client';
      logger.error(`Failed to send WhatsApp message to ${phone}:`, err);
      await prisma.whatsAppMessage.create({
        data: { studentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
      });
      return { success: false, error: errMsg };
    }
  }

  async sendTemplate(
    studentId: string,
    type: MessageType,
    extraVars?: Record<string, string>
  ): Promise<void> {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { route: true },
    });
    if (!student) throw new Error(`Student ${studentId} not found`);

    const settings = await prisma.settings.findMany();
    const getSetting = (key: string) => settings.find(s => s.key === key)?.value ?? '';

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

    const templates = TEMPLATES;

    let body = templates[type] ?? '';
    // First, resolve the nested custom message if provided
    if (extraVars?.message) {
      body = body.replaceAll('{message}', extraVars.message);
    }

    // Resolve all other variables
    for (const [key, value] of Object.entries(vars)) {
      body = body.replaceAll(`{${key}}`, value);
    }

    await this.sendMessage(student.whatsappNumber, body, studentId, type);
  }

  async sendConfirmation(studentId: string, paymentId: string): Promise<void> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { student: true },
    });
    if (!payment) return;

    const paidDate = payment.paidAt
      ? new Date(payment.paidAt).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric'
        })
      : new Date().toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric'
        });

    await this.sendTemplate(studentId, MessageType.CONFIRMATION, {
      receiptId: `PAY-${payment.year}-${paymentId.slice(-6).toUpperCase()}`,
      studentName: payment.student?.name ?? '',
      paidDate,
      amount: this.formatAmount(payment.amount),
      month: this.formatMonth(payment.month, payment.year),
    });
  }

  async broadcastToList(
    studentIds: string[],
    type: MessageType,
    extraVars?: Record<string, string>
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    for (const id of studentIds) {
      try {
        await this.sendTemplate(id, type, extraVars);
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  }

  async logout(): Promise<void> {
    await this.sock?.logout();
    await prisma.whatsAppSession.deleteMany();
    this.isReady = false;
    this.isConnecting = false;
    this.connectedPhone = null;
    this.qrBase64 = null;
    broadcastSSE('status', { connected: false, phone: null });
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

To pay and confirm:
1️⃣ Pay ₹{amount} via UPI to: {upiId}
2️⃣ Submit your payment screenshot here:
👉 ${PAY_CONFIRM_URL}

Fill in your name, mobile number, and upload the screenshot. Our team will verify and send your receipt.

Thank you,
{businessName}`,

  [MessageType.REMINDER_2]: `Dear {parentName},

🔔 Reminder: Transport fee of ₹{amount} for {month} is still pending.

Please pay and confirm at:
👉 ${PAY_CONFIRM_URL}

Steps:
1️⃣ Pay ₹{amount} to UPI: {upiId}
2️⃣ Upload screenshot at the link above

{businessName}`,

  [MessageType.REMINDER_3]: `Dear {parentName},

⚠️ Final Reminder: Transport fee ₹{amount} for {month} is still unpaid.

Please complete payment immediately:
1️⃣ Pay ₹{amount} to UPI: {upiId}
2️⃣ Submit proof: ${PAY_CONFIRM_URL}

Failure to pay may affect transport service.

{businessName}`,

  [MessageType.FINAL]: `🚨 URGENT: Dear {parentName},

Transport fee ₹{amount} for {month} is OVERDUE.

Pay immediately and submit proof:
👉 ${PAY_CONFIRM_URL}

UPI: {upiId}

Contact admin: {adminWhatsapp}

{businessName}`,

  [MessageType.CONFIRMATION]: `✅ Payment Confirmed!

Dear {parentName},

We have verified your payment of ₹{amount} for {month}.

🧾 Receipt No: {receiptId}
📅 Date: {paidDate}
🏫 Student: {studentName}

Your receipt has been recorded. Thank you for the prompt payment! 🙏

{businessName}
${PAY_CONFIRM_URL}`,

  [MessageType.EMERGENCY]: `⚠️ Notice from {businessName}:

{message}

For any queries: {adminWhatsapp}`,

  [MessageType.BROADCAST]: `{message}`,
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
