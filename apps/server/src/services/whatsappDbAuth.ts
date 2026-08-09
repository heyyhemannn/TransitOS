import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { SignalKeyStore, SignalDataTypeMap, SignalDataSet } from '@whiskeysockets/baileys/lib/Types/Auth';

const memoryKeyStore = new Map<string, any>();
let memoryCreds: any = null;
let isLoaded = false;

export async function usePrismaAuthState() {
  const { BufferJSON, initAuthCreds, proto } = await import('@whiskeysockets/baileys');

  // Fast pre-load of all session keys into memory cache
  if (!isLoaded) {
    try {
      const rows = await prisma.whatsAppSession.findMany();
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value, BufferJSON.reviver);
          if (row.key === 'creds') {
            memoryCreds = parsed;
          } else {
            memoryKeyStore.set(row.key, parsed);
          }
        } catch {}
      }
      isLoaded = true;
      logger.info(`Loaded ${memoryKeyStore.size} WhatsApp session keys into fast memory cache.`);
    } catch (err) {
      logger.warn('Failed to pre-load WhatsApp session keys from DB:', err);
    }
  }

  const creds = memoryCreds ?? initAuthCreds();
  memoryCreds = creds;

  if (creds.me) {
    creds.registered = true;
  }

  const writeKeyToDb = async (key: string, data: any) => {
    try {
      if (data) {
        memoryKeyStore.set(key, data);
        const value = JSON.stringify(data, BufferJSON.replacer);
        await prisma.whatsAppSession.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
      } else {
        memoryKeyStore.delete(key);
        await prisma.whatsAppSession.deleteMany({ where: { key } });
      }
    } catch (err) {
      logger.warn(`Failed to sync key ${key} to DB:`, err);
    }
  };

  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const data: Record<string, SignalDataTypeMap[T]> = {};
      for (const id of ids) {
        const key = `${type}-${id}`;
        let value = memoryKeyStore.get(key);
        if (value) {
          if (type === 'app-state-sync-key') {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value as SignalDataTypeMap[T];
        }
      }
      return data;
    },
    set: async (data: SignalDataSet) => {
      const tasks: Promise<void>[] = [];
      for (const type of Object.keys(data) as (keyof SignalDataSet)[]) {
        const categoryData = data[type];
        if (!categoryData) continue;

        for (const id of Object.keys(categoryData)) {
          const value = categoryData[id];
          const key = `${type}-${id}`;
          if (value) {
            memoryKeyStore.set(key, value);
          } else {
            memoryKeyStore.delete(key);
          }
          tasks.push(writeKeyToDb(key, value));
        }
      }
      await Promise.all(tasks);
    },
  };

  return {
    state: {
      creds,
      keys,
    },
    saveCreds: async () => {
      if (creds.me) {
        creds.registered = true;
      }
      memoryCreds = creds;
      await writeKeyToDb('creds', creds);
    },
    clearSession: async () => {
      memoryKeyStore.clear();
      memoryCreds = null;
      isLoaded = false;
      try {
        await prisma.whatsAppSession.deleteMany();
      } catch (err) {
        logger.error('Failed to clear WhatsApp session DB:', err);
      }
    },
  };
}
