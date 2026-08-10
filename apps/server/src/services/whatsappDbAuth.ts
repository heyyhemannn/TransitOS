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

    const diskFiles = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
    if (diskFiles.length === 0) return;

    const diskFileSet = new Set(diskFiles);

    // 1. Upsert files currently on disk
    await Promise.all(
      diskFiles.map(async (file) => {
        const filePath = path.join(SESSION_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        await prisma.whatsAppSession.upsert({
          where: { key: file },
          update: { value: content },
          create: { key: file, value: content },
        });
      })
    );

    // 2. Remove consumed/deleted keys from Postgres that no longer exist on disk
    const dbRows = await prisma.whatsAppSession.findMany({ select: { key: true } });
    const staleKeys = dbRows.map(r => r.key).filter(k => !diskFileSet.has(k));
    if (staleKeys.length > 0) {
      await prisma.whatsAppSession.deleteMany({
        where: { key: { in: staleKeys } },
      });
      logger.info(`[WA Auth] Removed ${staleKeys.length} consumed key(s) from Postgres.`);
    }

    logger.info(`[WA Auth] Backed up ${diskFiles.length} session file(s) to Postgres.`);
  } catch (err) {
    logger.error('[WA Auth] Failed to backup session to Postgres:', err);
  }
}

/**
 * Debounced backup: during message sending Baileys calls keys.set() many times
 * in rapid succession (one per Signal pre-key / session key). Without debouncing
 * this floods Postgres with dozens of concurrent upsert batches per message,
 * causing timeout / P2002 errors that surface as 500s to the frontend.
 * We coalesce all writes within a 3-second window into a single backup call.
 */
let backupDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBackup(): void {
  if (backupDebounceTimer) clearTimeout(backupDebounceTimer);
  backupDebounceTimer = setTimeout(() => {
    backupDebounceTimer = null;
    backupToDb().catch(err => logger.error('[WA Auth] Debounced backup failed:', err));
  }, 3000); // wait 3s for burst to settle before writing
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

  // Step 4: Wrap keys.set to schedule a debounced DB backup after signal key changes.
  // Baileys calls keys.set() many times per message (pre-keys, sessions, sender-keys).
  // We write to disk immediately (Baileys native) but debounce the DB backup.
  const originalKeysSet = multiFileState.state.keys.set.bind(multiFileState.state.keys);
  const wrappedKeys = {
    ...multiFileState.state.keys,
    set: async (data: Parameters<typeof originalKeysSet>[0]) => {
      await originalKeysSet(data); // write key files to disk immediately
      scheduleBackup();            // debounced: backs up to Postgres after 3s burst settles
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
