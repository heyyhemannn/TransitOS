import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Adjusting all student billing schedules to start from July 2026...');

  // 1. Delete all existing fee schedules to avoid conflicts
  const deletedSchedules = await prisma.feeSchedule.deleteMany();
  console.log(`🧹 Cleared ${deletedSchedules.count} old fee schedules.`);

  // 2. Fetch all registered students
  const students = await prisma.student.findMany();
  console.log(`📋 Found ${students.length} students to initialize.`);

  const targetMonth = 7; // July
  const targetYear = 2026;
  const dueDate = new Date(Date.UTC(targetYear, targetMonth - 1, 10, 4, 30, 0)); // July 10, 2026, 10:00 AM IST

  let createdCount = 0;
  for (const student of students) {
    await prisma.feeSchedule.create({
      data: {
        studentId: student.id,
        month: targetMonth,
        year: targetYear,
        dueDate,
        amount: student.monthlyFee,
        isPaid: false,
      },
    });
    createdCount++;
  }

  console.log(`✅ Initialized ${createdCount} billing schedules for July 2026.`);
  console.log('🎉 System is now fully set to start billing operations from July 2026!');
}

main()
  .catch((e) => {
    console.error('Error migrating schedules to July:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
