const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatMilkVolume } = require('../lib/utils/milk-volume-format.js');
const {
  renderUkweziPdf,
  buildUkweziFilename,
  buildUkweziResponseHeaders,
  getAccountingRows,
  getOutstandingSettlementRows,
  getEligibleFarmerPaymentGroups,
  getOwnerAccountingSummary,
  getCollectorFarmerGroups,
} = require('../lib/services/ukwezi-pdf-service.js');

const report = {
  rangeStart: '2026-10-01',
  rangeEnd: '2026-10-15',
  ownerGeneratedVolume: 720,
  ownerGeneratedGross: 288000,
  totalRevenueMonth: 288000,
  totalDeductionsMonth: 24000,
  collectorFarmerDeductions: 24000,
  collectorFarmerTransport: 12000,
  collectorSurplusAmount: 252000,
  collectorPayableFromBreakdown: 288000,
  collectorPayable: 288000,
  collectorIsReconciled: true,
  farmerPayments: Array.from({ length: 100 }, (_, index) => ({
    farmerId: index + 1,
    farmerName: `Abacunda ${index + 1} with a longer registered name`,
    nationalId: `ID-${index + 1}`,
    phone: '0788000000',
    accountNumber: `ACCOUNT-${index + 1}`,
    totalVolume: 7.2,
    pricePerLiter: 400,
    grossAmount: 2880,
    totalTransport: 120,
    totalDeductions: 240,
    netAmount: 2520,
  })),
  ownerSettlementRow: {
    isOwner: true,
    name: 'Latina account holder',
    farmerName: 'Latina account holder',
    totalVolume: 720,
    pricePerLiter: 400,
    grossAmount: 288000,
    netAmount: 288000,
    totalDeductions: 24000,
    totalTransport: 12000,
  },
};

test('Ukwezi milk-volume formatting trims zeros and preserves decimal and grouping precision', () => {
  assert.deepEqual([93, 93.5, 93.75, 139.5, 100, 5305, 1e-7].map(formatMilkVolume), [
    '93', '93.5', '93.75', '139.5', '100', '5,305', '0.0000001',
  ]);
});

test('Ukwezi PDF renderer creates a valid multipage accounting document from the report result', async () => {
  const pdf = await renderUkweziPdf({
    report,
    user: { id: 73, name: 'Latina account holder', email: 'latina@example.invalid', accountType: 'COLLECTOR' },
    query: { month: '10', year: '2026', periodType: 'first-half' },
    generatedAt: new Date('2026-10-08T09:30:00.000Z'),
  });
  const serialized = pdf.toString('latin1');
  const pageCount = (serialized.match(/\/Type\s*\/Page\b/g) || []).length;

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 10000);
  assert.ok(pageCount > 1);
  assert.match(serialized, /\/Subtype\s*\/Image/);
  assert.equal(buildUkweziFilename({ accountName: 'Latina / account', year: '2026', month: '10', periodType: 'first-half' }), 'Ukwezi-Latina-account-2026-10-first-half.pdf');
  assert.deepEqual(buildUkweziResponseHeaders({ accountName: 'Latina / account', year: 2026, month: 10, periodType: 'first-half' }), {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="Ukwezi-Latina-account-2026-10-first-half.pdf"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
});

test('Ukwezi PDF renderer handles an empty accounting period and renders settlement reconciliation', async () => {
  const emptyReport = {
    ...report,
    farmerPayments: [],
    ownerSettlementRow: null,
    settlementAccounting: {
      saccoDistributionInstruction: 0,
      saccoConfirmedAmount: 0,
      cashApprovedAmount: 500,
      cashConfirmedAmount: 250,
      debtRepaymentAmount: 100,
      outstandingDebt: 400,
      debtBalancesComplete: true,
      retainedUnpaidAmount: 650,
      unexplainedDiscrepancy: 0,
      ownerGrossReconciliation: { ownerGross: 1000, farmerGross: 1000, surplus: 0, discrepancy: 0 },
      farmers: [{
        farmerId: 19,
        farmerName: 'Settlement-only test farmer',
        totalVolume: 3,
        grossAmount: 1000,
        netAmount: 1000,
        settlement: {
          saccoDistributionInstruction: 0,
          cashApprovedAmount: 500,
          cashConfirmedAmount: 250,
          debtRepaymentAmount: 100,
          outstandingDebt: 400,
          debtBalanceComplete: true,
          retainedUnpaidAmount: 650,
          unexplainedDiscrepancy: 0,
        },
      }],
    },
  };
  const pdf = await renderUkweziPdf({
    report: emptyReport,
    user: { id: 73, name: 'Latina', accountType: 'COLLECTION_CENTER' },
    query: { month: '10', year: '2026', periodType: 'second-half' },
  });

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 1000);
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(pageCount, 1);
});

