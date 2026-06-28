import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.fdlgjptbqghhgeiczija:88gk3FcXbbtenzN5@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"
    }
  }
});

async function main() {
  const messages = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log('=== RECENT WHATSAPP MESSAGES ===');
  for (const msg of messages) {
    console.log(`ID: ${msg.id}`);
    console.log(`Phone: ${msg.phone}`);
    console.log(`Status: ${msg.status}`);
    console.log(`Error: ${msg.errorMessage}`);
    console.log(`Body: ${msg.body.replace(/\n/g, ' ')}`);
    console.log(`Created: ${msg.createdAt}`);
    console.log('-----------------------------------');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
