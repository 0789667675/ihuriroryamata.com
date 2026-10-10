const PDFDocument = require('pdfkit');

const COLORS = {
  blue: '#1681ab',
  blueDark: '#105a78',
  bluePale: '#eaf4f8',
  ink: '#20323b',
  muted: '#637782',
  line: '#cad9df',
  white: '#ffffff',
};

const amount = (value) => value === null || value === undefined
  ? 'Not available'
  : Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const volume = (value) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodName = (periodType) => periodType === 'first-half' ? '1-15' : periodType === 'second-half' ? '16-end of month' : periodType;
const safeFilePart = (value) => String(value || 'account')
  .normalize('NFKD')
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'account';

const getAccountingRows = ({ report, isCollector, isDairy }) => {
  const rows = isCollector
    ? report.farmerPayments || []
    : isDairy ? report.collectorSettlementRows || [] : [];
  return [
    ...rows.map((row) => ({ ...row, isOwner: false })),
    ...(report.ownerSettlementRow ? [{ ...report.ownerSettlementRow, isOwner: true }] : []),
  ];
};

const renderUkweziPdf = async ({ report, user, query, generatedAt = new Date() }) => {
  if (!report?.rangeStart || !report?.rangeEnd || !user?.id || !query?.periodType) {
    throw Object.assign(new Error('A valid account and accounting report are required.'), { statusCode: 400 });
  }

  const isCollector = user.accountType === 'COLLECTOR';
  const isDairy = user.accountType === 'COLLECTION_CENTER';
  const rows = getAccountingRows({ report, isCollector, isDairy });
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 34, bufferPages: true });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const pageWidth = doc.page.width;
  const leftMargin = doc.page.margins?.left ?? 34;
  const rightMargin = doc.page.margins?.right ?? 34;
  const bottomMargin = doc.page.margins?.bottom ?? 34;
  const contentWidth = pageWidth - leftMargin - rightMargin;

  const drawPageHeader = () => {
    doc.save();
    doc.rect(0, 0, pageWidth, 9).fill(COLORS.blue);
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(11)
      .text("IHURIRO RY'AMATA", leftMargin, 20, { lineBreak: false });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text('Milk System Technologies Ltd.', leftMargin, 36, { lineBreak: false });
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(15)
      .text('UKWEZI ACCOUNTING', pageWidth - rightMargin - 250, 22, { width: 250, align: 'right', lineBreak: false });
    doc.restore();
    doc.y = 56;
  };
  drawPageHeader();
  doc.on('pageAdded', drawPageHeader);

  const ownerName = user.name || user.email;
  const accountTypeName = isDairy ? 'Collection Center' : isCollector ? 'Collector' : 'Account';
  const generatedText = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kigali', dateStyle: 'medium', timeStyle: 'short',
  }).format(generatedAt);
  const period = periodName(query.periodType);

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13).text(ownerName, { continued: true });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`  |  ${accountTypeName}`);
  doc.moveDown(0.3);
  doc.fontSize(9).text(`Period: ${report.rangeStart} to ${report.rangeEnd} (${period})`);
  doc.text(`Generated: ${generatedText}`);
  doc.moveDown(0.8);

  const metrics = [
    { label: 'VALID MILK', value: `${volume(report.ownerGeneratedVolume ?? report.totalVolume)} L` },
    { label: 'GROSS AMOUNT', value: report.ownerGeneratedGross == null && isCollector ? 'Unpriced' : `${amount(report.ownerGeneratedGross ?? report.totalRevenueMonth)} RWF` },
    { label: 'DEDUCTIONS', value: `${amount(report.totalDeductionsMonth)} RWF` },
    ...(isCollector ? [{ label: 'TRANSPORT', value: `${amount(report.collectorFarmerTransport)} RWF` }] : []),
    { label: isDairy ? 'DAIRY PAYABLE' : 'NET / PAYABLE', value: (isCollector ? report.collectorPayable : report.netRevenueMonth) == null ? 'Unpriced' : `${amount(isCollector ? report.collectorPayable : report.netRevenueMonth)} RWF` },
  ];
  const metricGap = 8;
  const metricWidth = (contentWidth - metricGap * (metrics.length - 1)) / metrics.length;
  const metricY = doc.y;
  metrics.forEach((metric, index) => {
    const x = leftMargin + index * (metricWidth + metricGap);
    doc.save();
    doc.roundedRect(x, metricY, metricWidth, 48, 4).fill(COLORS.bluePale).stroke(COLORS.line);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7).text(metric.label, x + 8, metricY + 7, { width: metricWidth - 16, lineBreak: false });
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(metric.value, x + 8, metricY + 23, { width: metricWidth - 16, lineBreak: false, ellipsis: true });
    doc.restore();
  });
  doc.y = metricY + 62;

  if (isCollector && report.collectorPayableFromBreakdown != null) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text(`Reconciliation: ${amount(report.collectorSurplusAmount)} + ${amount(report.collectorFarmerDeductions)} + ${amount(report.collectorFarmerTransport)} = ${amount(report.collectorPayableFromBreakdown)} RWF`, { width: contentWidth });
    doc.moveDown(0.6);
  }
  if (isCollector && (report.collectorTransportIsComplete === false || rows.some((row) => row.transportIsComplete === false))) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text('Historical transport could not be established for every record in this period.', { width: contentWidth });
    doc.moveDown(0.6);
  }

  const columns = isCollector ? [
    { label: 'No', key: 'number', width: 28, align: 'right' },
    { label: 'Farmer / owner', key: 'name', width: 118 },
    { label: 'National ID', key: 'id', width: 65 },
    { label: 'Phone / account', key: 'contact', width: 108 },
    { label: 'Milk (L)', key: 'volume', width: 55, align: 'right' },
    { label: 'Price / L', key: 'price', width: 60, align: 'right' },
    { label: 'Gross (RWF)', key: 'gross', width: 75, align: 'right' },
    { label: 'Transport', key: 'transport', width: 64, align: 'right' },
    { label: 'Deductions', key: 'deductions', width: 75, align: 'right' },
    { label: 'Net / payable', key: 'net', width: 90, align: 'right' },
  ] : [
    { label: 'No', key: 'number', width: 28, align: 'right' },
    { label: 'Collector / owner', key: 'name', width: 150 },
    { label: 'Abacunda', key: 'count', width: 68, align: 'right' },
    { label: 'Phone / account', key: 'contact', width: 140 },
    { label: 'Milk (L)', key: 'volume', width: 70, align: 'right' },
    { label: 'Price / L', key: 'price', width: 75, align: 'right' },
    { label: 'Gross (RWF)', key: 'gross', width: 100, align: 'right' },
    { label: 'Payable (RWF)', key: 'net', width: 110, align: 'right' },
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const tableX = leftMargin + Math.max(0, (contentWidth - tableWidth) / 2);

  const drawTableHeader = () => {
    const y = doc.y;
    doc.save();
    doc.rect(tableX, y, tableWidth, 24).fill(COLORS.blue);
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7);
    let x = tableX;
    columns.forEach((column) => {
      doc.text(column.label, x + 4, y + 7, { width: column.width - 8, align: column.align || 'left', lineBreak: false });
      x += column.width;
    });
    doc.restore();
    doc.y = y + 24;
  };

  const rowValues = (row, index) => ({
    number: String(index + 1),
    name: `${row.farmerName || row.name || '—'}${row.isOwner ? ' (Owner)' : ''}`,
    id: row.nationalId || row.idNumber || '—',
    count: row.assignedFarmerCount === undefined ? '—' : String(row.assignedFarmerCount),
    contact: [row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—',
    volume: volume(row.totalVolume ?? row.actualVolume),
    price: row.pricePerLiter == null ? '—' : amount(row.pricePerLiter),
    gross: row.grossAmount == null ? 'Unpriced' : amount(row.grossAmount),
    transport: amount(row.totalTransport),
    deductions: amount(row.totalDeductions),
    net: row.netAmount == null ? 'Unpriced' : amount(row.netAmount),
  });

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text('ACCOUNT DETAILS', leftMargin, doc.y);
  doc.moveDown(0.5);
  if (rows.length) {
    drawTableHeader();
    rows.forEach((row, index) => {
      const values = rowValues(row, index);
      const fontSize = 7;
      const estimatedLines = columns.reduce((max, column) => {
        const value = String(values[column.key] ?? '');
        const roughLength = Math.max(1, Math.ceil((value.length || 1) / Math.max(1, Math.floor((column.width - 16) / 5.2))));
        return Math.max(max, roughLength);
      }, 1);
      const height = Math.max(28, (estimatedLines * 8) + 10);
      if (doc.y + height > doc.page.height - bottomMargin - 18) {
        doc.addPage();
        drawTableHeader();
      }
      const y = doc.y;
      doc.save();
      if (index % 2 === 1) doc.rect(tableX, y, tableWidth, height).fill('#f4f8fa');
      doc.rect(tableX, y, tableWidth, height).stroke(COLORS.line);
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(fontSize);
      let x = tableX;
      columns.forEach((column) => {
        doc.text(values[column.key], x + 4, y + 6, { width: column.width - 8, height: height - 10, align: column.align || 'left', ellipsis: true });
        x += column.width;
      });
      doc.restore();
      doc.y = y + height;
    });
  } else {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('No accounting rows were recorded for this period.', { width: contentWidth });
  }

  const pageRange = doc.bufferedPageRange();
  for (let page = pageRange.start; page < pageRange.start + pageRange.count; page += 1) {
    doc.switchToPage(page);
    const footerY = doc.page.height - 27;
    doc.save();
    doc.moveTo(leftMargin, footerY - 8).lineTo(pageWidth - rightMargin, footerY - 8).stroke(COLORS.line);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text('Milk System Technologies Ltd. | Ukwezi Accounting Report', leftMargin, footerY, { width: contentWidth / 2, lineBreak: false });
    doc.text(`Page ${page - pageRange.start + 1} of ${pageRange.count}`, pageWidth - rightMargin - 100, footerY, { width: 100, align: 'right', lineBreak: false });
    doc.restore();
  }
  doc.end();
  return output;
};

const buildUkweziFilename = ({ accountName, year, month, periodType }) =>
  `Ukwezi-${safeFilePart(accountName)}-${year}-${String(month).padStart(2, '0')}-${safeFilePart(periodType)}.pdf`;

module.exports = { renderUkweziPdf, buildUkweziFilename, getAccountingRows };
