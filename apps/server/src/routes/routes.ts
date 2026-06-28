import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole, StudentStatus } from '@prisma/client';
import { createAuditLog } from '../lib/audit';

export const routesRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────
const createRouteSchema = z.object({
  name: z.string().min(2, 'Route name must be at least 2 characters'),
  driverName: z.string().optional().nullable(),
  vehicleNumber: z.string().optional().nullable(),
});

const updateRouteSchema = createRouteSchema.partial();

const assignRouteSchema = z.object({
  studentId: z.string().min(1, 'Student ID is required'),
  routeId: z.string().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/routes
 * List all active routes with student counts
 */
routesRouter.get(
  '/',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.DRIVER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const includeStudents = req.query.includeStudents === 'true';

      const routes = await prisma.route.findMany({
        where: { isActive: true },
        include: {
          students: includeStudents
            ? {
                where: { status: StudentStatus.ACTIVE },
                select: {
                  id: true,
                  name: true,
                  school: true,
                  class: true,
                  pickupTime: true,
                  dropTime: true,
                  pickupAddress: true,
                },
              }
            : false,
          _count: {
            select: {
              students: {
                where: { status: StudentStatus.ACTIVE },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      res.json({
        success: true,
        data: routes,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/routes
 * Create a new route (ADMIN only)
 */
routesRouter.post(
  '/',
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createRouteSchema.parse(req.body);

      // Verify route name is unique
      const existingRoute = await prisma.route.findFirst({
        where: {
          name: { equals: body.name, mode: 'insensitive' },
          isActive: true,
        },
      });

      if (existingRoute) {
        res.status(409).json({
          success: false,
          error: 'Route with this name already exists',
        });
        return;
      }

      const route = await prisma.route.create({
        data: {
          name: body.name,
          driverName: body.driverName || null,
          vehicleNumber: body.vehicleNumber || null,
          isActive: true,
        },
      });

      if (req.user) {
        await createAuditLog(req.user.id, 'CREATE_ROUTE', 'Route', route.id, {
          name: route.name,
        });
      }

      res.status(201).json({
        success: true,
        data: route,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /api/v1/routes/:id
 * Update route metadata (ADMIN only)
 */
routesRouter.put(
  '/:id',
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const body = updateRouteSchema.parse(req.body);

      const existingRoute = await prisma.route.findUnique({
        where: { id },
      });

      if (!existingRoute || !existingRoute.isActive) {
        res.status(404).json({ success: false, error: 'Route not found' });
        return;
      }

      // Verify route name uniqueness if changed
      if (body.name && body.name.toLowerCase() !== existingRoute.name.toLowerCase()) {
        const duplicate = await prisma.route.findFirst({
          where: {
            name: { equals: body.name, mode: 'insensitive' },
            isActive: true,
            id: { not: id },
          },
        });

        if (duplicate) {
          res.status(409).json({
            success: false,
            error: 'Route with this name already exists',
          });
          return;
        }
      }

      const updatedRoute = await prisma.route.update({
        where: { id },
        data: {
          name: body.name,
          driverName: body.driverName !== undefined ? body.driverName : undefined,
          vehicleNumber: body.vehicleNumber !== undefined ? body.vehicleNumber : undefined,
        },
        include: {
          _count: {
            select: {
              students: {
                where: { status: StudentStatus.ACTIVE },
              },
            },
          },
        },
      });

      if (req.user) {
        await createAuditLog(req.user.id, 'UPDATE_ROUTE', 'Route', id, {
          changedFields: Object.keys(body),
        });
      }

      res.json({
        success: true,
        data: updatedRoute,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/v1/routes/:id
 * Deactivates a route (soft delete, ADMIN only)
 */
routesRouter.delete(
  '/:id',
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const route = await prisma.route.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              students: {
                where: { status: StudentStatus.ACTIVE },
              },
            },
          },
        },
      });

      if (!route || !route.isActive) {
        res.status(404).json({ success: false, error: 'Route not found' });
        return;
      }

      if (route._count.students > 0) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete route with active students. Reassign students first.',
        });
        return;
      }

      await prisma.route.update({
        where: { id },
        data: { isActive: false },
      });

      if (req.user) {
        await createAuditLog(req.user.id, 'DELETE_ROUTE', 'Route', id);
      }

      res.json({
        success: true,
        data: { message: 'Route successfully deactivated' },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/routes/:id/assign
 * Assign or reassign a student to a route (ADMIN and MANAGER only)
 */
routesRouter.post(
  '/:id/assign',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = assignRouteSchema.parse(req.body);

      // Verify student exists and is active
      const student = await prisma.student.findUnique({
        where: { id: body.studentId },
      });

      if (!student || student.status !== StudentStatus.ACTIVE) {
        res.status(404).json({
          success: false,
          error: 'Active student not found',
        });
        return;
      }

      // Verify route exists and is active if not null
      if (body.routeId) {
        const route = await prisma.route.findUnique({
          where: { id: body.routeId },
        });

        if (!route || !route.isActive) {
          res.status(404).json({
            success: false,
            error: 'Active route not found',
          });
          return;
        }
      }

      const updatedStudent = await prisma.student.update({
        where: { id: body.studentId },
        data: { routeId: body.routeId },
        include: {
          route: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (req.user) {
        await createAuditLog(req.user.id, 'ASSIGN_ROUTE', 'Student', student.id, {
          studentId: student.id,
          fromRouteId: student.routeId,
          toRouteId: body.routeId,
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
 * GET /api/v1/routes/:id/students
 * Return all active students assigned to a route, sorted by pickup time
 */
routesRouter.get(
  '/:id/students',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.DRIVER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const route = await prisma.route.findUnique({
        where: { id },
      });

      if (!route || !route.isActive) {
        res.status(404).json({ success: false, error: 'Route not found' });
        return;
      }

      const students = await prisma.student.findMany({
        where: {
          routeId: id,
          status: StudentStatus.ACTIVE,
        },
        select: {
          id: true,
          name: true,
          school: true,
          class: true,
          parentName: true,
          whatsappNumber: true,
          pickupTime: true,
          dropTime: true,
          pickupAddress: true,
          dropAddress: true,
        },
        orderBy: { pickupTime: 'asc' },
      });

      res.json({
        success: true,
        data: students,
      });
    } catch (error) {
      next(error);
    }
  },
);
