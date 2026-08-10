import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, MessageType, StudentStatus, MessageStatus, PaymentStatus } from '@prisma/client';
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
import { sendConfirmation } from '../services/whatsappService';
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
      // Get all unpaid active students using the robust helper function
      const unpaidStudents = await getUnpaidStudents();

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
            month: `${monthName} ${nowIST.getFullYear()}`,
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
  targetAudience: z.enum(['UNPAID', 'ALL', 'PAID']).optional(),
  reminderType: z.union([z.nativeEnum(MessageType), z.literal('CUSTOM')]).optional().default(MessageType.REMINDER_1),
  customText: z.string().optional(),
}).refine(data => data.school || data.schoolName, {
  message: "Either school or schoolName is required",
  path: ["school"]
});

/**
 * GET /api/v1/whatsapp/schools
 * Returns distinct school names from active students
 */
whatsappRouter.get(
  '/schools',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const students = await prisma.student.findMany({
        where: { status: StudentStatus.ACTIVE },
        select: { school: true },
      });
      const seen = new Set<string>();
      const schools: string[] = [];
      for (const s of students) {
        if (!s.school) continue;
        const normalized = s.school.trim();
        const upper = normalized.toUpperCase();
        if (!seen.has(upper)) {
          seen.add(upper);
          schools.push(normalized);
        }
      }
      schools.sort((a, b) => a.localeCompare(b));
      res.json({ success: true, data: schools });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/whatsapp/trigger-reminder
 * Manually trigger reminders or custom text broadcasts for a specific school (or all schools)
 */
whatsappRouter.post(
  '/trigger-reminder',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = triggerReminderSchema.parse(req.body);
      const rawSchool = (parsedBody.school || parsedBody.schoolName) as string;
      const { reminderType, customText } = parsedBody;
      const targetAudience = parsedBody.targetAudience || (customText && customText.trim().length > 0 ? 'ALL' : 'UNPAID');

      const status = getWhatsAppStatus();
      if (!status.connected) {
        res.status(503).json({
          success: false,
          error: 'WhatsApp service is not connected. Pair QR first.',
        });
        return;
      }

      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMonth = nowIST.getMonth() + 1;
      const currentYear = nowIST.getFullYear();

      // Build school filter condition
      const schoolFilter = (!rawSchool || rawSchool.toUpperCase() === 'ALL')
        ? {}
        : { school: { contains: rawSchool, mode: 'insensitive' as const } };

      let targetStudents: Array<{ id: string; name: string; school: string; whatsappNumber: string }> = [];

      if (targetAudience === 'ALL') {
        targetStudents = await prisma.student.findMany({
          where: {
            status: StudentStatus.ACTIVE,
            ...schoolFilter,
          },
          select: { id: true, name: true, school: true, whatsappNumber: true },
        });
      } else if (targetAudience === 'PAID') {
        targetStudents = await prisma.student.findMany({
          where: {
            status: StudentStatus.ACTIVE,
            ...schoolFilter,
            OR: [
              { payments: { some: { month: currentMonth, year: currentYear, status: PaymentStatus.PAID } } },
              { feeSchedules: { some: { month: currentMonth, year: currentYear, isPaid: true } } },
            ],
          },
          select: { id: true, name: true, school: true, whatsappNumber: true },
        });
      } else {
        // UNPAID
        targetStudents = await prisma.student.findMany({
          where: {
            status: StudentStatus.ACTIVE,
            ...schoolFilter,
            NOT: {
              OR: [
                { payments: { some: { month: currentMonth, year: currentYear, status: PaymentStatus.PAID } } },
                { feeSchedules: { some: { month: currentMonth, year: currentYear, isPaid: true } } },
              ],
            },
          },
          select: { id: true, name: true, school: true, whatsappNumber: true },
        });
      }

      const studentIds = targetStudents.map(s => s.id);
      let typeToSend: MessageType = MessageType.REMINDER_1;
      let extraVars: Record<string, string> | undefined = undefined;

      if (reminderType === 'CUSTOM' || (customText && customText.trim().length > 0)) {
        typeToSend = MessageType.BROADCAST;
        if (customText && customText.trim().length > 0) {
          extraVars = { message: customText.trim() };
        }
      } else {
        typeToSend = reminderType as MessageType;
        if (reminderType === MessageType.REMINDER_3 || reminderType === MessageType.FINAL) {
          if (studentIds.length > 0) {
            await prisma.feeSchedule.updateMany({
              where: {
                month: currentMonth,
                year: currentYear,
                isPaid: false,
                studentId: { in: studentIds },
              },
              data: { overdueAt: nowIST },
            });
          }
        }
      }

      if (studentIds.length === 0) {
        res.json({
          success: true,
          data: {
            message: `No active students found matching target criteria (${rawSchool}, audience: ${targetAudience}).`,
            scannedCount: 0,
            queuedCount: 0,
            sentCount: 0,
            failedCount: 0,
          },
        });
        return;
      }

      // Group by unique WhatsApp numbers
      const uniquePhones = new Set(targetStudents.map(s => s.whatsappNumber.replace(/\D/g, '')));

      // Trigger background broadcast loop so HTTP response is instant & never times out
      setImmediate(async () => {
        try {
          logger.info(`Starting manual trigger background broadcast for ${targetStudents.length} students (${uniquePhones.size} unique phones)`);
          await whatsappService.broadcastToList(studentIds, typeToSend, extraVars);
        } catch (bgErr) {
          logger.error('Error in manual trigger background broadcast:', bgErr);
        }
      });

      res.json({
        success: true,
        data: {
          message: `Manual trigger started in background for ${targetStudents.length} students across ${uniquePhones.size} unique WhatsApp numbers.`,
          scannedCount: targetStudents.length,
          queuedCount: uniquePhones.size,
          sentCount: targetStudents.length,
          failedCount: 0,
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

/**
 * POST /api/v1/whatsapp/logs/:id/retry
 * Retry a previously failed WhatsApp message by re-sending its body to the same phone.
 * For CONFIRMATION type, also re-sends the PDF receipt via sendConfirmation().
 */
whatsappRouter.post(
  '/logs/:id/retry',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      // Find the original log entry
      const log = await prisma.whatsAppMessage.findUnique({
        where: { id },
        include: { student: { select: { id: true, name: true } } },
      });

      if (!log) {
        res.status(404).json({ success: false, error: 'Message log not found' });
        return;
      }

      if (log.status !== MessageStatus.FAILED) {
        res.status(400).json({ success: false, error: 'Only FAILED messages can be retried' });
        return;
      }

      // Ensure connection is open and active
      const isConnected = await whatsappService.ensureConnected();
      if (!isConnected) {
        res.status(503).json({ success: false, error: 'WhatsApp is not connected. Please Sync Status and pair QR first.' });
        return;
      }

      // ── CONFIRMATION: re-send via sendConfirmation to also deliver PDF receipt ──
      if (log.type === MessageType.CONFIRMATION && log.studentId) {
        try {
          // Find the most recent PAID payment for this student
          const latestPayment = await prisma.payment.findFirst({
            where: { studentId: log.studentId, status: 'PAID' },
            orderBy: { paidAt: 'desc' },
          });

          if (latestPayment) {
            // Full confirmation: text message + PDF receipt
            await sendConfirmation(log.studentId, latestPayment.id);
            // Mark original log as SENT
            await prisma.whatsAppMessage.update({
              where: { id },
              data: { status: MessageStatus.SENT, sentAt: new Date(), errorMessage: null },
            });
            logger.info(`[Retry] CONFIRMATION re-sent with PDF for studentId ${log.studentId}, paymentId ${latestPayment.id}`);
            res.json({ success: true, data: { message: 'Confirmation message and receipt re-sent successfully' } });
            return;
          }
          // No payment found — fall through to plain text re-send
          logger.warn(`[Retry] No paid payment found for studentId ${log.studentId}, falling back to plain text re-send`);
        } catch (confirmErr: any) {
          logger.error(`[Retry] sendConfirmation failed for log ${id}:`, confirmErr);
          const errMsg = confirmErr?.message ?? 'sendConfirmation error';
          const isConnErr =
            errMsg.toLowerCase().includes('connection') ||
            errMsg.toLowerCase().includes('socket') ||
            errMsg.toLowerCase().includes('not connected') ||
            errMsg.toLowerCase().includes('pair qr');
          res.status(isConnErr ? 503 : 400).json({
            success: false,
            error: isConnErr
              ? 'WhatsApp connection dropped. Please Sync Status and retry.'
              : errMsg,
          });
          return;
        }
      }

      // ── All other types (REMINDER_1, REMINDER_2, etc.): plain re-send ──
      const result = await whatsappService.sendMessage(log.phone, log.body, log.studentId ?? null, log.type);

      if (result.success) {
        // Mark original log as SENT
        await prisma.whatsAppMessage.update({
          where: { id },
          data: { status: MessageStatus.SENT, sentAt: new Date(), errorMessage: null },
        });
        logger.info(`[Retry] Successfully retried message log ${id} to ${log.phone}`);
        res.json({ success: true, data: { message: 'Message retried and sent successfully' } });
      } else {
        const rawError = result.error ?? '';
        logger.warn(`[Retry] Re-send failed for log ${id}: ${rawError}`);

        // Detect any form of connection/socket error → 503
        const isConnectionError =
          rawError.toLowerCase().includes('connection') ||
          rawError.toLowerCase().includes('socket') ||
          rawError.toLowerCase().includes('not connected') ||
          rawError.toLowerCase().includes('pair qr') ||
          rawError.toLowerCase().includes('timed out') ||
          rawError.toLowerCase().includes('stream ended');

        if (isConnectionError) {
          res.status(503).json({
            success: false,
            error: 'WhatsApp connection dropped. Please go to WhatsApp Gateway → Sync Status, then retry.',
          });
        } else {
          res.status(400).json({ success: false, error: rawError || 'Retry failed — WhatsApp send error' });
        }
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/whatsapp/logout
 * Terminate the WhatsApp session and clear credentials
 */
whatsappRouter.post(
  '/logout',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await whatsappService.logout();
      res.json({ success: true, message: 'WhatsApp session terminated successfully' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/whatsapp/reset
 * Reset session credentials in DB and generate a fresh QR code
 */
whatsappRouter.post(
  '/reset',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await whatsappService.resetSession();
      res.json({ success: true, message: 'WhatsApp session reset successfully. Fresh QR code generated.' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/whatsapp/refresh
 * Refresh/regenerate QR code by re-initializing Baileys client
 */
whatsappRouter.post(
  '/refresh',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await whatsappService.initialize();
      res.json({ success: true, message: 'WhatsApp client re-initialization triggered' });
    } catch (error) {
      next(error);
    }
  }
);


