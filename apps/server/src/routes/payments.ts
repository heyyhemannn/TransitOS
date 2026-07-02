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
import { sendEmailNotification } from '../services/emailService';
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

      const actualNow = new Date();

      // Create payment and update fee schedules
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const payment = await tx.payment.create({
          data: {
            studentId: body.studentId,
            amount: amountPaise,
            month: body.month,
            year: body.year,
            paidAt: actualNow,
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
            paidAt: actualNow,
          },
          create: {
            studentId: body.studentId,
            month: body.month,
            year: body.year,
            dueDate: new Date(Date.UTC(body.year, body.month - 1, 10, 4, 30, 0)),
            amount: amountPaise,
            isPaid: true,
            paidAt: actualNow,
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

      let receiptUrl = payment.receiptUrl;
      if (!receiptUrl) {
        try {
          receiptUrl = await generateReceipt(id);
        } catch (err) {
          logger.error(`Failed to generate receipt on-demand for payment ${id}:`, err);
        }
      }

      if (!receiptUrl) {
        res.status(404).json({ success: false, error: 'Receipt not generated yet' });
        return;
      }

      // If it's a Supabase public URL for the receipts bucket, extract the relative storage path
      // to sign it and return a working URL.
      let storagePath = receiptUrl;
      const publicPrefix = '/storage/v1/object/public/receipts/';
      if (receiptUrl.includes(publicPrefix)) {
        storagePath = receiptUrl.split(publicPrefix)[1];
      }

      // If it starts with http/https and is not a public receipts bucket URL, return it directly
      if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
        res.json({
          success: true,
          data: storagePath,
        });
        return;
      }

      // Generate a signed URL for private Supabase Storage paths
      const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'receipts';
      const signedUrl = await getSignedUrl(bucket, storagePath, 3600); // 1 hour expiry

      res.json({
        success: true,
        data: signedUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PATCH /api/v1/payments/:id/status
 * Update status of a payment (ADMIN and MANAGER only)
 */
paymentsRouter.patch(
  '/:id/status',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = z.object({
        status: z.nativeEnum(PaymentStatus),
      }).parse(req.body);

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: { student: true },
      });

      if (!payment) {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      const oldStatus = payment.status;
      const actualNow = new Date();

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Update payment status
        const pay = await tx.payment.update({
          where: { id },
          data: { 
            status,
            paidAt: status === PaymentStatus.PAID ? actualNow : payment.paidAt,
          },
        });

        // Update corresponding fee schedule
        if (status === PaymentStatus.PAID) {
          await tx.feeSchedule.upsert({
            where: {
              studentId_month_year: {
                studentId: payment.studentId,
                month: payment.month,
                year: payment.year,
              },
            },
            update: {
              isPaid: true,
              paidAt: actualNow,
            },
            create: {
              studentId: payment.studentId,
              month: payment.month,
              year: payment.year,
              dueDate: new Date(Date.UTC(payment.year, payment.month - 1, 10, 4, 30, 0)),
              amount: payment.amount,
              isPaid: true,
              paidAt: actualNow,
            },
          });
        } else {
          // Revert to unpaid if changing status from PAID to something else
          if (oldStatus === PaymentStatus.PAID) {
            await tx.feeSchedule.updateMany({
              where: {
                studentId: payment.studentId,
                month: payment.month,
                year: payment.year,
              },
              data: {
                isPaid: false,
                paidAt: null,
              },
            });
          }
        }

        return pay;
      });

      // Write Audit Log
      await createAuditLog(req.user?.id || null, 'UPDATE_PAYMENT_STATUS', 'Payment', id, {
        studentId: payment.studentId,
        oldStatus,
        newStatus: status,
      });

      // If status changed to PAID (success), trigger side effects: receipt generation and WhatsApp confirmation dispatch
      if (status === PaymentStatus.PAID) {
        // Run receipt generation first so it updates payment.receiptUrl
        generateReceipt(id)
          .then(() => {
            sendConfirmation(payment.studentId, id).catch((err) => {
              logger.error(`WhatsApp confirmation failed after status change for studentId ${payment.studentId}:`, err);
            });
          })
          .catch((err) => {
            logger.error(`Receipt generation failed after status change for paymentId ${id}:`, err);
          });
      }

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  },
);


/**
 * GET /api/v1/payments/:id/screenshot
 * Returns a signed URL/JSON response to view the parent payment screenshot
 */
