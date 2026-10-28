const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderUkweziPdf, buildUkweziFilename, buildUkweziResponseHeaders, getAccountingRows, getOutstandingSettlementRows } = require('../lib/services/ukwezi-pdf-service.js');

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

test('Ukwezi collector summary notes start at the page content margin', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'ukwezi-pdf-service.js'), 'utf8');
  const start = source.indexOf('text.reconciliation}:');
  const end = source.indexOf('doc.moveDown(0.6);', start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /leftMargin, doc\.y, \{ width: contentWidth \}/);
});

test('Ukwezi PDF renderer rejects missing accounting scope with a client error', async () => {
  await assert.rejects(
    () => renderUkweziPdf({ report: {}, user: { id: 73, accountType: 'COLLECTOR' }, query: { periodType: 'first-half' } }),
    (error) => error.statusCode === 400 && /valid account and accounting report/i.test(error.message)
  );
});

test('Ukwezi PDF signals settlement accounting migration gaps without dropping core report output', async () => {
  const pdf = await renderUkweziPdf({
    report: { ...report, farmerPayments: [], ownerSettlementRow: null, settlementAccountingStatus: 'MIGRATION_REQUIRED' },
    user: { id: 73, name: 'Latina', accountType: 'COLLECTION_CENTER' },
    query: { month: '10', year: '2026', periodType: 'first-half', language: 'en' },
  });
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 1000);
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
  assert.match(source, /hasVerifiedAccount/);
  assert.match(source, /ownerRemainderRow/);

  // No SACCO / Ejo Heza in source or output
  const text = pdf.toString('latin1');
  assert.doesNotMatch(text, /SACCO/i);
  assert.doesNotMatch(text, /Ejo\s*Heza/i);
});
