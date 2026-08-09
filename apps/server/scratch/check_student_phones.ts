import { prisma } from '../src/lib/prisma';

async function checkStudentPhones() {
  console.log('--- Checking Student Phone Numbers in Database ---');
  const students = await prisma.student.findMany({
    where: { status: 'ACTIVE' },
    take: 10,
    select: { id: true, name: true, whatsappNumber: true, fatherMobile: true, motherMobile: true },
  });

  for (const s of students) {
    console.log(`Student: ${s.name} | WhatsApp: "${s.whatsappNumber}" | Father: "${s.fatherMobile}" | Mother: "${s.motherMobile}"`);
  }
}

checkStudentPhones()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
