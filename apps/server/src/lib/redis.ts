import { Redis } from '@upstash/redis';
import { logger } from './logger';

let redisClient: any = null;

/**
 * Local in-memory mock client to allow development out of the box
 * without requiring Upstash cloud database credentials.
 */
class MockRedis {
  private store = new Map<string, { value: any; expiry: number | null }>();

  async set(key: string, value: any, options?: { ex?: number }): Promise<'OK'> {
    const expiry = options?.ex ? Date.now() + options.ex * 1000 : null;
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiry && Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.value as T;
  }

  async del(key: string): Promise<number> {
    const deleted = this.store.delete(key);
    return deleted ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expiry = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (item.expiry === null) return -1;
    const remaining = Math.ceil((item.expiry - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }
}

/**
 * Returns a Redis client.
 * Uses Upstash if configured, falls back to a graceful in-memory MockRedis locally.
 */
export function getRedis(): Redis {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    logger.warn('⚠️ Upstash Redis URL/Token is missing. Falling back to in-memory MockRedis cache.');
    redisClient = new MockRedis();
    return redisClient;
  }

  try {
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch (err) {
    logger.error('Failed to initialize Upstash Redis. Falling back to in-memory MockRedis.', err);
    redisClient = new MockRedis();
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
