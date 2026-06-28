import { PrismaClient, UserRole, StudentStatus, PaymentMethod, PaymentStatus, MessageType, MessageStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Clean existing data
  await prisma.settings.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.whatsAppMessage.deleteMany();
  await prisma.feeSchedule.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.student.deleteMany();
  await prisma.route.deleteMany();
  await prisma.user.deleteMany();
  await prisma.dailyReport.deleteMany();

  console.log('🧹 Cleaned existing database tables.');

  // 2. Create Users
  const passwordHash = await bcrypt.hash('Admin@123', 12);
  const managerHash = await bcrypt.hash('Manager@123', 12);
  const driverHash = await bcrypt.hash('Driver@123', 12);

  const admin = await prisma.user.create({
    data: {
      name: 'Ravi Teja',
      email: 'admin@stms.com',
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: 'Srinivas Rao',
      email: 'manager@stms.com',
      passwordHash: managerHash,
      role: UserRole.MANAGER,
    },
  });

  const driver = await prisma.user.create({
    data: {
      name: 'Mallesh Yadav',
      email: 'driver@stms.com',
      passwordHash: driverHash,
      role: UserRole.DRIVER,
    },
  });

  console.log('👤 Created 3 Users (Admin, Manager, Driver).');

  // 3. Create Routes
  const routeA = await prisma.route.create({
    data: {
      name: 'Route A - Kukatpally',
      driverName: 'Mallesh Yadav',
      vehicleNumber: 'TS-09-UB-1234',
    },
  });

  const routeB = await prisma.route.create({
    data: {
      name: 'Route B - KPHB',
      driverName: 'Kanakiah Garu',
      vehicleNumber: 'TS-08-EB-5678',
    },
  });

  console.log('🚌 Created 2 Routes.');

  // 4. Create Students (10 students)
  const schools = ['DPS Nacharam', 'Unicent Bachupally'];

  const studentData = [
    {
      name: 'Chiranjeevi Kumar',
      school: schools[0],
      class: 'Class 5',
      routeId: routeA.id,
      parentName: 'Pawan Kalyan',
      fatherMobile: '9848022338',
      motherMobile: '9848022339',
      whatsappNumber: '919848022338',
      monthlyFee: 250000, // ₹2500
      pickupAddress: 'Kukatpally Phase 1, Hyderabad',
      dropAddress: 'DPS Nacharam campus',
      pickupTime: '07:15',
      dropTime: '14:30',
      vehicleNumber: routeA.vehicleNumber,
    },
    {
      name: 'Mahesh Babu',
      school: schools[0],
      class: 'Class 6',
      routeId: routeA.id,
      parentName: 'Krishna Ghattamaneni',
      fatherMobile: '9000123456',
      motherMobile: '9000123457',
      whatsappNumber: '919000123456',
      monthlyFee: 280000, // ₹2800
      pickupAddress: 'Vasanth Nagar, Kukatpally',
      dropAddress: 'DPS Nacharam campus',
      pickupTime: '07:20',
      dropTime: '14:35',
      vehicleNumber: routeA.vehicleNumber,
    },
    {
      name: 'Allu Arjun',
      school: schools[0],
      class: 'Class 7',
      routeId: routeA.id,
      parentName: 'Allu Aravind',
      fatherMobile: '9110234567',
      motherMobile: null,
      whatsappNumber: '919110234567',
      monthlyFee: 300000, // ₹3000
      pickupAddress: 'Pragathi Nagar, Hyderabad',
      dropAddress: 'DPS Nacharam campus',
      pickupTime: '07:25',
      dropTime: '14:40',
      vehicleNumber: routeA.vehicleNumber,
    },
    {
      name: 'NTR Rao Junior',
      school: schools[1],
      class: 'Class 4',
      routeId: routeA.id,
      parentName: 'Hari Krishna',
      fatherMobile: '9220345678',
      motherMobile: '9220345679',
      whatsappNumber: '919220345678',
      monthlyFee: 220000, // ₹2200
      pickupAddress: 'JNTU, Kukatpally',
      dropAddress: 'Unicent Bachupally campus',
      pickupTime: '07:30',
      dropTime: '14:15',
      vehicleNumber: routeA.vehicleNumber,
    },
    {
      name: 'Ram Charan',
      school: schools[1],
      class: 'Class 8',
      routeId: routeA.id,
      parentName: 'Chiranjeevi Konidela',
      fatherMobile: '9330456789',
      motherMobile: '9330456790',
      whatsappNumber: '919330456789',
      monthlyFee: 320000, // ₹3200
      pickupAddress: 'Nizampet Road, Kukatpally',
      dropAddress: 'Unicent Bachupally campus',
      pickupTime: '07:35',
      dropTime: '14:20',
      vehicleNumber: routeA.vehicleNumber,
    },
    {
      name: 'Nani Ghanta',
      school: schools[0],
      class: 'Class 3',
      routeId: routeB.id,
      parentName: 'Rambabu Ghanta',
      fatherMobile: '9440567890',
      motherMobile: '9440567891',
      whatsappNumber: '919440567890',
      monthlyFee: 260000, // ₹2600
      pickupAddress: 'KPHB Phase 3, Hyderabad',
      dropAddress: 'DPS Nacharam campus',
      pickupTime: '07:15',
      dropTime: '14:30',
      vehicleNumber: routeB.vehicleNumber,
    },
    {
      name: 'Vijay Devarakonda',
      school: schools[0],
      class: 'Class 9',
      routeId: routeB.id,
      parentName: 'Govardhan Rao',
      fatherMobile: '9550678901',
      motherMobile: '9550678902',
      whatsappNumber: '919550678901',
      monthlyFee: 310000, // ₹3100
      pickupAddress: 'Remedy Hospital Lane, KPHB',
      dropAddress: 'DPS Nacharam campus',
      pickupTime: '07:20',
      dropTime: '14:35',
      vehicleNumber: routeB.vehicleNumber,
    },
    {
      name: 'Rana Daggubati',
      school: schools[1],
      class: 'Class 10',
      routeId: routeB.id,
      parentName: 'Suresh Daggubati',
      fatherMobile: '9660789012',
      motherMobile: null,
      whatsappNumber: '919660789012',
      monthlyFee: 350000, // ₹3500
      pickupAddress: 'KPHB Colony Temple Road',
      dropAddress: 'Unicent Bachupally campus',
      pickupTime: '07:30',
      dropTime: '14:15',
      vehicleNumber: routeB.vehicleNumber,
    },
    {
      name: 'Nagarjuna Akkineni',
      school: schools[1],
      class: 'Class 7',
      routeId: routeB.id,
      parentName: 'Nageswara Rao Akkineni',
      fatherMobile: '9770890123',
      motherMobile: '9770890124',
      whatsappNumber: '919770890123',
      monthlyFee: 240000, // ₹2400
      pickupAddress: 'Forum Mall Road, KPHB',
      dropAddress: 'Unicent Bachupally campus',
      pickupTime: '07:35',
      dropTime: '14:20',
      vehicleNumber: routeB.vehicleNumber,
    },
    {
      name: 'Balakrishna Nandamuri',
      school: schools[1],
      class: 'Class 8',
      routeId: routeB.id,
      parentName: 'Taraka Rama Rao',
      fatherMobile: '9880901234',
      motherMobile: '9880901235',
      whatsappNumber: '919880901234',
      monthlyFee: 290000, // ₹2900
      pickupAddress: 'Hydernagar, Kukatpally',
      dropAddress: 'Unicent Bachupally campus',
      pickupTime: '07:40',
      dropTime: '14:25',
      vehicleNumber: routeB.vehicleNumber,
    },
  ];

  const students = [];
  for (const s of studentData) {
    const student = await prisma.student.create({
      data: {
        ...s,
        joiningDate: new Date('2024-01-01'),
        status: StudentStatus.ACTIVE,
      },
    });
    students.push(student);
  }

  console.log(`👨‍🎓 Created ${students.length} Students.`);

  // 5. Create FeeSchedules & Payments for April, May, June 2024
  // Months: April = 4, May = 5, June = 6
  // Year: 2024
  const months = [
    { month: 4, name: 'April' },
    { month: 5, name: 'May' },
    { month: 6, name: 'June' },
  ];

  for (const s of students) {
    for (const m of months) {
      const dueDate = new Date(2024, m.month - 1, 10); // due on 10th of that month
      await prisma.feeSchedule.create({
        data: {
          studentId: s.id,
          month: m.month,
          year: 2024,
          dueDate,
          amount: s.monthlyFee,
          isPaid: false, // will update below if paid
        },
      });
    }
  }

  console.log('📅 Generated Fee Schedules for April, May, and June 2024.');

  // Create payments
  // April (Month 4): Fully paid for everyone
  let txCounter = 1000;
  for (const s of students) {
    txCounter++;
    const paidAt = new Date(2024, 3, 5 + Math.floor(Math.random() * 5)); // paid between 5th and 9th April
    const transactionId = `TXN2024040${txCounter}`;

    await prisma.payment.create({
      data: {
        studentId: s.id,
        amount: s.monthlyFee,
        month: 4,
        year: 2024,
        paidAt,
        transactionId,
        method: PaymentMethod.UPI,
        status: PaymentStatus.PAID,
        remarks: 'April fee paid in full',
        createdBy: admin.id,
      },
    });

    // Update fee schedule
    await prisma.feeSchedule.update({
      where: {
        studentId_month_year: {
          studentId: s.id,
          month: 4,
          year: 2024,
        },
      },
      data: {
        isPaid: true,
        paidAt,
      },
    });
  }

  // May (Month 5): Partially paid (first 6 students are paid, last 4 are unpaid/pending)
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const isPaid = i < 6;

    if (isPaid) {
      txCounter++;
      const paidAt = new Date(2024, 4, 6 + Math.floor(Math.random() * 5));
      const transactionId = `TXN2024050${txCounter}`;

      await prisma.payment.create({
        data: {
          studentId: s.id,
          amount: s.monthlyFee,
          month: 5,
          year: 2024,
          paidAt,
          transactionId,
          method: PaymentMethod.UPI,
          status: PaymentStatus.PAID,
          remarks: 'May fee paid in full',
          createdBy: manager.id,
        },
      });

      await prisma.feeSchedule.update({
        where: {
          studentId_month_year: {
            studentId: s.id,
            month: 5,
            year: 2024,
          },
        },
        data: {
          isPaid: true,
          paidAt,
        },
      });
    } else {
      // Mark as overdue because it's past due date (May 10th) in our seed
      await prisma.feeSchedule.update({
        where: {
          studentId_month_year: {
            studentId: s.id,
            month: 5,
            year: 2024,
          },
        },
        data: {
          overdueAt: new Date(2024, 4, 16), // overdue from 16th May
        },
      });
    }
  }

  // June (Month 6): All unpaid.
  // Note: No payments created. FeeSchedules remain unpaid.

  console.log('💵 Created Payments: April (10/10 paid), May (6/10 paid), June (0/10 paid).');

  // 6. WhatsApp Messages
  await prisma.whatsAppMessage.createMany({
    data: [
      {
        studentId: students[0].id,
        phone: students[0].whatsappNumber,
        type: MessageType.CONFIRMATION,
        body: '✅ Payment Received!\n\nDear Pawan Kalyan, ₹2500 received for April.\nReceipt No: PAY-2024-000001\n\nThank you! 🙏\nSri Sai Travels',
        status: MessageStatus.SENT,
        sentAt: new Date('2024-04-06T10:00:00Z'),
      },
      {
        studentId: students[1].id,
        phone: students[1].whatsappNumber,
        type: MessageType.CONFIRMATION,
        body: '✅ Payment Received!\n\nDear Krishna Ghattamaneni, ₹2800 received for April.\nReceipt No: PAY-2024-000002\n\nThank you! 🙏\nSri Sai Travels',
        status: MessageStatus.SENT,
        sentAt: new Date('2024-04-07T11:15:00Z'),
      },
      {
        studentId: students[6].id,
        phone: students[6].whatsappNumber,
        type: MessageType.REMINDER_1,
        body: 'Dear Govardhan Rao,\n\nTransport fee of ₹3100 for May is due.\nKindly pay before 10th May.\n\nUPI: srisaitravels@upi\n\nThank you,\nSri Sai Travels',
        status: MessageStatus.FAILED,
        errorMessage: 'Failed to establish WhatsApp web-socket connection',
        createdAt: new Date('2024-05-01T09:30:00Z'),
      },
      {
        studentId: students[7].id,
        phone: students[7].whatsappNumber,
        type: MessageType.REMINDER_2,
        body: 'Reminder: Dear Suresh Daggubati,\n\nTransport fee ₹3500 for May is still pending. Please pay before 15th.\n\nSri Sai Travels',
        status: MessageStatus.SENT,
        sentAt: new Date('2024-05-05T09:05:00Z'),
      },
      {
        studentId: students[8].id,
        phone: students[8].whatsappNumber,
        type: MessageType.FINAL,
        body: 'URGENT: Dear Nageswara Rao Akkineni,\n\nTransport fee ₹2400 for May is now OVERDUE.\nPlease pay immediately to avoid service disruption.\n\nSri Sai Travels',
        status: MessageStatus.SENT,
        sentAt: new Date('2024-05-16T09:00:00Z'),
      },
    ],
  });

  console.log('💬 Generated 5 sample WhatsApp Messages (SENT/FAILED).');

  // 7. Settings
  await prisma.settings.createMany({
    data: [
      { key: 'businessName', value: 'Sri Sai Travels' },
      { key: 'upiId', value: 'srisaitravels@upi' },
      { key: 'adminWhatsapp', value: '919848022338' },
    ],
  });

  console.log('⚙️ Seeded Settings.');

  // 8. Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        userId: admin.id,
        action: 'SEED_DB',
        entity: 'System',
        entityId: 'SYSTEM',
        meta: { message: 'Database initialized and seeded' },
      },
    ],
  });

  console.log('🌲 Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
