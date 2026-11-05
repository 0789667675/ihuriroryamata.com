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
    farmerFullName: "Amazina yombi y'umworozi",
    accountNumber: 'Nimero ya konti',
    nationalIdNumber: "Nomero y'indangamuntu",
    telephone: 'Telefone',
    milkLiters: 'Ingano y’amata (L)',
    pricePerLiterColumn: 'Igiciro kuri litiro',
    grossTotal: 'Igiciro cya byose',
    paymentAmount: 'Amafaranga yishyurwa',
    otherDeductions: 'Ibipande n’ibindi',
    ejoheza: 'FRW ya Ejoheza',
    ejohezaNoRecords: 'Nta mafaranga ya Ejoheza yanditswe muri iyi raporo; hagaragara 0 RWF aho bikenewe.',
    deductionsTotal: 'Igiteranyo cy’ayakaswe',
    farmerPaid: 'Amafaranga umworozi ahembwe',
    signedFarmerNet: 'Neto y’aborozi mbere yo gukata hasi',
    negativeFarmerNet: 'Igiteranyo cya neto mbi',
    farmerRouteTotal: 'Amafaranga y’aborozi yanyuze mu nzira z’ubwishyu',
    distributionTotal: 'Igiteranyo cy’amafaranga agabanywa',
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
    nyirayoAuditTitle: 'IBARURAMARI RYA NYIRAYO',
    nyirayoRecordedMilkValue: 'Amata ya nyirayo',
    farmersRecordedMilkValue: 'Amata y’aborozi',
    nyirayoBaseDifference: 'Itandukaniro ry’ibanze',
    transportShare: 'Ubwikorezi (+)',
    farmerDeductionsShare: 'Ibyakuweho (+)',
    retainedNoAccountFarmerAmount: 'Aborozi badafite nimero ya konti (+)',
    nyirayoOperationalMargin: 'Amafaranga y’akazi ka Nyirayo',
    nyirayoTotalAfterOperations: 'Igiteranyo cya nyuma cya Nyirayo',
    verificationDifference: 'Itandukaniro ryo kugenzura',
    farmerAccountingTitle: 'AMAFARANGA Y\'ABOROZI AGOMBA KWISHYURWA',
    collectorFarmersTitle: 'ABOROZI BEMEREWE KU MUCUNDA',
    collectorFarmersNote: 'Aborozi bagaragazwa hano ni abafite amata yemejwe muri iki gihe gusa; ibiciro n\'ibyakuweho ni ibyo muri icyo gihe.',
    accountRoutedLabel: 'Aborozi bafite nimero ya konti',
    ownerListRoutedLabel: 'Aborozi badafite nimero ya konti (Kuri Konti ya Nyirayo)',
    ownerPaymentLine: 'Amafaranga anyuzwa kuri konti ya Nyirayo, harimo igiteranyo cy’abadafite konti',
    noAccountAggregate: 'Igiteranyo cy’amafaranga agenewe aborozi badafite konti',
    legacyDebtWarning: 'Hari inyandiko za kera zo kwishyura inguzanyo zidafite itariki; umwenda usigaye nturuzura.',
    settlementUnavailable: 'Ihuza ry’ubwishyu ntiriboneka: hakenewe gukoresha migrations 015, 016 na 030. Ibaruramari ry’amata n’agaciro ka nyirayo ntibyahinduwe.',
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
    farmerFullName: 'Farmer full name',
    accountNumber: 'Account number',
    nationalIdNumber: 'National ID number',
    telephone: 'Telephone',
    milkLiters: 'Milk quantity (L)',
    pricePerLiterColumn: 'Price per liter',
    grossTotal: 'Gross value',
    paymentAmount: 'Amount payable',
    otherDeductions: 'Igipande and other deductions',
    ejoheza: 'Ejoheza (RWF)',
    ejohezaNoRecords: 'No Ejoheza amount is recorded in this report; 0 RWF is shown where applicable.',
    deductionsTotal: 'Total deductions',
    farmerPaid: 'Farmer paid',
    signedFarmerNet: 'Signed farmer net before zero-floor routing',
    negativeFarmerNet: 'Total negative farmer net',
    farmerRouteTotal: 'Farmer amount assigned to payment routes',
    distributionTotal: 'Total payment distribution',
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
    nyirayoAuditTitle: 'OWNER ACCOUNTING SUMMARY',
    nyirayoRecordedMilkValue: 'Owner milk',
    farmersRecordedMilkValue: 'Farmers milk',
    nyirayoBaseDifference: 'Base difference',
    transportShare: 'Transport (+)',
    farmerDeductionsShare: 'Deductions (+)',
    retainedNoAccountFarmerAmount: 'Farmers without accounts (+)',
    nyirayoOperationalMargin: 'Owner work income',
    nyirayoTotalAfterOperations: 'Final owner total',
    verificationDifference: 'Reconciliation difference',
    farmerAccountingTitle: 'FARMER ACCOUNTING (PAYABLES)',
    collectorFarmersTitle: 'ELIGIBLE FARMERS BY COLLECTOR',
    collectorFarmersNote: 'Only farmers with valid milk in this period are listed; prices and deductions are the historical period values.',
    accountRoutedLabel: 'Farmers with accounts',
    ownerListRoutedLabel: 'Farmers without accounts (Under Owner)',
    ownerPaymentLine: "Owner's payment line, including the total routed for farmers without accounts",
    noAccountAggregate: 'Aggregate payable for farmers without accounts',
    legacyDebtWarning: 'Some legacy debt repayments have no dates; outstanding debt is incomplete.',
    settlementUnavailable: 'Settlement reconciliation unavailable until migrations 015, 016, and 030 are applied. Milk and owner-gross calculations are unchanged.',
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

