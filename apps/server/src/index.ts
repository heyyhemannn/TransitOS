import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { authRouter } from './routes/auth';
import { studentsRouter } from './routes/students';
import { routesRouter } from './routes/routes';
import { paymentsRouter, publicPaymentsRouter } from './routes/payments';
import { whatsappRouter } from './routes/whatsapp';
import { reportsRouter } from './routes/reports';
import { settingsRouter } from './routes/settings';
import { driverRouter } from './routes/driver';
import { parentRouter } from './routes/parent';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { authenticate } from './middleware/auth';
import { initWhatsApp, getWhatsAppDebugInfo } from './services/whatsappService';
import { initScheduler } from './services/schedulerService';
import { logger } from './lib/logger';
import { startKeepAlive } from './lib/keepAlive';
import { prisma } from './lib/prisma';


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
// Public payment endpoints (parent-confirm) — no JWT required
app.use(`${API_PREFIX}/payments`, publicPaymentsRouter);
// Authenticated payment endpoints — require JWT
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

import fs from 'fs';
import path from 'path';

// Temporary debug route to inspect container logs
app.get(`${API_PREFIX}/debug/logs`, (_req, res) => {
  try {
    const logPath = path.resolve(process.cwd(), 'logs/combined.log');
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf-8');
      const lines = logs.trim().split('\n');
      const last150 = lines.slice(-150).join('\n');
      res.type('text/plain').send(last150);
    } else {
      res.status(404).send('No combined.log file found');
    }
  } catch (err: any) {
    res.status(500).send(`Error reading logs: ${err.message}`);
  }
});

// Temporary debug route to inspect WhatsApp connection status
app.get(`${API_PREFIX}/debug/whatsapp`, (_req, res) => {
  try {
    const info = getWhatsAppDebugInfo();
    res.json({ success: true, data: info });
  } catch (err: any) {
    res.status(500).send(`Error getting debug info: ${err.message}`);
  }
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
      startKeepAlive();
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
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();

export default app;
