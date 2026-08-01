import { Redis } from '@upstash/redis';
import { logger } from './logger';
import { prisma } from './prisma';

let redisClient: any = null;

/**
 * Database-backed persistent key-value store using the Settings table.
 * Used as a graceful fallback when Upstash Redis is not configured,
 * ensuring session persistence across Render restarts/spin-downs.
 */
class DbSettingsRedis {
  async set(key: string, value: any, options?: { ex?: number }): Promise<'OK'> {
    const expiry = options?.ex ? new Date(Date.now() + options.ex * 1000).toISOString() : null;
    const dataStr = JSON.stringify({ value, expiry });
    try {
      await prisma.settings.upsert({
        where: { key },
        update: { value: dataStr },
        create: { key, value: dataStr },
      });
      return 'OK';
    } catch (err: any) {
      logger.error(`[DbSettingsRedis] Error setting key ${key}: ${err.message}`);
      return 'OK';
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const record = await prisma.settings.findUnique({ where: { key } });
      if (!record) return null;
      const { value, expiry } = JSON.parse(record.value);
      if (expiry && Date.now() > new Date(expiry).getTime()) {
        await this.del(key);
        return null;
      }
      return value as T;
    } catch (err: any) {
      logger.error(`[DbSettingsRedis] Error getting key ${key}: ${err.message}`);
      return null;
    }
  }

  async del(key: string): Promise<number> {
    try {
      await prisma.settings.delete({ where: { key } });
      return 1;
    } catch {
      // If record not found, delete throws, which we catch and return 0
      return 0;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      const current = (await this.get<number>(key)) ?? 0;
      const next = current + 1;
      await this.set(key, next);
      return next;
    } catch (err: any) {
      logger.error(`[DbSettingsRedis] Error incrementing key ${key}: ${err.message}`);
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    try {
      const record = await prisma.settings.findUnique({ where: { key } });
      if (!record) return 0;
      const { value } = JSON.parse(record.value);
      await this.set(key, value, { ex: seconds });
      return 1;
    } catch (err: any) {
      logger.error(`[DbSettingsRedis] Error setting expiry for key ${key}: ${err.message}`);
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      const record = await prisma.settings.findUnique({ where: { key } });
      if (!record) return -2;
      const { expiry } = JSON.parse(record.value);
      if (expiry === null) return -1;
      const remaining = Math.ceil((new Date(expiry).getTime() - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    } catch (err: any) {
      logger.error(`[DbSettingsRedis] Error getting TTL for key ${key}: ${err.message}`);
      return -2;
    }
  }
}

/**
 * Returns a Redis client.
 * Uses Upstash if configured, falls back to a database-backed DbSettingsRedis cache.
 */
export function getRedis(): Redis {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    logger.warn('⚠️ Upstash Redis URL/Token is missing. Falling back to persistent database-backed cache.');
    redisClient = new DbSettingsRedis();
    return redisClient;
  }

  try {
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch (err) {
    logger.error('Failed to initialize Upstash Redis. Falling back to database-backed cache.', err);
    redisClient = new DbSettingsRedis();
    return redisClient;
  }
}

/**
 * Rate-limit key helper.
 * Stores attempt counts in Redis with TTL.
 */
export async function incrementRateLimit(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttl: number }> {
  const redis = getRedis();
  const ttlSeconds = Math.ceil(windowMs / 1000);

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttlSeconds);
  }
  const ttl = await redis.ttl(key);
  return { count, ttl };
}
