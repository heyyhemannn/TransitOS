import * as path from 'path';
import * as fs from 'fs';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export async function usePrismaAuthState() {
  const baileys = await import('@whiskeysockets/baileys');
  const sessionDir = path.resolve(
    process.cwd(),
    process.env.WHATSAPP_SESSION_PATH || './whatsapp-session'
  );

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  // Use Baileys native multi-file auth state for 100% reliable session persistence
  const multiFileState = await baileys.useMultiFileAuthState(sessionDir);

  if (multiFileState.state.creds.me) {
    multiFileState.state.creds.registered = true;
  }

  return {
    state: multiFileState.state,
    saveCreds: async () => {
      try {
        if (multiFileState.state.creds.me) {
          multiFileState.state.creds.registered = true;
        }
        await multiFileState.saveCreds();

        // Backup primary creds to database for persistent resilience
        const value = JSON.stringify(multiFileState.state.creds, baileys.BufferJSON.replacer);
        await prisma.whatsAppSession.upsert({
          where: { key: 'creds' },
          update: { value },
          create: { key: 'creds', value },
        });
      } catch (err) {
        logger.warn('Failed to back up WhatsApp creds to DB:', err);
      }
    },
    clearSession: async () => {
      try {
        await prisma.whatsAppSession.deleteMany();
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          fs.mkdirSync(sessionDir, { recursive: true });
        }
      } catch (err) {
        logger.error('Failed to clear WhatsApp session files/DB:', err);
      }
    },
  };
}
