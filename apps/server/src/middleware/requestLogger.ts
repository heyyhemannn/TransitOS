import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, url, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    const logFn =
      statusCode >= 500 ? logger.error.bind(logger) : statusCode >= 400
        ? logger.warn.bind(logger)
        : logger.info.bind(logger);

    logFn(`${method} ${url} ${statusCode} ${duration}ms — ${ip ?? 'unknown'}`);
  });

  next();
}
