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

  // Use Baileys native useMultiFileAuthState for 100% atomic transaction locking and key handling
  const multiFileState = await baileys.useMultiFileAuthState(sessionDir);

  return {
    state: multiFileState.state,
    saveCreds: multiFileState.saveCreds,
    clearSession: async () => {
      try {
        await prisma.whatsAppSession.deleteMany();
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          fs.mkdirSync(sessionDir, { recursive: true });
        }
      } catch (err) {
        logger.error('Failed to clear WhatsApp session:', err);
      }
    },
  };
}
