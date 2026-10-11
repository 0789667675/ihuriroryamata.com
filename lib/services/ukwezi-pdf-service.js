const PDFDocument = require('pdfkit');
const path = require('node:path');

const BRAND_LOGO_PATH = path.join(process.cwd(), 'public', 'brand-logo.png');

const COLORS = {
  blue: '#1681ab',
  blueDark: '#105a78',
  bluePale: '#eaf4f8',
  ink: '#20323b',
  muted: '#637782',
  line: '#cad9df',
  white: '#ffffff',
};

const copy = {
  rw: {
    title: 'IBARURAMARI RY\'UKWEZI',
    accountDetails: 'IBIRANGA KONTI',
    notAvailable: 'Ntiboneka',
    validMilk: 'AMATA MEZA',
    grossAmount: 'AGACIRO MBISI',
    deductions: 'IBYAKUWEHO',
    transport: 'UBWIKOREZI',
    netPayable: 'AYISHYURWA / HASIGAYE',
    unpriced: 'Nta giciro',
    collector: 'Umucunda',
    collectionCenter: 'Ikigo cy\'ikusanyirizo',
    otherAccount: 'Konti',
    period: 'Igihe',
    generated: 'Byakozwe',
    firstHalf: '1-15',
    secondHalf: '16 kugeza ku mpera z\'ukwezi',
    monthly: 'Ukwezi kose',
    number: 'No',
    farmerOwner: 'Umworozi / nyirayo',
    nationalId: 'Indangamuntu',
    phoneAccount: 'Telefone / konti',
    milk: 'Amata (L)',
    pricePerLiter: 'Igiciro / L',
    grossRwf: 'Agaciro (RWF)',
    totalTransport: 'Ubwikorezi',
    totalDeductions: 'Ibyakuweho',
    net: 'Asigaye',
    assignedFarmers: 'Aborozi',
    owner: 'Nyirayo',
    noRows: 'Nta makuru y\'ibaruramari yanditswe muri iki gihe.',
    reconciliation: 'Ihuza ry\'ibaruramari',
    historicalTransport: 'Igiciro cy\'ubwikorezi cyo muri ayo matariki ntikiboneka kuri buri nyandiko.',
    footer: 'Milk System Technologies Ltd. | Ibaruramari ry\'Ukwezi',
    page: 'Urupapuro',
    of: 'kuri',
  },
  en: {
    title: 'UKWEZI ACCOUNTING',
    accountDetails: 'ACCOUNT DETAILS',
    notAvailable: 'Not available',
    validMilk: 'VALID MILK',
    grossAmount: 'GROSS AMOUNT',
    deductions: 'DEDUCTIONS',
    transport: 'TRANSPORT',
    netPayable: 'NET / PAYABLE',
    unpriced: 'Unpriced',
    collector: 'Collector',
    collectionCenter: 'Collection Center',
    otherAccount: 'Account',
    period: 'Period',
    generated: 'Generated',
    firstHalf: '1-15',
    secondHalf: '16-end of month',
    monthly: 'Full month',
    number: 'No',
    farmerOwner: 'Farmer / owner',
    nationalId: 'National ID',
    phoneAccount: 'Phone / account',
    milk: 'Milk (L)',
    pricePerLiter: 'Price / L',
    grossRwf: 'Gross (RWF)',
    totalTransport: 'Transport',
    totalDeductions: 'Deductions',
    net: 'Net / payable',
    assignedFarmers: 'Abacunda',
    owner: 'Owner',
    noRows: 'No accounting rows were recorded for this period.',
    reconciliation: 'Reconciliation',
    historicalTransport: 'Historical transport could not be established for every record in this period.',
    footer: 'Milk System Technologies Ltd. | Ukwezi Accounting Report',
    page: 'Page',
    of: 'of',
  },
};
const getCopy = (language) => copy[language === 'en' ? 'en' : 'rw'];
const amount = (value, locale, notAvailable) => value === null || value === undefined
  ? notAvailable
  : Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const volume = (value, locale) => Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodName = (periodType, text) => periodType === 'first-half' ? text.firstHalf : periodType === 'second-half' ? text.secondHalf : text.monthly;
