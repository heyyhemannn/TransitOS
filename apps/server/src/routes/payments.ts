import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { createAuditLog } from '../lib/audit';
import { matchPayment, importCSV, parseSMSText, parseUPIDescription } from '../services/paymentEngine';
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
  students: z.array(z.object({
    studentId: z.string().min(1, 'Student ID is required'),
    amount: z.number().positive('Amount must be a positive number'),
  })).min(1, 'At least one student must be allocated'),
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
      const search = req.query.search as string;

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

      if (search) {
        const searchVal = search.trim();
        where.OR = [
          {
            transactionId: {
              contains: searchVal,
              mode: 'insensitive',
            },
          },
          {
            student: {
              name: {
                contains: searchVal,
                mode: 'insensitive',
              },
            },
          },
          {
            student: {
              parentName: {
                contains: searchVal,
                mode: 'insensitive',
              },
            },
          },
          {
            student: {
              fatherMobile: {
                contains: searchVal,
              },
            },
          },
          {
            student: {
              motherMobile: {
                contains: searchVal,
              },
            },
          },
          {
            student: {
              whatsappNumber: {
                contains: searchVal,
              },
            },
          },
        ];
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
        students: { studentId: string; amount: number }[];
        month: number;
        year: number;
        transactionId?: string | null;
        method: PaymentMethod;
        remarks?: string | null;
      };

      const actualNow = new Date();
      const results: any[] = [];

      const studentIds = body.students.map(s => s.studentId);
      const students = await prisma.student.findMany({
        where: { id: { in: studentIds } },
      });

      if (students.length !== studentIds.length) {
        const foundIds = students.map(s => s.id);
        const missingId = studentIds.find(id => !foundIds.includes(id));
        throw new Error(`Student not found for ID: ${missingId}`);
      }

      const existingPayments = await prisma.payment.findMany({
        where: {
          OR: body.students.map(alloc => ({
            studentId: alloc.studentId,
            month: body.month,
            year: body.year,
          })),
        },
      });

      for (const p of existingPayments) {
        if (p.status === PaymentStatus.PAID) {
          const student = students.find(s => s.id === p.studentId);
          throw new Error(`Payment already recorded for student ${student?.name || p.studentId} this month`);
        }
      }

      // We will process all students in a transaction
      await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          for (const alloc of body.students) {
            const student = students.find(s => s.id === alloc.studentId)!;

            // Convert amount to paise
            const amountPaise = Math.round(alloc.amount * 100);

            // If remarks contain a raw UPI description string, parse it to extract the parent name
            if (body.remarks && body.remarks.trim().toUpperCase().startsWith('UPI/')) {
              const { senderName } = parseUPIDescription(body.remarks);
              if (senderName && (!student.parentName || student.parentName.trim() === '' || student.parentName.toLowerCase().includes('parent'))) {
                await tx.student.update({
                  where: { id: student.id },
                  data: { parentName: senderName },
                });
                logger.info(`Automatically learned parent name "${senderName}" for student ${student.name}`);
              }
            }

            // Format transaction ID to prevent unique constraint conflicts for collective payments
            const finalTxId = body.transactionId
              ? (body.students.length > 1
                  ? `${body.transactionId}_${alloc.studentId}`
                  : body.transactionId)
              : null;

            // Check if a payment record already exists for this student/month/year
            const existingForStudent = await tx.payment.findUnique({
              where: {
                studentId_month_year: {
                  studentId: alloc.studentId,
                  month: body.month,
                  year: body.year,
                },
              },
            });

            let payment;
            if (existingForStudent) {
              payment = await tx.payment.update({
                where: { id: existingForStudent.id },
                data: {
                  amount: amountPaise,
                  paidAt: actualNow,
                  transactionId: finalTxId || existingForStudent.transactionId,
                  method: body.method,
                  status: PaymentStatus.PAID,
                  remarks: body.remarks || existingForStudent.remarks || 'Manual Payment Entry',
                  createdBy: req.user?.id,
                },
              });
            } else {
              payment = await tx.payment.create({
                data: {
                  studentId: alloc.studentId,
                  amount: amountPaise,
                  month: body.month,
                  year: body.year,
                  paidAt: actualNow,
                  transactionId: finalTxId,
                  method: body.method,
                  status: PaymentStatus.PAID,
                  remarks: body.remarks || 'Manual Payment Entry',
                  createdBy: req.user?.id,
                },
              });
            }

            await tx.feeSchedule.upsert({
              where: {
                studentId_month_year: {
                  studentId: alloc.studentId,
                  month: body.month,
                  year: body.year,
                },
              },
              update: {
                isPaid: true,
                paidAt: actualNow,
              },
              create: {
                studentId: alloc.studentId,
                month: body.month,
                year: body.year,
                dueDate: new Date(Date.UTC(body.year, body.month - 1, 10, 4, 30, 0)),
                amount: amountPaise,
                isPaid: true,
                paidAt: actualNow,
              },
            });

            results.push({ payment, student });
          }
        },
        {
          maxWait: 10000,
          timeout: 20000,
        }
      );

      // After transaction completes, run side effects (outside transaction to avoid blocking DB) sequentially
      (async () => {
        for (const item of results) {
          // Write Audit Log
          await createAuditLog(req.user?.id || null, 'MANUAL_PAYMENT', 'Payment', item.payment.id, {
            studentId: item.payment.studentId,
            amount: item.payment.amount,
            month: body.month,
            year: body.year,
          }).catch((err) => logger.error('Audit log failed:', err));

          try {
            logger.info(`Processing receipt generation for manual entry paymentId ${item.payment.id}...`);
            await generateReceipt(item.payment.id);
            logger.info(`Sending WhatsApp confirmation for manual entry studentId ${item.student.id}...`);
            await sendConfirmation(item.student.id, item.payment.id);
            // Delay between sibling confirmations
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (err) {
            logger.error(`Failed to process confirmation side effects for manual payment ${item.payment.id}:`, err);
          }
        }
      })().catch(err => logger.error('Error in sequential manual confirmation dispatch:', err));

      res.status(201).json({
        success: true,
        data: results.map((r) => r.payment),
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message || 'Failed to record manual payments' });
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

      if (receiptUrl.startsWith('LOCAL:')) {
        const pathInReceipts = receiptUrl.replace('LOCAL:', '');
        const fs = await import('fs');
        const path = await import('path');
        const localFilePath = path.resolve(process.cwd(), 'storage', pathInReceipts);
        if (fs.existsSync(localFilePath)) {
          // Serve file via base64 data URL or stream directly
          const buffer = fs.readFileSync(localFilePath);
          const base64 = buffer.toString('base64');
          res.json({
            success: true,
            data: `data:application/pdf;base64,${base64}`,
          });
          return;
        }
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

      try {
        // Generate a signed URL for private Supabase Storage paths
        const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'receipts';
        const signedUrl = await getSignedUrl(bucket, storagePath, 3600); // 1 hour expiry

        res.json({
          success: true,
          data: signedUrl,
        });
      } catch (signErr) {
        // Fallback: Check local disk by paymentId / studentId
        const fs = await import('fs');
        const path = await import('path');
        const shortMonth = new Date(payment.year, payment.month - 1)
          .toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const receiptId = `PAY-${shortMonth}${payment.year}-${payment.id.slice(-6).toUpperCase()}`;
        const localFilePath = path.resolve(process.cwd(), 'storage', 'receipts', payment.studentId, `${receiptId}.pdf`);

        if (fs.existsSync(localFilePath)) {
          const buffer = fs.readFileSync(localFilePath);
          const base64 = buffer.toString('base64');
          res.json({
            success: true,
            data: `data:application/pdf;base64,${base64}`,
          });
          return;
        }

        throw signErr;
      }
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

      const baseTxId = payment.transactionId
        ? payment.transactionId.split('_')[0]
        : null;

      const relatedPayments = baseTxId
        ? await prisma.payment.findMany({
            where: {
              status: PaymentStatus.PENDING,
              transactionId: {
                startsWith: baseTxId,
              },
            },
            include: { student: true },
          })
        : [];

      const paymentsToUpdate = [payment, ...relatedPayments.filter(p => p.id !== payment.id)];
      const oldStatus = payment.status;
      const actualNow = new Date();

      const updated = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const results = [];
          for (const pay of paymentsToUpdate) {
            const oldPayStatus = pay.status;
            const updatedPay = await tx.payment.update({
              where: { id: pay.id },
              data: { 
                status,
                paidAt: status === PaymentStatus.PAID ? actualNow : pay.paidAt,
              },
            });
            results.push(updatedPay);

            // Update corresponding fee schedule
            if (status === PaymentStatus.PAID) {
              await tx.feeSchedule.upsert({
                where: {
                  studentId_month_year: {
                    studentId: pay.studentId,
                    month: pay.month,
                    year: pay.year,
                  },
                },
                update: {
                  isPaid: true,
                  paidAt: actualNow,
                },
                create: {
                  studentId: pay.studentId,
                  month: pay.month,
                  year: pay.year,
                  dueDate: new Date(Date.UTC(pay.year, pay.month - 1, 10, 4, 30, 0)),
                  amount: pay.amount,
                  isPaid: true,
                  paidAt: actualNow,
                },
              });
            } else {
              // Revert to unpaid if changing status from PAID to something else
              if (oldPayStatus === PaymentStatus.PAID) {
                await tx.feeSchedule.updateMany({
                  where: {
                    studentId: pay.studentId,
                    month: pay.month,
                    year: pay.year,
                  },
                  data: {
                    isPaid: false,
                    paidAt: null,
                  },
                });
              }
            }
          }
          return results;
        },
        {
          maxWait: 10000,
          timeout: 20000,
        }
      );

      // Write Audit Log for each
      for (const pay of paymentsToUpdate) {
        await createAuditLog(req.user?.id || null, 'UPDATE_PAYMENT_STATUS', 'Payment', pay.id, {
          studentId: pay.studentId,
          oldStatus: pay.status,
          newStatus: status,
        });
      }

      // If status changed to PAID (success), trigger side effects: receipt generation and WhatsApp confirmation dispatch sequentially
      if (status === PaymentStatus.PAID) {
        (async () => {
          for (const pay of paymentsToUpdate) {
            try {
              logger.info(`Processing receipt generation for payment status update ${pay.id}...`);
              await generateReceipt(pay.id);
              logger.info(`Sending WhatsApp confirmation for payment status update studentId ${pay.studentId}...`);
              await sendConfirmation(pay.studentId, pay.id);
              // Delay between sibling confirmations
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
              logger.error(`Failed to process confirmation side effects for status change payment ${pay.id}:`, err);
            }
          }
        })().catch(err => logger.error('Error in sequential status change confirmation dispatch:', err));
      }

      res.json({
        success: true,
        data: updated.find(p => p.id === id) || updated[0],
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

      await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
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
        },
        {
          maxWait: 10000,
          timeout: 20000,
        }
      );

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

      const activeStudents = await prisma.student.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { whatsappNumber: { endsWith: formattedPhone } },
            { fatherMobile: { endsWith: formattedPhone } },
            { motherMobile: { endsWith: formattedPhone } },
          ],
        },
      });

      if (activeStudents.length === 0) {
        res.status(404).json({
          success: false,
          error: 'No active student found for this mobile number. Please check and try again.',
        });
        return;
      }

      const existingPayment = await prisma.payment.findFirst({
        where: {
          OR: [
            { transactionId },
            { transactionId: { startsWith: `${transactionId}_` } },
          ],
        },
      });
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

      const isCollective = activeStudents.length > 1;

      interface PaymentInfo {
        student: typeof activeStudents[0];
        targetMonth: number;
        targetYear: number;
        targetAmount: number;
      }
      const paymentsToCreate: PaymentInfo[] = [];
      let totalCollectiveAmount = 0;

      for (const s of activeStudents) {
        const schedule = await prisma.feeSchedule.findFirst({
          where: { studentId: s.id, isPaid: false },
          orderBy: [{ year: 'asc' }, { month: 'asc' }],
        });

        const targetMonth = schedule ? schedule.month : currentMonth;
        const targetYear = schedule ? schedule.year : currentYear;
        const targetAmount = schedule ? schedule.amount : s.monthlyFee;
        totalCollectiveAmount += targetAmount;

        paymentsToCreate.push({
          student: s,
          targetMonth,
          targetYear,
          targetAmount,
        });
      }

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
      const isAutoConfirm = !isCollective && screenshotStoragePath !== null;
      const paymentStatus = isAutoConfirm ? PaymentStatus.PAID : PaymentStatus.PENDING;
      const paidAtValue = isAutoConfirm ? actualNow : null;

      // Create payment and update fee schedules
      const createdPayments = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const results = [];
          for (let i = 0; i < paymentsToCreate.length; i++) {
            const item = paymentsToCreate[i];
            const dbTxId = isCollective ? `${transactionId}_${item.student.id}` : transactionId;

            // Check if payment record already exists for this student/month/year
            const existingForMonth = await tx.payment.findUnique({
              where: {
                studentId_month_year: {
                  studentId: item.student.id,
                  month: item.targetMonth,
                  year: item.targetYear,
                },
              },
            });

            let payment;
            if (existingForMonth) {
              payment = await tx.payment.update({
                where: { id: existingForMonth.id },
                data: {
                  amount: item.targetAmount,
                  paidAt: paidAtValue,
                  transactionId: dbTxId,
                  method: 'UPI',
                  status: paymentStatus,
                  remarks: remarks + (isCollective ? ` (Collective payment ${i + 1}/${paymentsToCreate.length})` : ''),
                  screenshotUrl: screenshotStoragePath || existingForMonth.screenshotUrl,
                },
              });
            } else {
              payment = await tx.payment.create({
                data: {
                  studentId: item.student.id,
                  amount: item.targetAmount,
                  month: item.targetMonth,
                  year: item.targetYear,
                  paidAt: paidAtValue,
                  transactionId: dbTxId,
                  method: 'UPI',
                  status: paymentStatus,
                  remarks: remarks + (isCollective ? ` (Collective payment ${i + 1}/${paymentsToCreate.length})` : ''),
                  screenshotUrl: screenshotStoragePath,
                },
              });
            }
            results.push(payment);

            if (isAutoConfirm) {
              await tx.feeSchedule.upsert({
                where: {
                  studentId_month_year: {
                    studentId: item.student.id,
                    month: item.targetMonth,
                    year: item.targetYear,
                  },
                },
                update: {
                  isPaid: true,
                  paidAt: actualNow,
                },
                create: {
                  studentId: item.student.id,
                  month: item.targetMonth,
                  year: item.targetYear,
                  dueDate: new Date(Date.UTC(item.targetYear, item.targetMonth - 1, 10, 4, 30, 0)),
                  amount: item.targetAmount,
                  isPaid: true,
                  paidAt: actualNow,
                },
              });
            }
          }
          return results;
        },
        {
          maxWait: 10000,
          timeout: 20000,
        }
      );

      const firstResult = createdPayments[0];

      logger.info(`Parent submit (Auto-Confirmed=${isAutoConfirm}): Student=${isCollective ? activeStudents.map(s => s.name).join(' & ') : activeStudents[0].name}, TxID=${transactionId}, Screenshot=${screenshotStoragePath ? 'YES' : 'NO'}`);

      // Trigger non-blocking async receipt generation & WhatsApp confirmation (including PDF receipt document) sequentially if auto-confirmed
      if (isAutoConfirm) {
        (async () => {
          for (const pay of createdPayments) {
            try {
              logger.info(`Processing receipt generation for parent-confirm payment ${pay.id}...`);
              await generateReceipt(pay.id);
              logger.info(`Sending WhatsApp confirmation for parent-confirm studentId ${pay.studentId}...`);
              await sendConfirmation(pay.studentId, pay.id);
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
              logger.error(`Failed to process confirmation side effects for parent-confirm payment ${pay.id}:`, err);
            }
          }
        })().catch(err => logger.error('Error in sequential parent-confirm confirmation dispatch:', err));
      }

      // Send email notification to heyyheman@gmail.com
      const settingsList = await prisma.settings.findMany();
      const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
      const webAppUrl = settingsMap.get('frontendUrl') || process.env.FRONTEND_URL || 'https://transitos.vercel.app';

      const emailSubject = isAutoConfirm 
        ? `🔔 TransitOS Payment Confirmation: ${activeStudents[0].name}`
        : isCollective
        ? `⏳ TransitOS Collective Payment Review Required: ${activeStudents.map(s => s.name).join(' & ')}`
        : `⏳ TransitOS Payment Review Required: ${activeStudents[0].name}`;

      let emailBody = '';
      if (isCollective) {
        const studentDetails = paymentsToCreate.map((item, index) => {
          return `${index + 1}. ${item.student.name} (${item.student.school}) - ₹${(item.targetAmount / 100).toFixed(2)} [Month/Year: ${item.targetMonth}/${item.targetYear}]`;
        }).join('\n');

        emailBody = `A parent has submitted a collective payment confirmation for multiple siblings. This requires manual review.

Details:
- Students:
${studentDetails}
- Parent Name: ${activeStudents[0].parentName}
- Parent Phone: ${phone}
- Total Amount: ₹${(totalCollectiveAmount / 100).toFixed(2)}
- Transaction ID: ${transactionId}
- Screenshot: ${screenshotStoragePath ? `Uploaded (${screenshotStoragePath})` : 'No Screenshot'}

To review these transactions and change their status from PENDING to PAID (which will automatically send WhatsApp receipts and confirmations for all siblings), please visit: ${webAppUrl}/payments`;
      } else {
        const amountRupees = (paymentsToCreate[0].targetAmount / 100).toFixed(2);
        emailBody = isAutoConfirm
          ? `A parent has submitted a payment confirmation on the pay-confirm page.

Details:
- Student Name: ${activeStudents[0].name}
- School: ${activeStudents[0].school}
- Parent Name: ${activeStudents[0].parentName}
- Parent Phone: ${phone}
- Amount: ₹${amountRupees}
- Month/Year: ${paymentsToCreate[0].targetMonth}/${paymentsToCreate[0].targetYear}
- Transaction ID: ${transactionId}
- Screenshot: Uploaded (${screenshotStoragePath})

Payment has been auto-confirmed as PAID.
You can view this payment here: ${webAppUrl}/payments`
          : `A parent has submitted a payment confirmation without a screenshot. This payment requires manual review.

Details:
- Student Name: ${activeStudents[0].name}
- School: ${activeStudents[0].school}
- Parent Name: ${activeStudents[0].parentName}
- Parent Phone: ${phone}
- Amount: ₹${amountRupees}
- Month/Year: ${paymentsToCreate[0].targetMonth}/${paymentsToCreate[0].targetYear}
- Transaction ID: ${transactionId}
- Screenshot: No Screenshot

To review this transaction and change its status from PENDING to PAID (to automatically send the WhatsApp confirmation and receipt), please visit: ${webAppUrl}/payments`;
      }

      sendEmailNotification('heyyheman@gmail.com', emailSubject, emailBody).catch((err) => {
        logger.error('Failed to dispatch parent-confirm email notification:', err);
      });

      res.json({
        success: true,
        data: {
          message: isAutoConfirm 
            ? 'Payment confirmed successfully! Receipt and confirmation have been sent to your WhatsApp.'
            : isCollective
            ? 'Collective payment details submitted for review. Once verified by the administrator, receipts will be sent to your WhatsApp.'
            : 'Payment details submitted for review. Once verified by the administrator, a receipt will be sent to your WhatsApp.',
          studentName: isCollective ? activeStudents.map(s => s.name).join(' & ') : activeStudents[0].name,
          amount: isCollective ? totalCollectiveAmount : paymentsToCreate[0].targetAmount,
          screenshotUploaded: screenshotStoragePath !== null,
          status: firstResult.status,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
