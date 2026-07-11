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

interface ParsedUPI {
  senderName: string;
  upiRemark?: string;
}

export function parseUPIDescription(description: string): ParsedUPI {
  const desc = description.trim();
  
  if (desc.toUpperCase().startsWith('UPI/')) {
    const parts = desc.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const senderName = parts[3];
      let upiRemark = '';
      if (parts.length >= 6) {
        upiRemark = parts[5];
      } else if (parts.length === 5 && !['UPI', 'PAYMENT'].includes(parts[4].toUpperCase())) {
        upiRemark = parts[4];
      }
      
      return {
        senderName,
        upiRemark: upiRemark && !['UPI', 'PAYMENT'].includes(upiRemark.toUpperCase()) ? upiRemark : undefined
      };
    }
  }
  
  const match = desc.match(/(?:payment\s+from|received\s+from|from)\s+(.+)/i);
  return {
    senderName: match && match[1] ? match[1].trim() : desc
  };
}

/**
 * Fuzzy-matches an incoming payment to a student using amount and name similarity.
 * On match, records the payment as PENDING (under review) for manual admin tally.
 */
export async function matchPayment(
  transactionId: string | null,
  amount: number, // in paise
  senderNameOrDescription: string,
): Promise<MatchResult> {
  const { senderName, upiRemark } = parseUPIDescription(senderNameOrDescription);
  const cleanedSender = senderName.trim();

  // 1. Duplicate check
  if (transactionId) {
    const existingPayment = await prisma.payment.findFirst({
      where: {
        OR: [
          { transactionId },
          { transactionId: { startsWith: `${transactionId}_` } },
        ],
      },
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

    // Name Match: compare senderName and upiRemark to student name and parent name
    const parentSim = getSimilarity(cleanedSender, student.parentName || '');
    const studentSim = getSimilarity(cleanedSender, student.name || '');
    let bestSim = Math.max(parentSim, studentSim);

    if (upiRemark) {
      const remarkSim = getSimilarity(upiRemark, student.name || '');
      bestSim = Math.max(bestSim, remarkSim);
    }

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

  // Check if already has a payment record (PAID or PENDING)
  const existingMonthPayment = await prisma.payment.findUnique({
    where: {
      studentId_month_year: {
        studentId: matchedStudent.id,
        month,
        year,
      },
    },
  });

  if (existingMonthPayment) {
    logger.warn(`Matched student ${matchedStudent.name} (${matchedStudent.id}) already has a payment record for month ${month}/${year} with status: ${existingMonthPayment.status}`);
    return { matched: false, reason: 'ALREADY_PAID' };
  }

  // 6. DB Updates (Record as PENDING for review)
  const result = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const payment = await tx.payment.create({
        data: {
          studentId: matchedStudent.id,
          amount,
          month,
          year,
          paidAt: null, // pending, so not paid yet
          transactionId,
          method: PaymentMethod.UPI,
          status: PaymentStatus.PENDING,
          remarks: `Auto-matched from sender ${cleanedSender} (score: ${bestCandidate.score})`,
        },
      });

      return payment;
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );

  logger.info(`Successfully auto-matched payment of paise ${amount} (Txn: ${transactionId}) to student ${matchedStudent.name} as PENDING`);

  // Write audit log
  await createAuditLog(null, 'AUTO_MATCH_PAYMENT_PENDING', 'Payment', result.id, {
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
function resolveColumns(records: any[]): {
  creditKey: string | null;
  descriptionKey: string | null;
  refKey: string | null;
  dateKey: string | null;
} {
  if (records.length === 0) {
    return { creditKey: null, descriptionKey: null, refKey: null, dateKey: null };
  }

  const sample = records[0];
  const keys = Object.keys(sample);
  const clean = (s: string) => s.trim().toLowerCase();

  // 1. Find Description/Particulars column
  const descriptionKey = keys.find(k => 
    ['description', 'particulars', 'particular', 'narrative', 'remarks', 'remark'].includes(clean(k))
  ) || null;

  // 2. Find Date column
  const dateKey = keys.find(k => 
    ['date', 'tran date', 'transaction date', 'post date'].includes(clean(k))
  ) || null;

  // 3. Find Reference number column (if any)
  const refKey = keys.find(k => 
    ['reference no', 'reference number', 'ref no', 'ref number', 'transaction id', 'txn id', 'urn'].includes(clean(k))
  ) || null;

  // 4. Find Balance column to calibrate if possible
  const balanceKey = keys.find(k => 
    ['balance', 'bal', 'running balance'].includes(clean(k))
  );

  let creditKey: string | null = null;

  if (balanceKey && records.length > 1) {
    // Try to calibrate using balance differences
    for (let i = 1; i < Math.min(records.length, 10); i++) {
      const prevBal = parseFloat(String(records[i-1][balanceKey]).replace(/,/g, ''));
      const currBal = parseFloat(String(records[i][balanceKey]).replace(/,/g, ''));
      if (isNaN(prevBal) || isNaN(currBal)) continue;

      const diff = currBal - prevBal;
      if (Math.abs(diff) < 0.01) continue;

      // Find which column matches this diff
      for (const key of keys) {
        if (key === balanceKey) continue;
        const val = parseFloat(String(records[i][key]).replace(/,/g, ''));
        if (isNaN(val)) continue;

        if (diff > 0 && Math.abs(val - diff) < 0.05) {
          // Found the column that increases balance (Deposit)
          creditKey = key;
          break;
        }
      }
      if (creditKey) break;
    }
  }

  // Fallback if calibration is not possible
  if (!creditKey) {
    creditKey = keys.find(k => ['credit', 'cr', 'deposit', 'credit amount', 'deposits'].includes(clean(k))) || null;
    
    // If not found, and we have 'dr' and 'cr', check if standard
    if (!creditKey) {
      const hasDR = keys.some(k => clean(k) === 'dr');
      const hasCR = keys.some(k => clean(k) === 'cr');
      if (hasDR && hasCR) {
        creditKey = keys.find(k => clean(k) === 'cr') || null;
      }
    }
  }

  return { creditKey, descriptionKey, refKey, dateKey };
}

/**
 * Parses an exported bank statement CSV buffer and processes matches row-by-row.
 * Supports PhonePe, Axis, and other standard formats by dynamically mapping columns.
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
  }) as any[];

  const { creditKey, descriptionKey, refKey, dateKey } = resolveColumns(records);

  let total = 0;
  let matched = 0;
  let unmatched = 0;
  let duplicates = 0;
  let errors = 0;
  const unmatchedRows: any[] = [];

  // Log detected columns for debugging
  logger.info(`Detected CSV columns: Credit=${creditKey}, Description=${descriptionKey}, Ref=${refKey}, Date=${dateKey}`);

  if (!creditKey || !descriptionKey) {
    logger.warn('Could not identify credit or description columns in CSV file.');
    return { total, matched, unmatched, duplicates, errors, unmatchedRows };
  }

  for (const record of records) {
    const creditStr = record[creditKey];
    if (!creditStr || creditStr === '0' || creditStr === '0.00' || creditStr.trim() === '') {
      continue;
    }

    const cleanCredit = parseFloat(creditStr.replace(/,/g, ''));
    if (isNaN(cleanCredit) || cleanCredit <= 0) {
      continue;
    }

    total++;
    const amount = Math.round(cleanCredit * 100);
    const description = record[descriptionKey] || '';
    
    let transactionId = refKey ? record[refKey]?.trim() : null;
    
    // Extract transaction ID from description if column is absent (common in Axis/bank statement particulars)
    if (!transactionId && description) {
      if (description.toUpperCase().startsWith('UPI/')) {
        const parts = description.split('/').map((p: string) => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          transactionId = parts[2];
        }
      }
    }

    const dateStr = dateKey ? record[dateKey] : '';

    try {
      const matchResult = await matchPayment(transactionId, amount, description);
      if (matchResult.matched) {
        matched++;
      } else if (matchResult.reason === 'DUPLICATE') {
        duplicates++;
      } else {
        unmatched++;
        const parsed = parseUPIDescription(description);
        unmatchedRows.push({
          date: dateStr,
          credit: creditStr,
          transactionId,
          description,
          senderName: parsed.senderName,
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
