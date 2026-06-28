import { PrismaClient, StudentStatus } from '@prisma/client';

const prisma = new PrismaClient();

const dpsPhase2 = [
  { name: 'SAHASRA KALIDINDI', class: 'III-F', fatherMobile: '9966799493', motherMobile: '7680922896', whatsappNumber: '9966799493', monthlyFee: 200000 },
  { name: 'D HANSHITH REDDY', class: 'V - D', fatherMobile: '9823199663', motherMobile: '9573246570', whatsappNumber: '9823199663', monthlyFee: 200000 },
  { name: 'HARDHIK SAI', class: 'VII - E', fatherMobile: '9346463344', motherMobile: '8688283389', whatsappNumber: '9346463344', monthlyFee: 200000 },
  { name: 'HEMANSH', class: 'IV-G', fatherMobile: '9346463344', motherMobile: '8688283389', whatsappNumber: '9346463344', monthlyFee: 200000 },
  { name: 'KARTHIKEYA TAKKELLAPATI', class: 'IV-D', fatherMobile: '8599629522', motherMobile: '8106028013', whatsappNumber: '8599629522', monthlyFee: 200000 },
  { name: 'THUMMALA GAGANDEEP', class: 'VI-B', fatherMobile: '9952237933', motherMobile: '9885112132', whatsappNumber: '9952237933', monthlyFee: 200000 },
  { name: 'A MUNUKOTI JATHIN KARTHIK', class: 'IV-J', fatherMobile: '9985460639', motherMobile: '8374482730', whatsappNumber: '9985460639', monthlyFee: 200000 },
  { name: 'BODDETI SURYA SAATHVIK', class: 'III-F', fatherMobile: '9550899555', motherMobile: '9296559343', whatsappNumber: '9550899555', monthlyFee: 200000 },
  { name: 'KRITHIN RAO', class: 'III - G', fatherMobile: '9908502542', motherMobile: '9949604049', whatsappNumber: '9908502542', monthlyFee: 200000 },
  { name: 'SAMANVI DHARAVATH', class: 'UKG A', fatherMobile: '9963075560', motherMobile: '9052253972', whatsappNumber: '9963075560', monthlyFee: 200000 },
  { name: 'SATHVIK DHARAVATH', class: 'V', fatherMobile: '9963075560', motherMobile: '9052253972', whatsappNumber: '9963075560', monthlyFee: 200000 },
  { name: 'SHRESHTA RAO BANDA', class: 'X - K', fatherMobile: '9866688399', motherMobile: '9676118533', whatsappNumber: '9866688399', monthlyFee: 200000 },
  { name: 'ANIKA NIDHI DASARI', class: 'V - B', fatherMobile: '8019781554', motherMobile: '9966737477', whatsappNumber: '8019781554', monthlyFee: 200000 },
  { name: 'Student 8886026090', class: 'N/A', fatherMobile: '8886026090', motherMobile: null, whatsappNumber: '8886026090', monthlyFee: 200000 },
  { name: 'Student 7095085558', class: 'N/A', fatherMobile: '7095085558', motherMobile: null, whatsappNumber: '7095085558', monthlyFee: 200000 },
  { name: 'Student 6303219010', class: 'N/A', fatherMobile: '6303219010', motherMobile: null, whatsappNumber: '6303219010', monthlyFee: 200000 },
  { name: 'JAYA SATHYADEV 1', class: 'N/A', fatherMobile: '7661047160', motherMobile: null, whatsappNumber: '7661047160', monthlyFee: 200000 },
  { name: 'JAYA SATHYADEV 2', class: 'N/A', fatherMobile: '7661047160', motherMobile: null, whatsappNumber: '7661047160', monthlyFee: 200000 }
];

async function main() {
  console.log('Inserting DPS PHASE 2 students list...');
  
  // Get first route to assign as default
  const route = await prisma.route.findFirst({
    where: { isActive: true }
  });

  const routeId = route?.id ?? null;
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  for (const s of dpsPhase2) {
    const student = await prisma.student.create({
      data: {
        name: s.name,
        school: 'DPS PHASE 2',
        class: s.class,
        routeId,
        parentName: s.name.startsWith('Student') ? 'Parent of ' + s.fatherMobile : s.name.split(' ')[0] + "'s Parent",
        fatherMobile: s.fatherMobile,
        motherMobile: s.motherMobile,
        whatsappNumber: s.whatsappNumber,
        monthlyFee: s.monthlyFee,
        pickupAddress: 'DPS Phase 2 Area, Hyderabad',
        dropAddress: 'DPS Phase 2 Area, Hyderabad',
        pickupTime: '08:15 AM',
        dropTime: '04:15 PM',
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

  console.log('🎉 Successfully seeded all 18 DPS PHASE 2 students!');
}

main()
  .catch((e) => {
    console.error('Error seeding students:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