paymentsRouter.get(
  '/:id/screenshot',
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

      let screenshotPath = payment.screenshotUrl;
      if (!screenshotPath && payment.remarks) {
        // Fallback: parse from remarks string e.g. "Parent screenshot saved. Storage: screenshots/12345.png."
        const match = payment.remarks.match(/Storage:\s*(screenshots\/[^\s]+)/);
        if (match) {
          screenshotPath = match[1];
          if (screenshotPath.endsWith('.') || screenshotPath.endsWith(',')) {
            screenshotPath = screenshotPath.slice(0, -1);
          }
        }
      }

      if (!screenshotPath) {
        res.status(404).json({ success: false, error: 'Screenshot not found for this payment' });
        return;
      }

      if (screenshotPath.startsWith('http://') || screenshotPath.startsWith('https://')) {
        res.json({ success: true, data: screenshotPath });
        return;
      }

      const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'receipts';
      const signedUrl = await getSignedUrl(bucket, screenshotPath, 3600); // 1 hour expiry

      res.json({
        success: true,
        data: signedUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/v1/payments/:id
 * Delete a payment record and revert the FeeSchedule isPaid status to unpaid
 */
paymentsRouter.delete(
  '/:id',
  requireRole(UserRole.ADMIN),
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

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // 1. Revert FeeSchedule to unpaid
        await tx.feeSchedule.updateMany({
          where: {
            studentId: payment.studentId,
            month: payment.month,
            year: payment.year,
          },
          data: {
            isPaid: false,
            paidAt: null,
          },
        });

        // 2. Delete the payment
        await tx.payment.delete({
          where: { id },
        });
      });

      // Write Audit Log
      await createAuditLog(req.user?.id || null, 'DELETE_PAYMENT', 'Payment', id, {
        studentId: payment.studentId,
        amount: payment.amount,
        month: payment.month,
        year: payment.year,
      });

      res.json({
        success: true,
        message: 'Payment deleted and billing status reverted successfully',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/payments/parent-confirm
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

      const actualNow = new Date();
      const isAutoConfirm = screenshotStoragePath !== null;
      const paymentStatus = isAutoConfirm ? PaymentStatus.PAID : PaymentStatus.PENDING;
      const paidAtValue = isAutoConfirm ? actualNow : null;

      // Create payment and update fee schedules
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const payment = await tx.payment.create({
          data: {
            studentId: student.id,
            amount: targetAmount,
            month: targetMonth,
            year: targetYear,
            paidAt: paidAtValue,
            transactionId,
            method: 'UPI',
            status: paymentStatus,
            remarks,
            screenshotUrl: screenshotStoragePath,
          },
        });

        if (isAutoConfirm) {
          await tx.feeSchedule.upsert({
            where: {
              studentId_month_year: {
                studentId: student.id,
                month: targetMonth,
                year: targetYear,
              },
            },
            update: {
              isPaid: true,
              paidAt: actualNow,
            },
            create: {
              studentId: student.id,
              month: targetMonth,
              year: targetYear,
              dueDate: new Date(Date.UTC(targetYear, targetMonth - 1, 10, 4, 30, 0)),
              amount: targetAmount,
              isPaid: true,
              paidAt: actualNow,
            },
          });
        }

        return payment;
      });

      logger.info(`Parent submit (Auto-Confirmed=${isAutoConfirm}): Student=${student.name}, TxID=${transactionId}, Screenshot=${screenshotStoragePath ? 'YES' : 'NO'}`);

      // Trigger non-blocking async receipt generation & WhatsApp confirmation (including PDF receipt document) only if auto-confirmed
      if (isAutoConfirm) {
        generateReceipt(result.id)
          .then(() => {
            sendConfirmation(student.id, result.id).catch((err) => {
              logger.error(`WhatsApp confirmation failed in parent-confirm for studentId ${student.id}:`, err);
            });
          })
          .catch((err) => {
            logger.error(`Receipt generation failed in parent-confirm for paymentId ${result.id}:`, err);
          });
      }

      // Send email notification to heyyheman@gmail.com
      const amountRupees = (targetAmount / 100).toFixed(2);
      const emailSubject = isAutoConfirm 
        ? `🔔 TransitOS Payment Confirmation: ${student.name}`
        : `⏳ TransitOS Payment Review Required: ${student.name}`;
      const emailBody = isAutoConfirm
        ? `A parent has submitted a payment confirmation on the pay-confirm page.

Details:
- Student Name: ${student.name}
- School: ${student.school}
- Parent Name: ${student.parentName}
- Parent Phone: ${phone}
- Amount: ₹${amountRupees}
- Month/Year: ${targetMonth}/${targetYear}
- Transaction ID: ${transactionId}
- Screenshot: Uploaded (${screenshotStoragePath})

Payment has been auto-confirmed as PAID.`
        : `A parent has submitted a payment confirmation without a screenshot. This payment requires manual review.

Details:
- Student Name: ${student.name}
- School: ${student.school}
- Parent Name: ${student.parentName}
- Parent Phone: ${phone}
- Amount: ₹${amountRupees}
- Month/Year: ${targetMonth}/${targetYear}
- Transaction ID: ${transactionId}
- Screenshot: No Screenshot

Please review this transaction in the admin dashboard and mark it as PAID when verified.`;
      
      sendEmailNotification('heyyheman@gmail.com', emailSubject, emailBody).catch((err) => {
        logger.error('Failed to dispatch parent-confirm email notification:', err);
      });

      res.json({
        success: true,
        data: {
          message: isAutoConfirm 
            ? 'Payment confirmed successfully! Receipt and confirmation have been sent to your WhatsApp.'
            : 'Payment details submitted for review. Once verified by the administrator, a receipt will be sent to your WhatsApp.',
          studentName: student.name,
          amount: targetAmount,
          screenshotUploaded: screenshotStoragePath !== null,
          status: result.status,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
