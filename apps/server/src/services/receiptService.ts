import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { uploadToStorage, getSupabase } from '../lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Generates a professional PDF receipt using PDFKit (pure Node.js, no Chromium),
 * uploads it to Supabase Storage, and updates the payment's receiptUrl in the database.
 */
export async function generateReceipt(paymentId: string): Promise<string> {
  try {
    logger.info(`Generating receipt PDF for payment ID: ${paymentId}`);

    // 1. Fetch payment and related entities
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: { route: true },
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
    const billingMonth = `${MONTHS[payment.month - 1]} ${payment.year}`;
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

    // 2. Build PDF with PDFKit
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ─── Colors & Fonts ────────────────────────────────────────────────
      const DARK = '#0f172a';
      const MID = '#334155';
      const MUTED = '#64748b';
      const ACCENT = '#2563eb';
      const LINE = '#e2e8f0';
      const BG_ROW = '#f8fafc';

      const pageWidth = doc.page.width - 100; // margins

      // ─── Header ────────────────────────────────────────────────────────
      doc.rect(50, 50, pageWidth, 80).fill('#f1f5f9');
      doc.fillColor(DARK).fontSize(20).font('Helvetica-Bold')
        .text(businessName, 60, 65, { width: pageWidth / 2 });
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
        .text('SCHOOL TRANSPORT SERVICES', 60, 90);

      doc.fillColor(ACCENT).fontSize(22).font('Helvetica-Bold')
        .text('RECEIPT', 60 + pageWidth / 2, 62, { align: 'right', width: pageWidth / 2 - 10 });
      doc.fillColor(MUTED).fontSize(10).font('Helvetica')
        .text(receiptNo, 60 + pageWidth / 2, 90, { align: 'right', width: pageWidth / 2 - 10 });

      // ─── Divider ───────────────────────────────────────────────────────
      doc.moveDown(4);
      doc.moveTo(50, 145).lineTo(50 + pageWidth, 145).strokeColor(LINE).lineWidth(1).stroke();

      // ─── Billing Details ───────────────────────────────────────────────
      const leftCol = 50;
      const rightCol = 50 + pageWidth / 2 + 10;
      let y = 160;

      // Left column
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold')
        .text('BILLED TO (PARENT)', leftCol, y);
      doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
        .text(student.parentName, leftCol, y + 14);
      doc.fillColor(MID).fontSize(10).font('Helvetica')
        .text(`Mobile: ${student.fatherMobile}`, leftCol, y + 30);
      doc.text(`Student: ${student.name}`, leftCol, y + 45);
      doc.text(`School: ${student.school} – ${student.class}`, leftCol, y + 60);

      // Right column
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold')
        .text('TRANSACTION DETAILS', rightCol, y);
      doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
        .text(`Date: ${paymentDate}`, rightCol, y + 14);
      doc.fillColor(MID).fontSize(10).font('Helvetica')
        .text(`Billing Period: ${billingMonth}`, rightCol, y + 30);
      doc.text(`Method: ${payment.method}`, rightCol, y + 45);
      doc.text(`Ref: ${transactionId}`, rightCol, y + 60);

      // ─── Table ─────────────────────────────────────────────────────────
      y += 100;
      doc.moveTo(50, y).lineTo(50 + pageWidth, y).strokeColor(LINE).lineWidth(1).stroke();
      y += 8;

      // Table header
      doc.rect(50, y, pageWidth, 24).fill(BG_ROW);
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold');
      doc.text('STUDENT & SCHOOL', 60, y + 8);
      doc.text('ROUTE DETAILS', 240, y + 8);
      doc.text('AMOUNT PAID', 400, y + 8, { width: 100, align: 'right' });
      y += 28;

      // Table row
      doc.moveTo(50, y).lineTo(50 + pageWidth, y).strokeColor(LINE).lineWidth(0.5).stroke();
      y += 8;
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
        .text(student.name, 60, y);
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
        .text(`${student.school} – ${student.class}`, 60, y + 16);

      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
        .text(routeName, 240, y);
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
        .text(`Bus: ${vehicleNumber}`, 240, y + 16);

      doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
        .text(`Rs. ${amountRupees}`, 400, y, { width: 100, align: 'right' });

      y += 40;
      doc.moveTo(50, y).lineTo(50 + pageWidth, y).strokeColor(LINE).lineWidth(1).stroke();

      // ─── Summary ───────────────────────────────────────────────────────
      y += 20;
      const summaryX = 50 + pageWidth - 230;
      doc.fillColor(MUTED).fontSize(10).font('Helvetica')
        .text('Payment Method:', summaryX, y)
        .text(payment.method, summaryX + 130, y, { width: 100, align: 'right' });
      y += 18;
      doc.text('Transaction Ref:', summaryX, y)
        .text(transactionId, summaryX + 130, y, { width: 100, align: 'right' });
      y += 14;
      doc.moveTo(summaryX, y).lineTo(summaryX + 230, y).strokeColor(LINE).lineWidth(1).stroke();
      y += 10;
      doc.fillColor(DARK).fontSize(15).font('Helvetica-Bold')
        .text('Total Paid:', summaryX, y)
        .text(`Rs. ${amountRupees}`, summaryX + 130, y, { width: 100, align: 'right' });

      // ─── Footer ────────────────────────────────────────────────────────
      const footerY = doc.page.height - 90;
      doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).strokeColor(LINE).lineWidth(1).stroke();
      doc.fillColor(MID).fontSize(10).font('Helvetica-Bold')
        .text('Thank you for your trust!', 50, footerY + 15, { align: 'center', width: pageWidth });
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
        .text('This is an electronically generated payment document. No signature required.', 50, footerY + 32, {
          align: 'center',
          width: pageWidth,
        });

      doc.end();
    });

    // 3. Ensure Supabase Bucket exists
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'receipts';
    const supabase = getSupabase();
    try {
      await supabase.storage.createBucket(bucket, { public: false });
    } catch {
      // Ignored: bucket already exists
    }

    // 4. Upload PDF file
    const filePath = `receipts/${payment.studentId}/${payment.id}.pdf`;
    await uploadToStorage(bucket, filePath, pdfBuffer, 'application/pdf');

    // 5. Save receiptUrl path in database
    await prisma.payment.update({
      where: { id: paymentId },
      data: { receiptUrl: filePath },
    });

    logger.info(`Receipt PDF successfully generated and uploaded for payment ${paymentId}`);
    return filePath;
  } catch (error) {
    logger.error(`Failed to generate receipt PDF for payment ${paymentId}:`, error);
    throw error;
  }
}
