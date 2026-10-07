import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Milk = require('@/lib/services/milk-service.js');
const { buildIfishiVolumeRows } = require('@/lib/utils/ifishi-ledger.js');

export const runtime = 'nodejs';

const liters = (value) => Number(value || 0).toFixed(2);

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.accountType !== 'COLLECTOR' || user.role !== 'user') {
      return NextResponse.json({ message: 'Ifishi is available to Collector accounts.' }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const farmerId = Number(params.get('farmerId'));
    const month = Number(params.get('month'));
    const year = Number(params.get('year'));
    if (!Number.isSafeInteger(farmerId) || farmerId <= 0
        || !Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ message: 'A valid farmer, month, and year are required.' }, { status: 400 });
    }

    const records = await Milk.getMilkTemplate({ ownerUserId: user.id, farmerId, month, year });
    const rows = buildIfishiVolumeRows(records || []);
    if (!rows.length) return NextResponse.json({ message: 'Farmer or Ifishi records not found.' }, { status: 404 });

    const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24 });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.fontSize(17).font('Helvetica-Bold').text("IHURIRO RY'AMATA | IFISHI", { align: 'center' });
    document.moveDown(0.4).fontSize(9).font('Helvetica');
    document.text(`Account: ${user.name || user.email}`);
    document.text(`Farmer ID: ${farmerId}`);
    document.text(`Period: ${year}-${String(month).padStart(2, '0')}`);
    document.moveDown();

    const columns = [
      { label: 'Date', width: 54 },
      { label: 'Morning (L)', width: 58 },
      { label: 'Evening (L)', width: 58 },
      { label: 'Total (L)', width: 56 },
      { label: 'Valid (L)', width: 56 },
      { label: 'Lost (L)', width: 52 },
      { label: 'Status', width: 54 },
      { label: 'Reason', width: 108 },
    ];

    const headerY = document.y;
    document.font('Helvetica-Bold').fontSize(7);
    let x = document.page.margins.left;
    for (const column of columns) {
      document.text(column.label, x, headerY, { width: column.width, height: 34, align: 'left' });
      x += column.width;
    }
    const rowY = headerY + 38;
    document.moveTo(document.page.margins.left, rowY - 4).lineTo(document.page.width - document.page.margins.right, rowY - 4).stroke();

    document.font('Helvetica').fontSize(7);
    rows.forEach((row, index) => {
      const values = [
        row.date || `${index + 1}`,
        liters(row.morning),
        liters(row.evening),
        liters(row.total),
        liters(row.valid),
        liters(row.lost),
        row.status,
        row.note || '—',
      ];
      x = document.page.margins.left;
      values.forEach((value, columnIndex) => {
        const column = columns[columnIndex];
        document.text(String(value), x, rowY + (index * 18), { width: column.width, height: 16, ellipsis: true });
        x += column.width;
      });
    });

    document.moveTo(document.page.margins.left, rowY + (rows.length * 18) + 8).lineTo(document.page.width - document.page.margins.right, rowY + (rows.length * 18) + 8).stroke();
    document.end();

    const bytes = await new Promise((resolve, reject) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ifishi-${year}-${String(month).padStart(2, '0')}-${farmerId}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to generate Ifishi PDF.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
