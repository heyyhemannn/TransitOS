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

// Cache of file contents already saved to DB to prevent continuous DB queries
const savedContentCache = new Map<string, string>();

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
      savedContentCache.set(row.key, row.value);
    }
    logger.info(`[WA Auth] Restored ${rows.length} session file(s) from Postgres to disk.`);
  } catch (err) {
    logger.error('[WA Auth] Failed to restore session from Postgres:', err);
  }
}

/** Backup modified session files from disk to Postgres (only dirty files). */
async function backupToDb(): Promise<void> {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;

    const diskFiles = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
    if (diskFiles.length === 0) return;

    const diskFileSet = new Set(diskFiles);
    const changedFiles: { file: string; content: string }[] = [];

    for (const file of diskFiles) {
      const filePath = path.join(SESSION_DIR, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (savedContentCache.get(file) !== content) {
          changedFiles.push({ file, content });
        }
      } catch {
        // Ignore transient file read errors
      }
    }

    // If nothing changed, exit immediately with 0 DB queries!
    if (changedFiles.length === 0) {
      return;
    }

    // Upsert only dirty files
    for (const { file, content } of changedFiles) {
      try {
        await prisma.whatsAppSession.upsert({
          where: { key: file },
          update: { value: content },
          create: { key: file, value: content },
        });
        savedContentCache.set(file, content);
      } catch (upsertErr) {
        logger.warn(`[WA Auth] Failed to upsert session file ${file}:`, upsertErr);
      }
    }

    // Clean up removed keys
    for (const key of Array.from(savedContentCache.keys())) {
      if (!diskFileSet.has(key)) {
        savedContentCache.delete(key);
        await prisma.whatsAppSession.deleteMany({ where: { key } }).catch(() => {});
      }
    }

    logger.info(`[WA Auth] Backed up ${changedFiles.length} modified session file(s) to Postgres.`);
  } catch (err) {
    logger.error('[WA Auth] Failed to backup session to Postgres:', err);
  }
}

let backupDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBackup(): void {
  if (backupDebounceTimer) clearTimeout(backupDebounceTimer);
  backupDebounceTimer = setTimeout(() => {
    backupDebounceTimer = null;
    backupToDb().catch(err => logger.error('[WA Auth] Debounced backup failed:', err));
  }, 5000); // 5s debounce
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
