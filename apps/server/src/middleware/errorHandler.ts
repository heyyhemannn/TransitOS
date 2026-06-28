import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../lib/logger';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Prisma known errors
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    const prismaErr = err as { code: string; meta?: { target?: string[] } };
    if (prismaErr.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: `Duplicate value for field: ${String(prismaErr.meta?.target ?? 'unknown')}`,
      });
      return;
    }
    if (prismaErr.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'Record not found',
      });
      return;
    }
    logger.error('Prisma error:', err);
    res.status(500).json({ success: false, error: 'Database error' });
    return;
  }

  // Generic Error
  if (err instanceof Error) {
    logger.error('Unhandled error:', err);
    const isDev = process.env.NODE_ENV === 'development';
    res.status(500).json({
      success: false,
      error: isDev ? err.message : 'Internal server error',
      ...(isDev && { stack: err.stack }),
    });
    return;
  }

  // Unknown error
  logger.error('Unknown error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
}
