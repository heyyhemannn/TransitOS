import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from apps/server/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Checking database access for RLS enabled tables...');
  
  const userCount = await prisma.user.count();
  console.log(`✅ Table "User" can be read. Count: ${userCount}`);
  
  const studentCount = await prisma.student.count();
  console.log(`✅ Table "Student" can be read. Count: ${studentCount}`);
  
  const routeCount = await prisma.route.count();
  console.log(`✅ Table "Route" can be read. Count: ${routeCount}`);

  const paymentCount = await prisma.payment.count();
  console.log(`✅ Table "Payment" can be read. Count: ${paymentCount}`);
}

main()
  .catch((err) => {
    console.error('❌ Database access failed:', err);
  })
  .finally(() => prisma.$disconnect());
