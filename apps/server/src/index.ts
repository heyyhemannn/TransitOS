import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { authRouter } from './routes/auth';
import { studentsRouter } from './routes/students';
import { routesRouter } from './routes/routes';
import { paymentsRouter } from './routes/payments';
import { whatsappRouter } from './routes/whatsapp';
import { reportsRouter } from './routes/reports';
import { settingsRouter } from './routes/settings';
import { driverRouter } from './routes/driver';
import { parentRouter } from './routes/parent';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { authenticate } from './middleware/auth';
import { initWhatsApp } from './services/whatsappService';
import { initScheduler } from './services/schedulerService';
import { logger } from './lib/logger';

const app = express();
const PORT = process.env.PORT ?? 4000;

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // disabled so API works without CSP friction
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow all origins dynamically (reflecting client origin for credentials support)
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(requestLogger);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '1.0.0',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────
const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`, authRouter);
app.use(`${API_PREFIX}/students`, authenticate, studentsRouter);
app.use(`${API_PREFIX}/routes`, authenticate, routesRouter);
app.use(`${API_PREFIX}/payments`, authenticate, paymentsRouter);
app.use(`${API_PREFIX}/whatsapp`, authenticate, whatsappRouter);
app.use(`${API_PREFIX}/reports`, authenticate, reportsRouter);
app.use(`${API_PREFIX}/settings`, authenticate, settingsRouter);
app.use(`${API_PREFIX}/driver`, authenticate, driverRouter);
app.use(`${API_PREFIX}/parent`, parentRouter); // Public — no authenticate

app.get([API_PREFIX, `${API_PREFIX}/`], (_req, res) => {
  res.json({
    success: true,
    message: "🚀 TransitOS (Hemanth's Transport Services) API Gateway is online. Prefix endpoints with /api/v1",
  });
});

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: "🚀 TransitOS (Hemanth's Transport Services) API Gateway is online. Prefix endpoints with /api/v1",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// SERVER START
// ─────────────────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Start HTTP server
    app.listen(PORT, () => {
      logger.info(`🚀 STMS Server running on http://localhost:${PORT}`);
      logger.info(`📋 API available at http://localhost:${PORT}/api/v1`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);
    });

    // Initialize WhatsApp (non-blocking)
    if (process.env.NODE_ENV !== 'test') {
      initWhatsApp().catch((err: unknown) => {
        logger.warn('WhatsApp initialization failed (non-fatal):', err);
      });
    }

    // Initialize cron scheduler
    if (process.env.NODE_ENV !== 'test') {
      initScheduler();
      logger.info('⏰ Scheduler initialized');
    }
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

bootstrap();

export default app;
