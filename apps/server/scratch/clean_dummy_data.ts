import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Cleaning up old dummy students and their schedules...');

  // 1. Identify students to delete
  const targetSchools = ['DPS BRINDAVANAM', 'DPS PHASE 2', 'UNICENT'];
  
  const dummyStudents = await prisma.student.findMany({
    where: {
      school: {
        notIn: targetSchools,
      },
    },
  });

  const dummyStudentIds = dummyStudents.map((s) => s.id);
  console.log(`📋 Found ${dummyStudentIds.length} dummy students to clean up.`);

  if (dummyStudentIds.length > 0) {
    // 2. Delete fee schedules for dummy students
    const deletedSchedules = await prisma.feeSchedule.deleteMany({
      where: {
        studentId: {
          in: dummyStudentIds,
        },
      },
    });
    console.log(`🧹 Deleted ${deletedSchedules.count} dummy student fee schedules.`);

    // 3. Delete dummy students
    const deletedStudents = await prisma.student.deleteMany({
      where: {
        id: {
          in: dummyStudentIds,
        },
      },
    });
    console.log(`🧹 Deleted ${deletedStudents.count} dummy student records.`);
  }

  // 4. Verify count and expected revenue for July 2026
  const finalCount = await prisma.student.count();
  const finalSchedules = await prisma.feeSchedule.findMany({
    where: { month: 7, year: 2026 },
  });
  const totalRevenue = finalSchedules.reduce((sum, s) => sum + s.amount, 0);

  console.log('---');
  console.log(`✅ Clean-up completed successfully.`);
  console.log(`📊 Active Students Count: ${finalCount} (Expected: 53)`);
  console.log(`💰 Expected July 2026 Revenue: ₹${(totalRevenue / 100).toFixed(2)} (Expected: ₹100800.00)`);
}

main()
  .catch((e) => {
    console.error('Error during cleanup:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