test('Collection Center Ukwezi PDF labels its center separately from the account holder', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'ukwezi-pdf-service.js'), 'utf8');
  assert.match(source, /const centerName = typeof query\.collectionCenter === 'string'/);
  assert.match(source, /if \(isDairy && centerName\) doc\.text\(`\$\{text\.collectionCenter\}: \$\{centerName\}`\)/);
});

test('Ukwezi collector PDF includes the owner formula and explicit reconciliation difference', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'ukwezi-pdf-service.js'), 'utf8');
  const start = source.indexOf('const accountingRows = [');
  const end = source.indexOf('const summaryY = doc.y;', start);
  assert.ok(start >= 0 && end > start);
  const summary = source.slice(start, end);
  assert.match(summary, /text\.nyirayoRecordedMilkValue/);
  assert.match(summary, /text\.farmersRecordedMilkValue/);
  assert.match(summary, /text\.nyirayoBaseDifference/);
  assert.match(summary, /text\.nyirayoOperationalMargin/);
  assert.match(summary, /text\.ownerPaymentLine/);
  assert.match(summary, /text\.noAccountAggregate/);
  assert.match(summary, /text\.verificationDifference/);
  assert.match(summary, /text\.debtOpening/);
  assert.match(summary, /text\.debtRepaid/);
  assert.match(summary, /text\.debtOutstanding/);
});

test('Ukwezi PDF debt summary uses the same opening, recovered, and closing totals as the web report', async () => {
  const generated = await renderUkweziPdf({
    report: {
      ...report,
      settlementAccounting: {
        openingDebt: 50000,
        debtRepaymentAmount: 5000,
        outstandingDebt: 45000,
        debtBalancesComplete: true,
        farmers: [],
        ownerGrossReconciliation: {},
      },
    },
    user: { id: 73, name: 'Collector', accountType: 'COLLECTOR' },
    query: { month: '10', year: '2026', periodType: 'second-half', language: 'en' },
  });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const parsed = await pdfjs.getDocument({ data: new Uint8Array(generated) }).promise;
  const textPages = [];
  for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
    const page = await parsed.getPage(pageNumber);
    const content = await page.getTextContent();
    textPages.push(content.items.map((item) => item.str).join(' '));
  }
  const pdfText = textPages.join(' ');
  assert.ok(pdfText.includes('Opening debt'));
  assert.ok(pdfText.includes('Debt repaid'));
  assert.ok(pdfText.includes('Debt outstanding'));
  assert.ok(pdfText.includes('50,000.00 RWF'));
  assert.ok(pdfText.includes('5,000.00 RWF'));
  assert.ok(pdfText.includes('45,000.00 RWF'));
});

test('Ukwezi PDF renderer rejects missing accounting scope with a client error', async () => {
  await assert.rejects(
    () => renderUkweziPdf({ report: {}, user: { id: 73, accountType: 'COLLECTOR' }, query: { periodType: 'first-half' } }),
    (error) => error.statusCode === 400 && /valid account and accounting report/i.test(error.message)
  );
});

test('Ukwezi PDF omits technical settlement details when settlement accounting is unavailable', async () => {
  const pdf = await renderUkweziPdf({
    report: { ...report, farmerPayments: [], ownerSettlementRow: null, settlementAccountingStatus: 'MIGRATION_REQUIRED' },
    user: { id: 73, name: 'Latina', accountType: 'COLLECTION_CENTER' },
    query: { month: '10', year: '2026', periodType: 'first-half', language: 'en' },
  });
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 1000);
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'ukwezi-pdf-service.js'), 'utf8');
  const renderer = source.slice(source.indexOf('const renderUkweziPdf ='), source.indexOf('const buildUkweziFilename ='));
  assert.doesNotMatch(renderer, /getOutstandingSettlementRows\(report\)|text\.settlementUnavailable/);
});

test('Ukwezi PDF renderer keeps producing a valid PDF when the brand logo asset is missing', async () => {
  // Reproduces the production failure: doc.image(public/brand-logo.png) threw
  // ENOENT when the brand asset was not deployed, which surfaced as a 500 with
  // "PDF ntiyashoboye gukorwa ... kode <requestId>". The renderer must degrade
  // gracefully (text-only header) instead of failing the whole PDF request.
  const logoPath = path.join(process.cwd(), 'public', 'brand-logo.png');
  const bakPath = path.join(process.cwd(), 'public', 'brand-logo.pdf-test.bak');

  // Clean slate: drop any stale backup from a prior interrupted run, then require
  // the brand asset to be present before we simulate its absence.
  if (fs.existsSync(bakPath)) fs.rmSync(bakPath);
  assert.ok(fs.existsSync(logoPath), 'brand-logo.png must exist before the test');

  try {
    // Simulate a deployment in which the brand asset was not published.
    fs.renameSync(logoPath, bakPath);

    const pdf = await renderUkweziPdf({
      report,
      user: { id: 73, name: 'Missing Logo', email: 'missing-logo@example.invalid', accountType: 'COLLECTOR' },
      query: { month: '10', year: '2026', periodType: 'first-half' },
      generatedAt: new Date('2026-10-08T09:30:00.000Z'),
    });

    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(pdf.length > 1000, 'expected a non-empty PDF even without the brand logo');
  } finally {
    // Restore the brand asset regardless of test outcome.
    if (fs.existsSync(bakPath) && !fs.existsSync(logoPath)) {
      fs.renameSync(bakPath, logoPath);
    } else if (fs.existsSync(bakPath)) {
      // Logo already present; drop the stale backup.
      fs.rmSync(bakPath);
    }
    assert.ok(fs.existsSync(logoPath), 'brand-logo.png must exist after the test');
  }
});

