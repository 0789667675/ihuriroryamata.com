const PDFDocument = require('pdfkit');
const fs = require('node:fs');
const path = require('node:path');
const { formatDateLabel, getLanguageDateLocale } = require('../i18n/date-format.js');

const LOGO_CANDIDATE_PATHS = [
  path.join(process.cwd(), 'public', 'brand-logo.png'),
  path.join(process.cwd(), 'public', 'logo.png'),
  path.join(process.cwd(), 'public', 'brand-logo-512.png'),
];

const BRAND_LOGO_PATH = LOGO_CANDIDATE_PATHS[0];

const resolveLogoPath = () => {
  for (const candidate of LOGO_CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
};

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
    dairyTitle: 'RAPORO Y\'UBWISHYU BW\'ABACUNDA',
    collectorTitle: 'URUTONDE RW\'UBWISHYU BUKORESHWA NA BANKI',
    accountDetails: 'IBIRANGA KONTI',
    notAvailable: 'Ntiboneka',
    validMilk: 'AMATA MEZA',
    validIntakeMilk: 'AMATA YAKIRIWE',
    grossAmount: 'AGACIRO MBISI',
    deductions: 'IBYAKUWEHO',
    adjustments: 'IMPINDUKA / IBYAKUWEHO',
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
    code: 'Kode',
    collectorName: 'Umucunda',
    phone: 'Telefone',
    validIntakeLiters: 'Amata Yakiriwe (L)',
    centerPricePerLiter: 'Igiciro / L',
    qualityLossAdjustments: 'Impinduka / Igihombo',
    accountOrPaymentMethod: 'Konti / Uburyo bwo Kwishyura',
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
    settlementTitle: 'IBYEREKEYE KWISHYURA NO GUSUBIZA INGUZANYO',
    awaitingPaymentTitle: 'ABOROZI BAKIRI BATEGERANYE UBUZIMA',
    awaitingPaymentAmount: 'Amafaranga ategereje',
    noAwaitingPayments: 'Nta mworozi ugifite amafaranga ategereje kwishyurwa muri iki gihe.',
    ledgerPreservedNote: 'Imbonerahamwe iri hejuru ikomeza kugaragaza ibaruramari ryose ry’igihe; uru rutonde rugaragaza asigaye gusa.',
    saccoInstructions: 'Kuri konti y\'umworozi',
    saccoConfirmed: 'Byemejwe kuri konti',
    cashApproved: 'Amafaranga yemejwe',
    cashReceived: 'Amafaranga yakiriwe',
    debtRepaid: 'Inguza yishyuwe',
    debtOutstanding: 'Inguza isigaye',
    retainedUnpaid: 'Badafite konti (Kuri Nyirayo)',
    unexplained: 'Itandukaniro ridasobanutse',
    ownerGrossCheck: 'Igenzura ry’agaciro ka nyirayo',
    nyirayoAuditTitle: 'IGENZURA RYA NYIRAYO',
    nyirayoRecordedMilkValue: 'Amata ya nyirayo',
    farmersRecordedMilkValue: 'Amata y’aborozi',
    nyirayoBaseDifference: 'Itandukaniro ry’ibanze',
    transportShare: 'Ubwikorezi (+)',
    farmerDeductionsShare: 'Ibyakuweho (+)',
    retainedNoAccountFarmerAmount: 'Aborozi badafite nimero ya konti (+)',
    nyirayoOperationalMargin: 'Inyungu y’imirimo',
    nyirayoTotalAfterOperations: 'Igiteranyo cya nyirayo',
    farmerAccountingTitle: 'AMAFARANGA Y\'ABOROZI AGOMBA KWISHYURWA',
    accountRoutedLabel: 'Aborozi bafite nimero ya konti',
    ownerListRoutedLabel: 'Aborozi badafite nimero ya konti (Kuri Konti ya Nyirayo)',
    legacyDebtWarning: 'Hari inyandiko za kera zo kwishyura inguzanyo zidafite itariki; umwenda usigaye nturuzura.',
    settlementUnavailable: 'Ihuza ry’ubwishyu ntiriboneka: hakenewe gukoresha migration 015 na 016. Ibaruramari ry’amata n’agaciro ka nyirayo ntibyahinduwe.',
    historicalTransport: 'Igiciro cy\'ubwikorezi cyo muri ayo matariki ntikiboneka kuri buri nyandiko.',
    bankReadyTitle: 'URUTONDE RW\'UBWISHYU BUKORESHWA NA BANKI',
    grandTotal: 'IGITERANYO CYOSE HAMWE',
    preparedBy: 'Yateguwe na',
    preparedByRole: 'Ushinzwe amakuru / Umucunda',
    reviewedBy: 'Yagenzuwe na',
    reviewedByRole: 'Umubaruzi Mukuru / Umugenzuzi',
    approvedBy: 'Yemejwe na',
    approvedByRole: 'Umuyobozi / Uhagarariye Ikigo',
    dairyDirector: 'Umuyobozi w\'Ikigo',
    dairyChiefAccountant: 'Umubaruzi Mukuru',
    dairyAuditor: 'Umugenzuzi w\'Imbere',
    signatureStamp: 'Umukono & Kashi',
    signatureDate: 'Itariki',
    ownerAccountSuffix: '(Kuri Konti ya Nyirayo)',
    footer: 'Milk System Technologies Ltd. | Ibaruramari ry\'Ukwezi',
    page: 'Urupapuro',
    of: 'kuri',
  },
  en: {
    title: 'UKWEZI ACCOUNTING',
    dairyTitle: 'ABACUNDA SETTLEMENT STATEMENT',
    collectorTitle: 'BANK-READY PAYMENT ROSTER',
    accountDetails: 'ACCOUNT DETAILS',
    notAvailable: 'Not available',
    validMilk: 'VALID MILK',
    validIntakeMilk: 'VALID INTAKE MILK',
    grossAmount: 'GROSS AMOUNT',
    deductions: 'DEDUCTIONS',
    adjustments: 'ADJUSTMENTS',
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
    code: 'Code',
    collectorName: 'Collector Name',
    phone: 'Phone',
    validIntakeLiters: 'Valid Liters (L)',
    centerPricePerLiter: 'Price / L',
    qualityLossAdjustments: 'Quality/Loss Adjustments',
    accountOrPaymentMethod: 'Account / Payment Method',
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
    settlementTitle: 'SETTLEMENT AND DEBT RECONCILIATION',
    awaitingPaymentTitle: 'FARMERS STILL AWAITING PAYMENT',
    awaitingPaymentAmount: 'Amount outstanding',
    noAwaitingPayments: 'No farmers have an outstanding payment for this period.',
    ledgerPreservedNote: 'The accounting table above remains the complete period ledger; this list shows only unpaid balances.',
    saccoInstructions: 'Farmers with accounts',
    saccoConfirmed: 'Confirmed to accounts',
    cashApproved: 'Cash approved',
    cashReceived: 'Cash received',
    debtRepaid: 'Debt repaid',
    debtOutstanding: 'Debt outstanding',
    retainedUnpaid: 'Farmers without accounts (Under Owner)',
    unexplained: 'Unexplained difference',
    ownerGrossCheck: 'Owner gross reconciliation',
    nyirayoAuditTitle: 'OWNER AUDIT BREAKDOWN',
    nyirayoRecordedMilkValue: 'Owner milk',
    farmersRecordedMilkValue: 'Farmers milk',
    nyirayoBaseDifference: 'Base difference',
    transportShare: 'Transport (+)',
    farmerDeductionsShare: 'Deductions (+)',
    retainedNoAccountFarmerAmount: 'Farmers without accounts (+)',
    nyirayoOperationalMargin: 'Operational balance',
    nyirayoTotalAfterOperations: 'Total owner allocation',
    farmerAccountingTitle: 'FARMER ACCOUNTING (PAYABLES)',
    accountRoutedLabel: 'Farmers with accounts',
    ownerListRoutedLabel: 'Farmers without accounts (Under Owner)',
    legacyDebtWarning: 'Some legacy debt repayments have no dates; outstanding debt is incomplete.',
    settlementUnavailable: 'Settlement reconciliation unavailable until migrations 015 and 016 are applied. Milk and owner-gross calculations are unchanged.',
    historicalTransport: 'Historical transport could not be established for every record in this period.',
    bankReadyTitle: 'BANK-READY PAYMENT ROSTER',
    grandTotal: 'GRAND TOTAL',
    preparedBy: 'Prepared by',
    preparedByRole: 'Data Officer / Collector',
    reviewedBy: 'Reviewed by',
    reviewedByRole: 'Chief Accountant / Internal Auditor',
    approvedBy: 'Approved by',
    approvedByRole: 'Center Manager / Legal Representative',
    dairyDirector: 'Center Director',
    dairyChiefAccountant: 'Chief Accountant',
    dairyAuditor: 'Internal Auditor',
    signatureStamp: 'Signature & Stamp',
    signatureDate: 'Date',
    ownerAccountSuffix: '(Under Owner Account)',
    footer: 'Milk System Technologies Ltd. | Ukwezi Accounting Report',
    page: 'Page',
    of: 'of',
  },
};

