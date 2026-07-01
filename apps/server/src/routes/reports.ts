import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, StudentStatus, PaymentStatus } from '@prisma/client';
import { getWhatsAppStatus } from '../services/whatsappService';

export const reportsRouter = Router();

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

      // If we are currently in June 2026, default dashboard view to July 2026 since we migrated schedules there
      const month = req.query.month ? parseInt(req.query.month as string) : (currentMonth === 6 && currentYear === 2026 ? 7 : currentMonth);
      const year = req.query.year ? parseInt(req.query.year as string) : currentYear;

      const [totalStudents, activeRoutes, feeSchedules] = await Promise.all([
        prisma.student.count({
          where: { status: StudentStatus.ACTIVE },
        }),
        prisma.route.count({
          where: { isActive: true },
        }),
        prisma.feeSchedule.findMany({
          where: { month, year },
          select: { amount: true, isPaid: true },
        }),
      ]);

      const expectedRevenue = feeSchedules.reduce((sum, s) => sum + s.amount, 0);
      const receivedRevenue = feeSchedules.filter(s => s.isPaid).reduce((sum, s) => sum + s.amount, 0);
      const pendingRevenue = feeSchedules.filter(s => !s.isPaid).reduce((sum, s) => sum + s.amount, 0);
      const whatsapp = getWhatsAppStatus();

      res.json({
        success: true,
        data: {
          totalStudents,
          activeRoutes,
          expectedRevenue,
          receivedRevenue,
          pendingRevenue,
          whatsappStatus: whatsapp.connected,
        },
      });
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
