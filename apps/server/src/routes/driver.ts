import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, StudentStatus } from '@prisma/client';

export const driverRouter = Router();

/**
 * GET /api/v1/driver/me
 * Returns the authenticated driver's assigned route + full student list
 */
driverRouter.get(
  '/me',
  requireRole(UserRole.DRIVER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const route = await prisma.route.findFirst({
        where: { driverId: req.user!.id },
        include: {
          students: {
            where: { status: StudentStatus.ACTIVE },
            select: {
              id: true,
              name: true,
              school: true,
              class: true,
              parentName: true,
              fatherMobile: true,
              whatsappNumber: true,
              pickupAddress: true,
              dropAddress: true,
              pickupTime: true,
              dropTime: true,
            },
            orderBy: { pickupTime: 'asc' },
          },
        },
      });

      if (!route) {
        res.json({ success: true, data: { route: null, students: [] } });
        return;
      }

      const { students, ...routeInfo } = route;

      res.json({
        success: true,
        data: {
          route: {
            id: routeInfo.id,
            name: routeInfo.name,
            vehicleNumber: routeInfo.vehicleNumber,
            driverName: routeInfo.driverName,
          },
          students,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/driver/me/students
 * Returns only the students on the driver's assigned route, ordered by pickupTime
 */
driverRouter.get(
  '/me/students',
  requireRole(UserRole.DRIVER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const route = await prisma.route.findFirst({
        where: { driverId: req.user!.id },
        select: { id: true },
      });

      if (!route) {
        res.json({ success: true, data: [] });
        return;
      }

      const students = await prisma.student.findMany({
        where: { routeId: route.id, status: StudentStatus.ACTIVE },
        select: {
          id: true,
          name: true,
          school: true,
          class: true,
          parentName: true,
          fatherMobile: true,
          whatsappNumber: true,
          pickupAddress: true,
          dropAddress: true,
          pickupTime: true,
          dropTime: true,
        },
        orderBy: { pickupTime: 'asc' },
      });

      res.json({ success: true, data: students });
    } catch (error) {
      next(error);
    }
  },
);
