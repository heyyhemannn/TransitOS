import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole, StudentStatus, Payment, FeeSchedule } from '@prisma/client';
import { createAuditLog } from '../lib/audit';

export const studentsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────
const mobileRegex = /^[6-9]\d{9}$/; // Indian mobile numbers starting with 6-9

const createStudentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  school: z.string().min(2, 'School must be at least 2 characters'),
  class: z.string().min(1, 'Class is required'),
  routeId: z.string().optional().nullable(),
  parentName: z.string().min(2, 'Parent name must be at least 2 characters'),
  fatherMobile: z.string().regex(mobileRegex, 'Father mobile must be a valid 10-digit number'),
  motherMobile: z
    .string()
    .regex(mobileRegex, 'Mother mobile must be a valid 10-digit number')
    .optional()
    .nullable()
    .or(z.literal('')),
  whatsappNumber: z.string().regex(mobileRegex, 'WhatsApp number must be a valid 10-digit number'),
  monthlyFee: z.number().positive('Monthly fee must be a positive number'),
  joiningDate: z.string().datetime('Invalid joining date format (ISO expected)'),
  pickupAddress: z.string().min(1, 'Pickup address is required'),
  dropAddress: z.string().min(1, 'Drop address is required'),
  pickupTime: z.string().regex(/^([0-1]\d|2[0-3]):[0-5]\d$/, 'Pickup time must be in HH:MM format'),
  dropTime: z.string().regex(/^([0-1]\d|2[0-3]):[0-5]\d$/, 'Drop time must be in HH:MM format'),
  vehicleNumber: z.string().optional().nullable(),
});

const updateStudentSchema = createStudentSchema.partial();

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Automatically creates FeeSchedule records for the current month and next month
 * if they don't already exist for a student.
 */
