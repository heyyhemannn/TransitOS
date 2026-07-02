import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, MessageType, StudentStatus, MessageStatus } from '@prisma/client';
import {
  getWhatsAppStatus,
  syncWhatsAppStatus,
  getWhatsAppQR,
  getWhatsAppConnecting,
  sendWhatsAppMessage,
  formatTemplate,
  TEMPLATES,
  registerSSEClient,
  unregisterSSEClient,
  whatsappService,
} from '../services/whatsappService';
import { logger } from '../lib/logger';
import { getUnpaidStudents } from '../services/schedulerService';

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
  async (req: Request, res: Response): Promise<void> => {
    const status = await syncWhatsAppStatus();
    res.json({
      success: true,
      data: {
        ...status,
        connecting: getWhatsAppConnecting(),
      },
    });
  },
);

/**
 * GET /api/v1/whatsapp/events
 * Server-Sent Events stream — pushes real-time status and QR updates to the browser.
 * The frontend subscribes to this and immediately reflects QR scan / connect / disconnect.
 */
whatsappRouter.get(
  '/events',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  (req: Request, res: Response): void => {
    // Manual CORS for SSE — middleware doesn't cover streaming responses
    res.setHeader('Access-Control-Allow-Origin', 'https://transitos.vercel.app');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    // Register this client
    registerSSEClient(res);

    // Send current state immediately on connect
    const currentStatus = getWhatsAppStatus();
    const currentQR = getWhatsAppQR();
    res.write(`event: status\ndata: ${JSON.stringify({ ...currentStatus, connecting: getWhatsAppConnecting() })}\n\n`);
    if (currentQR) {
      res.write(`event: qr\ndata: ${JSON.stringify({ qr: currentQR })}\n\n`);
    }

    // Send periodic heartbeat to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      unregisterSSEClient(res);
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

      const result = await sendWhatsAppMessage(phone, body, null, MessageType.BROADCAST);
      if (result.success) {
        res.json({ success: true, data: { message: 'Message sent successfully' } });
      } else {
        res.status(400).json({ success: false, error: result.error || 'Failed to send WhatsApp message' });
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
      const webAppUrl = settingsMap.get('frontendUrl') || process.env.FRONTEND_URL || 'https://transitos.vercel.app';

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
              studentName: student.name,
              amount: (student.monthlyFee / 100).toFixed(0),
              month: `${monthName} ${year}`,
              upiId,
              businessName,
              webAppUrl,
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
      const webAppUrl = settingsMap.get('frontendUrl') || process.env.FRONTEND_URL || 'http://localhost:3000';

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
            webAppUrl,
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
      const webAppUrl = settingsMap.get('frontendUrl') || process.env.FRONTEND_URL || 'http://localhost:3000';

      const body = formatTemplate(TEMPLATES[MessageType.REMINDER_1], {
        parentName: 'Test Parent (Demo)',
        studentName: 'Omi Karthikeya N & Harshini Chakrika N',
        amount: '4000',
        month: 'July 2026',
        upiId,
        businessName,
        webAppUrl,
      });

      const result = await sendWhatsAppMessage(phone, body, null, MessageType.REMINDER_1);
      if (result.success) {
        res.json({ success: true, data: { message: 'Demo reminder sent successfully' } });
      } else {
        res.status(400).json({ success: false, error: result.error || 'Failed to send demo message' });
      }
    } catch (error) {
      next(error);
    }
  },
);

const triggerReminderSchema = z.object({
  school: z.string().optional(),
  schoolName: z.string().optional(),
  reminderType: z.nativeEnum(MessageType).optional().default(MessageType.REMINDER_1),
  customText: z.string().optional(),
}).refine(data => data.school || data.schoolName, {
  message: "Either school or schoolName is required",
  path: ["school"]
});

/**
 * POST /api/v1/whatsapp/trigger-reminder
 * Manually trigger reminders for a specific school
 */
whatsappRouter.post(
  '/trigger-reminder',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = triggerReminderSchema.parse(req.body);
      const school = (parsedBody.school || parsedBody.schoolName) as string;
      const { reminderType, customText } = parsedBody;

      const status = getWhatsAppStatus();
      if (!status.connected) {
        res.status(503).json({
          success: false,
          error: 'WhatsApp service is not connected. Pair QR first.',
        });
        return;
      }

      let studentIds: string[] = [];
      let typeToSend = reminderType;
      let extraVars: Record<string, string> | undefined = undefined;

      if (customText) {
        // Fetch all active students of this school
        const activeStudents = await prisma.student.findMany({
          where: {
            school,
            status: StudentStatus.ACTIVE,
          },
          select: { id: true },
        });
        studentIds = activeStudents.map(s => s.id);
        typeToSend = MessageType.BROADCAST;
        extraVars = { message: customText };
      } else {
        // Standard reminder flow (only to unpaid students)
        const unpaidStudents = await getUnpaidStudents([school]);
        studentIds = unpaidStudents.map(s => s.id);

        // If it is REMINDER_3 or FINAL, mark overdue in DB
        if (reminderType === MessageType.REMINDER_3 || reminderType === MessageType.FINAL) {
          const now = new Date();
          await prisma.feeSchedule.updateMany({
            where: {
              month: now.getMonth() + 1,
              year: now.getFullYear(),
              isPaid: false,
              student: { school, status: StudentStatus.ACTIVE },
            },
            data: { overdueAt: now },
          });
        }
      }

      const result = await whatsappService.broadcastToList(
        studentIds,
        typeToSend,
        extraVars
      );

      res.json({
        success: true,
        data: {
          scannedCount: studentIds.length,
          sentCount: result.sent,
          failedCount: result.failed,
          sent: result.sent,
          failed: result.failed,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/whatsapp/logs
 * Retrieve message logs, optionally filtered by status
 */
whatsappRouter.get(
  '/logs',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const statusParam = req.query.status as string;
      const filter: any = {};
      if (statusParam && Object.values(MessageStatus).includes(statusParam as any)) {
        filter.status = statusParam as MessageStatus;
      }

      const logs = await prisma.whatsAppMessage.findMany({
        where: filter,
        include: {
          student: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100,
      });

      res.json({
        success: true,
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  }
);

