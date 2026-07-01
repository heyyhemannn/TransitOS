import axios from 'axios';

const BASE_URL = 'https://transitos-apd4.onrender.com/api/v1';
const RECIPIENT_PHONE = '8328232607';

async function main() {
  console.log('🔑 Logging in as Admin...');
  const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
    email: 'heyyheman@gmail.com',
    password: 'Admin@123',
  });

  const token = loginRes.data.data.accessToken;
  console.log('✅ Logged in successfully!');

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  // 1. BEFORE PAYMENT: Send Demo Reminder
  console.log('\n--- 1. Testing BEFORE PAYMENT (Reminder with QR Code) ---');
  console.log(`Sending demo reminder to ${RECIPIENT_PHONE}...`);
  try {
    const reminderRes = await client.post('/whatsapp/send-demo', {
      phone: RECIPIENT_PHONE,
    });
    console.log('Response:', JSON.stringify(reminderRes.data, null, 2));
  } catch (err: any) {
    console.error('Failed to send before-payment demo:', err.response?.data || err.message);
  }

  // 2. AFTER PAYMENT: Send Payment Confirmation
  console.log('\n--- 2. Testing AFTER PAYMENT (Receipt Confirmation) ---');
  const confirmationBody = `✅ *Payment Received!*\n\nDear Test Parent (Demo), ₹4000 received for *July 2026* — *Omi Karthikeya N & Harshini Chakrika N*.\nReceipt No: \`PAY-2026-DEMO\`\n\nThank you! 🙏\n_Hemanth Transport Services_`;

  console.log(`Sending confirmation to ${RECIPIENT_PHONE}...`);
  try {
    const confirmationRes = await client.post('/whatsapp/send', {
      phone: RECIPIENT_PHONE,
      body: confirmationBody,
    });
    console.log('Response:', JSON.stringify(confirmationRes.data, null, 2));
  } catch (err: any) {
    console.error('Failed to send after-payment demo:', err.response?.data || err.message);
  }
}

main().catch(console.error);
