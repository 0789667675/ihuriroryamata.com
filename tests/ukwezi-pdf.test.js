const test = require('node:test');
const assert = require('node:assert/strict');
const { renderUkweziPdf, buildUkweziFilename } = require('../lib/services/ukwezi-pdf-service.js');

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
  assert.equal(buildUkweziFilename({ accountName: 'Latina / account', year: '2026', month: '10', periodType: 'first-half' }), 'Ukwezi-Latina-account-2026-10-first-half.pdf');
});

test('Ukwezi PDF renderer handles an empty accounting period without inventing rows', async () => {
  const emptyReport = { ...report, farmerPayments: [], ownerSettlementRow: null };
  const pdf = await renderUkweziPdf({
    report: emptyReport,
    user: { id: 73, name: 'Latina', accountType: 'COLLECTION_CENTER' },
    query: { month: '10', year: '2026', periodType: 'second-half' },
  });

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 1000);
});
