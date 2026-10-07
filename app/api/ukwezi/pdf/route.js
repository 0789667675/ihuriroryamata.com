import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');

export const runtime = 'nodejs';

const money = (value) => Number(value || 0).toFixed(2);

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(params.entries());
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query });

    const isCollector = user.accountType === 'COLLECTOR';
    const isDairy = user.accountType === 'COLLECTION_CENTER';
    const collectorPriced = !isCollector || report.collectorIsReconciled !== null;
    const ownerRowLabel = isCollector ? 'Owner account' : 'Business account';
    const payable = isCollector ? report.collectorPayable : report.netRevenueMonth;
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {});

    doc.fontSize(18).text('IHURIRO RY\'AMATA — Ukwezi', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Owner: ${user.name || user.email}`);
    doc.text(`Month: ${query.month || report.rangeStart.slice(5, 7)}`);
    doc.text(`Year: ${query.year || report.rangeStart.slice(0, 4)}`);
    doc.text(`Period: ${query.periodType || 'monthly'}`);
    doc.text(`Range: ${report.rangeStart} → ${report.rangeEnd}`);
    doc.moveDown();

    doc.fontSize(12).text(`Igiteranyo cy'byose: ${Number(report.ownerGeneratedVolume ?? report.totalVolume ?? 0).toFixed(2)} L`);
    doc.text(`Gross: ${isCollector && !collectorPriced ? 'Unpriced' : `${money(report.ownerGeneratedGross ?? report.totalRevenueMonth ?? 0)} RWF`}`);
    doc.text(`Deductions: ${money(report.totalDeductionsMonth || 0)} RWF`);
    if (isCollector) doc.text(`Transport: ${money(report.collectorFarmerTransport || 0)} RWF`);
    doc.text(`Payable: ${payable == null ? 'Unpriced' : `${money(payable)} RWF`}`);
    if (isCollector) doc.text(`Reconciled: ${report.collectorIsReconciled === true ? 'Yes' : report.collectorIsReconciled === false ? 'No' : 'Pending price'}`);

    const settlementRows = isCollector
      ? (Array.isArray(report.farmerPayments) ? report.farmerPayments : [])
      : isDairy ? (Array.isArray(report.collectorSettlementRows) ? report.collectorSettlementRows : []) : [];
    const accountingRows = [
      ...settlementRows,
      ...(report.ownerSettlementRow ? [report.ownerSettlementRow] : []),
    ];
    if (accountingRows.length) {
      doc.moveDown();
      doc.fontSize(12).text('Allocations');
      const columns = [
        { label: 'No', width: 24 },
        { label: isCollector ? 'Umworozi / Owner' : isDairy ? 'Collector / Owner' : 'Account', width: 125 },
        { label: 'ID', width: 70 },
        { label: 'Phone / account', width: 120 },
        { label: 'Liters', width: 55 },
        { label: 'Price / L', width: 60 },
        { label: 'Gross', width: 70 },
        ...(isCollector ? [{ label: 'Transport', width: 64 }] : []),
        { label: 'Deductions', width: 70 },
        { label: 'Payable', width: 75 },
      ];
      const drawTableHeader = () => {
        const headerY = doc.y;
        let x = doc.page.margins.left;
        doc.font('Helvetica-Bold').fontSize(8);
        columns.forEach((column) => {
          doc.text(column.label, x, headerY, { width: column.width, height: 28 });
          x += column.width;
        });
        doc.y = headerY + 30;
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
        doc.y += 5;
        doc.font('Helvetica').fontSize(8);
      };
      drawTableHeader();
      accountingRows.forEach((row, index) => {
        const values = [
          String(index + 1),
          row.isOwner ? `${row.name || row.farmerName} (${ownerRowLabel})` : row.farmerName || row.name || '—',
          row.nationalId || row.idNumber || '—',
          [row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—',
          `${Number(row.totalVolume || row.actualVolume || 0).toFixed(2)} L`,
          row.pricePerLiter == null ? '—' : `${money(row.pricePerLiter)} RWF`,
          row.grossAmount == null ? 'Unpriced' : `${money(row.grossAmount)} RWF`,
          ...(isCollector ? [`${money(row.totalTransport)} RWF`] : []),
          `${money(row.totalDeductions)} RWF`,
          row.netAmount == null ? 'Unpriced' : `${money(row.netAmount)} RWF`,
        ];
        const rowHeight = Math.max(20, ...values.map((value, columnIndex) => doc.heightOfString(value, { width: columns[columnIndex].width })));
        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          drawTableHeader();
        }
        const rowY = doc.y;
        let x = doc.page.margins.left;
        values.forEach((value, columnIndex) => {
          doc.text(value, x, rowY, { width: columns[columnIndex].width, height: rowHeight });
          x += columns[columnIndex].width;
        });
        doc.y = rowY + rowHeight + 5;
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
        doc.y += 4;
      });
    }

    const lossRows = [
      ...(Array.isArray(report.milkLossRecords) ? report.milkLossRecords : []).map((row) => ({
        date: row.date, name: row.farmerName, original: row.originalVolume, valid: row.validVolume,
        lost: row.lostVolume, status: row.status, reason: row.reason, actor: row.adjustedBy, at: row.adjustedAt,
      })),
      ...(Array.isArray(report.collectorEntries) ? report.collectorEntries : [])
        .filter((row) => row.status === 'cancelled' || Number(row.farmerLostLiters || 0) > 0)
        .map((row) => ({
          date: row.date, name: report.collectorProfile?.name || 'Collector', original: row.volumeLiters,
          valid: row.effectiveVolumeLiters, lost: row.status === 'cancelled' ? row.volumeLiters : row.farmerLostLiters,
          status: row.status, reason: row.voidReason, actor: row.voidedBy, at: row.voidedAt,
        })),
    ];
    if (lossRows.length) {
      doc.addPage();
      doc.fontSize(12).font('Helvetica-Bold').text('Void / lost milk reconciliation');
      doc.moveDown(0.5).fontSize(8).font('Helvetica');
      for (const row of lossRows) {
        doc.text(`${String(row.date).slice(0, 10)} · ${row.name} · original ${Number(row.original || 0).toFixed(2)} L · valid ${Number(row.valid || 0).toFixed(2)} L · lost ${Number(row.lost || 0).toFixed(2)} L · ${row.status} · ${row.reason || 'No reason supplied'} · actor ${row.actor || '—'} · ${row.at ? new Date(row.at).toISOString() : '—'}`);
      }
    }

    if (isCollector && collectorPriced && (Number(report.collectorFarmerTransport || 0) > 0 || Number(report.collectorSurplusAmount || 0) > 0)) {
      doc.moveDown();
      doc.fontSize(12).text('Transport / breakdown');
      doc.fontSize(10).text(`Transport: ${money(report.collectorFarmerTransport || 0)} RWF`);
      doc.text(`Surplus: ${money(report.collectorSurplusAmount || 0)} RWF`);
      doc.text(`Payable breakdown: ${money(report.collectorPayableFromBreakdown || 0)} RWF`);
    }

    doc.end();
    const bytes = await new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ukwezi-${query.year || report.rangeStart.slice(0, 4)}-${query.month || report.rangeStart.slice(5, 7)}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to generate Ukwezi PDF.' }, {
      status: error.statusCode || 500,
    });
  }
}
