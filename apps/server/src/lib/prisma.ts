import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

// Prevent multiple Prisma client instances during hot reload in development
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Build a DATABASE_URL that is safe for Supabase PgBouncer (transaction mode).
 * - connection_limit=1 : Prisma holds only 1 connection; PgBouncer does the actual pooling.
 * - pool_timeout=30    : Wait up to 30 s for a free slot before throwing.
 * If the URL already contains these params (e.g. set in Render env), they will not be duplicated.
 */
function buildDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? '';
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1');
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '30');
    }
    if (!url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
    return url.toString();
  } catch {
    // If the URL is malformed just return it as-is; Prisma will surface the real error.
    return raw;
  }
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    errorFormat: 'pretty',
    datasources: {
      db: { url: buildDatabaseUrl() },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}


