import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { SignalKeyStore, SignalDataTypeMap, SignalDataSet } from '@whiskeysockets/baileys/lib/Types/Auth';

export async function usePrismaAuthState() {
  const { BufferJSON, initAuthCreds, proto } = await import('@whiskeysockets/baileys');

  const writeData = async (key: string, data: any) => {
    try {
      const value = JSON.stringify(data, BufferJSON.replacer);
      await prisma.whatsAppSession.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    } catch (err) {
      logger.warn(`Failed to write WhatsApp session key ${key} to DB:`, err);
    }
  };

  const readData = async (key: string) => {
    try {
      const row = await prisma.whatsAppSession.findUnique({ where: { key } });
      if (!row) return null;
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch (err) {
      logger.warn(`Failed to read WhatsApp session key ${key} from DB:`, err);
      return null;
    }
  };

  const removeData = async (key: string) => {
    try {
      await prisma.whatsAppSession.deleteMany({ where: { key } });
    } catch (err) {
      logger.warn(`Failed to remove WhatsApp session key ${key} from DB:`, err);
    }
  };

  // Load existing creds or create fresh ones from PostgreSQL
  const creds = (await readData('creds')) ?? initAuthCreds();

  if (creds.me) {
    creds.registered = true;
  }

  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const data: Record<string, SignalDataTypeMap[T]> = {};
      await Promise.all(
        ids.map(async (id) => {
          let value = await readData(`${type}-${id}`);
          if (value) {
            if (type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value as SignalDataTypeMap[T];
          }
        })
      );
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
          tasks.push(
            value ? writeData(key, value) : removeData(key)
          );
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
      await writeData('creds', creds);
    },
    clearSession: async () => {
      try {
        await prisma.whatsAppSession.deleteMany();
      } catch (err) {
        logger.error('Failed to clear WhatsApp session DB:', err);
      }
    },
  };
}