const hasPaymentAccount = (farmer) => {
  const account = String(farmer?.accountNumber ?? farmer?.account_number ?? '').trim();
  return account.length >= 4 && !['N/A', 'NA', '—', '-', 'NONE', 'NULL'].includes(account.toUpperCase());
};

const getFarmerPaymentAmount = (farmer) => {
  const settlement = farmer?.settlement;
  const routeKey = hasPaymentAccount(farmer) ? 'saccoDistributionInstruction' : 'retainedUnpaidAmount';
  const hasRouteInstruction = settlement && Object.prototype.hasOwnProperty.call(settlement, routeKey);
  const amountValue = hasRouteInstruction
    ? settlement[routeKey]
    : (farmer?.netAmount != null
      ? Number(farmer.netAmount) - Number(settlement?.debtRepaymentAmount || 0)
        - Number(settlement?.cashConfirmedAmount || 0)
        - Number(settlement?.saccoConfirmedAmount || 0)
      : null);
  if (amountValue === null || amountValue === undefined) return null;
  const payable = Number(amountValue);
  return Number.isFinite(payable) ? Math.max(0, payable) : null;
};

const getFarmerPaymentRow = (farmer, index, locale) => {
  const liters = Number(farmer?.validVolumeLiters ?? farmer?.totalVolume ?? farmer?.volumeLiters ?? 0);
  const gross = farmer?.grossAmount == null ? null : Number(farmer.grossAmount);
  const ejoheza = farmer?.ejohezaDeductions == null ? 0 : Number(farmer.ejohezaDeductions);
  const deductions = farmer?.totalDeductions == null ? null : Number(farmer.totalDeductions);
  const transport = farmer?.totalTransport == null ? null : Number(farmer.totalTransport);
  const otherDeductions = deductions == null ? null : Math.max(0, deductions - ejoheza);
  const price = farmer?.pricePerLiter == null ? null : Number(farmer.pricePerLiter);
  const formatAmount = (value) => value == null ? '—' : `${amount(value, locale, '—')} RWF`;
  const paymentAmount = farmer?.paymentAmount == null ? null : Number(farmer.paymentAmount);

  return {
    number: String(index + 1),
    name: String(farmer?.farmerName || farmer?.name || '—'),
    nationalId: String(farmer?.nationalId || farmer?.idNumber || '—'),
    phone: String(farmer?.phone || '—'),
    accountNumber: String(farmer?.accountNumber || '—'),
    liters: `${volume(liters, locale)} L`,
    price: price == null ? '—' : `${amount(price, locale, '—')} RWF/L`,
    gross: formatAmount(gross),
    transport: formatAmount(transport),
    otherDeductions: formatAmount(otherDeductions),
    ejoheza: formatAmount(ejoheza),
    deductions: formatAmount(deductions),
    net: formatAmount(paymentAmount),
    rawLiters: liters,
    rawGross: gross,
    rawTransport: transport,
    rawOtherDeductions: otherDeductions,
    rawEjoheza: ejoheza,
    rawDeductions: deductions,
    rawPaymentAmount: paymentAmount,
    rawPrice: price,
  };
};

