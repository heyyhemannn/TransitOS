import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { createAuditLog } from '../lib/audit';
import { generateReceipt } from './receiptService';
import { sendConfirmation } from './whatsappService';
import { PaymentStatus, PaymentMethod, StudentStatus, Student, Prisma } from '@prisma/client';
import { distance } from 'fastest-levenshtein';
import { parse } from 'csv-parse/sync';

interface MatchResult {
  matched: boolean;
  reason?: 'DUPLICATE' | 'ALREADY_PAID' | 'NO_MATCH' | 'SUCCESS';
  payment?: any;
  student?: any;
  topCandidates?: Array<{ student: any; score: number }>;
}

interface CSVRow {
  Date: string;
  Debit: string;
  Credit: string;
  Balance: string;
  Description: string;
  'Reference No': string;
}

// Helper to compute string similarity (0 to 1) using Levenshtein distance
function getSimilarity(s1: string, s2: string): number {
  const str1 = s1.trim().toLowerCase();
  const str2 = s2.trim().toLowerCase();
  if (!str1 || !str2) return 0;
  const len = Math.max(str1.length, str2.length);
  if (len === 0) return 1;
  return 1 - distance(str1, str2) / len;
}

// Helper to clean Description text and extract the sender name
function extractSenderName(description: string): string {
  const desc = description.trim();
  // Match patterns like "Payment from NAME", "Received from NAME", or "From NAME"
  const match = desc.match(/(?:payment\s+from|received\s+from|from)\s+(.+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return desc; // Fallback to full description
}

/**
 * Fuzzy-matches an incoming payment to a student using amount and name similarity.
 * On match, records the payment, marks the fee schedule as paid, and triggers services.
 */
export async function matchPayment(
  transactionId: string | null,
  amount: number, // in paise
  senderName: string,
): Promise<MatchResult> {
  const cleanedSender = senderName.trim();

  // 1. Duplicate check
  if (transactionId) {
    const existingPayment = await prisma.payment.findUnique({
      where: { transactionId },
    });
    if (existingPayment) {
      logger.info(`Duplicate payment transaction skipped: ${transactionId}`);
      return { matched: false, reason: 'DUPLICATE' };
    }
  }

  // 2. Fetch active students
  const students = await prisma.student.findMany({
    where: { status: StudentStatus.ACTIVE },
  });

  // 3. Score candidates
  const scoredCandidates = students.map((student: Student) => {
    let score = 0;

    // Amount Match (+50 points)
    if (student.monthlyFee === amount) {
      score += 50;
    }

    // Name Match: compare senderName to student name and parent name
    const parentSim = getSimilarity(cleanedSender, student.parentName);
    const studentSim = getSimilarity(cleanedSender, student.name);
    const bestSim = Math.max(parentSim, studentSim);

    if (bestSim >= 0.8) {
      score += 40;
    } else if (bestSim >= 0.6) {
      score += 20;
    } else if (bestSim >= 0.4) {
      score += 10;
    }

    return {
      student,
      score,
      similarity: bestSim,
    };
  });

  // Sort candidates by score descending
  scoredCandidates.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

  const top3 = scoredCandidates.slice(0, 3).map((c: { student: Student; score: number }) => ({
    student: c.student,
    score: c.score,
  }));

  const bestCandidate = scoredCandidates[0];

  // 4. Threshold Validation (Minimum 60 points required for matching)
  if (!bestCandidate || bestCandidate.score < 60) {
    logger.info(`Payment mismatch: senderName "${cleanedSender}", amount ${amount}. Top score: ${bestCandidate?.score ?? 0}`);
    return {
      matched: false,
      reason: 'NO_MATCH',
      topCandidates: top3,
    };
  }

  const matchedStudent = bestCandidate.student;

  // 5. Determine billing month (IST)
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const month = nowIST.getMonth() + 1;
  const year = nowIST.getFullYear();
  const actualNow = new Date();

  // Check if already paid
  const existingMonthPayment = await prisma.payment.findUnique({
    where: {
      studentId_month_year: {
        studentId: matchedStudent.id,
        month,
        year,
      },
    },
  });

  if (existingMonthPayment && existingMonthPayment.status === PaymentStatus.PAID) {
    logger.warn(`Matched student ${matchedStudent.name} (${matchedStudent.id}) has already paid for month ${month}/${year}`);
    return { matched: false, reason: 'ALREADY_PAID' };
  }

  // 6. DB Updates & Transaction Triggers
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Record payment
    const payment = await tx.payment.create({
      data: {
        studentId: matchedStudent.id,
        amount,
        month,
        year,
        paidAt: actualNow,
        transactionId,
        method: PaymentMethod.UPI,
        status: PaymentStatus.PAID,
        remarks: `Auto-matched from sender ${cleanedSender} (score: ${bestCandidate.score})`,
      },
    });

    // Update schedule
    await tx.feeSchedule.upsert({
      where: {
        studentId_month_year: {
          studentId: matchedStudent.id,
          month,
          year,
        },
      },
      update: {
        isPaid: true,
        paidAt: actualNow,
      },
      create: {
        studentId: matchedStudent.id,
        month,
        year,
        dueDate: new Date(Date.UTC(year, month - 1, 10, 4, 30, 0)),
        amount,
        isPaid: true,
        paidAt: actualNow,
      },
    });

    return payment;
  });

  logger.info(`Successfully auto-matched payment of paise ${amount} (Txn: ${transactionId}) to student ${matchedStudent.name}`);

  // Trigger non-blocking async side-effects
  generateReceipt(result.id).catch((err) => {
    logger.error(`Receipt generation failed in auto-match for paymentId ${result.id}:`, err);
  });

  sendConfirmation(matchedStudent.id, result.id).catch((err) => {
    logger.error(`WhatsApp confirmation failed in auto-match for studentId ${matchedStudent.id}:`, err);
  });

  // Write audit log
  await createAuditLog(null, 'AUTO_MATCH_PAYMENT', 'Payment', result.id, {
    transactionId,
    amount,
    senderName: cleanedSender,
    matchedStudentId: matchedStudent.id,
    matchedStudentName: matchedStudent.name,
    score: bestCandidate.score,
  });

  return {
    matched: true,
    reason: 'SUCCESS',
    payment: result,
    student: matchedStudent,
  };
}

