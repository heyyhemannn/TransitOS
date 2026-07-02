import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';

function numberToWords(num: number): string {
  // Convert rupee amount to Indian English words
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

      const rupees = payment.amount / 100;
      const monthName = new Date(payment.year, payment.month - 1)
        .toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      const paidDate = payment.paidAt
        ? new Date(payment.paidAt).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
          })
        : new Date().toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
          });
      const amountWords = numberToWords(rupees);
      const businessName = getSetting('businessName') || "TransitOS Transport Services";
      const upiId = getSetting('upiId') || '';

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        // ─── HEADER ───
        // Blue rounded box
        doc.roundedRect(40, 40, 515, 80, 8).fill('#2563EB');

        // Brand name: Transit (white) + OS (light blue)
        doc.fillColor('white')
           .fontSize(26)
           .font('Helvetica-Bold')
           .text('Transit', 65, 60, { continued: true })
           .fillColor('#93C5FD')
           .text('OS');

        // Subtitle
        doc.fillColor('#93C5FD')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('SCHOOL TRANSPORT RECEIPT', 65, 92);

        // Receipt No
        doc.fillColor('#E2E8F0')
           .fontSize(10)
           .font('Helvetica')
           .text('RECEIPT NO', 380, 60, { width: 150, align: 'right' });

        doc.fillColor('white')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text(receiptId, 380, 74, { width: 150, align: 'right' });

        // ─── CONFIRMATION STAMP BANNER ───
        // Green banner
        doc.roundedRect(40, 130, 515, 30, 4).fill('#DCFCE7');

        // Border bottom (using a thin rect)
        doc.rect(40, 159, 515, 1).fill('#BBF7D0');

        // Green check circle
        doc.circle(60, 145, 8).fill('#16A34A');
        
        // Checkmark path in the circle
        doc.strokeColor('white')
           .lineWidth(2)
           .moveTo(56, 145)
           .lineTo(59, 148)
           .lineTo(64, 142)
           .stroke();

        // Banner Text
        doc.fillColor('#15803D')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('PAYMENT CONFIRMED', 78, 140);

        doc.fillColor('#16A34A')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text(paidDate, 380, 140, { width: 150, align: 'right' });

        // ─── STUDENT DETAILS ───
        doc.fillColor('#64748B')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('STUDENT DETAILS', 40, 180);

        // Separator line
        doc.rect(40, 194, 515, 1).fill('#E2E8F0');

        let currentY = 205;
        const drawRow = (label: string, value: string) => {
          doc.fillColor('#64748B')
             .fontSize(10)
             .font('Helvetica')
             .text(label, 40, currentY);

          doc.fillColor('#0F172A')
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(value, 200, currentY, { width: 355, align: 'right' });

          doc.rect(40, currentY + 16, 515, 0.5).fill('#F1F5F9');
          currentY += 24;
        };

        drawRow('Student Name', payment.student.name);
        drawRow('School', payment.student.school);
        drawRow('Class', payment.student.class);
        drawRow('Parent Name', payment.student.parentName);

        // ─── PAYMENT DETAILS ───
        currentY += 10;
        doc.fillColor('#64748B')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('PAYMENT DETAILS', 40, currentY);

        doc.rect(40, currentY + 14, 515, 1).fill('#E2E8F0');
        currentY += 25;

        drawRow('Fee Month', monthName);
        drawRow('Payment Method', payment.method);
        if (payment.transactionId) {
          drawRow('Transaction ID', payment.transactionId);
        }
        drawRow('Payment Date', paidDate);

        // ─── AMOUNT BOX ───
        currentY += 10;
        // Background rounded rect
        doc.roundedRect(40, currentY, 515, 60, 6).fill('#EFF6FF');
        // Border
        doc.roundedRect(40, currentY, 515, 60, 6).lineWidth(1).strokeColor('#BFDBFE').stroke();

        // Label on left
        doc.fillColor('#1D4ED8')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('AMOUNT PAID', 55, currentY + 15);

        // Words below label
        doc.fillColor('#64748B')
           .fontSize(9)
           .font('Helvetica-Oblique')
           .text(amountWords, 55, currentY + 32, { width: 320 });

        // Amount on right
        const formattedAmount = `INR ${rupees.toLocaleString('en-IN')}`;
        doc.fillColor('#1D4ED8')
           .fontSize(22)
           .font('Helvetica-Bold')
           .text(formattedAmount, 380, currentY + 18, { width: 160, align: 'right' });

        // ─── FOOTER ───
        currentY += 90;
        // Separator line
        doc.rect(40, currentY, 515, 1).fill('#E2E8F0');

        doc.fillColor('#334155')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text('Thank you for your prompt payment!', 40, currentY + 15, { width: 515, align: 'center' });

        doc.fillColor('#64748B')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text(businessName, 40, currentY + 32, { width: 515, align: 'center' });

        if (upiId) {
          doc.fillColor('#475569')
             .fontSize(9)
             .font('Helvetica')
             .text(`UPI: ${upiId}`, 40, currentY + 47, { width: 515, align: 'center' });
        }

        doc.end();
      });

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
