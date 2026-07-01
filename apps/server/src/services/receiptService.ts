import htmlPdf from 'html-pdf-node';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';

function numberToWords(num: number): string {
  // Convert rupee amount to Indian English words
  // e.g. 2500 → "Two Thousand Five Hundred Only"
  const ones = ['','One','Two','Three','Four','Five','Six','Seven',
    'Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen',
    'Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty',
    'Sixty','Seventy','Eighty','Ninety'];

  function convertHundreds(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n/10)] + ' ' + ones[n%10] + ' ';
    return ones[Math.floor(n/100)] + ' Hundred ' + convertHundreds(n%100);
  }

  function convert(n: number): string {
    if (n === 0) return 'Zero';
    let result = '';
    if (n >= 100000) {
      result += convertHundreds(Math.floor(n/100000)) + 'Lakh ';
      n %= 100000;
    }
    if (n >= 1000) {
      result += convertHundreds(Math.floor(n/1000)) + 'Thousand ';
      n %= 1000;
    }
    result += convertHundreds(n);
    return result.trim();
  }

  return convert(num) + ' Only';
}

function buildReceiptHTML(data: {
  receiptId: string;
  studentName: string;
  school: string;
  class: string;
  parentName: string;
  amount: number;        // in paise
  month: number;
  year: number;
  method: string;
  transactionId: string | null;
  paidAt: Date;
  businessName: string;
  upiId: string;
}): string {
  const rupees = data.amount / 100;
  const monthName = new Date(data.year, data.month - 1)
    .toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const paidDate = new Date(data.paidAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  const amountWords = numberToWords(rupees);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    font-family: 'Arial', sans-serif; 
    background: #ffffff;
    padding: 40px;
    color: #1a1a1a;
  }
  .receipt {
    max-width: 600px;
    margin: 0 auto;
    border: 2px solid #2563EB;
    border-radius: 12px;
    overflow: hidden;
  }
  .header {
    background: #2563EB;
    color: white;
    padding: 24px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header .brand { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
  .header .brand span { color: #93C5FD; }
  .header .receipt-no { text-align: right; }
  .header .receipt-no .label { font-size: 11px; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; }
  .header .receipt-no .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .paid-stamp {
    background: #DCFCE7;
    border-bottom: 2px solid #BBF7D0;
    padding: 10px 32px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .paid-stamp .dot { width: 10px; height: 10px; background: #16A34A; border-radius: 50%; }
  .paid-stamp .text { color: #15803D; font-weight: 700; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; }
  .paid-stamp .date { color: #16A34A; font-size: 12px; margin-left: auto; }
  .body { padding: 28px 32px; }
  .section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #6B7280;
    margin-bottom: 12px;
    margin-top: 20px;
  }
  .section-title:first-child { margin-top: 0; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #F3F4F6; }
  .row:last-child { border-bottom: none; }
  .row .label { color: #6B7280; font-size: 13px; }
  .row .value { font-size: 13px; font-weight: 600; color: #111827; text-align: right; max-width: 60%; }
  .amount-box {
    background: #EFF6FF;
    border: 1px solid #BFDBFE;
    border-radius: 8px;
    padding: 16px 20px;
    margin: 20px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .amount-box .label { color: #1D4ED8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .amount-box .rupees { font-size: 28px; font-weight: 800; color: #1D4ED8; }
  .amount-words {
    font-size: 11px;
    color: #6B7280;
    font-style: italic;
    margin-top: 4px;
  }
  .footer {
    background: #F9FAFB;
    border-top: 1px solid #E5E7EB;
    padding: 16px 32px;
    text-align: center;
  }
  .footer .thank-you { font-size: 14px; font-weight: 600; color: #374151; }
  .footer .sub { font-size: 11px; color: #9CA3AF; margin-top: 4px; }
  .footer .upi { font-size: 11px; color: #6B7280; margin-top: 8px; }
</style>
</head>
<body>
<div class="receipt">
  <div class="header">
    <div class="brand">Transit<span>OS</span></div>
    <div class="receipt-no">
      <div class="label">Receipt No</div>
      <div class="value">${data.receiptId}</div>
    </div>
  </div>
  <div class="paid-stamp">
    <div class="dot"></div>
    <div class="text">Payment Confirmed</div>
    <div class="date">${paidDate}</div>
  </div>
  <div class="body">
    <div class="section-title">Student Details</div>
    <div class="row"><span class="label">Student Name</span><span class="value">${data.studentName}</span></div>
    <div class="row"><span class="label">School</span><span class="value">${data.school}</span></div>
    <div class="row"><span class="label">Class</span><span class="value">${data.class}</span></div>
    <div class="row"><span class="label">Parent Name</span><span class="value">${data.parentName}</span></div>

    <div class="section-title">Payment Details</div>
    <div class="row"><span class="label">Fee Month</span><span class="value">${monthName}</span></div>
    <div class="row"><span class="label">Payment Method</span><span class="value">${data.method}</span></div>
    ${data.transactionId ? `<div class="row"><span class="label">Transaction ID</span><span class="value">${data.transactionId}</span></div>` : ''}
    <div class="row"><span class="label">Payment Date</span><span class="value">${paidDate}</span></div>

    <div class="amount-box">
      <div>
        <div class="label">Amount Paid</div>
        <div class="amount-words">${amountWords}</div>
      </div>
      <div class="rupees">₹${rupees.toLocaleString('en-IN')}</div>
    </div>
  </div>
  <div class="footer">
    <div class="thank-you">Thank you for the prompt payment! 🙏</div>
    <div class="sub">${data.businessName}</div>
    <div class="upi">UPI: ${data.upiId}</div>
  </div>
</div>
</body>
</html>`;
}

export class ReceiptService {

  async generateReceipt(paymentId: string): Promise<string | null> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { student: true },
      });
      if (!payment) throw new Error(`Payment ${paymentId} not found`);

      const settings = await prisma.settings.findMany();
      const getSetting = (key: string) => 
        settings.find(s => s.key === key)?.value ?? '';

      const receiptId = `PAY-${payment.year}-${paymentId.slice(-6).toUpperCase()}`;

      const html = buildReceiptHTML({
        receiptId,
        studentName: payment.student.name,
        school: payment.student.school,
        class: payment.student.class,
        parentName: payment.student.parentName,
        amount: payment.amount,
        month: payment.month,
        year: payment.year,
        method: payment.method,
        transactionId: payment.transactionId,
        paidAt: payment.paidAt ?? new Date(),
        businessName: getSetting('businessName') || "Hemanth's Transport Services",
        upiId: getSetting('upiId') || '',
      });

      // Generate PDF buffer
      const file = { content: html };
      const options = { format: 'A5', printBackground: true };
      const pdfBuffer = await htmlPdf.generatePdf(file, options);

      // Ensure the storage bucket exists
      const { error: bucketError } = await supabase.storage.createBucket('receipts', { public: true });
      if (bucketError) {
        console.log(`[Receipt] Bucket check/creation info: ${bucketError.message}`);
      }

      // Upload to Supabase Storage
      const fileName = `receipts/${payment.student.id}/${receiptId}.pdf`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(fileName, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (error) throw new Error(`Supabase upload failed: ${error.message}`);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(fileName);

      const receiptUrl = urlData.publicUrl;

      // Save URL back to payment record
      await prisma.payment.update({
        where: { id: paymentId },
        data: { receiptUrl },
      });

      console.log(`[Receipt] Generated: ${receiptId} → ${receiptUrl}`);
      return receiptUrl;

    } catch (error) {
      console.error('[Receipt] Generation failed:', error);
      return null;
    }
  }
}

export const receiptService = new ReceiptService();
export async function generateReceipt(paymentId: string): Promise<string | null> {
  return receiptService.generateReceipt(paymentId);
}