/**
 * Parses a PhonePe exported CSV buffer and processes matches row-by-row.
 */
export async function importCSV(buffer: Buffer): Promise<{
  total: number;
  matched: number;
  unmatched: number;
  duplicates: number;
  errors: number;
  unmatchedRows: any[];
}> {
  // Parse CSV
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CSVRow[];

  let total = 0;
  let matched = 0;
  let unmatched = 0;
  let duplicates = 0;
  let errors = 0;
  const unmatchedRows: any[] = [];

  for (const record of records) {
    // 1. Skip non-credit rows
    const creditStr = record.Credit;
    if (!creditStr || creditStr === '0' || creditStr === '0.00') {
      continue;
    }

    total++;
    const amount = Math.round(parseFloat(creditStr.replace(/,/g, '')) * 100);
    const transactionId = record['Reference No']?.trim();
    const senderName = extractSenderName(record.Description || '');

    try {
      const matchResult = await matchPayment(transactionId, amount, senderName);
      if (matchResult.matched) {
        matched++;
      } else if (matchResult.reason === 'DUPLICATE') {
        duplicates++;
      } else {
        unmatched++;
        unmatchedRows.push({
          date: record.Date,
          credit: creditStr,
          transactionId,
          description: record.Description,
          senderName,
          topCandidates: matchResult.topCandidates,
        });
      }
    } catch (err) {
      logger.error('Error matching CSV record:', err);
      errors++;
    }
  }

  return {
    total,
    matched,
    unmatched,
    duplicates,
    errors,
    unmatchedRows,
  };
}

/**
 * Parses UPI credited notification SMS formats.
 * Returns { amount, transactionId, senderName } or null.
 */
export function parseSMSText(smsBody: string): {
  amount: number;
  transactionId: string;
  senderName: string;
} | null {
  const body = smsBody.replace(/\s+/g, ' ').trim();

  // Helper to clean commas from stringified decimal numbers
  const cleanAmount = (amtStr: string) => Math.round(parseFloat(amtStr.replace(/,/g, '')) * 100);

  // Format 1: "Rs.2500.00 credited to your a/c XXXXXX by UPI ref no 123456789012 from RAVI KUMAR"
  const match1 = body.match(/(?:Rs\.?|INR)\s*([\d,]+\.?\d*)\s+credited\s+.*?by\s+UPI\s+ref\s+no\s+(\d+)\s+from\s+(.+)/i);
  if (match1) {
    return {
      amount: cleanAmount(match1[1]),
      transactionId: match1[2].trim(),
      senderName: match1[3].trim(),
    };
  }

  // Format 2: "INR 2,500.00 received in your account from VPA ravi@upi Ref:123456789012"
  const match2 = body.match(/(?:Rs\.?|INR)\s*([\d,]+\.?\d*)\s+received\s+.*?from\s+VPA\s+(\S+)\s+Ref:(\d+)/i);
  if (match2) {
    const vpa = match2[2].split('@')[0];
    const cleanVpa = vpa.replace(/[\W_]+/g, ' ').trim().toUpperCase(); // Format: "ravi"
    return {
      amount: cleanAmount(match2[1]),
      transactionId: match2[3].trim(),
      senderName: cleanVpa || 'UPI VPA',
    };
  }

  // Format 3: "Amount Rs 2500 credited. UPI Ref: 123456789. Sender: RAVI KUMAR"
  const match3 = body.match(/Amount\s+(?:Rs\.?|INR)?\s*([\d,]+\.?\d*)\s+credited.*?UPI\s+Ref:\s*(\d+).*?Sender:\s*(.+)/i);
  if (match3) {
    return {
      amount: cleanAmount(match3[1]),
      transactionId: match3[2].trim(),
      senderName: match3[3].trim(),
    };
  }

  return null;
}
