const test = require('node:test');
const assert = require('node:assert/strict');
const Reports = require('../lib/services/monthly-report-service.js');
const ReportRepository = require('../lib/repositories/reportRepository.js');

function makeRepository(overrides = {}) {
  return {
    getTotalFarmers: async () => 0,
    getPeriodTotals: async () => ({ totalVolume: 0, totalAmount: 0, totalMorning: 0, totalEvening: 0 }),
    getTodayTotals: async () => ({ todayTotal: 0, todayAmount: 0, todayMorning: 0, todayEvening: 0 }),
    getTotalDeductions: async () => 0,
    getCurrentCenterPrice: async () => null,
    getFarmerTotals: async () => [],
    getUserProfile: async (id) => ({ id, name: 'Test User', accountType: 'COLLECTOR', nationalId: null, accountNumber: null, phone: null }),
    getCollectorEntries: async () => [],
    getCollectorPriceAtDate: async () => null,
    getFarmerValidLitersByDate: async () => new Map(),
    getMilkLossRecords: async () => [],
    ...overrides,
  };
}

test('Reports API failure surfaces an error instead of zero totals', async () => {
  const failingRepository = makeRepository({
    getPeriodTotals: async () => { throw new Error('Database connection lost'); },
  });
  await assert.rejects(
    () => Reports.getSummary({
      ownerUserId: 42,
      query: { startDate: '2026-10-01', endDate: '2026-10-31' },
      repository: failingRepository,
    }),
    { message: 'Database connection lost' }
  );
});

test('Empty period returns zero values with honest empty indicators', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-10-16', endDate: '2026-10-31' },
    repository: makeRepository({
      getPeriodTotals: async () => ({ totalVolume: 0, totalAmount: 0, totalMorning: 0, totalEvening: 0 }),
      getFarmerTotals: async () => [],
      getTotalDeductions: async () => 0,
    }),
  });
  assert.equal(summary.totalVolume, 0);
  assert.equal(summary.totalAmount, 0);
  assert.equal(summary.totalDeductions, 0);
  assert.equal(summary.netAmount, 0);
  assert.equal(summary.farmerPayments.length, 0);
  assert.equal(summary.rangeStart, '2026-10-16');
  assert.equal(summary.rangeEnd, '2026-10-31');
});

test('Owner isolation: Collector only sees their own records', async () => {
  const calls = [];
  const repository = makeRepository({
    getUserProfile: async (id) => ({ id, name: 'Collector A', accountType: 'COLLECTOR' }),
    getCollectorDairyOwnerId: async () => null,
    getPeriodTotals: async (input) => { calls.push(input); return { totalVolume: 85, totalAmount: 34000 }; },
    getFarmerTotals: async (input) => { calls.push(input); return []; },
  });

  await Reports.getSummary({
    ownerUserId: 99,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository,
  });

  for (const input of calls) {
    assert.equal(input.ownerUserId, 99);
    assert.equal(input.collectorUserId, null);
  }
});

test('Collector with assigned dairy owner sees scoped data under dairy owner', async () => {
  const calls = [];
  const repository = makeRepository({
    getUserProfile: async (id) => ({ id, name: 'Collector A', accountType: 'COLLECTOR' }),
    getCollectorDairyOwnerId: async (collectorUserId) => collectorUserId === 99 ? 42 : null,
    getPeriodTotals: async (input) => { calls.push(input); return { totalVolume: 85, totalAmount: 34000 }; },
    getFarmerTotals: async (input) => { calls.push(input); return []; },
  });

  await Reports.getSummary({
    ownerUserId: 99,
    query: { periodType: 'current-half' },
    repository,
    now: new Date(2026, 9, 2),
  });

  for (const input of calls) {
    assert.equal(input.ownerUserId, 42);
    assert.equal(input.collectorUserId, 99);
  }
});

test('Historical transport rate snapshot preserved per record', async () => {
  const farmerRow = {
    farmerId: 1,
    farmerName: 'Test Farmer',
    totalVolume: 10,
    grossAmount: 4000,
    totalTransport: 250,
    totalDeductions: 0,
    otherDeductions: 0,
    advanceDeductions: 0,
    umwendaDeductions: 0,
    netAmount: 3750,
    milkValueComplete: true,
    transportIsComplete: true,
    pricePerLiter: 400,
    ifishiTotalDeductions: 0,
    ifishiNetAmount: 3750,
  };
  const mapped = ReportRepository.mapFarmerRow(farmerRow);
  assert.equal(mapped.totalTransport, 250);
  assert.equal(mapped.transportIsComplete, true);
  assert.equal(mapped.netAmount, 3750);
});

