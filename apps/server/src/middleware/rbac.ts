import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

/**
 * Role-Based Access Control middleware.
 * Verifies that the authenticated user possesses one of the required roles.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    next();
  };
}
