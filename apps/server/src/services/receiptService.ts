import puppeteer, { Browser } from 'puppeteer';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { uploadToStorage, getSupabase } from '../lib/supabase';

/**
 * Generates a premium PDF receipt using Puppeteer, uploads it to Supabase Storage,
 * and updates the payment's receiptUrl field in the database.
 */
export async function generateReceipt(paymentId: string): Promise<string> {
  let browser: Browser | null = null;
  try {
    logger.info(`Generating receipt PDF for payment ID: ${paymentId}`);

    // 1. Fetch payment and related entities
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            route: true,
          },
        },
      },
    });

    if (!payment) {
      throw new Error(`Payment with ID ${paymentId} not found`);
    }

    const student = payment.student;
    const routeName = student.route?.name ?? 'Not Assigned';
    const vehicleNumber = student.route?.vehicleNumber ?? 'N/A';

    // Load business settings
    const settingsList = await prisma.settings.findMany();
    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
    const businessName = settingsMap.get('businessName') || 'Sri Sai Travels';

    // Format fields
    const amountRupees = (payment.amount / 100).toFixed(2);
    const billingMonth = `${[
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
    ][payment.month - 1]} ${payment.year}`;

    const paymentDate = payment.paidAt
      ? new Date(payment.paidAt).toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : 'N/A';

    const transactionId = payment.transactionId ?? 'N/A';
    const receiptNo = `PAY-${payment.year}-${String(payment.id).slice(-6).toUpperCase()}`;

    // 2. Build premium HTML template
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 40px;
            font-size: 14px;
            line-height: 1.5;
            background: #fff;
          }
          .invoice-card {
            max-width: 650px;
            margin: 0 auto;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 40px;
            background: #fff;
            position: relative;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #f1f5f9;
            padding-bottom: 25px;
            margin-bottom: 30px;
          }
          .business-title {
            font-size: 22px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.025em;
          }
          .business-sub {
            color: #64748b;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 4px;
            font-weight: 600;
          }
          .receipt-tag {
            font-size: 26px;
            font-weight: 900;
            color: #2563eb;
            text-align: right;
            letter-spacing: -0.025em;
          }
          .receipt-num {
            color: #64748b;
            font-size: 12px;
            text-align: right;
            margin-top: 4px;
            font-weight: 500;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            margin-bottom: 35px;
          }
          .meta-label {
            color: #64748b;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 600;
            margin-bottom: 6px;
          }
          .meta-value {
            font-weight: 700;
            color: #0f172a;
            font-size: 15px;
          }
          .meta-sub {
            font-size: 13px;
            color: #475569;
            margin-top: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 35px;
          }
          th {
            background: #f8fafc;
            color: #475569;
            font-weight: 600;
            text-align: left;
            padding: 12px 16px;
            border-bottom: 2px solid #e2e8f0;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          td {
            padding: 16px;
            border-bottom: 1px solid #e2e8f0;
            color: #334155;
            font-size: 13px;
          }
          .amount-cell {
            text-align: right;
            font-weight: 700;
            color: #0f172a;
            font-size: 14px;
          }
          .summary-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 40px;
          }
          .summary-box {
            width: 280px;
          }
          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 13px;
            color: #475569;
          }
          .summary-row.total {
            font-size: 19px;
            font-weight: 800;
            border-top: 2px solid #e2e8f0;
            padding-top: 14px;
            margin-top: 8px;
            color: #0f172a;
          }
          .footer {
            border-top: 1px solid #e2e8f0;
            padding-top: 25px;
            text-align: center;
            color: #94a3b8;
            font-size: 11px;
          }
        </style>
      </head>
      <body>
        <div class="invoice-card">
          <div class="header">
            <div>
              <div class="business-title">${businessName}</div>
              <div class="business-sub">School Transport Services</div>
            </div>
            <div>
              <div class="receipt-tag">RECEIPT</div>
              <div class="receipt-num">${receiptNo}</div>
            </div>
          </div>
          
          <div class="meta-grid">
            <div>
              <div class="meta-label">Billed To (Parent)</div>
              <div class="meta-value">${student.parentName}</div>
              <div class="meta-sub">Mobile: ${student.fatherMobile}</div>
            </div>
            <div>
              <div class="meta-label">Transaction Details</div>
              <div class="meta-value">Date: ${paymentDate}</div>
              <div class="meta-sub">Billing Period: ${billingMonth}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Student & School</th>
                <th>Route Details</th>
                <th style="text-align: right;">Amount Paid</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div style="font-weight: 700; color: #0f172a;">${student.name}</div>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">${student.school} - ${student.class}</div>
                </td>
                <td>
                  <div style="font-weight: 500;">${routeName}</div>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Bus: ${vehicleNumber}</div>
                </td>
                <td class="amount-cell">₹${amountRupees}</td>
              </tr>
            </tbody>
          </table>

          <div class="summary-section">
            <div class="summary-box">
              <div class="summary-row">
                <span>Payment Method</span>
                <span style="font-weight: 600; color: #0f172a;">${payment.method}</span>
              </div>
              <div class="summary-row">
                <span>Transaction Ref</span>
                <span style="font-family: monospace; font-size: 12px; font-weight: 500; color: #334155;">${transactionId}</span>
              </div>
              <div class="summary-row total">
                <span>Total Paid</span>
                <span>₹${amountRupees}</span>
              </div>
            </div>
          </div>

          <div class="footer">
            <p style="margin: 0; font-weight: 700; color: #64748b; font-size: 12px;">Thank you for your trust!</p>
            <p style="margin: 6px 0 0 0;">This is an electronically generated payment document. No signature required.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // 3. Launch Puppeteer to render PDF
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1100 });
    await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });

    // Generate PDF as Buffer
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px',
      },
    });

    await browser.close();
    browser = null;

    // 4. Ensure Supabase Bucket exists
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'receipts';
    const supabase = getSupabase();
    try {
      await supabase.storage.createBucket(bucket, { public: false });
    } catch {
      // Ignored: bucket already exists
    }

    // 5. Upload PDF file
    const filePath = `receipts/${payment.studentId}/${payment.id}.pdf`;
    await uploadToStorage(bucket, filePath, pdfBuffer, 'application/pdf');

    // 6. Save receiptUrl path in database
    await prisma.payment.update({
      where: { id: paymentId },
      data: { receiptUrl: filePath },
    });

    logger.info(`Receipt PDF successfully generated and uploaded for payment ${paymentId}`);
    return filePath;
  } catch (error) {
    logger.error(`Failed to generate receipt PDF for payment ${paymentId}:`, error);
    if (browser) {
      await (browser as Browser).close().catch(() => {});
    }
    throw error;
  }
}
