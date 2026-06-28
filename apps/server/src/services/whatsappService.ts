import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
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
import { MessageType, MessageStatus } from '@prisma/client';

// Memory buffer for Baileys logs
export const baileysLogsBuffer: string[] = [];

// Custom Pino logger for Baileys internals that writes to memory buffer
const baileysLogger = P(
  { level: 'debug' },
  {
    write(msg: string) {
      try {
        const parsed = JSON.parse(msg);
        const time = parsed.time ? new Date(parsed.time).toISOString() : new Date().toISOString();
        const levelVal = parsed.level;
        const levelName = levelVal === 30 ? 'INFO' : levelVal === 40 ? 'WARN' : levelVal >= 50 ? 'ERROR' : 'DEBUG';
        const formattedMsg = `${time} [${levelName}]: ${parsed.msg || ''} ${parsed.err ? JSON.stringify(parsed.err) : ''}`;
        baileysLogsBuffer.push(formattedMsg);
      } catch {
        baileysLogsBuffer.push(msg.trim());
      }
      if (baileysLogsBuffer.length > 300) {
        baileysLogsBuffer.shift();
      }
    }
  }
);

// ─── State ───────────────────────────────────────────────────────────────────
let waSocket: WASocket | null = null;
let qrCodeBase64: string | null = null;
let isConnected = false;
let isConnecting = false;
let clientPhone: string | null = null;

// ─── SSE: Real-time push to all browser tabs ─────────────────────────────────
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

export function getWhatsAppConnecting(): boolean {
  return isConnecting;
}

// ─── Message Templates ───────────────────────────────────────────────────────
export const TEMPLATES: Record<MessageType, string> = {
  [MessageType.REMINDER_1]:
    'Dear {parentName},\n\n🚌 *Transport Fee Reminder*\n\nFee of *₹{amount}* for *{month}* is due for *{studentName}*.\nKindly pay before the 10th to avoid disruption.\n\n💳 *Payment Options:*\n• PhonePe / GPay: *9010009976*\n• UPI ID: *{upiId}*\n\n✅ *Already Paid?*\nPlease upload your payment screenshot here so we can mark it as paid quickly:\n👉 {webAppUrl}/pay-confirm\n\nThank you 🙏\n_{businessName}_',
  [MessageType.REMINDER_2]:
    'Dear {parentName},\n\n⚠️ *Pending Fee Alert*\n\nTransport fee of *₹{amount}* for *{month}* is still unpaid for *{studentName}*.\nPlease clear before the 15th.\n\n✅ *Already Paid?*\nUpload your payment screenshot here — takes only 30 seconds:\n👉 {webAppUrl}/pay-confirm\n\nThank you,\n_{businessName}_',
  [MessageType.REMINDER_3]:
    'Dear {parentName},\n\n🚨 *URGENT: Fee Overdue*\n\nTransport fee of *₹{amount}* for *{month}* is highly overdue for *{studentName}*. Please pay *immediately* to avoid suspension of transport service.\n\n✅ *Already Paid?*\nSubmit your proof here so we can verify right away:\n👉 {webAppUrl}/pay-confirm\n\nThank you,\n_{businessName}_',
  [MessageType.FINAL]:
    'Dear {parentName},\n\n🚫 *FINAL NOTICE*\n\nTransport fee of *₹{amount}* for *{month}* is now OVERDUE for *{studentName}*.\nService will be *suspended* if not cleared immediately.\n\n✅ *Already Paid?*\nSubmit proof here to avoid disruption:\n👉 {webAppUrl}/pay-confirm\n\nThank you,\n_{businessName}_',
  [MessageType.CONFIRMATION]:
    '✅ *Payment Received!*\n\nDear {parentName}, ₹{amount} received for *{month}* — *{studentName}*.\nReceipt No: `{receiptId}`\n\nThank you! 🙏\n_{businessName}_',
  [MessageType.EMERGENCY]:
    '🚨 EMERGENCY TRANSPORT NOTICE:\n\n{body}\n\n_{businessName}_',
  [MessageType.BROADCAST]:
    '{body}',
};

