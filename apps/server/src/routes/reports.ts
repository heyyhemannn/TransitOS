import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, StudentStatus, PaymentStatus } from '@prisma/client';
import { getWhatsAppStatus } from '../services/whatsappService';

export const reportsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// LIGHTWEIGHT IN-MEMORY CACHE
// Avoids hammering DB on every dashboard load. TTL-based, keyed by params.
// ─────────────────────────────────────────────────────────────────────────────
const cache = new Map<string, { data: unknown; expiresAt: number }>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// Clear cache for a month when a payment is recorded (called externally)
export function invalidateReportsCache(month: number, year: number): void {
  for (const key of cache.keys()) {
    if (key.includes(`${month}-${year}`)) cache.delete(key);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reports/stats
 * Get high-level KPI stats for dashboard widgets
 */
reportsRouter.get(
  '/stats',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMonth = nowIST.getMonth() + 1;
      const currentYear = nowIST.getFullYear();

      const month = req.query.month ? parseInt(req.query.month as string) : currentMonth;
      const year = req.query.year ? parseInt(req.query.year as string) : currentYear;
      const isCurrentMonth = month === currentMonth && year === currentYear;

      // Return cached response if available (60s for current month, 5min for past)
      const cacheKey = `stats:${month}-${year}`;
      const cached = getCache<object>(cacheKey);
      if (cached) { res.json(cached); return; }

      const [totalStudents, activeRoutes, payments, activeStudentFees] = await Promise.all([
        prisma.student.count({
          where: {
            status: StudentStatus.ACTIVE,
            routeId: { not: null },
          },
        }),
        prisma.route.count({
          where: { isActive: true },
        }),
        prisma.payment.findMany({
          where: { month, year, status: PaymentStatus.PAID },
          select: { amount: true },
        }),
        prisma.student.findMany({
          where: { status: StudentStatus.ACTIVE },
          select: { id: true, monthlyFee: true },
        }),
      ]);

      const expectedRevenue = activeStudentFees.reduce((sum, s) => sum + s.monthlyFee, 0);
      const receivedRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
      const pendingRevenue = Math.max(0, expectedRevenue - receivedRevenue);

      // Auto-generate missing FeeSchedules in background (doesn't affect response)
      if (isCurrentMonth) {
        (async () => {
          try {
            const dueDate = new Date(Date.UTC(year, month - 1, 10, 4, 30, 0));
            for (const student of activeStudentFees) {
              await prisma.feeSchedule.upsert({
                where: { studentId_month_year: { studentId: student.id, month, year } },
                update: {},
                create: { studentId: student.id, month, year, dueDate, amount: student.monthlyFee, isPaid: false },
              });
            }
          } catch {
            // background — never fails the response
          }
        })();
      }

      const whatsapp = getWhatsAppStatus();

      const response = {
        success: true,
        data: {
          totalStudents,
          activeRoutes,
          expectedRevenue,
          receivedRevenue,
          pendingRevenue,
          whatsappStatus: whatsapp.connected,
        },
      };

      // Cache: 60s for current month (live), 5min for past months (static)
      setCache(cacheKey, response, isCurrentMonth ? 60_000 : 5 * 60_000);

      res.json(response);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/reports/monthly
 * Get monthly collection performance data for graphs
 */
reportsRouter.get(
  '/monthly',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentMonth = new Date().getMonth() + 1;
      const defaultStartYear = currentMonth >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      const startYear = parseInt(req.query.year as string) || defaultStartYear;
      const endYear = startYear + 1;

      const [payments, feeSchedules, activeStudentsList] = await Promise.all([
        prisma.payment.findMany({
          where: {
            status: PaymentStatus.PAID,
            OR: [
              { year: startYear, month: { gte: 6 } },
              { year: endYear, month: { lte: 5 } }
            ]
          },
          select: { month: true, year: true, amount: true },
        }),
        prisma.feeSchedule.findMany({
          where: {
            OR: [
              { year: startYear, month: { gte: 6 } },
              { year: endYear, month: { lte: 5 } }
            ]
          },
          select: { month: true, year: true, amount: true },
        }),
        prisma.student.findMany({
          where: { status: StudentStatus.ACTIVE },
          select: { monthlyFee: true },
        }),
      ]);

      const defaultFallbackExpected = activeStudentsList.reduce((sum, s) => sum + s.monthlyFee, 0);

      const academicMonths = [
        { month: 6, year: startYear, name: 'June' },
        { month: 7, year: startYear, name: 'July' },
        { month: 8, year: startYear, name: 'August' },
        { month: 9, year: startYear, name: 'September' },
        { month: 10, year: startYear, name: 'October' },
        { month: 11, year: startYear, name: 'November' },
        { month: 12, year: startYear, name: 'December' },
        { month: 1, year: endYear, name: 'January' },
        { month: 2, year: endYear, name: 'February' },
        { month: 3, year: endYear, name: 'March' },
        { month: 4, year: endYear, name: 'April' },
        { month: 5, year: endYear, name: 'May' },
      ];

      const monthlyData = academicMonths.map((m) => {
        // Sum payments for this month & year
        const collected = payments
          .filter((p) => p.month === m.month && p.year === m.year)
          .reduce((sum, p) => sum + p.amount, 0);

        // Sum fee schedules for this month & year
        let expected = feeSchedules
          .filter((s) => s.month === m.month && s.year === m.year)
          .reduce((sum, s) => sum + s.amount, 0);

        // If no schedules are created for this future month, fallback to current potential revenue
        if (expected === 0) {
          expected = defaultFallbackExpected;
        }

        const pending = Math.max(0, expected - collected);

        return {
          month: m.month,
          year: m.year,
          monthName: `${m.name} ${m.year}`,
          collected,
          expected,
          pending,
        };
      });

      res.json({
        success: true,
        data: monthlyData,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/reports/route-performance
 * Returns route performance and payment collection metrics
 */
reportsRouter.get(
  '/route-performance',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMonth = nowIST.getMonth() + 1;
      const currentYear = nowIST.getFullYear();

      // Fetch active routes, active students on them, and payments for this month
      const [routes, students, payments] = await Promise.all([
        prisma.route.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
        }),
        prisma.student.findMany({
          where: { status: StudentStatus.ACTIVE },
          select: { id: true, routeId: true },
        }),
        prisma.payment.findMany({
          where: {
            month: currentMonth,
            year: currentYear,
            status: PaymentStatus.PAID,
          },
          select: { studentId: true },
        }),
      ]);

      const paidStudentIds = new Set(payments.map((p) => p.studentId));

      const routeMetrics = routes.map((route) => {
        const routeStudents = students.filter((s) => s.routeId === route.id);
        const totalStudents = routeStudents.length;

        const paidStudents = routeStudents.filter((s) => paidStudentIds.has(s.id)).length;
        const pendingStudents = totalStudents - paidStudents;

        const collectionRate =
          totalStudents === 0 ? 100 : parseFloat(((paidStudents / totalStudents) * 100).toFixed(1));

        return {
          routeId: route.id,
          routeName: route.name,
          totalStudents,
          paidStudents,
          pendingStudents,
          collectionRate,
        };
      });

      res.json({
        success: true,
        data: routeMetrics,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/reports/daily
 * Retrieve history logs from DailyReport summary table
 */
reportsRouter.get(
  '/daily',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

      // Default to last 30 days
      const thirtyDaysAgo = new Date(nowIST);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const startDateInput = req.query.startDate as string;
      const endDateInput = req.query.endDate as string;

      const startDate = startDateInput ? new Date(startDateInput) : thirtyDaysAgo;
      const endDate = endDateInput ? new Date(endDateInput) : nowIST;

      // Reset hours to start/end of day for boundary checks
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      const reports = await prisma.dailyReport.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { date: 'asc' },
      });

      res.json({
        success: true,
        data: reports,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/reports/school-performance
 * Returns school-wise collection and payment metrics for the current billing cycle
 */
reportsRouter.get(
  '/school-performance',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMonth = nowIST.getMonth() + 1;
      const currentYear = nowIST.getFullYear();

      // July 2026 override default check as in statistics route
      const month = req.query.month ? parseInt(req.query.month as string) : currentMonth;
      const year = req.query.year ? parseInt(req.query.year as string) : currentYear;

      // 1. Fetch active students
      const students = await prisma.student.findMany({
        where: { status: StudentStatus.ACTIVE },
        select: { id: true, school: true, monthlyFee: true },
      });

      // 2. Fetch all PAID payments for this month
      const payments = await prisma.payment.findMany({
        where: {
          month,
          year,
          status: PaymentStatus.PAID,
        },
        select: { studentId: true, amount: true },
      });

      const paidStudentMap = new Map(payments.map(p => [p.studentId, p.amount]));

      // 3. Group by school
      const schoolMap: Record<string, { expected: number; collected: number; pending: number; count: number }> = {};

      for (const s of students) {
        const schoolName = s.school || 'Unspecified School';
        if (!schoolMap[schoolName]) {
          schoolMap[schoolName] = { expected: 0, collected: 0, pending: 0, count: 0 };
        }

        const isPaid = paidStudentMap.has(s.id);
        const amountCollected = isPaid ? (paidStudentMap.get(s.id) ?? s.monthlyFee) : 0;
        const amountPending = isPaid ? 0 : s.monthlyFee;
        const amountExpected = s.monthlyFee;

        schoolMap[schoolName].expected += amountExpected;
        schoolMap[schoolName].collected += amountCollected;
        schoolMap[schoolName].pending += amountPending;
        schoolMap[schoolName].count += 1;
      }

      const schoolMetrics = Object.entries(schoolMap).map(([schoolName, data]) => {
        const rate = data.expected === 0 ? 100 : parseFloat(((data.collected / data.expected) * 100).toFixed(1));
        return {
          school: schoolName,
          expected: data.expected,
          collected: data.collected,
          pending: data.pending,
          studentCount: data.count,
          rate,
        };
      });

      // Sort by expected contribution descending
      schoolMetrics.sort((a, b) => b.expected - a.expected);

      res.json({
        success: true,
        data: schoolMetrics,
      });
    } catch (error) {
      next(error);
    }
  }
);

