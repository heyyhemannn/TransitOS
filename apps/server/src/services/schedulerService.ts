import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendWhatsAppMessage, formatTemplate, TEMPLATES } from './whatsappService';
import { autoCreateFeeSchedule } from '../routes/students';
import { StudentStatus, MessageType, PaymentStatus } from '@prisma/client';

/**
 * Daily fee checks run every day at 10:00 AM IST.
 * Dispatches WhatsApp fee alerts for 1st, 11th, 16th, and 21st milestones.
 */
async function runDailyFeeChecks(): Promise<void> {
  try {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentDay = nowIST.getDate();
    const currentMonth = nowIST.getMonth() + 1;
    const currentYear = nowIST.getFullYear();

    logger.info(`Running daily fee checks milestone check for Day ${currentDay}...`);

    // Only process milestones on the 1st, 3rd, 5th, 9, 10th, and 15th
    if (![1, 3, 5, 9, 10, 15].includes(currentDay)) {
      logger.info(`Day ${currentDay} is not a fee alert milestone. Skipping.`);
      return;
    }

    // Load settings
    const settingsList = await prisma.settings.findMany();
    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
    const businessName = settingsMap.get('businessName') || 'Sri Sai Travels';
    const upiId = settingsMap.get('upiId') || 'yourupi@upi';
    const webAppUrl = settingsMap.get('frontendUrl') || process.env.FRONTEND_URL || 'http://localhost:3000';

    const monthsNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const monthName = monthsNames[currentMonth - 1];

    // Fetch all active students
    const activeStudents = await prisma.student.findMany({
      where: { status: StudentStatus.ACTIVE },
    });

    logger.info(`Found ${activeStudents.length} active students to evaluate for alerts.`);

    for (const student of activeStudents) {
      const school = student.school.toUpperCase().trim();
      let isMilestoneDay = false;
      let isFirstMessageDay = false;
      let alertType: MessageType | null = null;

      // School-specific rules
      if (school === 'DPS PHASE 2') {
        if (currentDay === 1) {
          isMilestoneDay = true;
          isFirstMessageDay = true;
          alertType = MessageType.REMINDER_1;
        } else if (currentDay === 5) {
          isMilestoneDay = true;
          alertType = MessageType.REMINDER_2;
        } else if (currentDay === 10) {
          isMilestoneDay = true;
          alertType = MessageType.REMINDER_3;
        }
      } else if (school === 'UNICENT' || school === 'DPS BRINDAVANAM') {
        if (currentDay === 3) {
          isMilestoneDay = true;
          isFirstMessageDay = true;
          alertType = MessageType.REMINDER_1;
        } else if (currentDay === 9) {
          isMilestoneDay = true;
          alertType = MessageType.REMINDER_2;
        } else if (currentDay === 15) {
          isMilestoneDay = true;
          alertType = MessageType.REMINDER_3;
        }
      }

      // Skip if this is not a billing reminder milestone day for this student's school
      if (!isMilestoneDay || !alertType) {
        continue;
      }

      // 1. Autocreate current/next month schedule if missing (specifically useful on the first message day)
      if (isFirstMessageDay) {
        await autoCreateFeeSchedule(student.id, student.monthlyFee);
      }

      // 2. Load the schedule for this month
      const schedule = await prisma.feeSchedule.findUnique({
        where: {
          studentId_month_year: {
            studentId: student.id,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      // 3. Skip if already paid
      if (schedule?.isPaid) {
        continue;
      }

      // 4. Update overdue timestamp on final warning milestone
      if (alertType === MessageType.REMINDER_3 && schedule) {
        await prisma.feeSchedule.update({
          where: { id: schedule.id },
          data: { overdueAt: nowIST },
        });
      }

      // 5. Dispatch message
      const amountRupees = (student.monthlyFee / 100).toFixed(0);
      const body = formatTemplate(TEMPLATES[alertType], {
        parentName: student.parentName,
        amount: amountRupees,
        month: `${monthName} ${currentYear}`,
        upiId,
        businessName,
        webAppUrl,
      });

      // Fire and forget send message with short delay spacing
      sendWhatsAppMessage(student.whatsappNumber, body, student.id, alertType).catch((err) => {
        logger.error(`Failed to send auto reminder ${alertType} to student ${student.id}:`, err);
      });
    }

    logger.info('Daily fee checks milestone completed successfully.');
  } catch (error) {
    logger.error('Error occurred during daily fee checks job:', error);
  }
}

/**
 * Daily reports summary aggregator runs every day at 11:59 PM IST.
 * Tallies collections, payment transaction count, and active pending student defaults.
 */
async function generateDailyReport(): Promise<void> {
  try {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentMonth = nowIST.getMonth() + 1;
    const currentYear = nowIST.getFullYear();

    logger.info('Generating Daily Report summary...');

    // Define IST start and end times in local execution context
    const startOfToday = new Date(nowIST);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(nowIST);
    endOfToday.setHours(23, 59, 59, 999);

    // Date identifier stored at midnight UTC for unified indexing
    const reportDate = new Date(Date.UTC(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate(), 0, 0, 0));

    // Fetch payments credited today
    const [paymentsToday, pendingCount] = await Promise.all([
      prisma.payment.findMany({
        where: {
          paidAt: {
            gte: startOfToday,
            lte: endOfToday,
          },
          status: PaymentStatus.PAID,
        },
      }),
      prisma.student.count({
        where: {
          status: StudentStatus.ACTIVE,
          payments: {
            none: {
              month: currentMonth,
              year: currentYear,
              status: PaymentStatus.PAID,
            },
          },
        },
      }),
    ]);

    const totalCollected = paymentsToday.reduce((sum, p) => sum + p.amount, 0);
    const paymentCount = paymentsToday.length;

    // Upsert report record
    await prisma.dailyReport.upsert({
      where: { date: reportDate },
      update: {
        totalCollected,
        paymentCount,
        pendingCount,
      },
      create: {
        date: reportDate,
        totalCollected,
        paymentCount,
        pendingCount,
      },
    });

    logger.info(`Daily Report successfully generated for ${reportDate.toISOString().slice(0, 10)}. Total Collected: ₹${(totalCollected / 100).toFixed(2)}, Payments: ${paymentCount}, Pending Students: ${pendingCount}`);
  } catch (error) {
    logger.error('Error occurred generating daily report job:', error);
  }
}

/**
 * Initializes cron jobs for automated system operations
 */
export async function initScheduler(): Promise<void> {
  logger.info('Initializing Scheduler service...');

  // 1. Fee Checks Milestone Alert (Daily at 10:00 AM IST)
  cron.schedule('0 10 * * *', () => {
    logger.info('Cron Triggered: Daily Fee Alert Checks Milestone');
    runDailyFeeChecks().catch((err) => logger.error('Daily fee alert cron failed:', err));
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  // 2. Daily Summary Tally Report (Daily at 11:59 PM IST)
  cron.schedule('59 23 * * *', () => {
    logger.info('Cron Triggered: Daily Summary Report Tally');
    generateDailyReport().catch((err) => logger.error('Daily report aggregation cron failed:', err));
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  logger.info('⏰ Scheduler successfully loaded with 2 cron jobs (Asia/Kolkata).');
}
