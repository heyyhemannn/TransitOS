import https from 'https';
import { prisma } from './prisma';
import { logger } from './logger';

const PING_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

function pingUrl(url: string): void {
  const mod = url.startsWith('https') ? https : require('http');
  mod.get(url, (res: { statusCode: number; resume: () => void }) => {
    logger.info(`[KeepAlive] ${url} → ${res.statusCode}`);
    res.resume();
  }).on('error', (err: Error) => {
    logger.warn(`[KeepAlive] Ping failed for ${url}: ${err.message}`);
  });
}

async function keepDbAlive(): Promise<void> {
  try {
    // Lightweight query — just checks DB is alive, keeps Supabase from pausing
    await prisma.$queryRaw`SELECT 1`;
    logger.info('[KeepAlive] DB heartbeat OK');
  } catch (err) {
    logger.warn('[KeepAlive] DB heartbeat failed:', err);
  }
}

export function startKeepAlive(): void {
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  if (process.env.NODE_ENV !== 'production') {
    logger.info('[KeepAlive] Skipped — not in production');
    return;
  }

  setInterval(async () => {
    // 1. Ping self to prevent Render from sleeping
    if (selfUrl) pingUrl(`${selfUrl}/health`);

    // 2. Ping Supabase REST to keep it active
    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl) pingUrl(`${supabaseUrl}/rest/v1/`);

    // 3. Run a DB query to keep Supabase from auto-pausing
    await keepDbAlive();
  }, PING_INTERVAL_MS);

  logger.info('[KeepAlive] Started — pinging every 10 minutes (self + Supabase + DB)');
}
