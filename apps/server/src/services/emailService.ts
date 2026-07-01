import nodemailer from 'nodemailer';
import { logger } from '../lib/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmailNotification(to: string, subject: string, text: string, html?: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('[Email] SMTP_USER or SMTP_PASS not configured in environment. Skipping email notification.');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"TransitOS Notifications" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
    logger.info(`[Email] Notification sent: ${info.messageId}`);
  } catch (error) {
    logger.error('[Email] Failed to send email notification:', error);
  }
}
