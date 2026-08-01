import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * Extracts the relative storage path inside a Supabase bucket from a URL or relative path.
 */
export function getStoragePath(urlOrPath: string, bucket: string): string | null {
  if (!urlOrPath) return null;
  const publicPrefix = `/storage/v1/object/public/${bucket}/`;
  if (urlOrPath.includes(publicPrefix)) {
    return urlOrPath.split(publicPrefix)[1];
  }
  const privatePrefix = `/storage/v1/object/sign/${bucket}/`;
  if (urlOrPath.includes(privatePrefix)) {
    const pathPart = urlOrPath.split(privatePrefix)[1];
    return pathPart.split('?')[0];
  }
  // If it's already a relative path (doesn't start with http), return it
  if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
    return urlOrPath;
  }
  return null;
}

/**
 * Cleanup task to delete receipt PDFs and parent screenshots older than 30 days
 * from Supabase storage, while retaining payment text records.
 */
export async function cleanupOldStorageFiles(): Promise<void> {
  logger.info('[StorageCleanup] Starting 30-day storage cleanup job...');

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    // 1. Find all payments created older than 30 days that have any files
    const oldPayments = await prisma.payment.findMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
        OR: [
          { receiptUrl: { not: null } },
          { screenshotUrl: { not: null } },
        ],
      },
      select: {
        id: true,
        receiptUrl: true,
        screenshotUrl: true,
      },
    });

    if (oldPayments.length === 0) {
      logger.info('[StorageCleanup] No old files found for deletion.');
      return;
    }

    logger.info(`[StorageCleanup] Found ${oldPayments.length} payments older than 30 days with files.`);

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'receipts';
    const pathsToDelete: string[] = [];

    // 2. Extract paths to delete from storage
    for (const p of oldPayments) {
      if (p.receiptUrl) {
        const path = getStoragePath(p.receiptUrl, bucket);
        if (path) pathsToDelete.push(path);
      }
      if (p.screenshotUrl) {
        const path = getStoragePath(p.screenshotUrl, bucket);
        if (path) pathsToDelete.push(path);
      }
    }

    if (pathsToDelete.length > 0) {
      logger.info(`[StorageCleanup] Deleting ${pathsToDelete.length} files from Supabase Storage bucket "${bucket}"...`);

      // Delete files in batches of 100
      const batchSize = 100;
      for (let i = 0; i < pathsToDelete.length; i += batchSize) {
        const batch = pathsToDelete.slice(i, i + batchSize);
        // Using Supabase admin/service client
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) {
          logger.error(`[StorageCleanup] Error deleting batch from Supabase Storage: ${error.message}`, error);
        } else {
          logger.info(`[StorageCleanup] Successfully deleted batch of ${batch.length} files from storage.`);
        }
      }
    }

    // 3. Nullify URLs in the database to keep the text records but remove reference to deleted files
    const paymentIds = oldPayments.map(p => p.id);
    const updateResult = await prisma.payment.updateMany({
      where: {
        id: { in: paymentIds },
      },
      data: {
        receiptUrl: null,
        screenshotUrl: null,
      },
    });

    logger.info(`[StorageCleanup] Successfully nullified file URLs for ${updateResult.count} payment records in the database.`);
  } catch (err: any) {
    logger.error(`[StorageCleanup] Error running storage cleanup: ${err.message}`, err);
    throw err;
  }
}