const getEligibleFarmerPaymentGroups = (report) => {
  const farmers = (report?.farmerPayments || [])
    .filter((farmer) => Number(farmer?.validVolumeLiters ?? farmer?.totalVolume ?? 0) > 0)
    .map((farmer) => ({ ...farmer, paymentAmount: getFarmerPaymentAmount(farmer) }))
  return {
    withAccount: farmers.filter(hasPaymentAccount),
    withoutAccount: farmers.filter((farmer) => !hasPaymentAccount(farmer)),
  };
};

const getOwnerAccountingSummary = (report) => {
  const reconciliation = report?.settlementAccounting?.ownerGrossReconciliation || {};
  const ownerMilkValue = reconciliation.ownerGross ?? report?.nyirayoMilkValue ?? report?.ownerGeneratedGross ?? report?.collectorGross ?? null;
  const farmersMilkValue = reconciliation.farmerGross ?? report?.farmersMilkValue ?? report?.collectorFarmerMilkValue ?? null;
  const initialDifference = reconciliation.baseDifference ?? report?.nyirayoBaseDifference
    ?? (ownerMilkValue !== null && farmersMilkValue !== null ? Number(ownerMilkValue) - Number(farmersMilkValue) : null);
  const transport = reconciliation.transportAmount ?? report?.transportAmount ?? report?.collectorFarmerTransport ?? null;
  const deductions = reconciliation.farmerDeductions ?? report?.farmerDeductions ?? report?.collectorFarmerDeductions ?? null;
  const noAccountAmount = reconciliation.retainedNoAccountFarmerAmount ?? report?.retainedNoAccountFarmerAmount ?? null;
  const workIncome = reconciliation.operationalMargin ?? report?.nyirayoOperationalMargin
    ?? (initialDifference !== null && transport !== null && deductions !== null
      ? Number(initialDifference) + Number(transport) + Number(deductions)
      : null);
  const finalOwnerTotal = reconciliation.totalAfterOperations ?? report?.nyirayoTotalWithOwnerList ?? report?.nyirayoTotalAfterOperations
    ?? (workIncome !== null && noAccountAmount !== null ? Number(workIncome) + Number(noAccountAmount) : null);
  return { ownerMilkValue, farmersMilkValue, initialDifference, transport, deductions, noAccountAmount, workIncome, finalOwnerTotal };
};

// The Collection Center report is grouped by Collector. `collectorSettlementRows`
// already contains only farmers that passed the authoritative Ukwezi eligibility
// rule (valid volume > 0 in the period); this helper keeps that contract explicit
// and filters defensively before the PDF writes any farmer detail.
const getCollectorFarmerGroups = (report) => {
  const groups = [];
  for (const collector of report?.collectorSettlementRows || []) {
    const farmers = (Array.isArray(collector?.farmers) ? collector.farmers : [])
      .filter((farmer) => {
        const validVolume = Number(farmer?.validVolumeLiters ?? farmer?.totalVolume ?? farmer?.volumeLiters ?? 0);
        const netPayable = Number(farmer?.netAmount ?? (Number(farmer?.grossAmount || 0) - Number(farmer?.totalTransport || 0) - Number(farmer?.totalDeductions || 0)));
        return validVolume > 0 && Number.isFinite(netPayable) && netPayable > 0.005;
      });
    if (!farmers.length) continue;
    groups.push({
      collectorUserId: collector.collectorUserId ?? null,
      code: collector.collectorCode || collector.code || null,
      name: collector.collectorName || collector.name || 'Umucunda',
      farmers,
    });
  }
  return groups;
};

