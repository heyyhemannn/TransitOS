import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { MessageType, MessageStatus } from '@prisma/client';

let whatsappClient: Client | null = null;
let qrCodeBase64: string | null = null;
let isConnected = false;
let clientPhone: string | null = null;

export const TEMPLATES: Record<MessageType, string> = {
  [MessageType.REMINDER_1]:
    'Dear {parentName},\n\nTransport fee reminder for {studentName}:\nTransport fee of ₹{amount} for {month} is due.\nKindly pay before 10th.\n\nPayment Options:\n• PhonePe/GPay: 9010009976\n• UPI ID: {upiId}\n\nKindly update your payment screenshot and reference ID to confirm: {webAppUrl}/pay-confirm\n\nThank you,\n{businessName}',
  [MessageType.REMINDER_2]:
    'Dear {parentName},\n\nReminder: Transport fee of ₹{amount} for {month} is still pending for {studentName}. Please pay before 15th.\n\nKindly update your payment screenshot and reference ID to confirm: {webAppUrl}/pay-confirm\n\nThank you,\n{businessName}',
  [MessageType.REMINDER_3]:
    'URGENT NOTICE: Dear {parentName},\n\nTransport fee of ₹{amount} for {month} is highly overdue for {studentName}. Please clear it immediately to avoid route suspension.\n\nKindly update your payment screenshot and reference ID to confirm: {webAppUrl}/pay-confirm\n\nThank you,\n{businessName}',
  [MessageType.FINAL]:
    'FINAL WARNING: Dear {parentName},\n\nTransport fee of ₹{amount} for {month} is now OVERDUE for {studentName}.\nPlease pay immediately to avoid service disruption.\n\nKindly update your payment screenshot and reference ID to confirm: {webAppUrl}/pay-confirm\n\nThank you,\n{businessName}',
  [MessageType.CONFIRMATION]:
    '✅ Payment Received!\n\nDear {parentName}, ₹{amount} received for {month} ({studentName}).\nReceipt No: {receiptId}\n\nThank you! 🙏\n{businessName}',
  [MessageType.EMERGENCY]:
    '🚨 EMERGENCY TRANSPORT NOTICE:\n\n{body}\n\n{businessName}',
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
    try {
      // Generate a base64 PNG data URL
      qrCodeBase64 = await QRCode.toDataURL(qr);
    } catch (err) {
      logger.error('Failed to convert QR code to base64:', err);
    }
  });

  whatsappClient.on('ready', () => {
    isConnected = true;
    qrCodeBase64 = null;
    clientPhone = whatsappClient?.info.wid.user ?? null;
    logger.info(`WhatsApp client is ready. Connected as: ${clientPhone}`);
  });

  whatsappClient.on('authenticated', () => {
    logger.info('WhatsApp client successfully authenticated.');
  });

  whatsappClient.on('auth_failure', (msg) => {
    logger.error('WhatsApp authentication failed:', msg);
    isConnected = false;
    qrCodeBase64 = null;
  });

  whatsappClient.on('disconnected', (reason) => {
    logger.warn(`WhatsApp client was disconnected: ${reason}`);
    isConnected = false;
    clientPhone = null;
    qrCodeBase64 = null;

    // Retry connection after 10 seconds
    setTimeout(() => {
      if (whatsappClient) {
        logger.info('Attempting to re-initialize WhatsApp client...');
        whatsappClient.initialize().catch((err) => {
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
  return {
    connected: isConnected,
    phone: clientPhone,
  };
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
