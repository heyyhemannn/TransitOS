import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

export const parentRouter = Router();

// 5 requests per minute per IP for the lookup endpoint
const lookupRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a minute before trying again.' },
  keyGenerator: (req) => req.ip ?? 'unknown',
});

const lookupSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number'),
});

/**
 * POST /api/v1/parent/lookup
 * Public endpoint — no auth required.
 * Returns student(s) linked to the given mobile number with 2-year payment history.
 */
parentRouter.post(
  '/lookup',
  lookupRateLimit,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { phone } = lookupSchema.parse(req.body);

      const currentYear = new Date().getFullYear();
      const fromYear = currentYear - 1;

      const students = await prisma.student.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { fatherMobile: phone },
            { motherMobile: phone },
            { whatsappNumber: phone },
          ],
        },
        include: {
          route: {
            select: { id: true, name: true },
          },
          payments: {
            where: { year: { gte: fromYear } },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            select: {
              id: true,
              month: true,
              year: true,
              status: true,
              amount: true,
              paidAt: true,
              method: true,
              // transactionId intentionally omitted — internal data
            },
          },
          feeSchedules: {
            where: { year: { gte: fromYear } },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            select: {
              month: true,
              year: true,
              dueDate: true,
              amount: true,
              isPaid: true,
            },
          },
        },
      });

      res.json({ success: true, data: { students } });
    } catch (error) {
      next(error);
    }
  },
);
