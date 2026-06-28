import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { getRedis, incrementRateLimit } from '../lib/redis';
import { logger } from '../lib/logger';
import { authenticate } from '../middleware/auth';

export const authRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
async function loginRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const key = `ratelimit:login:${ip}`;
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  try {
    const { count, ttl } = await incrementRateLimit(key, windowMs);
    if (count > maxAttempts) {
      res.status(429).json({
        success: false,
        error: `Too many login attempts. Please try again in ${Math.ceil(ttl / 60)} minutes.`,
      });
      return;
    }
    next();
  } catch (error) {
    // Graceful fallback: do not block login if Redis cache has issues
    logger.warn('Login rate limiter connection error:', error);
    next();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials, sets refresh token cookie, registers token in Redis
 */
authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const isValidPassword = await bcrypt.compare(body.password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const accessSecret = process.env.JWT_ACCESS_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!accessSecret || !refreshSecret) {
      logger.error('JWT secrets are not defined in environment variables');
      res.status(500).json({ success: false, error: 'Internal server error' });
      return;
    }

    // Generate JWT tokens
    const accessToken = jwt.sign(
      { userId: user.id, role: user.role },
      accessSecret,
      { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '7d') as any }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      refreshSecret,
      { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') as any }
    );

    // Save refresh token to Redis with 30-day expiration
    try {
      const redis = getRedis();
      await redis.set(`refresh:${user.id}`, refreshToken, { ex: 30 * 24 * 60 * 60 });
    } catch (redisError) {
      logger.error(`Failed to store refresh token in Redis for user ${user.id}:`, redisError);
      res.status(500).json({ success: false, error: 'Internal server error' });
      return;
    }

    // Set refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/refresh
 * Rotates the refresh token and returns a new access token
 */
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oldRefreshToken = req.cookies.refreshToken as string | undefined;
    if (!oldRefreshToken) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    const accessSecret = process.env.JWT_ACCESS_SECRET;
    if (!accessSecret || !refreshSecret) {
      logger.error('JWT secrets are not defined in environment variables');
      res.status(500).json({ success: false, error: 'Internal server error' });
      return;
    }

    // Verify token signature
    let decoded: { userId: string } | null = null;
    try {
      decoded = jwt.verify(oldRefreshToken, refreshSecret) as { userId: string };
    } catch {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!decoded?.userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Verify that the refresh token exists in Redis
    try {
      const redis = getRedis();
      const storedToken = await redis.get<string>(`refresh:${decoded.userId}`);
      if (!storedToken || storedToken !== oldRefreshToken) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
    } catch (redisError) {
      logger.error('Redis connection failed during token refresh verification:', redisError);
      res.status(500).json({ success: false, error: 'Internal server error' });
      return;
    }

    // Fetch user to verify they are still active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Generate new tokens
    const newAccessToken = jwt.sign(
      { userId: user.id, role: user.role },
      accessSecret,
      { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '7d') as any }
    );

    const newRefreshToken = jwt.sign(
      { userId: user.id },
      refreshSecret,
      { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') as any }
    );

    // Rotate Redis token (atomic overwrite)
    try {
      const redis = getRedis();
      await redis.set(`refresh:${user.id}`, newRefreshToken, { ex: 30 * 24 * 60 * 60 });
    } catch (redisError) {
      logger.error(`Failed to rotate refresh token in Redis for user ${user.id}:`, redisError);
      res.status(500).json({ success: false, error: 'Internal server error' });
      return;
    }

    // Set rotated cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/logout
 * Deletes the session from Redis and clears the httpOnly cookies
 */
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oldRefreshToken = req.cookies.refreshToken as string | undefined;
    if (oldRefreshToken) {
      const refreshSecret = process.env.JWT_REFRESH_SECRET;
      if (refreshSecret) {
        try {
          const decoded = jwt.verify(oldRefreshToken, refreshSecret) as { userId: string };
          if (decoded?.userId) {
            const redis = getRedis();
            await redis.del(`refresh:${decoded.userId}`);
          }
        } catch {
          // Ignore invalid signature during logout
        }
      }
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/auth/me
 * Retrieves current active session profile details
 */
authRouter.get('/me', authenticate, (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const { id, name, email, role, createdAt } = req.user;

  res.json({
    success: true,
    data: {
      id,
      name,
      email,
      role,
      createdAt: createdAt.toISOString(),
    },
  });
});
