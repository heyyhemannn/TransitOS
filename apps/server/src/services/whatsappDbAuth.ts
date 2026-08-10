/**
 * whatsappDbAuth.ts
 *
 * STRATEGY: Use Baileys' native `useMultiFileAuthState` for all auth state
 * operations (file I/O, serialisation, key management — Baileys handles this
 * correctly and we do NOT want to re-implement it). Additionally, backup every
 * session file to Supabase Postgres (WhatsAppSession table) and restore them on
 * startup.
 *
 * WHY POSTGRES BACKUP: Render free tier has an ephemeral filesystem. Every
 * restart/deploy/sleep wipes the local ./whatsapp-session folder. Without DB
 * backup, the session is permanently lost and parents stop receiving messages.
 * With this approach the session survives forever — until the user manually
 * logs out.
 *
 * FLOW:
 *   1. Startup  → restore session files from Postgres to disk (if disk is empty)
 *   2. Normal   → Baileys reads/writes its own session files on disk
 *   3. On save  → also upsert every session file into Postgres as a backup
 *   4. Logout   → delete from disk AND Postgres
 */

import * as path from 'path';
import * as fs from 'fs';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const SESSION_DIR = path.resolve(
  process.cwd(),
  process.env.WHATSAPP_SESSION_PATH || './whatsapp-session'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Restore session files from Postgres to disk (called on server startup). */
async function restoreFromDb(): Promise<void> {
  try {
    const rows = await prisma.whatsAppSession.findMany();
    if (rows.length === 0) {
      logger.info('[WA Auth] No session found in Postgres — fresh start.');
      return;
    }

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    for (const row of rows) {
      const filePath = path.join(SESSION_DIR, row.key);
      fs.writeFileSync(filePath, row.value, 'utf-8');
    }
    logger.info(`[WA Auth] Restored ${rows.length} session file(s) from Postgres to disk.`);
  } catch (err) {
    logger.error('[WA Auth] Failed to restore session from Postgres:', err);
  }
}

/** Backup all session files from disk to Postgres (called after every save). */
async function backupToDb(): Promise<void> {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;

    const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) return;

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(SESSION_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        await prisma.whatsAppSession.upsert({
          where: { key: file },
          update: { value: content },
          create: { key: file, value: content },
        });
      })
    );
    logger.info(`[WA Auth] Backed up ${files.length} session file(s) to Postgres.`);
  } catch (err) {
    logger.error('[WA Auth] Failed to backup session to Postgres:', err);
  }
}

// ── Main exported function ────────────────────────────────────────────────────

export async function usePrismaAuthState() {
  const baileys = await import('@whiskeysockets/baileys');

  // Step 1: Restore session files from DB if disk is empty (e.g. after Render restart)
  const credsFile = path.join(SESSION_DIR, 'creds.json');
  if (!fs.existsSync(credsFile)) {
    await restoreFromDb();
  }

  // Ensure the directory exists for Baileys
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  // Step 2: Use Baileys' native file-based auth state (handles all serialisation correctly)
  const multiFileState = await baileys.useMultiFileAuthState(SESSION_DIR);

  // Step 3: Wrap saveCreds to also backup to DB
  const saveCreds = async () => {
    await multiFileState.saveCreds(); // write creds.json to disk
    await backupToDb();               // backup all session files to Postgres
  };

  // Step 4: Wrap keys.set to also backup to DB after signal key changes
  const originalKeysSet = multiFileState.state.keys.set.bind(multiFileState.state.keys);
  const wrappedKeys = {
    ...multiFileState.state.keys,
    set: async (data: Parameters<typeof originalKeysSet>[0]) => {
      await originalKeysSet(data); // write key files to disk
      await backupToDb();          // backup all session files to Postgres
    },
  };

  const clearSession = async () => {
    try {
      // Clear disk
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        fs.mkdirSync(SESSION_DIR, { recursive: true });
      }
      // Clear Postgres
      await prisma.whatsAppSession.deleteMany();
      logger.info('[WA Auth] Session cleared from disk and Postgres.');
    } catch (err) {
      logger.error('[WA Auth] Failed to clear session:', err);
    }
  };

  return {
    state: {
      creds: multiFileState.state.creds,
      keys: wrappedKeys,
    },
    saveCreds,
    clearSession,
  };
}
