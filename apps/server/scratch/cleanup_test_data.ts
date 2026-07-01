import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Scanning for test/demo data to clean up...\n');

  // ─────────────────────────────────────────────────────────────
  // 1. Find & delete test payments by transaction ID
  // ─────────────────────────────────────────────────────────────
  const testTransactionIds = ['TXN57306231003'];

  const paymentsByTxn = await prisma.payment.findMany({
    where: { transactionId: { in: testTransactionIds } },
    include: { student: true },
  });

  if (paymentsByTxn.length > 0) {
    console.log(`📋 Found ${paymentsByTxn.length} test payment(s) by transaction ID:`);
    paymentsByTxn.forEach((p) =>
      console.log(`   - TXN: ${p.transactionId} | Student: ${p.student.name} | ₹${p.amount / 100}`),
    );
    await prisma.payment.deleteMany({
      where: { transactionId: { in: testTransactionIds } },
    });
    console.log(`✅ Deleted ${paymentsByTxn.length} payment(s) by transaction ID.\n`);
  } else {
    console.log('ℹ️  No payments found with test transaction IDs.\n');
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Find & delete payments linked to "(Test)" students
  // ─────────────────────────────────────────────────────────────
  const testStudentPayments = await prisma.payment.findMany({
    where: {
      student: { name: { contains: '(Test)', mode: 'insensitive' } },
    },
    include: { student: true },
  });

  if (testStudentPayments.length > 0) {
    console.log(`📋 Found ${testStudentPayments.length} payment(s) linked to test students:`);
    testStudentPayments.forEach((p) =>
      console.log(`   - Student: ${p.student.name} | ₹${p.amount / 100} | ${p.month}/${p.year}`),
    );
    const testStudentIds = [...new Set(testStudentPayments.map((p) => p.studentId))];
    await prisma.payment.deleteMany({ where: { studentId: { in: testStudentIds } } });
    console.log(`✅ Deleted ${testStudentPayments.length} payment(s) linked to test students.\n`);
  } else {
    console.log('ℹ️  No payments found linked to test students.\n');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Delete "(Test)" named students (+ cascades: feeSchedules, payments)
  // ─────────────────────────────────────────────────────────────
  const testStudents = await prisma.student.findMany({
    where: { name: { contains: '(Test)', mode: 'insensitive' } },
  });

  if (testStudents.length > 0) {
    console.log(`📋 Found ${testStudents.length} test student(s):`);
    testStudents.forEach((s) => console.log(`   - ${s.name} (${s.school})`));
    const testStudentIds = testStudents.map((s) => s.id);
    // Delete fee schedules first (no cascade defined)
    const deletedSchedules = await prisma.feeSchedule.deleteMany({
      where: { studentId: { in: testStudentIds } },
    });
    console.log(`🧹 Deleted ${deletedSchedules.count} fee schedule(s) for test students.`);
    // Delete the students (payments cascade via schema)
    await prisma.student.deleteMany({ where: { id: { in: testStudentIds } } });
    console.log(`✅ Deleted ${testStudents.length} test student record(s).\n`);
  } else {
    console.log('ℹ️  No test student records found.\n');
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Delete WhatsApp demo/test messages
  //    - Messages with body containing "Test Parent (Demo)"
  //    - Messages sent to the demo number (8328232607) that are demo reminders
  // ─────────────────────────────────────────────────────────────
  const demoMessages = await prisma.whatsAppMessage.findMany({
    where: {
      OR: [
        { body: { contains: 'Test Parent (Demo)', mode: 'insensitive' } },
        { body: { contains: 'PAY-2026-DEMO', mode: 'insensitive' } },
      ],
    },
  });

  if (demoMessages.length > 0) {
    console.log(`📋 Found ${demoMessages.length} demo WhatsApp message(s):`);
    demoMessages.forEach((m) =>
      console.log(`   - ID: ${m.id} | Phone: ${m.phone} | Status: ${m.status}`),
    );
    await prisma.whatsAppMessage.deleteMany({
      where: {
        id: { in: demoMessages.map((m) => m.id) },
      },
    });
    console.log(`✅ Deleted ${demoMessages.length} demo WhatsApp message(s).\n`);
  } else {
    console.log('ℹ️  No demo WhatsApp messages found.\n');
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Post-cleanup summary
  // ─────────────────────────────────────────────────────────────
  const studentCount = await prisma.student.count();
  const paymentCount = await prisma.payment.count();
  const scheduleCount = await prisma.feeSchedule.count();
  const messageCount = await prisma.whatsAppMessage.count();

  console.log('─────────────────────────────────');
  console.log('📊 Database summary after cleanup:');
  console.log(`   Students:         ${studentCount}`);
  console.log(`   Payments:         ${paymentCount}`);
  console.log(`   Fee Schedules:    ${scheduleCount}`);
  console.log(`   WhatsApp Messages: ${messageCount}`);
  console.log('─────────────────────────────────');
  console.log('🎉 Test data cleanup complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error during cleanup:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
