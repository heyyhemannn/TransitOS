import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  Deleting test payment records...');

  // Test transaction IDs visible in the Payments Directory screenshot
  const testTransactionIds = ['TXN57306231003'];

  // Also catch any payments linked to student names containing "(Test)"
  const testStudentPayments = await prisma.payment.findMany({
    where: {
      student: {
        name: {
          contains: '(Test)',
          mode: 'insensitive',
        },
      },
    },
    include: { student: true },
  });

  console.log(
    `📋 Found ${testStudentPayments.length} payment(s) linked to test students:`,
  );
  testStudentPayments.forEach((p) => {
    console.log(
      `   - TXN: ${p.transactionId ?? 'N/A'} | Student: ${p.student.name} | ₹${p.amount / 100} | ${p.month}/${p.year}`,
    );
  });

  // Delete by explicit transaction IDs
  const deletedByTxn = await prisma.payment.deleteMany({
    where: {
      transactionId: {
        in: testTransactionIds,
      },
    },
  });
  console.log(
    `✅ Deleted ${deletedByTxn.count} payment(s) by transaction ID.`,
  );

  // Delete any remaining payments linked to "(Test)" named students
  const testStudentIds = testStudentPayments.map((p) => p.studentId);
  if (testStudentIds.length > 0) {
    const deletedByStudent = await prisma.payment.deleteMany({
      where: {
        studentId: { in: testStudentIds },
        // Avoid double-deleting ones already removed above
        transactionId: { notIn: testTransactionIds },
      },
    });
    console.log(
      `✅ Deleted ${deletedByStudent.count} additional payment(s) linked to test students.`,
    );
  }

  console.log('🎉 Done! Test payment records removed from Payments Directory.');
}

main()
  .catch((e) => {
    console.error('❌ Error during deletion:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
