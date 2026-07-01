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

// Base64-encoded TransitOS bus logo SVG (embedded to avoid inline SVG rendering issues in PDF)
const LOGO_BASE64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDg4IDg4Ij48cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iODgiIGhlaWdodD0iODgiIHJ4PSIyMiIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjE1Ii8+PHJlY3QgeD0iMTIiIHk9IjEyIiB3aWR0aD0iNjQiIGhlaWdodD0iNDgiIHJ4PSI4IiBmaWxsPSIjMjU2M0VCIi8+PHJlY3QgeD0iMTkiIHk9IjE5IiB3aWR0aD0iNTAiIGhlaWdodD0iMjAiIHJ4PSI0IiBmaWxsPSIjMWE0NWIwIi8+PHJlY3QgeD0iMjIiIHk9IjIyIiB3aWR0aD0iMTMiIGhlaWdodD0iMTMiIHJ4PSIzIiBmaWxsPSIjQkZEQkZFIiBmaWxsLW9wYWNpdHk9IjAuOSIvPjxyZWN0IHg9IjM4IiB5PSIyMiIgd2lkdGg9IjEzIiBoZWlnaHQ9IjEzIiByeD0iMyIgZmlsbD0iI0JGREJGRSIgZmlsbC1vcGFjaXR5PSIwLjkiLz48cmVjdCB4PSI1NCIgeT0iMjIiIHdpZHRoPSIxMyIgaGVpZ2h0PSIxMyIgcng9IjMiIGZpbGw9IiNCRkRCRkUiIGZpbGwtb3BhY2l0eT0iMC45Ii8+PHJlY3QgeD0iMTIiIHk9IjM3IiB3aWR0aD0iNjQiIGhlaWdodD0iMi41IiByeD0iMS4yNSIgZmlsbD0iI0Y1OUUwQiIgZmlsbC1vcGFjaXR5PSIwLjkyIi8+PHJlY3QgeD0iOCIgeT0iMzQiIHdpZHRoPSI1IiBoZWlnaHQ9IjE4IiByeD0iMi41IiBmaWxsPSIjMTc0MUEwIi8+PHJlY3QgeD0iNzUiIHk9IjM0IiB3aWR0aD0iNSIgaGVpZ2h0PSIxOCIgcng9IjIuNSIgZmlsbD0iIzE3NDFBMCIvPjxyZWN0IHg9IjE5IiB5PSI0MyIgd2lkdGg9IjI0IiBoZWlnaHQ9IjEyIiByeD0iMyIgZmlsbD0iIzFhNDViMCIvPjxyZWN0IHg9IjQ3IiB5PSI0MyIgd2lkdGg9IjI0IiBoZWlnaHQ9IjEyIiByeD0iMyIgZmlsbD0iIzFhNDViMCIvPjxjaXJjbGUgY3g9IjI1IiBjeT0iNjIiIHI9IjcuNSIgZmlsbD0iIzA4MGQxYSIvPjxjaXJjbGUgY3g9IjI1IiBjeT0iNjIiIHI9IjUiIGZpbGw9IiMwZDE1MjgiIHN0cm9rZT0iIzI1NjNFQiIgc3Ryb2tlLXdpZHRoPSIxLjgiLz48Y2lyY2xlIGN4PSIyNSIgY3k9IjYyIiByPSIyIiBmaWxsPSIjMjU2M0VCIi8+PGNpcmNsZSBjeD0iNjMiIGN5PSI2MiIgcj0iNy41IiBmaWxsPSIjMDgwZDFhIi8+PGNpcmNsZSBjeD0iNjMiIGN5PSI2MiIgcj0iNSIgZmlsbD0iIzBkMTUyOCIgc3Ryb2tlPSIjMjU2M0VCIiBzdHJva2Utd2lkdGg9IjEuOCIvPjxjaXJjbGUgY3g9IjYzIiBjeT0iNjIiIHI9IjIiIGZpbGw9IiMyNTYzRUIiLz48L3N2Zz4K';

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
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    font-family: 'Arial', sans-serif; 
    background: #f8fafc;
    padding: 30px 20px;
    color: #1a1a1a;
  }
  .receipt {
    max-width: 640px;
    margin: 0 auto;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -4px rgba(0,0,0,0.05);
  }
  .header {
    background: #2563EB;
    color: white;
    padding: 24px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand-container {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .brand-container .logo {
    width: 48px;
    height: 48px;
    display: block;
  }
  .header .brand { 
    font-size: 26px; 
    font-weight: 800; 
    letter-spacing: -0.5px; 
    line-height: 1.1;
  }
  .header .brand span { color: #93C5FD; }
  .header .subtitle {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    opacity: 0.95;
    margin-top: 2px;
    text-transform: uppercase;
  }
  .header .receipt-no { text-align: right; }
  .header .receipt-no .label { font-size: 10px; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; }
  .header .receipt-no .value { font-size: 16px; font-weight: 700; margin-top: 4px; }
  .paid-stamp {
    background: #DCFCE7;
    border-bottom: 2px solid #BBF7D0;
    padding: 10px 32px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .paid-stamp .text { color: #15803D; font-weight: 700; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; display: flex; align-items: center; }
  .paid-stamp .date { color: #16A34A; font-size: 12px; margin-left: auto; font-weight: 600; }
  /* CSS-only checkmark icon (avoids Unicode/font glyph issues in PDF rendering) */
  .check-icon {
    display: inline-block;
    width: 16px;
    height: 16px;
    background: #16A34A;
    border-radius: 50%;
    position: relative;
    vertical-align: middle;
    margin-right: 6px;
    flex-shrink: 0;
  }
  .check-icon::after {
    content: '';
    position: absolute;
    left: 5.5px;
    top: 2.5px;
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .body { padding: 24px 32px; }
  .section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #64748B;
    margin-bottom: 8px;
    margin-top: 18px;
    font-weight: 700;
  }
  .section-title:first-child { margin-top: 0; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #F1F5F9; }
  .row:last-child { border-bottom: none; }
  .row .label { color: #64748B; font-size: 13px; }
  .row .value { font-size: 13px; font-weight: 600; color: #0F172A; text-align: right; max-width: 60%; }
  .amount-box {
    background: #EFF6FF;
    border: 1px solid #BFDBFE;
    border-radius: 10px;
    padding: 16px 20px;
    margin: 20px 0 5px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .amount-box .label { color: #1D4ED8; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .amount-box .rupees { font-size: 28px; font-weight: 800; color: #1D4ED8; }
  .amount-words {
    font-size: 11px;
    color: #64748B;
    font-style: italic;
    margin-top: 4px;
  }
  .footer {
    background: #F8FAFC;
    border-top: 1px solid #E2E8F0;
    padding: 18px 32px;
    text-align: center;
  }
  .footer .thank-you { font-size: 13px; font-weight: 700; color: #334155; }
  .footer .sub { font-size: 11px; color: #64748B; margin-top: 4px; font-weight: 600; }
  .footer .upi { font-size: 11px; color: #475569; margin-top: 6px; font-weight: 500; max-width: 100%; white-space: normal; overflow-wrap: anywhere; word-break: break-word; text-align: center; }

  @media print {
    html, body {
      background: #ffffff;
      padding: 20px;
      height: 99%;
    }
    .receipt {
      border: 1px solid #e2e8f0;
      box-shadow: none;
      page-break-inside: avoid;
    }
  }
</style>
</head>
<body>
<div class="receipt">
  <div class="header">
    <div class="brand-container">
      <img class="logo" src="data:image/svg+xml;base64,${LOGO_BASE64}" width="48" height="48" alt="TransitOS" />
      <div>
        <div class="brand">Transit<span>OS</span></div>
        <div class="subtitle">School Transport Receipt</div>
      </div>
    </div>
    <div class="receipt-no">
      <div class="label">Receipt No</div>
      <div class="value">${data.receiptId}</div>
    </div>
  </div>
  <div class="paid-stamp">
    <div class="text">
      <span class="check-icon"></span>
      PAYMENT CONFIRMED
    </div>
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
      <div class="rupees">&#8377;${rupees.toLocaleString('en-IN')}</div>
    </div>
  </div>
  <div class="footer">
    <div class="thank-you">Thank you for your prompt payment!</div>
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

      const shortMonth = new Date(payment.year, payment.month - 1)
        .toLocaleString('en-US', { month: 'short' }).toUpperCase();
      const receiptId = `PAY-${shortMonth}${payment.year}-${paymentId.slice(-6).toUpperCase()}`;

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
      const options = { format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } };
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