export async function autoCreateFeeSchedule(studentId: string, monthlyFee: number): Promise<void> {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentMonth = nowIST.getMonth() + 1;
  const currentYear = nowIST.getFullYear();

  let nextMonth = currentMonth + 1;
  let nextYear = currentYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = currentYear + 1;
  }

  const schedules = [
    { month: currentMonth, year: currentYear },
    { month: nextMonth, year: nextYear },
  ];

  for (const item of schedules) {
    const dueDate = new Date(Date.UTC(item.year, item.month - 1, 10, 4, 30, 0)); // 10th of the month at 10:00 AM IST

    await prisma.feeSchedule.upsert({
      where: {
        studentId_month_year: {
          studentId,
          month: item.month,
          year: item.year,
        },
      },
      update: {},
      create: {
        studentId,
        month: item.month,
        year: item.year,
        dueDate,
        amount: monthlyFee,
        isPaid: false,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/students
 * List and search paginated student directories
 */
studentsRouter.get(
  '/',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const search = (req.query.search as string) || '';
      const school = (req.query.school as string) || '';
      const routeId = (req.query.routeId as string) || '';
      const statusInput = (req.query.status as string) || 'ACTIVE';
      const status = statusInput === 'INACTIVE' ? StudentStatus.INACTIVE : StudentStatus.ACTIVE;

      const skip = (page - 1) * limit;

      // Construct filter query
      const where: any = { status };

      if (school) {
        where.school = school;
      }
      if (routeId) {
        where.routeId = routeId;
      }

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { parentName: { contains: search, mode: 'insensitive' } },
          { fatherMobile: { contains: search } },
        ];
      }

      const [students, total] = await Promise.all([
        prisma.student.findMany({
          where,
          include: {
            route: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { name: 'asc' },
          skip,
          take: limit,
        }),
        prisma.student.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: {
          students,
          page,
          limit,
          total,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/students
 * Registers a new student, automatically generates fees schedules, writes audit log
 */
studentsRouter.post(
  '/',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createStudentSchema.parse(req.body);

      // Convert monthlyFee from Rupees to Paise
      const monthlyFeePaise = Math.round(body.monthlyFee * 100);

      const student = await prisma.student.create({
        data: {
          name: body.name,
          school: body.school,
          class: body.class,
          routeId: body.routeId || null,
          parentName: body.parentName,
          fatherMobile: body.fatherMobile,
          motherMobile: body.motherMobile || null,
          whatsappNumber: body.whatsappNumber,
          monthlyFee: monthlyFeePaise,
          joiningDate: new Date(body.joiningDate),
          status: StudentStatus.ACTIVE,
          pickupAddress: body.pickupAddress,
          dropAddress: body.dropAddress,
          pickupTime: body.pickupTime,
          dropTime: body.dropTime,
          vehicleNumber: body.vehicleNumber || null,
        },
        include: {
          route: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Auto-create FeeSchedule for current and next month
      await autoCreateFeeSchedule(student.id, student.monthlyFee);

      // Audit Logging
      if (req.user) {
        await createAuditLog(req.user.id, 'CREATE_STUDENT', 'Student', student.id, {
          name: student.name,
          school: student.school,
          monthlyFee: student.monthlyFee,
        });
      }

      res.status(201).json({
        success: true,
        data: student,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/students/:id
 * Retrieve details of a single student including payment history and schedules
 */
studentsRouter.get(
  '/:id',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const student = await prisma.student.findUnique({
        where: { id },
        include: {
          route: {
            select: {
              id: true,
              name: true,
            },
          },
          payments: {
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 6,
          },
          feeSchedules: {
            where: {
              year: new Date().getFullYear(),
            },
            orderBy: { month: 'asc' },
          },
        },
      });

      if (!student) {
        res.status(404).json({ success: false, error: 'Student not found' });
        return;
      }

      res.json({
        success: true,
        data: student,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /api/v1/students/:id
 * Update student profile info
 */
studentsRouter.put(
  '/:id',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const body = updateStudentSchema.parse(req.body);

      // Verify student exists
      const existingStudent = await prisma.student.findUnique({ where: { id } });
      if (!existingStudent) {
        res.status(404).json({ success: false, error: 'Student not found' });
        return;
      }

      const updateData: any = { ...body };

      // Convert monthlyFee from Rupees to Paise if supplied
      if (body.monthlyFee !== undefined) {
        updateData.monthlyFee = Math.round(body.monthlyFee * 100);
      }

      if (body.joiningDate) {
        updateData.joiningDate = new Date(body.joiningDate);
      }

      const updatedStudent = await prisma.student.update({
        where: { id },
        data: updateData,
        include: {
          route: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Audit Logging
      if (req.user) {
        await createAuditLog(req.user.id, 'UPDATE_STUDENT', 'Student', id, {
          changedFields: Object.keys(body),
        });
      }

      res.json({
        success: true,
        data: updatedStudent,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/v1/students/:id
 * Soft delete: toggles status to INACTIVE
 */
studentsRouter.delete(
  '/:id',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const existingStudent = await prisma.student.findUnique({ where: { id } });
      if (!existingStudent) {
        res.status(404).json({ success: false, error: 'Student not found' });
        return;
      }

      await prisma.student.update({
        where: { id },
        data: { status: StudentStatus.INACTIVE },
      });

      // Audit Logging
      if (req.user) {
        await createAuditLog(req.user.id, 'DEACTIVATE_STUDENT', 'Student', id);
      }

      res.json({
        success: true,
        data: { message: 'Student deactivated' },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/students/:id/payments
 * Get 12-month payment checklist matrix for a given year
 */
studentsRouter.get(
  '/:id/payments',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();

      const student = await prisma.student.findUnique({ where: { id } });
      if (!student) {
        res.status(404).json({ success: false, error: 'Student not found' });
        return;
      }

      const [payments, feeSchedules] = await Promise.all([
        prisma.payment.findMany({
          where: { studentId: id, year },
        }),
        prisma.feeSchedule.findMany({
          where: { studentId: id, year },
        }),
      ]);

      const monthNames = [
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

      // Assemble 12-month grid
      const historyGrid = Array.from({ length: 12 }, (_, i) => {
        const monthIndex = i + 1;
        const payment = payments.find((p: Payment) => p.month === monthIndex);
        const schedule = feeSchedules.find((s: FeeSchedule) => s.month === monthIndex);

        // Determine month-over-month status
        let status = 'PENDING';
        if (payment) {
          status = payment.status;
        } else if (schedule) {
          const now = new Date();
          const dueDate = new Date(schedule.dueDate);
          if (!schedule.isPaid && dueDate < now) {
            status = 'OVERDUE';
          }
        }

        return {
          month: monthIndex,
          monthName: monthNames[i],
          year,
          amount: payment?.amount ?? null,
          paidAt: payment?.paidAt ?? null,
          transactionId: payment?.transactionId ?? null,
          method: payment?.method ?? null,
          status,
          receiptUrl: payment?.receiptUrl ?? null,
          feeScheduleAmount: schedule?.amount ?? student.monthlyFee,
          isPaid: schedule?.isPaid ?? false,
        };
      });

      res.json({
        success: true,
        data: historyGrid,
      });
    } catch (error) {
      next(error);
    }
  },
);
