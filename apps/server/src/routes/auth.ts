import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { getRedis, incrementRateLimit } from '../lib/redis';
import { logger } from '../lib/logger';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@prisma/client';

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
  const maxAttempts = 20;

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
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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
        refreshToken,
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
    const oldRefreshToken =
      (req.cookies.refreshToken as string | undefined) ??
      (req.body.refreshToken as string | undefined) ??
      (req.headers['x-refresh-token'] as string | undefined);

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

    // Verify that the refresh token exists in Redis (soft check — allows graceful recovery after server restart)
    try {
      const redis = getRedis();
      const storedToken = await redis.get<string>(`refresh:${decoded.userId}`);
      // Only hard-reject if Redis explicitly holds a DIFFERENT token (token reuse / rotation attack).
      // If storedToken is null (server restart wiped Redis/DB), trust the valid JWT signature and reissue.
      if (storedToken && storedToken !== oldRefreshToken) {
        logger.warn(`[Auth] Refresh token mismatch for user ${decoded.userId} — possible replay attack.`);
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
    } catch (redisError) {
      // Redis unavailable — trust the JWT signature, proceed
      logger.warn('Redis unavailable during refresh check — proceeding with JWT signature only:', redisError);
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
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
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
    const oldRefreshToken =
      (req.cookies.refreshToken as string | undefined) ??
      (req.body.refreshToken as string | undefined) ??
      (req.headers['x-refresh-token'] as string | undefined);

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
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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

/**
 * GET /api/v1/auth/users
 * ADMIN only — list all users, optionally filtered by role.
 * Used to populate driver assignment dropdowns and settings list.
 */
authRouter.get(
  '/users',
  authenticate,
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roleFilter = req.query.role as string | undefined;

      // Validate the role filter if provided
      const validRoles = Object.values(UserRole);
      if (roleFilter && !validRoles.includes(roleFilter as UserRole)) {
        res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        return;
      }

      const users = await prisma.user.findMany({
        where: {
          // If no roleFilter (settings view), return all users. If roleFilter (e.g. DRIVER selection), return active only.
          ...(roleFilter ? { role: roleFilter as UserRole, isActive: true } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { name: 'asc' },
      });

      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  },
);

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.nativeEnum(UserRole),
});

/**
 * POST /api/v1/auth/register
 * ADMIN only — creates a new active user
 */
authRouter.post(
  '/register',
  authenticate,
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = registerSchema.parse(req.body);

      const existingUser = await prisma.user.findUnique({
        where: { email: body.email.toLowerCase() },
      });

      if (existingUser) {
        res.status(400).json({ success: false, error: 'User with this email already exists' });
        return;
      }

      const passwordHash = await bcrypt.hash(body.password, 12);

      const user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email.toLowerCase(),
          passwordHash,
          role: body.role,
          isActive: true,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/auth/users/:userId/deactivate
 * ADMIN only — deactivates a user
 */
authRouter.patch(
  '/users/:userId/deactivate',
  authenticate,
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;

      if (userId === req.user?.id) {
        res.status(400).json({ success: false, error: 'Cannot deactivate yourself' });
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      res.json({ success: true, message: 'User deactivated successfully' });
    } catch (error) {
      next(error);
    }
  }
);

const changePasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * POST /api/v1/auth/users/:userId/change-password
 * ADMIN only — updates a user's password directly in the database
 */
authRouter.post(
  '/users/:userId/change-password',
  authenticate,
  requireRole(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const { password } = changePasswordSchema.parse(req.body);

      const passwordHash = await bcrypt.hash(password, 12);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
      next(error);
    }
  }
);