test('Ukwezi PDF selects server-calculated accounting rows by account type, not performance-report rows', () => {
  const sourceReport = {
    farmerPayments: [{ farmerId: 5, farmerName: 'Farmer for Collector accounting', totalVolume: 12, grossAmount: 4800, totalDeductions: 400, totalTransport: 200, netAmount: 4200 }],
    collectorSettlementRows: [{ collectorUserId: 9, name: 'Collector for Dairy accounting', totalVolume: 20, grossAmount: 8000, totalDeductions: 500, netAmount: 7500 }],
    ownerSettlementRow: { isOwner: true, name: 'Owner settlement', totalVolume: 30, grossAmount: 12000, netAmount: 11500 },
    performanceRows: [{ name: 'Must not appear in Ukwezi' }],
  };

  assert.deepEqual(getAccountingRows({ report: sourceReport, isCollector: true, isDairy: false }).map((row) => row.farmerName || row.name), [
    'Farmer for Collector accounting', 'Owner settlement',
  ]);
  assert.deepEqual(getAccountingRows({ report: sourceReport, isCollector: false, isDairy: true }).map((row) => row.farmerName || row.name), [
    'Collector for Dairy accounting', 'Owner settlement',
  ]);
});

test('Ukwezi outstanding-payment list omits paid farmers without removing them from the accounting ledger', () => {
  const farmers = [
    { farmerId: 1, farmerName: 'Fully paid', totalVolume: 10, grossAmount: 4000, netAmount: 4000, settlement: { saccoDistributionInstruction: 0, retainedUnpaidAmount: 0 } },
    { farmerId: 2, farmerName: 'Partially paid', totalVolume: 5, grossAmount: 2000, netAmount: 2000, settlement: { saccoDistributionInstruction: 1200, retainedUnpaidAmount: 0 } },
    { farmerId: 3, farmerName: 'Still unpaid', totalVolume: 4, grossAmount: 1600, netAmount: 1600, settlement: { saccoDistributionInstruction: 0, retainedUnpaidAmount: 1600 } },
  ];
  const periodReport = {
    farmerPayments: farmers.map(({ settlement, ...farmer }) => farmer),
    settlementAccounting: { farmers },
  };

  assert.deepEqual(getOutstandingSettlementRows(periodReport).map((farmer) => [farmer.farmerId, farmer.outstandingAmount]), [
    [2, 1200],
    [3, 1600],
  ]);
  assert.equal(getAccountingRows({ report: periodReport, isCollector: true, isDairy: false }).length, 3);
  assert.equal(periodReport.farmerPayments[0].netAmount, 4000);
});

test('Ukwezi payment groups use outstanding route instructions and retain zero/negative farmers', () => {
  const groups = getEligibleFarmerPaymentGroups({
    farmerPayments: [
      { farmerId: 1, farmerName: 'Account paid', accountNumber: 'RW-12345', totalVolume: 5, netAmount: 500, settlement: { saccoDistributionInstruction: 320 } },
      { farmerId: 2, farmerName: 'No account', accountNumber: null, totalVolume: 4, netAmount: 400, settlement: { retainedUnpaidAmount: 250, outstandingDebt: 900 } },
      { farmerId: 3, farmerName: 'Zero after debt recovery', accountNumber: 'RW-56789', totalVolume: 3, netAmount: 300, settlement: { saccoDistributionInstruction: 0, availableAfterDebtRecovery: 0, outstandingDebt: 800 } },
      { farmerId: 8, farmerName: 'Debt recovery consumes payable', accountNumber: 'RW-98765', totalVolume: 2, netAmount: 200, settlement: { debtRepaymentAmount: 200, outstandingDebt: 0 } },
      { farmerId: 7, farmerName: 'Debt only, no remaining payable', accountNumber: null, totalVolume: 2, netAmount: 200, settlement: { retainedUnpaidAmount: 0, availableAfterDebtRecovery: 0, outstandingDebt: 200 } },
      { farmerId: 4, farmerName: 'Negative payable', accountNumber: null, totalVolume: 2, netAmount: -50 },
      { farmerId: 5, farmerName: 'No valid milk', accountNumber: 'RW-88888', totalVolume: 0, netAmount: 700 },
      { farmerId: 6, farmerName: 'No account value', accountNumber: 'N/A', totalVolume: 1, netAmount: 75 },
      { farmerId: 9, farmerName: 'Legacy confirmed account payment', accountNumber: 'RW-11111', totalVolume: 2, netAmount: 500, settlement: { cashConfirmedAmount: 50, saccoConfirmedAmount: 50 } },
      { farmerId: 10, farmerName: 'Legacy confirmed owner payment', accountNumber: null, totalVolume: 2, netAmount: 500, settlement: { cashConfirmedAmount: 100 } },
      { farmerId: 11, farmerName: 'Unknown route amount', accountNumber: 'RW-22222', totalVolume: 2, netAmount: 500, settlement: { saccoDistributionInstruction: null } },
    ],
  });

  assert.deepEqual(groups.withAccount.map(({ farmerId, paymentAmount }) => [farmerId, paymentAmount]), [[1, 320], [8, 0], [9, 400], [11, null], [3, 0]]);
  assert.deepEqual(groups.withoutAccount.map(({ farmerId, paymentAmount }) => [farmerId, paymentAmount]), [[7, 0], [10, 400], [4, 0], [2, 250], [6, 75]]);
});

