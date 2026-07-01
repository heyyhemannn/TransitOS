import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { createAuditLog } from '../lib/audit';
import { matchPayment, importCSV, parseSMSText } from '../services/paymentEngine';
import { getSignedUrl } from '../lib/supabase';
import { generateReceipt } from '../services/receiptService';
import { sendConfirmation } from '../services/whatsappService';
import { logger } from '../lib/logger';

export const paymentsRouter = Router();
export const publicPaymentsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG MULTER FOR CSV
// ─────────────────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────
const manualPaymentSchema = z.object({
  studentId: z.string().min(1, 'Student ID is required'),
  amount: z.number().positive('Amount must be a positive number'),
  month: z.number().int().min(1).max(12, 'Month must be between 1 and 12'),
  year: z.number().int().min(2020, 'Year must be at least 2020'),
  transactionId: z.string().optional().nullable().or(z.literal('')),
  method: z.nativeEnum(PaymentMethod),
  remarks: z.string().optional().nullable().or(z.literal('')),
});

const webhookSchema = z.object({
  smsBody: z.string().min(1, 'SMS body is required'),
  secret: z.string().min(1, 'Webhook secret is required'),
});

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/payments
 * Query list of payments with paginated filters
 */
paymentsRouter.get(
  '/',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip = (page - 1) * limit;

      const month = req.query.month ? parseInt(req.query.month as string) : undefined;
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const statusInput = req.query.status as string;
      const status = statusInput ? (statusInput as PaymentStatus) : undefined;
      const studentId = req.query.studentId as string;
      const school = req.query.school as string;
      const routeId = req.query.routeId as string;

      // Construct filter query
      const where: any = {};

      if (month !== undefined) where.month = month;
      if (year !== undefined) where.year = year;
      if (status) where.status = status;
      if (studentId) where.studentId = studentId;

      if (school || routeId) {
        where.student = {};
        if (school) where.student.school = school;
        if (routeId) where.student.routeId = routeId;
      }

      // Execute queries
      const [payments, total, sumResult] = await Promise.all([
        prisma.payment.findMany({
          where,
          include: {
            student: {
              select: {
                id: true,
                name: true,
                school: true,
                parentName: true,
              },
            },
          },
          orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
          skip,
          take: limit,
        }),
        prisma.payment.count({ where }),
        prisma.payment.aggregate({
          _sum: { amount: true },
          where,
        }),
      ]);

      const totalAmount = sumResult._sum.amount ?? 0;
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: {
          payments,
          page,
          limit,
          total,
          totalPages,
          totalAmount,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/payments
 * Performs manual payment entry for a student (ADMIN and MANAGER only)
 */
paymentsRouter.post(
  '/',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = manualPaymentSchema.parse(req.body) as {
        studentId: string;
        amount: number;
        month: number;
        year: number;
        transactionId?: string | null;
        method: PaymentMethod;
        remarks?: string | null;
      };

      // Verify student exists
      const student = await prisma.student.findUnique({
        where: { id: body.studentId },
      });
      if (!student) {
        res.status(404).json({ success: false, error: 'Student not found' });
        return;
      }

      // Convert amount to paise
      const amountPaise = Math.round(body.amount * 100);

      // Check duplicate payment
      const existingPayment = await prisma.payment.findUnique({
        where: {
          studentId_month_year: {
            studentId: body.studentId,
            month: body.month,
            year: body.year,
          },
        },
      });

      if (existingPayment && existingPayment.status === PaymentStatus.PAID) {
        res.status(400).json({
          success: false,
          error: `Payment already recorded for student this month: ${body.month}/${body.year}`,
        });
        return;
      }

      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

      // Create payment and update fee schedules
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const payment = await tx.payment.create({
          data: {
            studentId: body.studentId,
            amount: amountPaise,
            month: body.month,
            year: body.year,
            paidAt: nowIST,
            transactionId: body.transactionId || null,
            method: body.method,
            status: PaymentStatus.PAID,
            remarks: body.remarks || 'Manual Payment Entry',
            createdBy: req.user?.id,
          },
        });

        await tx.feeSchedule.upsert({
          where: {
            studentId_month_year: {
              studentId: body.studentId,
              month: body.month,
              year: body.year,
            },
          },
          update: {
            isPaid: true,
            paidAt: nowIST,
          },
          create: {
            studentId: body.studentId,
            month: body.month,
            year: body.year,
            dueDate: new Date(Date.UTC(body.year, body.month - 1, 10, 4, 30, 0)),
            amount: amountPaise,
            isPaid: true,
            paidAt: nowIST,
          },
        });

        return payment;
      });

      // Write Audit Log
      await createAuditLog(req.user?.id || null, 'MANUAL_PAYMENT', 'Payment', result.id, {
        studentId: body.studentId,
        amount: amountPaise,
        month: body.month,
        year: body.year,
      });

      // Trigger Side-effects
      generateReceipt(result.id).catch((err) => {
        logger.error(`Receipt generation failed in manual entry for paymentId ${result.id}:`, err);
      });

      sendConfirmation(student.id, result.id).catch((err) => {
        logger.error(`WhatsApp confirmation failed in manual entry for studentId ${student.id}:`, err);
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/payments/import-csv
 * Process uploaded PhonePe CSV sheet (ADMIN and MANAGER only)
 */
paymentsRouter.post(
  '/import-csv',
  requireRole(UserRole.ADMIN),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
      }

      const summary = await importCSV(req.file.buffer);

      if (req.user) {
        await createAuditLog(req.user.id, 'IMPORT_CSV_PAYMENTS', 'Payment', null, {
          total: summary.total,
          matched: summary.matched,
          unmatched: summary.unmatched,
          duplicates: summary.duplicates,
        });
      }

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/payments/sms-webhook
 * Receive SMS gateway logs for automatic UPI confirmation checks
 */
paymentsRouter.post(
  '/sms-webhook',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { smsBody, secret } = webhookSchema.parse(req.body);

      // Verify webhook secret
      if (secret !== process.env.SMS_WEBHOOK_SECRET) {
        res.status(401).json({ success: false, error: 'Unauthorized webhook request' });
        return;
      }

      const parsed = parseSMSText(smsBody);
      if (!parsed) {
        res.json({
          success: false,
          error: 'SMS body did not match any supported UPI credit formats',
        });
        return;
      }

      const matchResult = await matchPayment(parsed.transactionId, parsed.amount, parsed.senderName);

      res.json({
        success: true,
        data: {
          parsed,
          matchResult,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/payments/:id
 * Retrieve detail block for a specific payment
 */
paymentsRouter.get(
  '/:id',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              school: true,
              parentName: true,
            },
          },
        },
      });

      if (!payment) {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/payments/:id/receipt
 * Returns a signed URL redirection to open the PDF receipt
 */
paymentsRouter.get(
  '/:id/receipt',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const payment = await prisma.payment.findUnique({
        where: { id },
      });

      if (!payment) {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      if (!payment.receiptUrl) {
        res.status(404).json({ success: false, error: 'Receipt not generated yet' });
        return;
      }

      // If it's already a full HTTP URL (e.g. from CDN/mock), redirect directly
      if (payment.receiptUrl.startsWith('http://') || payment.receiptUrl.startsWith('https://')) {
        res.redirect(302, payment.receiptUrl);
        return;
      }

      // Generate a signed URL for private Supabase Storage paths
      const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'receipts';
      const signedUrl = await getSignedUrl(bucket, payment.receiptUrl, 3600); // 1 hour expiry

      res.redirect(302, signedUrl);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/payments/parent-confirm
 * PUBLIC — no JWT required. Parents submit UPI TxID + screenshot from the WhatsApp pay link.
 */
publicPaymentsRouter.post(
  '/parent-confirm',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { phone, transactionId, screenshotBase64 } = z.object({
        phone: z.string().regex(/^\d{10}$/, 'Must be a valid 10-digit mobile number'),
        transactionId: z.string().regex(/^\d{12}$/, 'Must be a valid 12-digit UPI transaction reference'),
        screenshotBase64: z.string().optional().nullable(),
      }).parse(req.body);

      const formattedPhone = phone.trim();

      const student = await prisma.student.findFirst({
        where: {
          status: 'ACTIVE',
          OR: [
            { whatsappNumber: { endsWith: formattedPhone } },
            { fatherMobile: { endsWith: formattedPhone } },
            { motherMobile: { endsWith: formattedPhone } },
          ],
        },
      });

      if (!student) {
        res.status(404).json({
          success: false,
          error: 'No active student found for this mobile number. Please check and try again.',
        });
        return;
      }

      const existingPayment = await prisma.payment.findUnique({ where: { transactionId } });
      if (existingPayment) {
        res.status(400).json({
          success: false,
          error: 'This UPI Transaction ID has already been submitted.',
        });
        return;
      }

      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMonth = nowIST.getMonth() + 1;
      const currentYear = nowIST.getFullYear();

      const schedule = await prisma.feeSchedule.findFirst({
        where: { studentId: student.id, isPaid: false },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      });

      const targetMonth = schedule ? schedule.month : currentMonth;
      const targetYear = schedule ? schedule.year : currentYear;
      const targetAmount = schedule ? schedule.amount : student.monthlyFee;

      let screenshotStoragePath: string | null = null;
      if (screenshotBase64) {
        try {
          const { getSupabase } = await import('../lib/supabase');
          const supabase = getSupabase();
          const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const contentType = screenshotBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          const extension = contentType === 'image/png' ? 'png' : 'jpg';
          const storagePath = `screenshots/${transactionId}.${extension}`;
          const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'receipts';
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(storagePath, buffer, { contentType, upsert: false });
          if (!uploadError) {
            screenshotStoragePath = storagePath;
            logger.info(`Screenshot uploaded: ${bucket}/${storagePath}`);
          } else {
            logger.error(`Screenshot upload failed: ${uploadError.message}`);
          }
        } catch (uploadErr) {
          logger.error('Screenshot upload error (non-fatal):', uploadErr);
        }
      }

      const remarks = screenshotStoragePath
        ? `Parent screenshot saved. Storage: ${screenshotStoragePath}. Phone: ${phone}`
        : `No screenshot provided. Phone: ${phone}`;

      await prisma.payment.create({
        data: {
          studentId: student.id,
          amount: targetAmount,
          month: targetMonth,
          year: targetYear,
          paidAt: nowIST,
          transactionId,
          method: 'UPI',
          status: 'PENDING',
          remarks,
        },
      });

      logger.info(`Parent submit: Student=${student.name}, TxID=${transactionId}, Screenshot=${screenshotStoragePath ? 'YES' : 'NO'}`);

      res.json({
        success: true,
        data: {
          message: 'Payment submitted successfully! Admin will verify and send your receipt on WhatsApp.',
          studentName: student.name,
          amount: targetAmount,
          screenshotUploaded: screenshotStoragePath !== null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
