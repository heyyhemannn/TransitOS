import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@prisma/client';
import { createAuditLog } from '../lib/audit';

export const settingsRouter = Router();

const updateSettingsSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  upiId: z.string().min(5, 'UPI ID is required').includes('@', { message: 'Must be a valid UPI format (e.g. name@ybl)' }),
});

/**
 * GET /api/v1/settings
 * Retrieve business configuration metadata key-values
 */
settingsRouter.get(
  '/',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await prisma.settings.findMany();
      
      // Transform array of { key, value } to a simple key-value dictionary
      const settingsMap: Record<string, string> = {};
      settings.forEach((s) => {
        settingsMap[s.key] = s.value;
      });

      // Default values if empty
      const responseData = {
        businessName: settingsMap['businessName'] || 'Sri Sai Travels',
        upiId: settingsMap['upiId'] || 'yourupi@upi',
      };

      res.json({
        success: true,
        data: responseData,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/settings
 * Toggles and updates configurations
 */
settingsRouter.post(
  '/',
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessName, upiId } = updateSettingsSchema.parse(req.body);

      // Upsert businessName setting key
      await prisma.settings.upsert({
        where: { key: 'businessName' },
        update: { value: businessName },
        create: { key: 'businessName', value: businessName },
      });

      // Upsert upiId setting key
      await prisma.settings.upsert({
        where: { key: 'upiId' },
        update: { value: upiId },
        create: { key: 'upiId', value: upiId },
      });

      // Log setting update audit log
      if (req.user) {
        await createAuditLog(
          req.user.id,
          'SETTINGS_UPDATE',
          'SETTINGS',
          null,
          { businessName, upiId },
        );
      }

      res.json({
        success: true,
        data: {
          businessName,
          upiId,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