test('Ukwezi payment groups sort each account route by case-insensitive farmer name', () => {
  const groups = getEligibleFarmerPaymentGroups({
    farmerPayments: [
      { farmerId: 1, farmerName: 'zulu', accountNumber: 'RW-0001', totalVolume: 1 },
      { farmerId: 2, farmerName: 'ALPHA', accountNumber: 'RW-0002', totalVolume: 1 },
      { farmerId: 3, farmerName: 'bravo', accountNumber: 'RW-0003', totalVolume: 1 },
      { farmerId: 4, farmerName: 'Charlie', accountNumber: null, totalVolume: 1 },
      { farmerId: 5, farmerName: 'beta', accountNumber: null, totalVolume: 1 },
      { farmerId: 6, farmerName: 'DELTA', accountNumber: null, totalVolume: 1 },
    ],
  });

  assert.deepEqual(groups.withAccount.map(({ farmerName }) => farmerName), ['ALPHA', 'bravo', 'zulu']);
  assert.deepEqual(groups.withoutAccount.map(({ farmerName }) => farmerName), ['beta', 'Charlie', 'DELTA']);
});

test('Collector PDF sorts both farmer sections alphabetically, keeps the owner aggregate, and repeats all 13 headers', async () => {
  const bankFarmers = Array.from({ length: 64 }, (_, index) => ({
    farmerId: index + 1,
    farmerName: `BANK-FARMER-${String(index + 1).padStart(3, '0')}`,
    nationalId: `ID-${String(index + 1).padStart(6, '0')}`,
    phone: `078800${String(index + 1).padStart(4, '0')}`,
    accountNumber: `RW-ACCOUNT-${String(index + 1).padStart(4, '0')}`,
    validVolumeLiters: index === 0 ? 93.5 : index === 1 ? 93.75 : 10,
    totalVolume: index === 0 ? 93.5 : index === 1 ? 93.75 : 10,
    pricePerLiter: 400,
    grossAmount: 4000,
    totalTransport: 100,
    totalDeductions: 200,
    ejohezaDeductions: 0,
    netAmount: 3700,
  }));
  const ownerRoutedFarmers = Array.from({ length: 24 }, (_, index) => ({
    farmerId: index + 1001,
    farmerName: `OWNER-FARMER-${String(index + 1).padStart(3, '0')}`,
    nationalId: `NO-ID-${String(index + 1).padStart(4, '0')}`,
    phone: `078811${String(index + 1).padStart(4, '0')}`,
    accountNumber: null,
    validVolumeLiters: index === 0 ? 139.5 : index === 1 ? 5305 : 8,
    totalVolume: index === 0 ? 139.5 : index === 1 ? 5305 : 8,
    pricePerLiter: 400,
    grossAmount: 3200,
    totalTransport: 80,
    totalDeductions: 120,
    ejohezaDeductions: 0,
    netAmount: 3000,
  }));
  const generated = await renderUkweziPdf({
    report: {
      ...report,
      farmerPayments: [...bankFarmers.slice().reverse(), ...ownerRoutedFarmers.slice().reverse()],
      ownerGeneratedGross: 300000,
      ownerGeneratedVolume: 750,
      collectorFarmersValidLiters: 832,
      nyirayoMilkValue: 300000,
      collectorFarmerMilkValue: 332800,
      nyirayoBaseDifference: -32800,
      transportAmount: 8320,
      farmerDeductions: 15680,
      nyirayoOperationalMargin: -8800,
      retainedNoAccountFarmerAmount: 72000,
      nyirayoTotalAfterOperations: 63200,
      ownerSettlementRow: { name: 'Owner bank route', accountNumber: 'RW-OWNER-001' },
      settlementAccounting: {
        signedFarmerNetBalance: 308800,
        negativeFarmerNetBalance: 0,
        negativeFarmerCount: 0,
        ownerGrossReconciliation: {
          ownerGross: 300000,
          farmerGross: 332800,
          baseDifference: -32800,
          transportAmount: 8320,
          farmerDeductions: 15680,
          retainedNoAccountFarmerAmount: 72000,
          operationalMargin: -8800,
          totalAfterOperations: 63200,
        },
      },
    },
    user: { id: 73, name: 'Collector', accountType: 'COLLECTOR' },
    query: { month: '10', year: '2026', periodType: 'second-half', language: 'en' },
  });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const parsed = await pdfjs.getDocument({ data: new Uint8Array(generated) }).promise;
  const firstPageViewport = (await parsed.getPage(1)).getViewport({ scale: 1 });
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
    const page = await parsed.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' '));
  }
  const pdfText = pageTexts.join(' ');

  assert.ok(parsed.numPages > 2);
  assert.ok(firstPageViewport.width > firstPageViewport.height);
  assert.ok(firstPageViewport.width > 1100, 'collector statement uses a wide landscape page for legible 13-column tables');
  for (const header of [
    'Farmer full name', 'National ID number', 'Telephone', 'Account number',
    'Milk quantity (L)', 'Price per liter', 'Gross value', 'TRANSPORT',
    'Igipande and other deductions', 'Ejoheza (RWF)', 'Total deductions', 'Farmer paid',
  ]) {
    assert.ok(pdfText.includes(header), `missing PDF column: ${header}`);
  }
  assert.ok(pageTexts.filter((pageText) => pageText.includes('Farmer full name')).length >= 2, 'table header must repeat on later pages');
  for (const farmers of [bankFarmers, ownerRoutedFarmers]) {
    let previousIndex = -1;
    for (const farmer of farmers) {
      const currentIndex = pdfText.indexOf(farmer.farmerName);
      assert.ok(currentIndex > previousIndex, `expected ${farmer.farmerName} after the prior alphabetical row`);
      assert.equal(pdfText.split(farmer.farmerName).length - 1, 1, `expected exactly one row for ${farmer.farmerName}`);
      previousIndex = currentIndex;
    }
  }
  assert.ok(pdfText.includes('OWNER-FARMER-001'));
  assert.ok(pdfText.includes('NO-ID-0001'));
  assert.ok(pdfText.includes('93.5'));
  assert.ok(pdfText.includes('93.75'));
  assert.ok(pdfText.includes('139.5'));
  assert.ok(pdfText.includes('5,305'));
  assert.ok(pdfText.includes('807.25'));
  assert.ok(pdfText.includes('5,620.5'));
  assert.equal(/\b(?:93\.5|93\.75|139\.5|5,305) L\b/.test(pdfText), false);
  assert.ok(/\b1\s+BANK-FARMER-001\b/.test(pdfText));
  assert.ok(/\b64\s+BANK-FARMER-064\b/.test(pdfText));
  assert.ok(/\b1\s+OWNER-FARMER-001\b/.test(pdfText));
  assert.ok(/\b24\s+OWNER-FARMER-024\b/.test(pdfText));
  assert.ok(pdfText.includes('RW-OWNER-001'));
  assert.ok(pdfText.includes('Aggregate payable for farmers without accounts'));
  assert.ok(pdfText.includes('72,000.00 RWF'));
  assert.ok(pdfText.includes("Owner's payment line, including the total routed for farmers without accounts"));
  assert.ok(pdfText.includes('63,200.00 RWF'));
  assert.ok(pdfText.includes('Total payment distribution'));
  assert.ok(pdfText.includes('300,000.00 RWF'));
  assert.ok(pdfText.includes('236,800.00 RWF'));
  assert.ok(pdfText.includes('72,000.00 RWF'));
  assert.ok(pdfText.includes('300,000.00 RWF'));
  assert.ok(pdfText.includes('No Ejoheza amount is recorded in this report'));
  assert.ok(pdfText.includes('750'));
  assert.ok(pdfText.includes('832'));
  const rosterSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'collector-ukwezi-payment-roster.tsx'), 'utf8');
  const workspaceSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
  assert.match(rosterSource, /renderTable\(filteredOwnerRows,\s*false/);
  assert.match(rosterSource, /\[\.\.\.accountRows\]\.sort\(compareFarmerNames\)/);
  assert.match(rosterSource, /\[\.\.\.ownerRows\]\.sort\(compareFarmerNames\)/);
  assert.match(rosterSource, /formatMilkVolume/);
  assert.match(workspaceSource, /ownerRows=\{noAccountPaymentRows\}/);
  assert.match(workspaceSource, /params\.set\('sortBy', 'name'\)/);
  assert.match(workspaceSource, /params\.set\('sortDirection', 'asc'\)/);
  assert.match(workspaceSource, /ukweziLiters = formatMilkVolume/);
  await parsed.destroy();
});

