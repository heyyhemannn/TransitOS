import { prisma } from '../src/lib/prisma';
import { cleanupOldStorageFiles } from '../src/services/storageCleanupService';
import { logger } from '../src/lib/logger';

async function runTest() {
  logger.info('=== STARTING STORAGE CLEANUP TEST ===');
  
  // 1. We check if there's database connectivity first
  try {
    await prisma.$connect();
    logger.info('Successfully connected to the database.');
  } catch (err: any) {
    logger.error(`Database connection failed: ${err.message}`);
    logger.error('Please make sure your Supabase project is restored/resumed and active.');
    return;
  }

  // 2. Query any existing payments that are older than 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const countBefore = await prisma.payment.count({
    where: {
      createdAt: { lt: thirtyDaysAgo },
      OR: [
        { receiptUrl: { not: null } },
        { screenshotUrl: { not: null } },
      ],
    },
  });

  logger.info(`Number of payments older than 30 days with file references before cleanup: ${countBefore}`);

  // 3. Run the cleanup
  try {
    await cleanupOldStorageFiles();
    logger.info('Cleanup job executed successfully.');
  } catch (err: any) {
    logger.error(`Cleanup job failed: ${err.message}`);
  }

  // 4. Verify count after cleanup
  const countAfter = await prisma.payment.count({
    where: {
      createdAt: { lt: thirtyDaysAgo },
      OR: [
        { receiptUrl: { not: null } },
        { screenshotUrl: { not: null } },
      ],
    },
  });

  logger.info(`Number of payments older than 30 days with file references after cleanup: ${countAfter}`);
  logger.info('=== TEST COMPLETED ===');
}

runTest()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
