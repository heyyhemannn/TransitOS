import { prisma } from '../src/lib/prisma';
import { autoCreateFeeSchedule } from '../src/routes/students';

async function main() {
  console.log('Testing student creation via Prisma...');
  try {
    const student = await prisma.student.create({
      data: {
        name: 'Test Student',
        school: 'UNICENT',
        class: 'Grade 5',
        routeId: null,
        parentName: 'Test Parent',
        fatherMobile: '9848022338',
        motherMobile: null,
        whatsappNumber: '9848022338',
        monthlyFee: 250000,
        joiningDate: new Date(),
        pickupAddress: 'Test Pickup Address',
        dropAddress: 'Test Drop Address',
        pickupTime: '07:30',
        dropTime: '14:00',
        vehicleNumber: null,
      },
    });
    console.log('✅ Student created successfully:', student);

    console.log('Testing autoCreateFeeSchedule...');
    await autoCreateFeeSchedule(student.id, student.monthlyFee);
    console.log('✅ Fee schedule created successfully.');

    // Cleanup
    console.log('Cleaning up...');
    await prisma.student.delete({
      where: { id: student.id },
    });
    console.log('✅ Cleanup done.');
  } catch (err: any) {
    console.error('❌ Error testing student creation:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
