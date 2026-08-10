import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../lib/logger';

/**
 * Ensures CORS headers are present on error responses.
 * When a route throws and Express jumps straight to the error handler,
 * the cors() middleware has already run — but some edge cases (e.g. the
 * error handler itself responding before cors sets headers on that specific
 * response object) can strip them. Explicitly setting the header here means
 * the browser always gets Access-Control-Allow-Origin even on 500s, so the
 * real error is visible instead of a misleading CORS block.
 */
function ensureCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Always ensure CORS headers on error responses so browser shows real error
  ensureCorsHeaders(req, res);

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
