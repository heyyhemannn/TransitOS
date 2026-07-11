import 'dotenv/config';
import { PrismaClient, StudentStatus } from '@prisma/client';

const prisma = new PrismaClient();

const missingStudents = [
  {
    name: 'Abhineeth Patel',
    school: 'DPS BRINDAVANAM',
    class: '7F',
    routeId: 'cmqxroj0k0003efsgttihmc2v',
    parentName: "Abhineeth's Parent",
    fatherMobile: '7873112409',
    motherMobile: '7873112409',
    whatsappNumber: '7873112409',
    monthlyFee: 150000, // ₹1500
    joiningDate: new Date('2026-06-28'),
    status: StudentStatus.ACTIVE,
    pickupAddress: 'DPS Brindavanam Area, Hyderabad',
    dropAddress: 'DPS Brindavanam Area, Hyderabad',
    pickupTime: '08:00 AM',
    dropTime: '04:00 PM',
    vehicleNumber: 'TS-09-UB-1234',
  },
  {
    name: 'B. Tanuj',
    school: 'DPS BRINDAVANAM',
    class: 'LKG B',
    routeId: 'cmqxroj0k0003efsgttihmc2v',
    parentName: "Tanuj's Parent",
    fatherMobile: '9493625614',
    motherMobile: '9493625614',
    whatsappNumber: '9493625614',
    monthlyFee: 183300, // ₹1833
    joiningDate: new Date('2026-06-28'),
    status: StudentStatus.ACTIVE,
    pickupAddress: 'DPS Brindavanam Area, Hyderabad',
    dropAddress: 'DPS Brindavanam Area, Hyderabad',
    pickupTime: '08:00 AM',
    dropTime: '04:00 PM',
    vehicleNumber: 'TS-09-UB-1234',
  },
  {
    name: 'B. Jignyas',
    school: 'DPS BRINDAVANAM',
    class: 'III J',
    routeId: 'cmqxroj0k0003efsgttihmc2v',
    parentName: "Jignyas's Parent",
    fatherMobile: '9493625614',
    motherMobile: '9493625614',
    whatsappNumber: '9493625614',
    monthlyFee: 183300, // ₹1833
    joiningDate: new Date('2026-06-28'),
    status: StudentStatus.ACTIVE,
    pickupAddress: 'DPS Brindavanam Area, Hyderabad',
    dropAddress: 'DPS Brindavanam Area, Hyderabad',
    pickupTime: '08:00 AM',
    dropTime: '04:00 PM',
    vehicleNumber: 'TS-09-UB-1234',
  },
  {
    name: 'B Jashwin Naga Srinath',
    school: 'DPS BRINDAVANAM',
    class: 'I F',
    routeId: 'cmqxroj0k0003efsgttihmc2v',
    parentName: "Jashwin's Parent",
    fatherMobile: '9493625614',
    motherMobile: '9493625614',
    whatsappNumber: '9493625614',
    monthlyFee: 183400, // ₹1834
    joiningDate: new Date('2026-06-28'),
    status: StudentStatus.ACTIVE,
    pickupAddress: 'DPS Brindavanam Area, Hyderabad',
    dropAddress: 'DPS Brindavanam Area, Hyderabad',
    pickupTime: '08:00 AM',
    dropTime: '04:00 PM',
    vehicleNumber: 'TS-09-UB-1234',
  },
];

async function main() {
  console.log('Inserting missing students...');
  for (const s of missingStudents) {
    const existing = await prisma.student.findFirst({
      where: {
        name: s.name,
        school: s.school,
      },
    });

    if (existing) {
      console.log(`Student ${s.name} already exists. Skipping.`);
    } else {
      const created = await prisma.student.create({
        data: s,
      });
      console.log(`Created student ${created.name} with ID: ${created.id}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
