import { prisma } from '../src/lib/prisma';

async function checkFailed() {
  console.log('--- Inspecting Failed CONFIRMATION Messages ---');
  
  const failed = await prisma.whatsAppMessage.findMany({
    where: {
      type: 'CONFIRMATION',
      status: 'FAILED',
    },
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Found ${failed.length} failed CONFIRMATION messages:`);
  for (const m of failed) {
    console.log(`--------------------------------------------------`);
    console.log(`ID: ${m.id}`);
    console.log(`Phone: ${m.phone}`);
    console.log(`CreatedAt: ${m.createdAt.toISOString()}`);
    console.log(`ErrorMessage: ${m.errorMessage}`);
  }
}

checkFailed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