const displayDate = (value, locale) => new Intl.DateTimeFormat(locale, {
  timeZone: 'Africa/Kigali', dateStyle: 'medium',
}).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`));
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
  const language = query.language === 'en' ? 'en' : 'rw';
  const text = getCopy(language);
  const locale = language === 'en' ? 'en-GB' : 'rw-RW';
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
    doc.image(BRAND_LOGO_PATH, leftMargin, 15, { fit: [38, 38] });
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(11)
      .text("IHURIRO RY'AMATA", leftMargin + 46, 20, { lineBreak: false });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text('Milk System Technologies Ltd.', leftMargin + 46, 36, { lineBreak: false });
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(15)
      .text(text.title, pageWidth - rightMargin - 280, 22, { width: 280, align: 'right', lineBreak: false });
    doc.restore();
    doc.y = 62;
  };
  drawPageHeader();
  doc.on('pageAdded', drawPageHeader);

  const ownerName = user.name || user.email || text.owner;
  const accountTypeName = isDairy ? text.collectionCenter : isCollector ? text.collector : text.otherAccount;
  const generatedText = new Intl.DateTimeFormat(locale, {
    timeZone: 'Africa/Kigali', dateStyle: 'medium', timeStyle: 'short',
  }).format(generatedAt);
  const period = periodName(query.periodType, text);

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13).text(ownerName, { continued: true });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`  |  ${accountTypeName}`);
  doc.moveDown(0.3);
  doc.fontSize(9).text(`${text.period}: ${displayDate(report.rangeStart, locale)} – ${displayDate(report.rangeEnd, locale)} (${period})`);
  doc.text(`${text.generated}: ${generatedText}`);
  doc.moveDown(0.8);

  const metrics = [
    { label: text.validMilk, value: `${volume(report.ownerGeneratedVolume ?? report.totalVolume, locale)} L` },
    { label: text.grossAmount, value: report.ownerGeneratedGross == null && isCollector ? text.unpriced : `${amount(report.ownerGeneratedGross ?? report.totalRevenueMonth, locale, text.notAvailable)} RWF` },
    { label: text.deductions, value: `${amount(report.totalDeductionsMonth, locale, text.notAvailable)} RWF` },
    ...(isCollector ? [{ label: text.transport, value: `${amount(report.collectorFarmerTransport, locale, text.notAvailable)} RWF` }] : []),
    { label: text.netPayable, value: (isCollector ? report.collectorPayable : report.netRevenueMonth) == null ? text.unpriced : `${amount(isCollector ? report.collectorPayable : report.netRevenueMonth, locale, text.notAvailable)} RWF` },
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
      .text(`${text.reconciliation}: ${amount(report.collectorSurplusAmount, locale, text.notAvailable)} + ${amount(report.collectorFarmerDeductions, locale, text.notAvailable)} + ${amount(report.collectorFarmerTransport, locale, text.notAvailable)} = ${amount(report.collectorPayableFromBreakdown, locale, text.notAvailable)} RWF`, { width: contentWidth });
    doc.moveDown(0.6);
  }
  if (isCollector && (report.collectorTransportIsComplete === false || rows.some((row) => row.transportIsComplete === false))) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text(text.historicalTransport, { width: contentWidth });
    doc.moveDown(0.6);
  }

  const columns = isCollector ? [
    { label: text.number, key: 'number', width: 28, align: 'right' },
    { label: text.farmerOwner, key: 'name', width: 118 },
    { label: text.nationalId, key: 'id', width: 65 },
    { label: text.phoneAccount, key: 'contact', width: 108 },
    { label: text.milk, key: 'volume', width: 55, align: 'right' },
    { label: text.pricePerLiter, key: 'price', width: 60, align: 'right' },
    { label: text.grossRwf, key: 'gross', width: 75, align: 'right' },
    { label: text.totalTransport, key: 'transport', width: 64, align: 'right' },
    { label: text.totalDeductions, key: 'deductions', width: 75, align: 'right' },
    { label: text.net, key: 'net', width: 90, align: 'right' },
  ] : [
    { label: text.number, key: 'number', width: 28, align: 'right' },
    { label: text.farmerOwner, key: 'name', width: 150 },
    { label: text.assignedFarmers, key: 'count', width: 68, align: 'right' },
    { label: text.phoneAccount, key: 'contact', width: 140 },
    { label: text.milk, key: 'volume', width: 70, align: 'right' },
    { label: text.pricePerLiter, key: 'price', width: 75, align: 'right' },
    { label: text.grossRwf, key: 'gross', width: 100, align: 'right' },
    { label: text.net, key: 'net', width: 110, align: 'right' },
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
    name: `${row.farmerName || row.name || '—'}${row.isOwner ? ` (${text.owner})` : ''}`,
    id: row.nationalId || row.idNumber || '—',
    count: row.assignedFarmerCount === undefined ? '—' : String(row.assignedFarmerCount),
    contact: [row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—',
    volume: volume(row.totalVolume ?? row.actualVolume, locale),
    price: row.pricePerLiter == null ? '—' : amount(row.pricePerLiter, locale, text.notAvailable),
    gross: row.grossAmount == null ? text.unpriced : amount(row.grossAmount, locale, text.notAvailable),
    transport: amount(row.totalTransport, locale, text.notAvailable),
    deductions: amount(row.totalDeductions, locale, text.notAvailable),
    net: row.netAmount == null ? text.unpriced : amount(row.netAmount, locale, text.notAvailable),
  });

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(text.accountDetails, leftMargin, doc.y);
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
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(text.noRows, { width: contentWidth });
  }

  const pageRange = doc.bufferedPageRange();
  for (let page = pageRange.start; page < pageRange.start + pageRange.count; page += 1) {
    doc.switchToPage(page);
    const footerY = doc.page.height - bottomMargin - 10;
    doc.save();
    doc.moveTo(leftMargin, footerY - 8).lineTo(pageWidth - rightMargin, footerY - 8).stroke(COLORS.line);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(text.footer, leftMargin, footerY, { width: contentWidth / 2, lineBreak: false });
    doc.text(`${text.page} ${page - pageRange.start + 1} ${text.of} ${pageRange.count}`, pageWidth - rightMargin - 100, footerY, { width: 100, align: 'right', lineBreak: false });
    doc.restore();
  }
  doc.end();
  return output;
};

const buildUkweziFilename = ({ accountName, year, month, periodType }) =>
  `Ukwezi-${safeFilePart(accountName)}-${year}-${String(month).padStart(2, '0')}-${safeFilePart(periodType)}.pdf`;

const buildUkweziResponseHeaders = ({ accountName, year, month, periodType }) => ({
  'Content-Type': 'application/pdf',
  'Content-Disposition': `attachment; filename="${buildUkweziFilename({ accountName, year, month, periodType })}"`,
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
});

module.exports = { renderUkweziPdf, buildUkweziFilename, buildUkweziResponseHeaders, getAccountingRows };