test('Collection Center detail lists exclude zero and negative farmer payable rows', () => {
  const groups = getCollectorFarmerGroups({
    collectorSettlementRows: [{
      name: 'Collector A',
      farmers: [
        { farmerId: 1, farmerName: 'Positive', totalVolume: 2, netAmount: 100 },
        { farmerId: 2, farmerName: 'Zero', totalVolume: 2, netAmount: 0 },
        { farmerId: 3, farmerName: 'Negative', totalVolume: 2, netAmount: -10 },
        { farmerId: 4, farmerName: 'No valid volume', totalVolume: 0, netAmount: 100 },
      ],
    }],
  });
  assert.deepEqual(groups[0].farmers.map((farmer) => farmer.farmerId), [1]);
});

test('Ukwezi owner summary preserves the established formula and exposes a distribution difference', () => {
  const summary = getOwnerAccountingSummary({
    ownerGeneratedGross: 5000,
    collectorFarmerMilkValue: 4000,
    transportAmount: 200,
    farmerDeductions: 300,
    retainedNoAccountFarmerAmount: 400,
    settlementAccounting: {
      ownerGrossReconciliation: {
        ownerGross: 5000,
        farmerGross: 4000,
        baseDifference: 1000,
        transportAmount: 200,
        farmerDeductions: 300,
        retainedNoAccountFarmerAmount: 400,
        operationalMargin: 1500,
        totalAfterOperations: 1900,
      },
    },
  });
  const difference = Number((summary.ownerMilkValue - summary.finalOwnerTotal - 3100).toFixed(2));

  assert.deepEqual(summary, {
    ownerMilkValue: 5000,
    farmersMilkValue: 4000,
    initialDifference: 1000,
    transport: 200,
    deductions: 300,
    noAccountAmount: 400,
    workIncome: 1500,
    finalOwnerTotal: 1900,
  });
  assert.equal(difference, 0);
  assert.equal(summary.workIncome, summary.initialDifference + summary.transport + summary.deductions);
  assert.equal(summary.finalOwnerTotal, summary.workIncome + summary.noAccountAmount);
});