const renderUkweziPdf = async ({ report, user, query, generatedAt = new Date() }) => {
  if (!report?.rangeStart || !report?.rangeEnd || !user?.id || !query?.periodType) {
    throw Object.assign(new Error('A valid account and accounting report are required.'), { statusCode: 400 });
  }

  const isCollector = user.accountType === 'COLLECTOR';
  const isDairy = user.accountType === 'COLLECTION_CENTER';
  const collectorPaymentGroups = isCollector ? getEligibleFarmerPaymentGroups(report) : { withAccount: [], withoutAccount: [] };
  const ownerAccounting = isCollector ? getOwnerAccountingSummary(report) : null;
  const accountPayableTotal = collectorPaymentGroups.withAccount.every((farmer) => farmer.paymentAmount !== null)
    ? collectorPaymentGroups.withAccount.reduce((sum, farmer) => sum + farmer.paymentAmount, 0)
    : null;
  const ownerRoutedFarmerTotal = collectorPaymentGroups.withoutAccount.every((farmer) => farmer.paymentAmount !== null)
    ? collectorPaymentGroups.withoutAccount.reduce((sum, farmer) => sum + farmer.paymentAmount, 0)
    : null;
  const farmerPaymentRouteTotal = accountPayableTotal === null || ownerRoutedFarmerTotal === null
    ? null
    : Number((accountPayableTotal + ownerRoutedFarmerTotal).toFixed(2));
  const reconciliationDifference = !ownerAccounting || ownerAccounting.ownerMilkValue == null || ownerAccounting.finalOwnerTotal == null
    || accountPayableTotal === null
      ? null
      : Number((Number(ownerAccounting.ownerMilkValue) - Number(ownerAccounting.finalOwnerTotal) - accountPayableTotal).toFixed(2));
  const language = query.language === 'en' ? 'en' : 'rw';
  const text = getCopy(language);
  const locale = getLanguageDateLocale(language);
  const rows = getAccountingRows({ report, isCollector, isDairy });
  const doc = new PDFDocument({ size: isCollector ? 'A3' : 'A4', layout: 'landscape', margin: 34, bufferPages: true });
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
  ] : isCollector ? [
    {
      label: text.nyirayoRecordedMilkValue,
      value: `${report.ownerGeneratedVolume == null ? text.notAvailable : `${volume(report.ownerGeneratedVolume, locale)} L`} / ${amount(ownerAccounting.ownerMilkValue, locale, text.notAvailable)} RWF`,
    },
    {
      label: text.farmersRecordedMilkValue,
      value: `${report.collectorFarmersValidLiters == null ? text.notAvailable : `${volume(report.collectorFarmersValidLiters, locale)} L`} / ${amount(ownerAccounting.farmersMilkValue, locale, text.notAvailable)} RWF`,
    },
    { label: text.transportShare, value: `${amount(ownerAccounting.transport, locale, text.notAvailable)} RWF` },
    { label: text.farmerDeductionsShare, value: `${amount(ownerAccounting.deductions, locale, text.notAvailable)} RWF` },
  ] : [
    { label: text.validMilk, value: `${volume(report.ownerGeneratedVolume ?? report.totalVolume, locale)} L` },
    { label: text.grossAmount, value: report.ownerGeneratedGross == null && isCollector ? text.unpriced : `${amount(report.ownerGeneratedGross ?? report.totalRevenueMonth, locale, text.notAvailable)} RWF` },
    { label: text.deductions, value: `${amount(report.totalDeductionsMonth, locale, text.notAvailable)} RWF` },
    ...(isCollector ? [{ label: text.transport, value: `${amount(report.collectorFarmerTransport, locale, text.notAvailable)} RWF` }] : []),
    { label: text.netPayable, value: (isCollector ? report.collectorPayable : report.netRevenueMonth) == null ? text.unpriced : `${amount(isCollector ? report.collectorPayable : report.netRevenueMonth, locale, text.notAvailable)} RWF` },
  ];

  if (metrics.length) {
    const metricGap = 8;
    const metricWidth = (contentWidth - metricGap * (metrics.length - 1)) / metrics.length;
    const metricY = doc.y;
    metrics.forEach((metric, index) => {
      const x = leftMargin + index * (metricWidth + metricGap);
      doc.save();
      const metricHeight = isCollector ? 56 : 48;
      doc.roundedRect(x, metricY, metricWidth, metricHeight, 4).fill(COLORS.bluePale).stroke(COLORS.line);
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7).text(metric.label, x + 8, metricY + 7, { width: metricWidth - 16, lineBreak: false });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(isCollector ? 8.5 : 10).text(metric.value, x + 8, metricY + 22, { width: metricWidth - 16, lineGap: 0.5 });
      doc.restore();
    });
    doc.y = metricY + (isCollector ? 70 : 62);
  }

  if (isCollector) {
    const accountingRows = [
      [text.nyirayoRecordedMilkValue, ownerAccounting.ownerMilkValue],
      [text.farmersRecordedMilkValue, ownerAccounting.farmersMilkValue],
      [text.nyirayoBaseDifference, ownerAccounting.initialDifference],
      [text.transportShare, ownerAccounting.transport],
      [text.farmerDeductionsShare, ownerAccounting.deductions],
      [text.nyirayoOperationalMargin, ownerAccounting.workIncome],
      [text.noAccountAggregate, ownerAccounting.noAccountAmount],
      [text.ownerPaymentLine, ownerAccounting.finalOwnerTotal],
      [text.signedFarmerNet, report.settlementAccounting?.signedFarmerNetBalance ?? null],
      [text.negativeFarmerNet, report.settlementAccounting?.negativeFarmerNetBalance ?? null],
      [text.farmerRouteTotal, farmerPaymentRouteTotal],
      [text.accountRoutedLabel, accountPayableTotal],
      [text.distributionTotal, ownerAccounting.finalOwnerTotal === null || accountPayableTotal === null ? null : Number(ownerAccounting.finalOwnerTotal) + accountPayableTotal],
      [text.verificationDifference, reconciliationDifference],
    ];
    const summaryY = doc.y;
    const summaryRowHeight = 17;
    const summaryHeight = 30 + Math.ceil(accountingRows.length / 2) * summaryRowHeight;
    if (summaryY + summaryHeight > doc.page.height - bottomMargin - 18) doc.addPage();
    const boxY = doc.y;
    doc.save();
    doc.roundedRect(leftMargin, boxY, contentWidth, summaryHeight, 4).fillAndStroke('#f7fafb', COLORS.line);
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(9)
      .text(text.nyirayoAuditTitle, leftMargin + 9, boxY + 7, { width: contentWidth - 18, lineBreak: false });
    accountingRows.forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = leftMargin + 9 + column * (contentWidth / 2);
      const y = boxY + 24 + row * summaryRowHeight;
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
        .text(`${label}: ${amount(value, locale, text.notAvailable)} RWF`, x, y, { width: contentWidth / 2 - 18, lineBreak: false, ellipsis: true });
    });
    doc.restore();
    doc.y = boxY + summaryHeight + 10;
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
  ] : isCollector ? [
    { label: text.number, key: 'number', width: 32, align: 'right' },
    { label: text.farmerFullName, key: 'name', width: 148 },
    { label: text.nationalIdNumber, key: 'nationalId', width: 100 },
    { label: text.telephone, key: 'phone', width: 75 },
    { label: text.accountNumber, key: 'accountNumber', width: 105 },
    { label: text.milkLiters, key: 'liters', width: 64, align: 'right' },
    { label: text.pricePerLiterColumn, key: 'price', width: 76, align: 'right' },
    { label: text.grossTotal, key: 'gross', width: 85, align: 'right' },
    { label: text.transport, key: 'transport', width: 78, align: 'right' },
    { label: text.otherDeductions, key: 'otherDeductions', width: 78, align: 'right' },
    { label: text.ejoheza, key: 'ejoheza', width: 67, align: 'right' },
    { label: text.deductionsTotal, key: 'deductions', width: 86, align: 'right' },
    { label: text.farmerPaid, key: 'net', width: 92, align: 'right' },
  ] : [
    { label: text.number, key: 'number', width: 28, align: 'right' },
    { label: text.farmerOwner, key: 'name', width: 260 },
    { label: text.accountNumber, key: 'accountNumber', width: 190 },
    { label: text.paymentAmount, key: 'net', width: 130, align: 'right' },
  ];

  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const tableX = leftMargin + Math.max(0, (contentWidth - tableWidth) / 2);
  const tableHeaderHeight = isCollector ? 42 : 24;

  const drawTableHeader = () => {
    const y = doc.y;
    doc.save();
    doc.rect(tableX, y, tableWidth, tableHeaderHeight).fill(COLORS.blue);
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(isCollector ? 7 : 7);
    let x = tableX;
    columns.forEach((column) => {
      doc.text(column.label, x + 4, y + (isCollector ? 4 : 7), {
        width: column.width - 8,
        height: tableHeaderHeight - 6,
        align: column.align || 'left',
        lineGap: 0.5,
      });
      x += column.width;
    });
    doc.restore();
    doc.y = y + tableHeaderHeight;
  };

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(isDairy ? text.dairyTitle : text.accountRoutedLabel, leftMargin, doc.y);
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
      const safeRowGross = row.grossAmount == null ? null : Number(row.grossAmount);
      const safeRowAdjustments = Number(row.adjustments ?? row.loss_adjustments ?? row.lossAdjustments ?? row.totalDeductions ?? 0);
      const safeRowNet = row.netAmount == null ? null : Number(row.netAmount);

      const liters = Number(safeRowLiters || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const rate = Number(safeRowPrice || 400).toLocaleString('en-US');
      const adj = Number(safeRowAdjustments || 0).toLocaleString('en-US');
      const net = safeRowNet == null ? text.unpriced : Number(safeRowNet || 0).toLocaleString('en-US');
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
    displayRows = collectorPaymentGroups.withAccount.map((farmer, index) => getFarmerPaymentRow(farmer, index, locale));
  }

  if (displayRows.length) {
    drawTableHeader();
    displayRows.forEach((row, index) => {
      const fontSize = isCollector ? 7.2 : 7;
      const estimatedHeight = isCollector
        ? columns.reduce((max, column) => Math.max(max, doc.heightOfString(String(row[column.key] ?? '—'), {
          width: column.width - 8,
          font: 'Helvetica',
          fontSize,
          lineGap: 0.5,
        })), 0)
        : 14;
      const height = Math.max(isCollector ? 20 : 28, estimatedHeight + (isCollector ? 8 : 10));
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
        doc.text(String(row[column.key] ?? '—'), x + 4, y + (isCollector ? 4 : 6), {
          width: column.width - 8,
          align: column.align || 'left',
          lineGap: 0.5,
          ellipsis: !isCollector,
        });
        x += column.width;
      });
      doc.restore();
      doc.y = y + height;
    });

    // Grand Total Row
    const totalRowHeight = isCollector ? 32 : 24;
    if (doc.y + totalRowHeight > doc.page.height - bottomMargin - 18) {
      doc.addPage();
      drawTableHeader();
    }
    const totalY = doc.y;
    doc.save();
    doc.rect(tableX, totalY, tableWidth, totalRowHeight).fill('#eaf4f8').stroke(COLORS.line);
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(isCollector ? 7.2 : 7.5);
    if (isCollector) {
      const sumRows = (key) => displayRows.every((row) => row[key] !== null)
        ? displayRows.reduce((sum, row) => sum + Number(row[key] || 0), 0)
        : null;
      const totalValues = {
        liters: `${volume(sumRows('rawLiters') || 0, locale)} L`,
        price: sumRows('rawLiters') && sumRows('rawGross') !== null
          ? `${amount(Number(sumRows('rawGross')) / Number(sumRows('rawLiters')), locale, text.notAvailable)} RWF/L`
          : '—',
        gross: `${amount(sumRows('rawGross'), locale, text.notAvailable)} RWF`,
        transport: `${amount(sumRows('rawTransport'), locale, text.notAvailable)} RWF`,
        otherDeductions: `${amount(sumRows('rawOtherDeductions'), locale, text.notAvailable)} RWF`,
        ejoheza: `${amount(sumRows('rawEjoheza'), locale, text.notAvailable)} RWF`,
        deductions: `${amount(sumRows('rawDeductions'), locale, text.notAvailable)} RWF`,
        net: `${amount(sumRows('rawPaymentAmount'), locale, text.notAvailable)} RWF`,
      };
      doc.text(text.grandTotal, tableX + 4, totalY + 8, {
        width: columns.slice(0, 5).reduce((sum, column) => sum + column.width, 0) - 8,
      });
      let x = tableX + columns.slice(0, 5).reduce((sum, column) => sum + column.width, 0);
      columns.slice(5).forEach((column) => {
        doc.text(totalValues[column.key] || '—', x + 3, totalY + 8, {
          width: column.width - 6,
          align: column.align || 'right',
          lineBreak: false,
        });
        x += column.width;
      });
    } else {
      doc.text(text.grandTotal, tableX + 8, totalY + 8, { width: columns[0].width + columns[1].width, lineBreak: false });

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

      const grandNetValue = isDairy
        ? dairyNet
        : (report.totalRevenueMonth ?? report.netRevenueMonth);
      const grandNetText = grandNetValue != null
        ? `${amount(grandNetValue, locale, text.notAvailable)} RWF`
        : `${amount(displayRows.reduce((sum, row) => sum + Number(row.rawNet || 0), 0), locale, text.notAvailable)} RWF`;
      let nx = tableX;
      for (const col of columns) {
        if (col.key === 'net') {
          doc.text(grandNetText, nx + 4, totalY + 8, { width: col.width - 8, align: 'right', lineBreak: false });
          break;
        }
        nx += col.width;
      }
    }
    doc.restore();
    doc.y = totalY + totalRowHeight;
  } else {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(text.noRows, { width: contentWidth });
  }

  if (isCollector) {
    const ownerNameForPayment = report.ownerSettlementRow?.farmerName || report.ownerSettlementRow?.name || ownerName;
    const ownerAccountNumberForPayment = report.ownerSettlementRow?.accountNumber || user.accountNumber || '—';
    doc.moveDown(0.35);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(text.ejohezaNoRecords, tableX, doc.y, { width: tableWidth });
    doc.moveDown(0.45);
    if (doc.y + 46 > doc.page.height - bottomMargin - 18) doc.addPage();
    doc.moveDown(0.4);
    const ownerEntryY = doc.y;
    doc.save();
    doc.roundedRect(tableX, ownerEntryY, tableWidth, 42, 3).fillAndStroke(COLORS.bluePale, COLORS.line);
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(8)
      .text(text.ownerPaymentLine, tableX + 7, ownerEntryY + 6, { width: tableWidth - 220, lineBreak: false, ellipsis: true });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(`${ownerNameForPayment} · ${text.accountNumber}: ${ownerAccountNumberForPayment}`, tableX + 7, ownerEntryY + 21, { width: tableWidth - 220, lineBreak: false, ellipsis: true });
    doc.fillColor(COLORS.blueDark).font('Helvetica-Bold').fontSize(8)
      .text(`${amount(ownerAccounting?.finalOwnerTotal, locale, text.notAvailable)} RWF`, tableX + tableWidth - 200, ownerEntryY + 14, { width: 190, align: 'right', lineBreak: false });
    doc.restore();
    doc.y = ownerEntryY + 50;
  }

  // Collection Center reports include only the farmers that passed the
  // authoritative Ukwezi eligibility rule, grouped under their Collector.
  const collectorFarmerGroups = isDairy ? getCollectorFarmerGroups(report) : [];
  if (collectorFarmerGroups.length) {
    const detailColumns = [
      { label: text.number, key: 'number', width: 24, align: 'right' },
      { label: text.farmerOwner, key: 'name', width: 150 },
      { label: text.nationalId, key: 'id', width: 85 },
      { label: text.phoneAccount, key: 'contact', width: 120 },
      { label: text.milk, key: 'volume', width: 65, align: 'right' },
      { label: text.pricePerLiter, key: 'price', width: 55, align: 'right' },
      { label: text.grossRwf, key: 'gross', width: 80, align: 'right' },
      { label: text.totalDeductions, key: 'deductions', width: 75, align: 'right' },
      { label: text.net, key: 'net', width: 90, align: 'right' },
    ];
    const detailWidth = detailColumns.reduce((sum, column) => sum + column.width, 0);
    const detailX = leftMargin + Math.max(0, (contentWidth - detailWidth) / 2);
    const detailRowHeight = 20;

    const drawDetailHeader = () => {
      const y = doc.y;
      doc.save();
      doc.rect(detailX, y, detailWidth, detailRowHeight).fill(COLORS.blue);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(6.5);
      let x = detailX;
      detailColumns.forEach((column) => {
        doc.text(column.label, x + 3, y + 6, { width: column.width - 6, align: column.align || 'left', lineBreak: false });
        x += column.width;
      });
      doc.restore();
      doc.y = y + detailRowHeight;
    };

    const drawCollectorGroupLabel = (group) => {
      const groupCode = group.code ? `${group.code} · ` : '';
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
        .text(`${groupCode}${group.name} (${group.farmers.length} ${text.assignedFarmers})`, leftMargin, doc.y, { width: contentWidth });
      doc.moveDown(0.25);
    };

    if (doc.y + 54 > doc.page.height - bottomMargin - 18) doc.addPage();
    doc.moveDown(0.8);
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(text.collectorFarmersTitle, leftMargin, doc.y);
    doc.moveDown(0.2);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(text.collectorFarmersNote, leftMargin, doc.y, { width: contentWidth });
    doc.moveDown(0.5);

    collectorFarmerGroups.forEach((group) => {
      if (doc.y + detailRowHeight * 3 > doc.page.height - bottomMargin - 18) doc.addPage();
      drawCollectorGroupLabel(group);
      drawDetailHeader();
      group.farmers.forEach((farmer, index) => {
        if (doc.y + detailRowHeight > doc.page.height - bottomMargin - 18) {
          doc.addPage();
          drawCollectorGroupLabel(group);
          drawDetailHeader();
        }
        const farmerLiters = Number(farmer.validVolumeLiters ?? farmer.totalVolume ?? farmer.volumeLiters ?? 0);
        const farmerPrice = farmer.pricePerLiter == null ? null : Number(farmer.pricePerLiter);
        const farmerGross = farmer.grossAmount == null ? null : Number(farmer.grossAmount);
        const farmerDeductions = Number(farmer.totalDeductions ?? farmer.lossAdjustments ?? 0);
        const farmerNet = farmer.netAmount == null ? null : Number(farmer.netAmount);
        const row = {
          number: String(index + 1),
          name: String(farmer.farmerName || farmer.name || '—'),
          id: String(farmer.nationalId || farmer.idNumber || '—'),
          contact: [farmer.phone, farmer.accountNumber].filter(Boolean).join(' / ') || '—',
          volume: volume(farmerLiters, locale),
          price: farmerPrice == null ? '—' : amount(farmerPrice, locale, text.notAvailable),
          gross: farmerGross == null ? text.unpriced : amount(farmerGross, locale, text.notAvailable),
          deductions: amount(farmerDeductions, locale, text.notAvailable),
          net: farmerNet == null ? text.unpriced : amount(farmerNet, locale, text.notAvailable),
        };
        const rowY = doc.y;
        doc.save();
        if (index % 2 === 1) doc.rect(detailX, rowY, detailWidth, detailRowHeight).fill('#f4f8fa');
        doc.rect(detailX, rowY, detailWidth, detailRowHeight).stroke(COLORS.line);
        doc.fillColor(COLORS.ink).font('Helvetica').fontSize(6.5);
        let x = detailX;
        detailColumns.forEach((column) => {
          doc.text(String(row[column.key] ?? '—'), x + 3, rowY + 6, {
            width: column.width - 6,
            align: column.align || 'left',
            lineBreak: false,
            ellipsis: true,
          });
          x += column.width;
        });
        doc.restore();
        doc.y = rowY + detailRowHeight;
      });
      doc.moveDown(0.5);
    });
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

module.exports = {
  renderUkweziPdf,
  buildUkweziFilename,
  buildUkweziResponseHeaders,
  getAccountingRows,
  getOutstandingSettlementRows,
  getEligibleFarmerPaymentGroups,
  getOwnerAccountingSummary,
  getCollectorFarmerGroups,
  BRAND_LOGO_PATH,
};