test('Transport snapshot missing marks transport incomplete and net null', async () => {
  const farmerRow = {
    farmerId: 1,
    farmerName: 'Test Farmer',
    totalVolume: 10,
    grossAmount: 4000,
    totalTransport: 0,
    totalDeductions: 0,
    otherDeductions: 0,
    advanceDeductions: 0,
    umwendaDeductions: 0,
    netAmount: null,
    milkValueComplete: true,
    transportIsComplete: false,
    transportIncompleteCount: 1,
    pricePerLiter: null,
    ifishiTotalDeductions: 0,
    ifishiNetAmount: null,
  };
  const mapped = ReportRepository.mapFarmerRow(farmerRow);
  assert.equal(mapped.transportIsComplete, false);
  assert.equal(mapped.totalTransport, null);
  assert.equal(mapped.netAmount, null);
});

test('Deductions excluded from unsupported categories', async () => {
  const farmer = ReportRepository.mapFarmerRow({
    farmerId: 7,
    farmerName: 'Aline',
    totalVolume: 20,
    originalVolume: 22,
    lostVolume: 2,
    grossAmount: 8000,
    pricedVolumeAmount: 8000,
    totalTransport: 500,
    totalDeductions: 1000,
    totalOther: 1000,
    totalAdvance: 0,
    totalUmwenda: 0,
  });
  assert.equal(farmer.totalDeductions, 1000);
  assert.equal(farmer.netAmount, 6500);
  assert.equal(Object.hasOwn(farmer, 'ejohezaDeductions'), false);
});

test('Monthly report range uses inclusive start and end dates', () => {
  const now = new Date(2026, 9, 16); // October 16, 2026
  const [start, end] = Reports.getPeriodRange({ periodType: 'monthly', month: 10, year: 2026, now });
  assert.equal(start, '2026-10-01');
  assert.equal(end, '2026-10-31');
});

test('Half-month first-half range is inclusive of day 15', () => {
  const now = new Date(2026, 9, 10); // October 10, 2026
  const [start, end] = Reports.getPeriodRange({ periodType: 'first-half', month: 10, year: 2026, now });
  assert.equal(start, '2026-10-01');
  assert.equal(end, '2026-10-15');
});

test('Half-month second-half range starts at day 16', () => {
  const now = new Date(2026, 9, 20); // October 20, 2026
  const [start, end] = Reports.getPeriodRange({ periodType: 'second-half', month: 10, year: 2026, now });
  assert.equal(start, '2026-10-16');
  assert.equal(end, '2026-10-31');
});

test('Custom date range requires both start and end', async () => {
  const repository = makeRepository();
  await assert.rejects(
    () => Reports.getSummary({
      ownerUserId: 42,
      query: { startDate: '2026-06-01' },
      repository,
    }),
    /Both startDate and endDate/
  );
});

test('Invalid ISO date is rejected', async () => {
  const repository = makeRepository();
  await assert.rejects(
    () => Reports.getSummary({
      ownerUserId: 42,
      query: { startDate: '2026-02-30', endDate: '2026-03-01' },
      repository,
    }),
    /Invalid startDate/
  );
});

test('Report refresh does not duplicate farmer rows', async () => {
  const farmerRows = [{
    farmerId: 1,
    farmerName: 'Aline',
    totalVolume: 85,
    grossAmount: 34000,
    totalTransport: 2500,
    totalDeductions: 1500,
    otherDeductions: 1500,
    advanceDeductions: 0,
    umwendaDeductions: 0,
    netAmount: 30000,
    milkValueComplete: true,
    transportIsComplete: true,
    pricePerLiter: 400,
    ifishiTotalDeductions: 1500,
    ifishiNetAmount: 30000,
  }];
  const calls = [];
  const repository = makeRepository({
    getFarmerTotals: async () => { calls.push(1); return farmerRows; },
    getPeriodTotals: async () => ({ totalVolume: 85, totalAmount: 34000 }),
    getTotalDeductions: async () => 1500,
  });

  const first = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository,
  });
  const second = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository,
  });

  assert.equal(first.farmerPayments.length, 1);
  assert.equal(second.farmerPayments.length, 1);
  assert.equal(first.farmerPayments[0].farmerId, 1);
  assert.equal(second.farmerPayments[0].farmerId, 1);
  assert.equal(calls.length, 2); // Two separate queries, no duplication
});