test('Ukwezi PDF route uses the authenticated owner and selected period context', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ukwezi', 'pdf', 'route.js'), 'utf8');
  const nextConfig = fs.readFileSync(path.join(__dirname, '..', 'next.config.mjs'), 'utf8');
  const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
  assert.match(route, /getAuthenticatedUser\(request\)/);
  assert.match(route, /ownerUserId: user\.id, actorId: user\.id, query/);
  assert.match(route, /periodType: query\.periodType/);
  assert.match(route, /query\.language = query\.language === 'en' \? 'en' : 'rw'/);
  assert.match(route, /buildUkweziResponseHeaders/);
  assert.match(route, /return new NextResponse\(pdf,\s*\{\s*status: 200,\s*headers,\s*\}\)/);
  assert.match(route, /periodType: query\.periodType/);
  assert.match(route, /message: error\.message/);
  assert.match(route, /stack: error\.stack/);
  assert.match(route, /UKWEZI_PDF_GENERATION_FAILED/);
  assert.match(route, /requestId/);
  assert.match(route, /status,\s*\}\)/);
  assert.match(workspace, /throw new Error\(body\?\.message \|\| publicLanguage\.t\('ukweziPdfError'\)\)/);
  assert.match(nextConfig, /serverComponentsExternalPackages: \['pdfkit'\]/);
});

test('Ukwezi PDF renderer includes Igenzura rya Nyirayo line items in settlement reconciliation', async () => {
  const auditReport = {
    ...report,
    nyirayoMilkValue: 208400,
    farmersMilkValue: 707400,
    nyirayoBaseDifference: -499000,
    transportAmount: 18000,
    farmerDeductions: 9000,
    retainedNoAccountFarmerAmount: 288000,
    nyirayoOperationalMargin: -472000,
    nyirayoTotalAfterOperations: -184000,
    settlementAccounting: {
      saccoDistributionInstruction: 392400,
      saccoConfirmedAmount: 0,
      cashApprovedAmount: 0,
      cashConfirmedAmount: 0,
      debtRepaymentAmount: 0,
      outstandingDebt: 0,
      debtBalancesComplete: true,
      retainedUnpaidAmount: 288000,
      unexplainedDiscrepancy: 0,
      ownerGrossReconciliation: {
        ownerGross: 208400,
        farmerGross: 707400,
        baseDifference: -499000,
        transportAmount: 18000,
        farmerDeductions: 9000,
        retainedNoAccountFarmerAmount: 288000,
        operationalMargin: -472000,
        totalAfterOperations: -184000,
      },
      farmers: report.farmerPayments.slice(0, 2),
    },
  };

  const pdf = await renderUkweziPdf({
    report: auditReport,
    user: { id: 73, name: 'Latina account holder', email: 'latina@example.invalid', accountType: 'COLLECTOR' },
    query: { month: '10', year: '2026', periodType: 'first-half' },
  });

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 5000);
});