/**
 * Format templates with variable substitutions
 */
export function formatTemplate(templateText: string, vars: Record<string, string>): string {
  let text = templateText;
  for (const [key, value] of Object.entries(vars)) {
    text = text.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  return text;
}

/**
 * Normalizes an Indian phone number to WhatsApp JID format.
 * E.g., "9848022338" -> "919848022338@s.whatsapp.net"
 */
function formatWhatsAppJID(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = cleaned + '@s.whatsapp.net';
  }
  return cleaned;
}

// ─── Auth state directory ────────────────────────────────────────────────────
const AUTH_DIR = path.resolve(process.cwd(), './whatsapp-session');

/**
 * Initialize the WhatsApp Baileys client (WebSocket, no Chromium)
 */
export async function initWhatsApp(): Promise<void> {
  logger.info('Initializing WhatsApp client via Baileys (WebSocket)...');

  // Ensure session directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  logger.info(`Using Baileys version: ${version.join('.')}`);

  waSocket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    printQRInTerminal: false,
    logger: baileysLogger,
    // Reduce memory usage
    msgRetryCounterCache: {} as any,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  // ── QR Code event ──────────────────────────────────────────────────────────
  waSocket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      isConnecting = true;
      try {
        qrCodeBase64 = await QRCode.toDataURL(qr);
        logger.info('WhatsApp QR Code generated — waiting for scan.');
        broadcastSSE('qr', { qr: qrCodeBase64 });
      } catch (err) {
        logger.error('Failed to convert QR to base64:', err);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      isConnected = false;
      isConnecting = false;
      clientPhone = null;
      qrCodeBase64 = null;
      broadcastSSE('status', { connected: false, phone: null });

      logger.warn(`WhatsApp connection closed. Code=${statusCode} Reconnect=${shouldReconnect}`);

      if (shouldReconnect) {
        // Re-initialize after 5 seconds
        setTimeout(() => {
          initWhatsApp().catch((err) => {
            logger.error('Failed to re-initialize WhatsApp:', err);
          });
        }, 5000);
      } else {
        // Logged out — clear session so fresh QR is shown
        logger.info('WhatsApp logged out. Clearing session directory.');
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
        } catch (e) { /* ignore */ }
        // Restart to generate new QR
        setTimeout(() => {
          initWhatsApp().catch((err) => {
            logger.error('Failed to restart WhatsApp after logout:', err);
          });
        }, 3000);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      isConnecting = false;
      qrCodeBase64 = null;
      clientPhone = waSocket?.user?.id?.split(':')[0] ?? null;
      logger.info(`WhatsApp connected. Phone: ${clientPhone}`);
      broadcastSSE('status', { connected: true, phone: clientPhone });
    }

    if (connection === 'connecting') {
      isConnecting = true;
      broadcastSSE('status', { connected: false, phone: null, authenticating: true });
    }
  });

  // ── Save credentials when updated ─────────────────────────────────────────
  waSocket.ev.on('creds.update', saveCreds);
}

/**
 * Get the current QR code base64 image data URL
 */
export function getWhatsAppQR(): string | null {
  return qrCodeBase64;
}

/**
 * Get the current connection status of the WhatsApp client
 */
export function getWhatsAppStatus(): { connected: boolean; phone: string | null } {
  // Sync from live socket if possible
  if (waSocket?.user?.id) {
    isConnected = true;
    isConnecting = false;
    clientPhone = waSocket.user.id.split(':')[0];
  }
  return {
    connected: isConnected,
    phone: clientPhone,
  };
}

/**
 * Actively synchronize WhatsApp connection status (lightweight, no Puppeteer IPC)
 */
export async function syncWhatsAppStatus(): Promise<{ connected: boolean; phone: string | null }> {
  return getWhatsAppStatus();
}

/**
 * Send a single WhatsApp message and log it to the database.
 */
