import { PrismaClient, StudentStatus } from '@prisma/client';

const prisma = new PrismaClient();

const unicentStudents = [
  { name: 'M Reyyansh', class: 'IV', fatherMobile: '9849804297', motherMobile: '9849769116', whatsappNumber: '9849804297', monthlyFee: 200000 },
  { name: 'Sarika Singh', class: 'IV', fatherMobile: '9581888624', motherMobile: '9538644421', whatsappNumber: '9581888624', monthlyFee: 200000 },
  { name: 'A Sreetan', class: 'I', fatherMobile: '8500607054', motherMobile: '8500007054', whatsappNumber: '8500607054', monthlyFee: 200000 },
  { name: 'Rugveda Aradhya', class: 'III', fatherMobile: '9742742444', motherMobile: '9742732444', whatsappNumber: '9742742444', monthlyFee: 180000 },
  { name: 'Adhithya', class: 'UKG', fatherMobile: '9742742444', motherMobile: '9742732444', whatsappNumber: '9742742444', monthlyFee: 180000 },
  { name: 'M Shreyan', class: 'I', fatherMobile: '9948326644', motherMobile: '9502698081', whatsappNumber: '9948326644', monthlyFee: 110000 },
  { name: 'M Soumya', class: 'VIII', fatherMobile: '9948326644', motherMobile: '9502698081', whatsappNumber: '9948326644', monthlyFee: 110000 },
  { name: 'K Vedansh', class: 'I', fatherMobile: '9666171171', motherMobile: '9962283731', whatsappNumber: '9666171171', monthlyFee: 200000 },
  { name: 'Lakshitha Shiva', class: 'III', fatherMobile: '9849735143', motherMobile: '9640228489', whatsappNumber: '9849735143', monthlyFee: 200000 },
  { name: 'Githansha', class: 'UKG', fatherMobile: '9849735143', motherMobile: '9640228489', whatsappNumber: '9849735143', monthlyFee: 200000 },
  { name: 'K K Student', class: 'N/A', fatherMobile: '9032964061', motherMobile: '9032964061', whatsappNumber: '9032964061', monthlyFee: 200000 },
  { name: 'Student 9849181224 1', class: 'N/A', fatherMobile: '9849181224', motherMobile: null, whatsappNumber: '9849181224', monthlyFee: 166600 },
  { name: 'Student 9849181224 2', class: 'N/A', fatherMobile: '9849181224', motherMobile: null, whatsappNumber: '9849181224', monthlyFee: 166700 },
  { name: 'Student 9849181224 3', class: 'N/A', fatherMobile: '9849181224', motherMobile: null, whatsappNumber: '9849181224', monthlyFee: 166700 },
  { name: 'Student 9063992229 1', class: 'N/A', fatherMobile: '9063992229', motherMobile: null, whatsappNumber: '9063992229', monthlyFee: 175000 },
  { name: 'Student 9063992229 2', class: 'N/A', fatherMobile: '9063992229', motherMobile: null, whatsappNumber: '9063992229', monthlyFee: 175000 },
  { name: 'Student 9666049679 1', class: 'N/A', fatherMobile: '9666049679', motherMobile: null, whatsappNumber: '9666049679', monthlyFee: 175000 },
  { name: 'Student 9666049679 2', class: 'N/A', fatherMobile: '9666049679', motherMobile: null, whatsappNumber: '9666049679', monthlyFee: 175000 },
  { name: 'Student 9030460055', class: 'N/A', fatherMobile: '9030460055', motherMobile: null, whatsappNumber: '9030460055', monthlyFee: 200000 }
];

async function main() {
  console.log('Inserting UNICENT students list...');
  
  // Get first route to assign as default
  const route = await prisma.route.findFirst({
    where: { isActive: true }
  });

  const routeId = route?.id ?? null;
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  for (const s of unicentStudents) {
    const student = await prisma.student.create({
      data: {
        name: s.name,
        school: 'UNICENT',
        class: s.class,
        routeId,
        parentName: s.name.startsWith('Student') ? 'Parent of ' + s.fatherMobile : s.name.split(' ')[0] + "'s Parent",
        fatherMobile: s.fatherMobile,
        motherMobile: s.motherMobile,
        whatsappNumber: s.whatsappNumber,
        monthlyFee: s.monthlyFee,
        pickupAddress: 'Unicent School Area, Hyderabad',
        dropAddress: 'Unicent School Area, Hyderabad',
        pickupTime: '08:30 AM',
        dropTime: '04:30 PM',
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

  console.log('🎉 Successfully seeded all 19 UNICENT students!');
}

main()
  .catch((e) => {
    console.error('Error seeding students:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