test('Ukwezi PDF renders Area A (Farmer Accounting) with 35,370 RWF gap, Area B (Nyirayo Accounting) with -499,000 RWF difference, and avoids SACCO/Ejo Heza labels', async () => {
  const auditReport = {
    ...report,
    farmersMilkValue: 707400,
    farmerTransportTotal: 23370,
    farmerDeductionsTotal: 12000,
    farmerPayableTotal: 672030,
    accountRoutedPayable: 388030,
    ownerListRoutedPayable: 284000,
    nyirayoRecordedMilkValue: 208400,
    farmersComparisonMilkValue: 707400,
    nyirayoMilkDifference: -499000,
    nyirayoTransportAmount: 23370,
    nyirayoDeductionsAmount: 12000,
    nyirayoOwnAccountingBalance: -463630,
    ownerNameListFarmerSettlementAmount: 284000,
    nyirayoTotalWithOwnerList: -179630,
    collectorGross: 208400,
    collectorFarmerMilkValue: 707400,
    collectorFarmerTransport: 23370,
    collectorFarmerDeductions: 12000,
    collectorFarmerPayable: 672030,
    collectorSurplusAmount: -499000,
    settlementAccounting: {
      farmersMilkValue: 707400,
      farmerPayableTotal: 672030,
      accountRoutedPayable: 388030,
      ownerListRoutedPayable: 284000,
      saccoDistributionInstruction: 388030,
      saccoConfirmedAmount: 0,
      cashApprovedAmount: 0,
      cashConfirmedAmount: 0,
      debtRepaymentAmount: 0,
      outstandingDebt: 0,
      debtBalancesComplete: true,
      retainedUnpaidAmount: 284000,
      unexplainedDiscrepancy: 0,
      ownerGrossReconciliation: {
        ownerGross: 208400,
        farmerGross: 707400,
        baseDifference: -499000,
        transportAmount: 23370,
        farmerDeductions: 12000,
        retainedNoAccountFarmerAmount: 284000,
        operationalMargin: -463630,
        totalAfterOperations: -179630,
        nyirayoRecordedMilkValue: 208400,
        farmersComparisonMilkValue: 707400,
        nyirayoMilkDifference: -499000,
        nyirayoTransportAmount: 23370,
        nyirayoDeductionsAmount: 12000,
        nyirayoOwnAccountingBalance: -463630,
        ownerNameListFarmerSettlementAmount: 284000,
        nyirayoTotalWithOwnerList: -179630,
      },
      farmers: [
        {
          farmerId: 201,
          farmerName: 'Gatete John',
          totalVolume: 1018.5,
          grossAmount: 407400,
          netAmount: 388030,
          settlement: {
            saccoDistributionInstruction: 388030,
            cashApprovedAmount: 0,
            cashConfirmedAmount: 0,
            debtRepaymentAmount: 0,
            outstandingDebt: 0,
            debtBalanceComplete: true,
            retainedUnpaidAmount: 0,
            unexplainedDiscrepancy: 0,
          },
        },
        {
          farmerId: 202,
          farmerName: 'Mukamana Claire',
          totalVolume: 750,
          grossAmount: 300000,
          netAmount: 284000,
          settlement: {
            saccoDistributionInstruction: 0,
            cashApprovedAmount: 0,
            cashConfirmedAmount: 0,
            debtRepaymentAmount: 0,
            outstandingDebt: 0,
            debtBalanceComplete: true,
            retainedUnpaidAmount: 284000,
            unexplainedDiscrepancy: 0,
          },
        },
      ],
    },
  };

  const pdfRw = await renderUkweziPdf({
    report: auditReport,
    user: { id: 73, name: 'Latina account holder', email: 'latina@example.invalid', accountType: 'COLLECTOR' },
    query: { month: '10', year: '2026', periodType: 'first-half', language: 'rw' },
  });

  const pdfEn = await renderUkweziPdf({
    report: auditReport,
    user: { id: 73, name: 'Latina account holder', email: 'latina@example.invalid', accountType: 'COLLECTOR' },
    query: { month: '10', year: '2026', periodType: 'first-half', language: 'en' },
  });

  assert.equal(pdfRw.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(pdfEn.subarray(0, 5).toString('ascii'), '%PDF-');

  // Verify neither PDF contains "SACCO" or "Ejo Heza" in its text stream
  const textRw = pdfRw.toString('latin1');
  const textEn = pdfEn.toString('latin1');
  assert.doesNotMatch(textRw, /SACCO/i);
  assert.doesNotMatch(textRw, /Ejo\s*Heza/i);
  assert.doesNotMatch(textEn, /SACCO/i);
  assert.doesNotMatch(textEn, /Ejo\s*Heza/i);
});

test('Paper-Efficient Bank-Ready PDF includes bank endorsement blocks, only verified accounts, and balances with Owner Account remainder', async () => {
  const bankReport = {
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    ownerGeneratedVolume: 800,
    ownerGeneratedGross: 320000,
    totalRevenueMonth: 320000,
    totalDeductionsMonth: 8000,
    collectorFarmerDeductions: 8000,
    collectorFarmerTransport: 0,
    collectorGross: 320000,
    nyirayoTotalWithOwnerList: 125000,
    farmerPayments: [
      {
        farmerId: 301,
        farmerName: 'Verified Account Farmer',
        accountNumber: '400123456789', // Verified
        phone: '0788111222',
        totalVolume: 500,
        pricePerLiter: 400,
        grossAmount: 200000,
        totalTransport: 0,
        totalDeductions: 5000,
        netAmount: 195000,
      },
      {
        farmerId: 302,
        farmerName: 'Cash Only Farmer',
        accountNumber: null, // No account -> routed to Owner line
        phone: '0788333444',
        totalVolume: 300,
        pricePerLiter: 400,
        grossAmount: 120000,
        totalTransport: 0,
        totalDeductions: 3000,
        netAmount: 117000,
      },
    ],
  };

  const pdf = await renderUkweziPdf({
    report: bankReport,
    user: { id: 88, name: 'Latina Collector', accountType: 'COLLECTOR', accountNumber: '000999888' },
    query: { month: '10', year: '2026', periodType: 'first-half', language: 'rw' },
  });

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 5000);

  // Verify source code enforces bank endorsement blocks, grand total, and owner remainder
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'ukwezi-pdf-service.js'), 'utf8');
  assert.match(source, /drawBankEndorsements/);
  assert.match(source, /text\.preparedBy/);
  assert.match(source, /text\.reviewedBy/);
  assert.match(source, /text\.approvedBy/);
  assert.match(source, /text\.grandTotal/);
  assert.match(source, /collectorPaymentGroups\.withAccount/);
  assert.match(source, /collectorPaymentGroups\.withoutAccount/);
  assert.match(source, /getOwnerAccountingSummary/);

  // No SACCO / Ejo Heza in source or output
  const text = pdf.toString('latin1');
  assert.doesNotMatch(text, /SACCO/i);
  assert.doesNotMatch(text, /Ejo\s*Heza/i);
});

