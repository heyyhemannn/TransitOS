import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, MessageType, StudentStatus } from '@prisma/client';
import {
  getWhatsAppStatus,
  getWhatsAppQR,
  sendWhatsAppMessage,
  formatTemplate,
  TEMPLATES,
} from '../services/whatsappService';
import { logger } from '../lib/logger';

export const whatsappRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────
const mobileRegex = /^[6-9]\d{9}$/;

const sendMessageSchema = z.object({
  phone: z.string().regex(mobileRegex, 'Recipient phone must be a valid 10-digit number'),
  body: z.string().min(1, 'Message body is required'),
});

const broadcastSchema = z.object({
  studentIds: z.array(z.string()).min(1, 'At least one student must be selected'),
  type: z.nativeEnum(MessageType),
  customText: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/whatsapp/status
 * Check current pairing connectivity details
 */
whatsappRouter.get(
  '/status',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  (req: Request, res: Response): void => {
    const status = getWhatsAppStatus();
    res.json({
      success: true,
      data: status,
    });
  },
);

/**
 * GET /api/v1/whatsapp/qr
 * Retrieve current active base64 PNG QR code
 */
whatsappRouter.get(
  '/qr',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  (req: Request, res: Response): void => {
    const qr = getWhatsAppQR();
    res.json({
      success: true,
      data: { qr },
    });
  },
);

/**
 * POST /api/v1/whatsapp/send
 * Sends a one-off custom WhatsApp message to a specific number
 */
whatsappRouter.post(
  '/send',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { phone, body } = sendMessageSchema.parse(req.body);

      const status = getWhatsAppStatus();
      if (!status.connected) {
        res.status(503).json({
          success: false,
          error: 'WhatsApp service is not connected. Pair QR first.',
        });
        return;
      }

      const sent = await sendWhatsAppMessage(phone, body, null, MessageType.BROADCAST);
      if (sent) {
        res.json({ success: true, data: { message: 'Message sent successfully' } });
      } else {
        res.status(500).json({ success: false, error: 'Failed to send WhatsApp message' });
      }
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/whatsapp/broadcast
 * Triggers batch broadcast messages with 3s spacing rate-limits in the background
 */
whatsappRouter.post(
  '/broadcast',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentIds, type, customText } = broadcastSchema.parse(req.body);

      const status = getWhatsAppStatus();
      if (!status.connected) {
        res.status(503).json({
          success: false,
          error: 'WhatsApp service is not connected. Pair QR first.',
        });
        return;
      }

      // Fetch target students
      const students = await prisma.student.findMany({
        where: {
          id: { in: studentIds },
          status: StudentStatus.ACTIVE,
        },
      });

      if (students.length === 0) {
        res.status(404).json({
          success: false,
          error: 'No active students found for selected IDs',
        });
        return;
      }

      // Load Settings
      const settingsList = await prisma.settings.findMany();
      const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
      const businessName = settingsMap.get('businessName') || 'Sri Sai Travels';
      const upiId = settingsMap.get('upiId') || 'yourupi@ybl';

      // Date variables
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
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
      const monthName = monthsNames[nowIST.getMonth()];
      const year = nowIST.getFullYear();

      // Trigger broadcast loop in background
      (async () => {
        logger.info(`Starting broadcast loop for ${students.length} recipients. Spacing: 3 seconds.`);

        for (let i = 0; i < students.length; i++) {
          const student = students[i];

          // 3-second spacing rate limit
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }

          let body = '';
          if (type === MessageType.BROADCAST) {
            body = customText || '';
          } else {
            const templateText = TEMPLATES[type];
            body = formatTemplate(templateText, {
              parentName: student.parentName,
              amount: (student.monthlyFee / 100).toFixed(0),
              month: `${monthName} ${year}`,
              upiId,
              businessName,
            });
          }

          try {
            await sendWhatsAppMessage(student.whatsappNumber, body, student.id, type);
          } catch (err) {
            logger.error(`Broadcast failed for student ${student.name} (${student.id}):`, err);
          }
        }

        logger.info(`Broadcast loop completed for ${students.length} recipients.`);
      })().catch((err) => {
        logger.error('Error in WhatsApp broadcast loop:', err);
      });

      res.json({
        success: true,
        data: {
          message: `Broadcast queued successfully for ${students.length} recipients`,
          queuedCount: students.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/whatsapp/broadcast-unpaid
 * Sends broadcast reminders to all active students who have NOT paid for the current month
 */
whatsappRouter.post(
  '/broadcast-unpaid',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMonth = nowIST.getMonth() + 1;
      const currentYear = nowIST.getFullYear();

      // Find all active students
      const activeStudents = await prisma.student.findMany({
        where: { status: StudentStatus.ACTIVE },
      });

      // Find all paid schedules for this month
      const paidSchedules = await prisma.feeSchedule.findMany({
        where: {
          month: currentMonth,
          year: currentYear,
          isPaid: true,
        },
        select: { studentId: true },
      });

      const paidStudentIds = new Set(paidSchedules.map((s) => s.studentId));

      // Filter to unpaid active students
      const unpaidStudents = activeStudents.filter((s) => !paidStudentIds.has(s.id));

      if (unpaidStudents.length === 0) {
        res.json({
          success: true,
          data: {
            message: 'All active students have already paid for this month!',
            queuedCount: 0,
          },
        });
        return;
      }

      // Group unpaid students by whatsappNumber
      const unpaidByPhone = new Map<string, typeof unpaidStudents>();
      for (const student of unpaidStudents) {
        const phone = student.whatsappNumber.trim();
        if (!unpaidByPhone.has(phone)) {
          unpaidByPhone.set(phone, []);
        }
        unpaidByPhone.get(phone)!.push(student);
      }

      const status = getWhatsAppStatus();
      if (!status.connected) {
        res.status(503).json({
          success: false,
          error: 'WhatsApp service is not connected. Pair QR first.',
        });
        return;
      }

      // Load Settings
      const settingsList = await prisma.settings.findMany();
      const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
      const businessName = settingsMap.get('businessName') || 'Sri Sai Travels';
      const upiId = settingsMap.get('upiId') || 'yourupi@ybl';

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
      const monthName = monthsNames[nowIST.getMonth()];

      // Trigger broadcast loop in background
      (async () => {
        logger.info(`Starting broadcast loop for ${unpaidByPhone.size} unique recipients.`);

        let idx = 0;
        for (const [phone, group] of unpaidByPhone.entries()) {
          // 3-second spacing rate limit
          if (idx > 0) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
          idx++;

          const parentName = group[0].parentName;
          const studentName = group.map((s) => s.name).join(' & ');
          const totalAmount = group.reduce((sum, s) => sum + s.monthlyFee, 0);
          const amountRupees = (totalAmount / 100).toFixed(0);

          const templateText = TEMPLATES[MessageType.REMINDER_1];
          const body = formatTemplate(templateText, {
            parentName,
            studentName,
            amount: amountRupees,
            month: `${monthName} ${currentYear}`,
            upiId,
            businessName,
          });

          try {
            await sendWhatsAppMessage(phone, body, group[0].id, MessageType.REMINDER_1);
          } catch (err) {
            logger.error(`Broadcast failed for unpaid parent phone ${phone}:`, err);
          }
        }

        logger.info(`Broadcast loop completed for ${unpaidByPhone.size} unique numbers.`);
      })().catch((err) => {
        logger.error('Error in WhatsApp broadcast unpaid loop:', err);
      });

      res.json({
        success: true,
        data: {
          message: `Broadcast queued successfully for ${unpaidStudents.length} unpaid students (${unpaidByPhone.size} unique numbers)`,
          queuedCount: unpaidByPhone.size,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/whatsapp/send-demo
 * Sends a demo payment reminder with QR code scanner image to a target number
 */
whatsappRouter.post(
  '/send-demo',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { phone } = z.object({
        phone: z.string().regex(mobileRegex, 'Recipient phone must be a valid 10-digit number'),
      }).parse(req.body);

      const status = getWhatsAppStatus();
      if (!status.connected) {
        res.status(503).json({
          success: false,
          error: 'WhatsApp service is not connected. Pair QR first.',
        });
        return;
      }

      const settingsList = await prisma.settings.findMany();
      const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
      const businessName = settingsMap.get('businessName') || 'Hemanth Transport Services';
      const upiId = settingsMap.get('upiId') || '9010009967@axl';

      const body = formatTemplate(TEMPLATES[MessageType.REMINDER_1], {
        parentName: 'Test Parent (Demo)',
        studentName: 'Omi Karthikeya N & Harshini Chakrika N',
        amount: '4000',
        month: 'July 2026',
        upiId,
        businessName,
      });

      const sent = await sendWhatsAppMessage(phone, body, null, MessageType.REMINDER_1);
      if (sent) {
        res.json({ success: true, data: { message: 'Demo reminder sent successfully' } });
      } else {
        res.status(500).json({ success: false, error: 'Failed to send demo message' });
      }
    } catch (error) {
      next(error);
    }
  },
);