export async function sendWhatsAppMessage(
  phone: string,
  body: string,
  studentId: string | null = null,
  type: MessageType = MessageType.BROADCAST,
): Promise<{ success: boolean; error?: string }> {
  const now = new Date();
  const jid = formatWhatsAppJID(phone);

  // Sync from live socket — most reliable check
  const actuallyConnected = !!(waSocket?.user?.id);
  if (actuallyConnected) {
    isConnected = true;
    isConnecting = false;
    clientPhone = waSocket!.user!.id.split(':')[0];
  }

  if (!actuallyConnected || !waSocket) {
    const errMsg = 'WhatsApp client is not connected. Please pair QR first.';
    logger.warn(`Cannot send message. Client not connected. Socket=${!!waSocket} user=${!!waSocket?.user?.id}. Recipient: ${phone}`);
    await prisma.whatsAppMessage.create({
      data: { studentId, phone, type, body, status: MessageStatus.FAILED, errorMessage: errMsg, createdAt: now },
    });
    return { success: false, error: errMsg };
  }

  try {
    if (type === MessageType.REMINDER_1) {
      // Attempt to send payment QR image as media
      try {
        const qrImagePath = path.resolve(process.cwd(), 'apps/server/src/assets/payment_qr.jpg');
        if (fs.existsSync(qrImagePath)) {
          const imageBuffer = fs.readFileSync(qrImagePath);
          await waSocket.sendMessage(jid, {
            image: imageBuffer,
            caption: body,
            mimetype: 'image/jpeg',
          });
        } else {
          logger.warn(`Payment QR image not found at ${qrImagePath}. Sending text only.`);
          await waSocket.sendMessage(jid, { text: body });
        }
      } catch (mediaErr) {
        logger.error('Failed to send QR image media, falling back to text:', mediaErr);
        await waSocket.sendMessage(jid, { text: body });
      }
    } else {
      await waSocket.sendMessage(jid, { text: body });
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

/**
 * Sends a payment confirmation message to a parent.
 */
export async function sendConfirmation(studentId: string, paymentId: string): Promise<void> {
  try {
    const [student, payment, settingsList] = await Promise.all([
      prisma.student.findUnique({ where: { id: studentId } }),
      prisma.payment.findUnique({ where: { id: paymentId } }),
      prisma.settings.findMany(),
    ]);

    if (!student || !payment) {
      logger.error(`Skipping WhatsApp confirmation. Student ${studentId} or Payment ${paymentId} not found.`);
      return;
    }

    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
    const businessName = settingsMap.get('businessName') || 'Sri Sai Travels';

    const amountRupees = (payment.amount / 100).toFixed(0);
    const monthsNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = monthsNames[payment.month - 1];

    const body = formatTemplate(TEMPLATES[MessageType.CONFIRMATION], {
      parentName: student.parentName,
      amount: amountRupees,
      month: `${monthName} ${payment.year}`,
      receiptId: `PAY-${payment.year}-${String(payment.id).slice(-6).toUpperCase()}`,
      businessName,
    });

    await sendWhatsAppMessage(student.whatsappNumber, body, student.id, MessageType.CONFIRMATION);
  } catch (err) {
    logger.error(`Error in sendConfirmation for student ${studentId}:`, err);
  }
}

/**
 * Triggers batch broadcast with an enforced 3-second spacing rate limit.
 * Non-blocking — runs in background.
 */
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

/**
 * Exposes internal WhatsApp state for debugging
 */
export function getWhatsAppDebugInfo() {
  return {
    socketExists: !!waSocket,
    user: waSocket?.user ? { id: waSocket.user.id, name: waSocket.user.name } : null,
    isConnected,
    isConnecting,
    clientPhone,
    qrLength: qrCodeBase64 ? qrCodeBase64.length : 0,
    sessionFiles: fs.existsSync(AUTH_DIR) ? fs.readdirSync(AUTH_DIR) : [],
    baileysLogs: baileysLogsBuffer,
  };
}
