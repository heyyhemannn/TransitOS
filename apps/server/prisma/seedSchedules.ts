import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // DPS Phase 2 schedule: 1st, 6th, 10th
  await prisma.schoolReminderSchedule.upsert({
    where: { schoolName: 'DPS Phase 2' },
    update: { reminder1Day: 1, reminder2Day: 6, reminder3Day: 10 },
    create: { schoolName: 'DPS Phase 2', reminder1Day: 1, reminder2Day: 6, reminder3Day: 10 },
  });

  // Unicent schedule: 1st, 7th, 15th
  await prisma.schoolReminderSchedule.upsert({
    where: { schoolName: 'Unicent' },
    update: { reminder1Day: 1, reminder2Day: 7, reminder3Day: 15 },
    create: { schoolName: 'Unicent', reminder1Day: 1, reminder2Day: 7, reminder3Day: 15 },
  });

  // DPS Brindavanam schedule: 1st, 7th, 15th
  await prisma.schoolReminderSchedule.upsert({
    where: { schoolName: 'DPS Brindavanam' },
    update: { reminder1Day: 1, reminder2Day: 7, reminder3Day: 15 },
    create: { schoolName: 'DPS Brindavanam', reminder1Day: 1, reminder2Day: 7, reminder3Day: 15 },
  });

  console.log('School reminder schedules seeded.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
