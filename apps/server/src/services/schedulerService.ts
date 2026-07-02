import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { whatsappService } from './whatsappService';
import { MessageType } from '@prisma/client';

// Helper: get all unpaid active students for current month, optionally 
// filtered by school name(s)
export async function getUnpaidStudents(schools?: string[]) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  return prisma.student.findMany({
    where: {
      status: 'ACTIVE',
      ...(schools ? { school: { in: schools } } : {}),
      feeSchedules: {
        some: {
          month,
          year,
          isPaid: false,
        },
      },
    },
    select: { id: true, name: true, school: true, parentName: true, whatsappNumber: true },
  });
}

// Helper: log job execution
function logJob(name: string, status: 'START' | 'END' | 'ERROR', detail?: string) {
  const ts = new Date().toISOString();
  console.log(`[Scheduler][${ts}] ${name} — ${status}${detail ? ': ' + detail : ''}`);
}

export function initScheduler() {

  // ── 1st of every month, 9:00 AM ─────────────────────────────
  // Reminder 1 for ALL schools
  cron.schedule('0 9 1 * *', async () => {
    logJob('REMINDER_1_ALL', 'START');
    try {
      const students = await getUnpaidStudents();
      logJob('REMINDER_1_ALL', 'START', `${students.length} unpaid students`);
      const result = await whatsappService.broadcastToList(
        students.map(s => s.id),
        MessageType.REMINDER_1
      );
      logJob('REMINDER_1_ALL', 'END', `sent: ${result.sent}, failed: ${result.failed}`);
    } catch (e) {
      logJob('REMINDER_1_ALL', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });


  // ── 6th of every month, 9:00 AM ─────────────────────────────
  // Reminder 2 for DPS Phase 2 only
  cron.schedule('0 9 6 * *', async () => {
    logJob('REMINDER_2_DPS_PHASE2', 'START');
    try {
      const students = await getUnpaidStudents(['DPS Phase 2']);
      const result = await whatsappService.broadcastToList(
        students.map(s => s.id),
        MessageType.REMINDER_2
      );
      logJob('REMINDER_2_DPS_PHASE2', 'END', `sent: ${result.sent}, failed: ${result.failed}`);
    } catch (e) {
      logJob('REMINDER_2_DPS_PHASE2', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });


  // ── 7th of every month, 9:00 AM ─────────────────────────────
  // Reminder 2 for Unicent and DPS Brindavanam
  cron.schedule('0 9 7 * *', async () => {
    logJob('REMINDER_2_UNICENT_BRINDAVANAM', 'START');
    try {
      const students = await getUnpaidStudents(['Unicent', 'DPS Brindavanam']);
      const result = await whatsappService.broadcastToList(
        students.map(s => s.id),
        MessageType.REMINDER_2
      );
      logJob('REMINDER_2_UNICENT_BRINDAVANAM', 'END', `sent: ${result.sent}, failed: ${result.failed}`);
    } catch (e) {
      logJob('REMINDER_2_UNICENT_BRINDAVANAM', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });


  // ── 10th of every month, 9:00 AM ────────────────────────────
  // Reminder 3 / Final for DPS Phase 2 only
  cron.schedule('0 9 10 * *', async () => {
    logJob('REMINDER_3_DPS_PHASE2', 'START');
    try {
      const students = await getUnpaidStudents(['DPS Phase 2']);

      // Mark overdue in DB
      const now = new Date();
      await prisma.feeSchedule.updateMany({
        where: {
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          isPaid: false,
          student: { school: { in: ['DPS Phase 2'] } },
        },
        data: { overdueAt: now },
      });

      const result = await whatsappService.broadcastToList(
        students.map(s => s.id),
        MessageType.FINAL
      );
      logJob('REMINDER_3_DPS_PHASE2', 'END', `sent: ${result.sent}, failed: ${result.failed}`);
    } catch (e) {
      logJob('REMINDER_3_DPS_PHASE2', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });


  // ── 15th of every month, 9:00 AM ────────────────────────────
  // Reminder 3 / Final for Unicent and DPS Brindavanam
  cron.schedule('0 9 15 * *', async () => {
    logJob('REMINDER_3_UNICENT_BRINDAVANAM', 'START');
    try {
      const students = await getUnpaidStudents(['Unicent', 'DPS Brindavanam']);

      const now = new Date();
      await prisma.feeSchedule.updateMany({
        where: {
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          isPaid: false,
          student: { school: { in: ['Unicent', 'DPS Brindavanam'] } },
        },
        data: { overdueAt: now },
      });

      const result = await whatsappService.broadcastToList(
        students.map(s => s.id),
        MessageType.FINAL
      );
      logJob('REMINDER_3_UNICENT_BRINDAVANAM', 'END', `sent: ${result.sent}, failed: ${result.failed}`);
    } catch (e) {
      logJob('REMINDER_3_UNICENT_BRINDAVANAM', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });


  // ── Every 15 minutes ────────────────────────────────────────
  // Poll Android SMS gateway for UPI credit SMS
  cron.schedule('*/15 * * * *', async () => {
    const gatewayUrl = process.env.ANDROID_GATEWAY_URL;
    if (!gatewayUrl) return;
    try {
      const res = await fetch(`${gatewayUrl}/messages?from=last15min`);
      const data = (await res.json()) as { body: string }[];
      for (const sms of data) {
        const { parseSMSText, matchPayment } = await import('./paymentEngine');
        const parsed = parseSMSText(sms.body);
        if (parsed) {
          await matchPayment(
            parsed.transactionId,
            parsed.amount,
            parsed.senderName
          );
        }
      }
    } catch (e) {
      // silent — gateway may not be running
    }
  });


  // ── Every day at 11:00 PM ────────────────────────────────────
  // Daily collection report
  cron.schedule('0 23 * * *', async () => {
    logJob('DAILY_REPORT', 'START');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const payments = await prisma.payment.findMany({
        where: {
          status: 'PAID',
          paidAt: { gte: today, lt: tomorrow },
        },
      });

      const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);

      const pendingCount = await prisma.feeSchedule.count({
        where: {
          month: today.getMonth() + 1,
          year: today.getFullYear(),
          isPaid: false,
          student: { status: 'ACTIVE' },
        },
      });

      await prisma.dailyReport.upsert({
        where: { date: today },
        update: { totalCollected, paymentCount: payments.length, pendingCount },
        create: { date: today, totalCollected, paymentCount: payments.length, pendingCount },
      });

      logJob('DAILY_REPORT', 'END', `collected: ₹${totalCollected/100}, payments: ${payments.length}`);
    } catch (e) {
      logJob('DAILY_REPORT', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });


  // ── 1st of every month at 8:00 AM ───────────────────────────
  // Monthly summary to admin WhatsApp
  cron.schedule('0 8 1 * *', async () => {
    logJob('MONTHLY_REPORT', 'START');
    try {
      const now = new Date();
      // Previous month
      const month = now.getMonth() === 0 ? 12 : now.getMonth();
      const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

      const [paid, pending, total] = await Promise.all([
        prisma.payment.count({ where: { month, year, status: 'PAID' } }),
        prisma.feeSchedule.count({
          where: {
            month,
            year,
            isPaid: false,
            student: { status: 'ACTIVE' },
          },
        }),
        prisma.payment.aggregate({
          where: { month, year, status: 'PAID' },
          _sum: { amount: true },
        }),
      ]);

      const monthName = new Date(year, month - 1).toLocaleString('en-IN', {
        month: 'long', year: 'numeric'
      });

      const totalAmt = (total._sum.amount ?? 0) / 100;

      const settings = await prisma.settings.findMany();
      const adminPhone = settings.find(s => s.key === 'adminWhatsapp')?.value;
      const businessName = settings.find(s => s.key === 'businessName')?.value ?? 'TransitOS';

      if (adminPhone) {
        const message =
`📊 Monthly Report — ${monthName}

Business: ${businessName}
✅ Payments Received: ${paid}
❌ Still Pending: ${pending}
💰 Total Collected: ₹${totalAmt.toLocaleString('en-IN')}

View full report: https://transitos.vercel.app/reports`;

        await whatsappService.sendMessage(adminPhone, message);
      }

      logJob('MONTHLY_REPORT', 'END', `month: ${monthName}, collected: ₹${totalAmt}`);
    } catch (e) {
      logJob('MONTHLY_REPORT', 'ERROR', String(e));
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[Scheduler] All cron jobs registered — timezone: Asia/Kolkata');
}
export { initScheduler as startScheduler }; // alias for index.ts compatibility
