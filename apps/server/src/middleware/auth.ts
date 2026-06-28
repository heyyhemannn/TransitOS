import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

interface TokenPayload {
  userId: string;
  role: string;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (
      req.path?.endsWith('/sms-webhook') ||
      req.originalUrl?.endsWith('/sms-webhook') ||
      req.path?.endsWith('/send-demo') ||
      req.originalUrl?.endsWith('/send-demo') ||
      req.path?.endsWith('/parent-confirm') ||
      req.originalUrl?.endsWith('/parent-confirm') ||
      req.path?.endsWith('/parent/lookup') ||
      req.originalUrl?.endsWith('/parent/lookup')
    ) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      logger.error('JWT_ACCESS_SECRET is not configured in environment variables');
      res.status(500).json({ success: false, error: 'Internal server error' });
      return;
    }

    const decoded = jwt.verify(token, secret) as TokenPayload;
    if (!decoded?.userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    logger.error('Authentication middleware error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
