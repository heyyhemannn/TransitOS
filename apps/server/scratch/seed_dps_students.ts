import { PrismaClient, StudentStatus } from '@prisma/client';

const prisma = new PrismaClient();

const dpsStudents = [
  { name: 'Jaasritha G', class: 'VI F', fatherMobile: '8519825590', motherMobile: '9676951424', whatsappNumber: '8519825590', monthlyFee: 200000 },
  { name: 'Omi Karthikeya N', class: 'V B', fatherMobile: '9441532335', motherMobile: '8309789470', whatsappNumber: '9441532335', monthlyFee: 200000 },
  { name: 'Harshini Chakrika N', class: 'IX G', fatherMobile: '9441532335', motherMobile: '8309789470', whatsappNumber: '9441532335', monthlyFee: 200000 },
  { name: 'Rithvika Sai', class: 'IV B', fatherMobile: '8008001595', motherMobile: '7799010474', whatsappNumber: '8008001595', monthlyFee: 200000 },
  { name: 'Advait Biradar', class: 'IV H', fatherMobile: '7095010612', motherMobile: '9885172084', whatsappNumber: '7095010612', monthlyFee: 200000 },
  { name: 'Jayshith', class: 'Grade 5', fatherMobile: '8830706411', motherMobile: '8830706411', whatsappNumber: '8830706411', monthlyFee: 200000 },
  { name: 'Satya Sri Lasya', class: 'VI H', fatherMobile: '9966449262', motherMobile: '6309129262', whatsappNumber: '9966449262', monthlyFee: 200000 },
  { name: 'Sathya Sri Sai', class: 'I A', fatherMobile: '9966449262', motherMobile: '6309129262', whatsappNumber: '9966449262', monthlyFee: 200000 },
  { name: 'Venkat Srija D', class: 'III F', fatherMobile: '9347316677', motherMobile: '8790882633', whatsappNumber: '9347316677', monthlyFee: 200000 },
  { name: 'Duhitha Isha D', class: 'VII F', fatherMobile: '9347316677', motherMobile: '8790882633', whatsappNumber: '9347316677', monthlyFee: 200000 },
  { name: 'Sushma Reddy', class: 'Grade 6', fatherMobile: '8008001109', motherMobile: '9652925451', whatsappNumber: '8008001109', monthlyFee: 150000 },
  { name: 'Tanishka Reddy', class: 'Grade 4', fatherMobile: '8008001109', motherMobile: '9652925451', whatsappNumber: '8008001109', monthlyFee: 150000 },
  { name: 'M. Jaasritha', class: 'Grade 3', fatherMobile: '9949985286', motherMobile: '9949985286', whatsappNumber: '9949985286', monthlyFee: 200000 },
  { name: 'Samyutha Reddy', class: 'IV B', fatherMobile: '9346618734', motherMobile: '8904076683', whatsappNumber: '9346618734', monthlyFee: 200000 },
  { name: 'Neeharika', class: '7G', fatherMobile: '9160003244', motherMobile: '9160003245', whatsappNumber: '9160003244', monthlyFee: 200000 },
  { name: 'Anshika', class: 'Grade 2', fatherMobile: '9911151808', motherMobile: '9911151808', whatsappNumber: '9911151808', monthlyFee: 200000 }
];

async function main() {
  console.log('Inserting DPS BRINDAVANAM students list...');
  
  // Get first route to assign as default
  const route = await prisma.route.findFirst({
    where: { isActive: true }
  });

  const routeId = route?.id ?? null;
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  for (const s of dpsStudents) {
    const student = await prisma.student.create({
      data: {
        name: s.name,
        school: 'DPS BRINDAVANAM',
        class: s.class,
        routeId,
        parentName: s.name.split(' ')[0] + "'s Parent",
        fatherMobile: s.fatherMobile,
        motherMobile: s.motherMobile,
        whatsappNumber: s.whatsappNumber,
        monthlyFee: s.monthlyFee,
        pickupAddress: 'DPS Brindavanam Area, Hyderabad',
        dropAddress: 'DPS Brindavanam Area, Hyderabad',
        pickupTime: '08:00 AM',
        dropTime: '04:00 PM',
        joiningDate: new Date(),
        status: StudentStatus.ACTIVE
      }
    });

    // Create billing schedule for the current month
    await prisma.feeSchedule.create({
      data: {
        studentId: student.id,
        month: currentMonth,
        year: currentYear,
        dueDate: new Date(Date.UTC(currentYear, currentMonth - 1, 10, 4, 30, 0)),
        amount: student.monthlyFee,
        isPaid: false
      }
    });

    console.log(`✅ Seeded student: ${student.name} (ID: ${student.id})`);
  }

  console.log('🎉 Successfully seeded all 16 DPS BRINDAVANAM students!');
}

main()
  .catch((e) => {
    console.error('Error seeding students:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