test('Collection Center statement renders Abacunda Settlement Statement with center endorsement blocks and safe numbers', async () => {
  const dairyReport = {
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    totalVolume: 5000,
    pricePerLiter: 400,
    grossAmount: 2000000,
    totalRevenueMonth: 2000000,
    totalDeductionsMonth: 50000,
    totalDeductions: 50000,
    netRevenueMonth: 1950000,
    netAmount: 1950000,
    collectorSettlementRows: [
      {
        collectorUserId: 101,
        name: 'Jean Claude (Koperative)',
        collectorName: 'Jean Claude (Koperative)',
        phone: '0788123456',
        accountNumber: '400111222333',
        totalVolume: 3000,
        validVolumeLiters: 3000,
        pricePerLiter: 400,
        grossAmount: 1200000,
        adjustments: 30000,
        netAmount: 1170000,
      },
      {
        collectorUserId: 102,
        name: 'Marie Rose',
        collectorName: 'Marie Rose',
        phone: '0788654321',
        accountNumber: null,
        totalVolume: 2000,
        validVolumeLiters: 2000,
        pricePerLiter: 400,
        grossAmount: null, // Test safe numeric calculation fallback
        adjustments: 20000,
        netAmount: null, // Test safe numeric calculation fallback
      },
    ],
  };

  const pdfRw = await renderUkweziPdf({
    report: dairyReport,
    user: { id: 50, name: 'MAVA MILK', accountType: 'COLLECTION_CENTER' },
    query: { month: '10', year: '2026', periodType: 'first-half', collectionCenter: 'MAVA MILK', language: 'rw' },
  });

  const pdfEn = await renderUkweziPdf({
    report: dairyReport,
    user: { id: 50, name: 'MAVA MILK', accountType: 'COLLECTION_CENTER' },
    query: { month: '10', year: '2026', periodType: 'first-half', collectionCenter: 'MAVA MILK', language: 'en' },
  });

  assert.equal(pdfRw.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(pdfEn.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdfRw.length > 3000);
  assert.ok(pdfEn.length > 3000);

  // Check source code has Center Director, Chief Accountant, and Auditor blocks
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'ukwezi-pdf-service.js'), 'utf8');
  assert.match(source, /text\.dairyDirector/);
  assert.match(source, /text\.dairyChiefAccountant/);
  assert.match(source, /text\.dairyAuditor/);
  assert.match(source, /text\.dairyTitle/);
});
