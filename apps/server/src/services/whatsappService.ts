import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import type { Response as ExpressResponse } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { MessageType, MessageStatus } from '@prisma/client';

let whatsappClient: Client | null = null;
let qrCodeBase64: string | null = null;
let isConnected = false;
let isConnecting = false;
let clientPhone: string | null = null;

// SSE clients registry — push real-time status to all open browser tabs
const sseClients: Set<ExpressResponse> = new Set();

function broadcastSSE(event: string, data: object) {
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
 * Normalizes an Indian phone number to WhatsApp format.
 * E.g., "9848022338" -> "919848022338@c.us"
 */
function formatWhatsAppNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  if (!cleaned.endsWith('@c.us')) {
    cleaned = cleaned + '@c.us';
  }
  return cleaned;
}

/**
 * Initialize the WhatsApp Web Client
 */
export async function initWhatsApp(): Promise<void> {
  logger.info('Initializing WhatsApp client...');

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  whatsappClient.on('qr', async (qr) => {
    logger.info('WhatsApp QR Code generated.');
    isConnecting = true;
    try {
      // Generate a base64 PNG data URL
      qrCodeBase64 = await QRCode.toDataURL(qr);
      // Push new QR to all open browser tabs via SSE
      broadcastSSE('qr', { qr: qrCodeBase64 });
    } catch (err) {
      logger.error('Failed to convert QR code to base64:', err);
    }
  });

  whatsappClient.on('ready', () => {
    isConnected = true;
    isConnecting = false;
    qrCodeBase64 = null;
    clientPhone = whatsappClient?.info.wid.user ?? null;
    logger.info(`WhatsApp client is ready. Connected as: ${clientPhone}`);
    // Immediately push connected state to all open browser tabs
    broadcastSSE('status', { connected: true, phone: clientPhone });
  });

  whatsappClient.on('authenticated', () => {
    logger.info('WhatsApp client successfully authenticated.');
    // Push authenticated (in-progress) state — still not fully ready yet
    broadcastSSE('status', { connected: false, phone: null, authenticating: true });
  });

  whatsappClient.on('auth_failure', (msg) => {
    logger.error('WhatsApp authentication failed:', msg);
    isConnected = false;
    isConnecting = false;
    qrCodeBase64 = null;
    broadcastSSE('status', { connected: false, phone: null, error: 'Authentication failed' });
  });

  whatsappClient.on('disconnected', (reason) => {
    logger.warn(`WhatsApp client was disconnected: ${reason}`);
    isConnected = false;
    isConnecting = false;
    clientPhone = null;
    qrCodeBase64 = null;
    broadcastSSE('status', { connected: false, phone: null, reason });

    // Retry connection after 10 seconds
    setTimeout(() => {
      if (whatsappClient) {
        logger.info('Attempting to re-initialize WhatsApp client...');
        isConnecting = true;
        whatsappClient.initialize().catch((err) => {
          isConnecting = false;
          logger.error('Failed to re-initialize WhatsApp client:', err);
        });
      }
    }, 10000);
  });

  try {
    await whatsappClient.initialize();
  } catch (err) {
    logger.error('Error starting WhatsApp client:', err);
    throw err;
  }
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
  if (whatsappClient && whatsappClient.info && whatsappClient.info.wid) {
    isConnected = true;
    isConnecting = false;
    qrCodeBase64 = null;
    clientPhone = whatsappClient.info.wid.user;
  }
  return {
    connected: isConnected,
    phone: clientPhone,
  };
}

/**
 * Actively query Puppeteer / WhatsApp Web client to synchronize state
 */
export async function syncWhatsAppStatus(): Promise<{ connected: boolean; phone: string | null }> {
  if (whatsappClient) {
    try {
      if (whatsappClient.info && whatsappClient.info.wid) {
        isConnected = true;
        isConnecting = false;
        qrCodeBase64 = null;
        clientPhone = whatsappClient.info.wid.user;
      } else {
        const state = await whatsappClient.getState();
        if (state === 'CONNECTED') {
          isConnected = true;
          isConnecting = false;
          qrCodeBase64 = null;
          if (whatsappClient.info?.wid?.user) {
            clientPhone = whatsappClient.info.wid.user;
          }
        }
      }
    } catch (err) {
      // client might not be ready for getState yet
    }
  }
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
): Promise<boolean> {
  const formattedPhone = formatWhatsAppNumber(phone);
  const now = new Date();

  // 1. If not connected, fail immediately and log as FAILED
  if (!isConnected || !whatsappClient) {
    logger.warn(`Cannot send WhatsApp message. Client not connected. Recipient: ${phone}`);
    await prisma.whatsAppMessage.create({
      data: {
        studentId,
        phone,
        type,
        body,
        status: MessageStatus.FAILED,
        errorMessage: 'WhatsApp client is not connected',
        createdAt: now,
      },
    });
    return false;
  }

  try {
    if (type === MessageType.REMINDER_1) {
      try {
        const path = require('path');
        const fs = require('fs');
        const qrPath = path.resolve(__dirname, '../assets/payment_qr.jpg');
        if (fs.existsSync(qrPath)) {
          const media = MessageMedia.fromFilePath(qrPath);
          await whatsappClient.sendMessage(formattedPhone, media, { caption: body });
        } else {
          logger.warn(`Payment QR image not found at ${qrPath}. Sending text only.`);
          await whatsappClient.sendMessage(formattedPhone, body);
        }
      } catch (mediaErr) {
        logger.error('Failed to send QR code image media. Falling back to text-only send:', mediaErr);
        await whatsappClient.sendMessage(formattedPhone, body);
      }
    } else {
      await whatsappClient.sendMessage(formattedPhone, body);
    }

    // Save record to DB as SENT
    await prisma.whatsAppMessage.create({
      data: {
        studentId,
        phone,
        type,
        body,
        status: MessageStatus.SENT,
        sentAt: now,
        createdAt: now,
      },
    });
    return true;
  } catch (err: any) {
    logger.error(`Failed to send WhatsApp message to ${phone}:`, err);

    // Save record to DB as FAILED
    await prisma.whatsAppMessage.create({
      data: {
        studentId,
        phone,
        type,
        body,
        status: MessageStatus.FAILED,
        errorMessage: err.message || 'Unknown send error',
        createdAt: now,
      },
    });
    return false;
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

    // Load business settings
    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
    const businessName = settingsMap.get('businessName') || 'Sri Sai Travels';

    // Format fields
    const amountRupees = (payment.amount / 100).toFixed(0);
    const monthsNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
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
 * Triggers batch broadcast with an enforced 3-second spacing rate limit
 * to avoid account bans. Non-blocking to API response.
 */
export function sendBroadcast(
  phones: string[],
  type: MessageType,
  variables: Record<string, string>,
  studentIdMap?: Record<string, string>, // Optional mapping of phone -> studentId
): void {
  // Run asynchronously in the background
  (async () => {
    const templateText = TEMPLATES[type] || '{body}';
    logger.info(`Starting WhatsApp broadcast for ${phones.length} recipients...`);

    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];
      const studentId = studentIdMap ? studentIdMap[phone] : null;

      // Rate limiting: wait 3 seconds between messages (skip first iteration)
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // Format custom body variables
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
