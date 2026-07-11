import 'dotenv/config';
import { sendEmailNotification } from '../src/services/emailService';
import { whatsappService } from '../src/services/whatsappService';
import { prisma } from '../src/lib/prisma';

async function testServices() {
  console.log('Testing Email and WhatsApp services...');

  // 1. Test Email Service
  console.log('\n--- 1. Testing Email Service ---');
  try {
    await sendEmailNotification(
      'heyyheman@gmail.com',
      'Test Notification - TransitOS',
      'This is a test notification from TransitOS. If you received this, the SMTP email service is configured and working properly!',
      '<h3>TransitOS Email Test</h3><p>This is a test notification from TransitOS. If you received this, the SMTP email service is configured and working properly!</p>'
    );
    console.log('✅ Email trigger completed. Check server logs above for outcome.');
  } catch (e: any) {
    console.error('❌ Email service error:', e.message);
  }

  // 2. Test WhatsApp Service
  console.log('\n--- 2. Testing WhatsApp Service ---');
  try {
    const status = whatsappService.getStatus();
    console.log('WhatsApp connection status:', status);

    if (status.connected) {
      console.log('Sending test message to admin...');
      const adminPhone = '9010009976'; // Recipient: Hemanth's number from ADMIN_WHATSAPP
      const result = await whatsappService.sendMessage(
        adminPhone,
        '🚀 Hello Hemanth! This is a direct test message from TransitOS. Both WhatsApp and backend services are active and running!'
      );
      if (result.success) {
        console.log('✅ WhatsApp message sent successfully!');
      } else {
        console.error('❌ WhatsApp message failed:', result.error);
      }
    } else {
      console.warn('⚠️ WhatsApp is not connected. Skipping sending message, but service initialized.');
    }
  } catch (e: any) {
    console.error('❌ WhatsApp service error:', e.message);
  }
}

// Small timeout to allow active prisma connections to settle if needed, but not required
testServices()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
