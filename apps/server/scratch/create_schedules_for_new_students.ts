import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { autoCreateFeeSchedule } from '../src/routes/students';

async function main() {
  const names = ['Abhineeth Patel', 'B. Tanuj', 'B. Jignyas', 'B Jashwin Naga Srinath'];
  const students = await prisma.student.findMany({
    where: {
      name: { in: names },
      school: 'DPS BRINDAVANAM',
    },
  });

  console.log(`Found ${students.length} students to generate schedules for.`);
  for (const s of students) {
    console.log(`Generating schedules for ${s.name}...`);
    await autoCreateFeeSchedule(s.id, s.monthlyFee);
  }
  console.log('Done!');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