const getCopy = (language) => copy[language === 'en' ? 'en' : 'rw'];

const amount = (value, locale, notAvailable) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return notAvailable;
  }
  return Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const volume = (value, locale) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0.00';
  }
  return Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const periodName = (periodType, text) => periodType === 'first-half' ? text.firstHalf : periodType === 'second-half' ? text.secondHalf : text.monthly;

const displayDate = (value, language) => formatDateLabel(value, language, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

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

const getOutstandingSettlementRows = (report) => (report?.settlementAccounting?.farmers || [])
  .map((farmer) => {
    const saccoOutstanding = Math.max(0, Number(farmer.settlement?.saccoDistributionInstruction || 0));
    const retainedOutstanding = Math.max(0, Number(farmer.settlement?.retainedUnpaidAmount || 0));
    return {
      farmerId: farmer.farmerId,
      farmerName: farmer.farmerName || farmer.name || '—',
      saccoOutstanding,
      retainedOutstanding,
      outstandingAmount: Number((saccoOutstanding + retainedOutstanding).toFixed(2)),
    };
  })
  .filter((farmer) => farmer.outstandingAmount > 0.005);

const renderUkweziPdf = async ({ report, user, query, generatedAt = new Date() }) => {
  if (!report?.rangeStart || !report?.rangeEnd || !user?.id || !query?.periodType) {
    throw Object.assign(new Error('A valid account and accounting report are required.'), { statusCode: 400 });
  }

  const isCollector = user.accountType === 'COLLECTOR';
  const isDairy = user.accountType === 'COLLECTION_CENTER';
  const language = query.language === 'en' ? 'en' : 'rw';
  const text = getCopy(language);
  const locale = getLanguageDateLocale(language);
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
    const resolvedLogo = resolveLogoPath();
    if (resolvedLogo) {
      try {
        doc.image(resolvedLogo, leftMargin, 15, { fit: [38, 38] });
      } catch {
        // Brand logo asset unreadable. Render text-only header cleanly.
      }
    }
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(11)
      .text("IHURIRO RY'AMATA", leftMargin + 46, 20, { lineBreak: false });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text('Milk System Technologies Ltd.', leftMargin + 46, 36, { lineBreak: false });
    const titleText = isDairy ? text.dairyTitle : text.title;
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(14)
      .text(titleText, pageWidth - rightMargin - 320, 22, { width: 320, align: 'right', lineBreak: false });
    doc.restore();
    doc.y = 62;
  };
  drawPageHeader();
  doc.on('pageAdded', drawPageHeader);

  const ownerName = user.name || user.email || text.owner;
  const accountTypeName = isDairy ? text.collectionCenter : isCollector ? text.collector : text.otherAccount;
  const generatedText = formatDateLabel(generatedAt, language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    time: 'short',
  });
  const period = periodName(query.periodType, text);
  const centerName = typeof query.collectionCenter === 'string' ? query.collectionCenter.trim() : '';

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13).text(ownerName, { continued: true });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`  |  ${accountTypeName}`);
  if (isDairy && centerName) doc.text(`${text.collectionCenter}: ${centerName}`);
  doc.moveDown(0.3);
  doc.fontSize(9).text(`${text.period}: ${displayDate(report.rangeStart, locale)} – ${displayDate(report.rangeEnd, locale)} (${period})`);
  doc.text(`${text.generated}: ${generatedText}`);
  doc.moveDown(0.8);

  const centerPrice = Number(report.pricePerLiter ?? 400);
  const dairyValidLiters = Number(report.totalVolume ?? report.ownerGeneratedVolume ?? 0);
  const dairyGross = Number(report.totalRevenueMonth ?? report.ownerGeneratedGross ?? (dairyValidLiters * centerPrice));
  const dairyAdjustments = Number(report.totalDeductionsMonth ?? report.totalDeductions ?? 0);
  const dairyNet = Number(report.netRevenueMonth ?? (dairyGross - dairyAdjustments));

  const metrics = isDairy ? [
    { label: text.validIntakeMilk, value: `${volume(dairyValidLiters, locale)} L` },
    { label: text.grossAmount, value: `${amount(dairyGross, locale, text.notAvailable)} RWF` },
    { label: text.adjustments, value: `${amount(dairyAdjustments, locale, text.notAvailable)} RWF` },
    { label: text.netPayable, value: `${amount(dairyNet, locale, text.notAvailable)} RWF` },
  ] : [
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
      .text(`${text.reconciliation}: ${amount(report.collectorSurplusAmount, locale, text.notAvailable)} + ${amount(report.collectorFarmerDeductions, locale, text.notAvailable)} + ${amount(report.collectorFarmerTransport, locale, text.notAvailable)} = ${amount(report.collectorPayableFromBreakdown, locale, text.notAvailable)} RWF`, leftMargin, doc.y, { width: contentWidth });
    doc.moveDown(0.6);
  }
  if (isCollector && (report.collectorTransportIsComplete === false || rows.some((row) => row.transportIsComplete === false))) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text(text.historicalTransport, leftMargin, doc.y, { width: contentWidth });
    doc.moveDown(0.6);
  }

  // Dual-role column structure
  const columns = isDairy ? [
    { label: text.code, key: 'code', width: 44, align: 'center' },
    { label: text.collectorName, key: 'name', width: 145 },
    { label: text.phone, key: 'phone', width: 85 },
    { label: text.validIntakeLiters, key: 'volume', width: 75, align: 'right' },
    { label: text.centerPricePerLiter, key: 'price', width: 65, align: 'right' },
    { label: text.qualityLossAdjustments, key: 'adjustments', width: 85, align: 'right' },
    { label: text.netPayable, key: 'net', width: 95, align: 'right' },
    { label: text.accountOrPaymentMethod, key: 'method', width: 145 },
  ] : [
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

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(isDairy ? text.dairyTitle : text.accountDetails, leftMargin, doc.y);
  doc.moveDown(0.5);

  let displayRows = [];

  if (isDairy) {
    const rawDairyRows = (report.collectorSettlementRows && report.collectorSettlementRows.length)
      ? report.collectorSettlementRows
      : rows.filter((r) => !r.isOwner);

    displayRows = rawDairyRows.map((row, index) => {
      const code = String(row.collectorCode || row.code || `#${String(index + 1).padStart(3, '0')}`);
      const name = String(row.collectorName || row.name || 'Umucunda');
      const phone = String(row.phone || '—');
      const safeRowLiters = Number(row.validVolumeLiters ?? row.totalVolume ?? row.actualVolume ?? row.volumeLiters ?? 0);
      const safeRowPrice = Number(row.pricePerLiter ?? centerPrice ?? 400);
      const safeRowGross = Number(row.grossAmount ?? (safeRowLiters * safeRowPrice));
      const safeRowAdjustments = Number(row.adjustments ?? row.loss_adjustments ?? row.lossAdjustments ?? row.totalDeductions ?? 0);
      const safeRowNet = Number(row.netAmount ?? (safeRowGross - safeRowAdjustments));

      const liters = Number(safeRowLiters || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const rate = Number(safeRowPrice || 400).toLocaleString('en-US');
      const adj = Number(safeRowAdjustments || 0).toLocaleString('en-US');
      const net = Number(safeRowNet || 0).toLocaleString('en-US');
      const payMethod = String(row.accountNumber || [row.accountNumber, row.phone].filter(Boolean).join(' / ') || row.paymentMethod || 'Kuri Konti / Cash');

      return {
        code,
        name,
        phone,
        volume: liters,
        price: rate,
        adjustments: adj,
        net,
        method: payMethod,
        rawLiters: safeRowLiters,
        rawAdjustments: safeRowAdjustments,
        rawNet: safeRowNet,
      };
    });
  } else {
    // Collector Closed Bank Balance Identity: Individual verified accounts + Owner Account custodial line
    const hasVerifiedAccount = (row) => {
      if (row.isOwner) return true;
      const acc = String(row.accountNumber || '').trim().toUpperCase();
      if (acc && !['N/A', 'NA', '—', '-', 'NONE', 'NULL'].includes(acc) && acc.length >= 4) {
        return true;
      }
      if (row.settlement && Number(row.settlement.saccoDistributionInstruction || row.settlement.saccoEligiblePayable || 0) > 0) {
        return true;
      }
      return false;
    };

    const verifiedFarmerRows = rows.filter((row) => !row.isOwner && hasVerifiedAccount(row));

    const ownerRemainderAmount = report.nyirayoTotalWithOwnerList
      ?? (report.settlementAccounting?.ownerGrossReconciliation?.totalAfterOperations
      ?? (report.ownerSettlementRow?.netAmount ?? 0));

    const ownerRemainderRow = report.ownerSettlementRow ? {
      ...report.ownerSettlementRow,
      isOwner: true,
      farmerName: `${report.ownerSettlementRow.farmerName || report.ownerSettlementRow.name || ownerName} ${text.ownerAccountSuffix}`,
      name: `${report.ownerSettlementRow.name || ownerName} ${text.ownerAccountSuffix}`,
      netAmount: ownerRemainderAmount,
    } : (report.nyirayoTotalWithOwnerList != null ? {
      isOwner: true,
      farmerName: `${ownerName} ${text.ownerAccountSuffix}`,
      name: `${ownerName} ${text.ownerAccountSuffix}`,
      nationalId: user.nationalId || null,
      phone: user.phone || null,
      accountNumber: user.accountNumber || null,
      totalVolume: report.ownerGeneratedVolume ?? 0,
      pricePerLiter: report.pricePerLiter ?? null,
      grossAmount: report.ownerGeneratedGross ?? null,
      totalTransport: report.collectorFarmerTransport ?? 0,
      totalDeductions: report.collectorFarmerDeductions ?? 0,
      netAmount: ownerRemainderAmount,
    } : null);

    const collectorDisplayCandidates = ownerRemainderRow
      ? [...verifiedFarmerRows, ownerRemainderRow]
      : (verifiedFarmerRows.length ? verifiedFarmerRows : rows);

    displayRows = collectorDisplayCandidates.map((row, index) => {
      const safeRowLiters = Number(row.validVolumeLiters ?? row.totalVolume ?? row.actualVolume ?? row.volumeLiters ?? 0);
      const safeRowPrice = Number(row.pricePerLiter ?? centerPrice ?? 400);
      const safeRowGross = Number(row.grossAmount ?? (safeRowLiters * safeRowPrice));
      const safeRowNet = Number(row.netAmount ?? safeRowGross);

      return {
        number: String(index + 1),
        name: `${row.farmerName || row.name || '—'}${row.isOwner ? ` (${text.owner})` : ''}`,
        id: row.nationalId || row.idNumber || '—',
        count: row.assignedFarmerCount === undefined ? '—' : String(row.assignedFarmerCount),
        contact: [row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—',
        volume: volume(safeRowLiters, locale),
        price: row.pricePerLiter == null ? '—' : amount(safeRowPrice, locale, text.notAvailable),
        gross: row.grossAmount == null ? text.unpriced : amount(safeRowGross, locale, text.notAvailable),
        transport: amount(row.totalTransport, locale, text.notAvailable),
        deductions: amount(row.totalDeductions, locale, text.notAvailable),
        net: row.netAmount == null ? text.unpriced : amount(safeRowNet, locale, text.notAvailable),
        rawLiters: safeRowLiters,
        rawNet: safeRowNet,
      };
    });
  }

  if (displayRows.length) {
    drawTableHeader();
    displayRows.forEach((row, index) => {
      const fontSize = 7;
      const estimatedLines = columns.reduce((max, column) => {
        const value = String(row[column.key] ?? '');
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
        doc.text(String(row[column.key] ?? '—'), x + 4, y + 6, { width: column.width - 8, height: height - 10, align: column.align || 'left', ellipsis: true });
        x += column.width;
      });
      doc.restore();
      doc.y = y + height;
    });

    // Grand Total Row
    const totalRowHeight = 24;
    if (doc.y + totalRowHeight > doc.page.height - bottomMargin - 18) {
      doc.addPage();
      drawTableHeader();
    }
    const totalY = doc.y;
    doc.save();
    doc.rect(tableX, totalY, tableWidth, totalRowHeight).fill('#eaf4f8').stroke(COLORS.line);
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(7.5);
    doc.text(text.grandTotal, tableX + 8, totalY + 8, { width: columns[0].width + columns[1].width, lineBreak: false });

    // Total Volume
    const totalVolText = isDairy
      ? `${volume(dairyValidLiters, locale)} L`
      : `${volume(report.ownerGeneratedVolume ?? report.totalVolume, locale)} L`;

    let vx = tableX;
    for (const col of columns) {
      if (col.key === 'volume') {
        doc.text(totalVolText, vx + 4, totalY + 8, { width: col.width - 8, align: 'right', lineBreak: false });
        break;
      }
      vx += col.width;
    }

    // Grand Net Total
    const grandNetValue = isDairy
      ? dairyNet
      : (isCollector
        ? (report.collectorGross ?? report.totalRevenueMonth ?? report.ownerGeneratedGross)
        : (report.totalRevenueMonth ?? report.netRevenueMonth));

    const grandNetText = grandNetValue != null
      ? `${amount(grandNetValue, locale, text.notAvailable)} RWF`
      : `${amount(displayRows.reduce((sum, r) => sum + Number(r.rawNet || 0), 0), locale, text.notAvailable)} RWF`;

    let nx = tableX;
    for (const col of columns) {
      if (col.key === 'net') {
        doc.text(grandNetText, nx + 4, totalY + 8, { width: col.width - 8, align: 'right', lineBreak: false });
        break;
      }
      nx += col.width;
    }
    doc.restore();
    doc.y = totalY + totalRowHeight;
  } else {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(text.noRows, { width: contentWidth });
  }

  // Collector-only Settlement and Debt Reconciliation
  if (isCollector && report.settlementAccounting) {
    const settlement = report.settlementAccounting;
    if (doc.y + 125 > doc.page.height - bottomMargin - 18) doc.addPage();
    doc.moveDown(0.8);
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(text.settlementTitle, leftMargin, doc.y);
    doc.moveDown(0.4);
    const settlementLine = [
      `${text.saccoInstructions}: ${amount(settlement.saccoDistributionInstruction, locale, text.notAvailable)} RWF`,
      `${text.saccoConfirmed}: ${amount(settlement.saccoConfirmedAmount, locale, text.notAvailable)} RWF`,
      `${text.cashApproved}: ${amount(settlement.cashApprovedAmount, locale, text.notAvailable)} RWF`,
      `${text.cashReceived}: ${amount(settlement.cashConfirmedAmount, locale, text.notAvailable)} RWF`,
      `${text.debtRepaid}: ${amount(settlement.debtRepaymentAmount, locale, text.notAvailable)} RWF`,
      `${text.debtOutstanding}: ${settlement.debtBalancesComplete ? `${amount(settlement.outstandingDebt, locale, text.notAvailable)} RWF` : text.unpriced}`,
      `${text.retainedUnpaid}: ${amount(settlement.retainedUnpaidAmount, locale, text.notAvailable)} RWF`,
      `${text.unexplained}: ${amount(settlement.unexplainedDiscrepancy, locale, text.notAvailable)} RWF`,
    ].join('  |  ');
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(settlementLine, leftMargin, doc.y, { width: contentWidth });
    doc.moveDown(0.4);

    const grossCheck = settlement.ownerGrossReconciliation || {};
    const baseDiff = grossCheck.baseDifference ?? report.nyirayoBaseDifference ?? (grossCheck.ownerGross != null && grossCheck.farmerGross != null ? grossCheck.ownerGross - grossCheck.farmerGross : null);
    const transportVal = grossCheck.transportAmount ?? report.transportAmount ?? report.collectorFarmerTransport ?? 0;
    const deductionsVal = grossCheck.farmerDeductions ?? report.farmerDeductions ?? report.collectorFarmerDeductions ?? 0;
    const noAccountVal = grossCheck.retainedNoAccountFarmerAmount ?? report.retainedNoAccountFarmerAmount ?? (settlement ? settlement.retainedUnpaidAmount : 0);
    const opMargin = grossCheck.operationalMargin ?? report.nyirayoOperationalMargin ?? (baseDiff != null ? baseDiff + transportVal + deductionsVal : null);
    const totalAfterOp = grossCheck.totalAfterOperations ?? report.nyirayoTotalAfterOperations ?? (opMargin != null ? opMargin + noAccountVal : null);

    const nyirayoParts = [
      `${text.nyirayoRecordedMilkValue}: ${amount(grossCheck.ownerGross ?? report.nyirayoMilkValue ?? report.collectorGross, locale, text.notAvailable)} RWF`,
      `${text.farmersRecordedMilkValue}: ${amount(grossCheck.farmerGross ?? report.farmersMilkValue ?? report.collectorFarmerMilkValue, locale, text.notAvailable)} RWF`,
      `${text.nyirayoBaseDifference}: ${amount(baseDiff, locale, text.notAvailable)} RWF`,
      `${text.transportShare}: ${amount(transportVal, locale, text.notAvailable)} RWF`,
      `${text.farmerDeductionsShare}: ${amount(deductionsVal, locale, text.notAvailable)} RWF`,
      `${text.nyirayoOperationalMargin}: ${amount(opMargin, locale, text.notAvailable)} RWF`,
      `${text.retainedNoAccountFarmerAmount}: ${amount(noAccountVal, locale, text.notAvailable)} RWF`,
      `${text.nyirayoTotalAfterOperations}: ${amount(totalAfterOp, locale, text.notAvailable)} RWF`,
    ].join('  |  ');
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(
      `${text.ownerGrossCheck}: ${nyirayoParts}`,
      { width: contentWidth }
    );
    if (!settlement.debtBalancesComplete) {
      doc.moveDown(0.3);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(text.legacyDebtWarning, { width: contentWidth });
    }

    const outstandingRows = getOutstandingSettlementRows(report);
    const outstandingColumns = [
      { label: text.number, width: 30, align: 'right' },
      { label: text.farmerOwner, width: 220 },
      { label: text.awaitingPaymentAmount, width: 120, align: 'right' },
    ];
    const outstandingWidth = outstandingColumns.reduce((sum, column) => sum + column.width, 0);
    const outstandingX = leftMargin + Math.max(0, (contentWidth - outstandingWidth) / 2);
    const drawOutstandingHeading = () => {
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(text.awaitingPaymentTitle, leftMargin, doc.y);
      doc.moveDown(0.25);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(text.ledgerPreservedNote, leftMargin, doc.y, { width: contentWidth });
      doc.moveDown(0.4);
      if (!outstandingRows.length) {
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(text.noAwaitingPayments, leftMargin, doc.y, { width: contentWidth });
        return;
      }
      const headerY = doc.y;
      doc.save();
      doc.rect(outstandingX, headerY, outstandingWidth, 22).fill(COLORS.blue);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7);
      let columnX = outstandingX;
      outstandingColumns.forEach((column) => {
        doc.text(column.label, columnX + 4, headerY + 6, { width: column.width - 8, align: column.align || 'left', lineBreak: false, ellipsis: true });
        columnX += column.width;
      });
      doc.restore();
      doc.y = headerY + 22;
    };

    if (doc.y + 68 > doc.page.height - bottomMargin - 18) doc.addPage();
    doc.moveDown(0.8);
    drawOutstandingHeading();
    outstandingRows.forEach((farmer, index) => {
      if (doc.y + 22 > doc.page.height - bottomMargin - 18) {
        doc.addPage();
        drawOutstandingHeading();
      }
      if (!outstandingRows.length) return;
      const rowY = doc.y;
      doc.save();
      if (index % 2 === 1) doc.rect(outstandingX, rowY, outstandingWidth, 22).fill('#f4f8fa');
      doc.rect(outstandingX, rowY, outstandingWidth, 22).stroke(COLORS.line);
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(7);
      doc.text(String(index + 1), outstandingX + 4, rowY + 6, { width: outstandingColumns[0].width - 8, align: 'right', lineBreak: false });
      doc.text(farmer.farmerName, outstandingX + outstandingColumns[0].width + 4, rowY + 6, { width: outstandingColumns[1].width - 8, ellipsis: true, lineBreak: false });
      doc.text(`${amount(farmer.outstandingAmount, locale, text.notAvailable)} RWF`, outstandingX + outstandingColumns[0].width + outstandingColumns[1].width + 4, rowY + 6, { width: outstandingColumns[2].width - 8, align: 'right', lineBreak: false });
      doc.restore();
      doc.y = rowY + 22;
    });
  }

  if (isCollector && !report.settlementAccounting && report.settlementAccountingStatus === 'MIGRATION_REQUIRED') {
    if (doc.y + 36 > doc.page.height - bottomMargin - 18) doc.addPage();
    doc.moveDown(0.8);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(text.settlementUnavailable, leftMargin, doc.y, { width: contentWidth });
  }

  const drawBankEndorsements = () => {
    const endorsementHeight = 84;
    if (doc.y + endorsementHeight > doc.page.height - bottomMargin - 18) {
      doc.addPage();
    }
    doc.moveDown(0.6);
    const startY = doc.y;
    const blockGap = 10;
    const blockWidth = (contentWidth - blockGap * 2) / 3;

    const blocks = isDairy ? [
      {
        title: text.approvedBy,
        role: text.dairyDirector,
        stamp: true,
      },
      {
        title: text.reviewedBy,
        role: text.dairyChiefAccountant,
        stamp: false,
      },
      {
        title: text.preparedBy,
        role: text.dairyAuditor,
        stamp: false,
      },
    ] : [
      {
        title: text.preparedBy,
        role: text.preparedByRole,
        stamp: false,
      },
      {
        title: text.reviewedBy,
        role: text.reviewedByRole,
        stamp: false,
      },
      {
        title: text.approvedBy,
        role: text.approvedByRole,
        stamp: true,
      },
    ];

    blocks.forEach((block, i) => {
      const x = leftMargin + i * (blockWidth + blockGap);
      doc.save();
      doc.roundedRect(x, startY, blockWidth, endorsementHeight, 4).fillAndStroke('#fafcfe', COLORS.line);
      doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(7.5)
        .text(block.title, x + 8, startY + 7, { width: blockWidth - 16, lineBreak: false });
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(6.5)
        .text(block.role, x + 8, startY + 18, { width: blockWidth - 16, lineBreak: false });

      if (block.stamp) {
        doc.roundedRect(x + blockWidth - 58, startY + 24, 50, 32, 2).stroke('#cad9df');
        doc.fillColor('#9ab0bc').font('Helvetica').fontSize(5)
          .text(text.signatureStamp, x + blockWidth - 56, startY + 36, { width: 46, align: 'center' });
      }

      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(6.5)
        .text('Amazina / Name: .....................................', x + 8, startY + 36, { lineBreak: false });
      doc.text('Umukono / Sign: .....................................', x + 8, startY + 50, { lineBreak: false });
      doc.text(`${text.signatureDate}: ...... / ...... / 20......`, x + 8, startY + 64, { lineBreak: false });
      doc.restore();
    });
    doc.y = startY + endorsementHeight + 8;
  };

  drawBankEndorsements();

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

module.exports = { renderUkweziPdf, buildUkweziFilename, buildUkweziResponseHeaders, getAccountingRows, getOutstandingSettlementRows, BRAND_LOGO_PATH };
