const test = require('node:test');
const assert = require('node:assert/strict');

const Reports = require('../lib/services/monthly-report-service.js');
const ReportRepository = require('../lib/repositories/reportRepository.js');
const CollectorMilkRepository = require('../lib/repositories/collectorMilkRepository.js');

const farmerRows = [{
  farmerId: 1,
  farmerName: 'Aline',
  village: 'North Site',
  phone: null,
  nationalId: null,
  accountNumber: null,
  collectionCenter: 'North Site',
  totalMorning: 85,
  totalEvening: 0,
  totalVolume: 85,
  grossAmount: 34000,
  totalTransport: 2500,
  totalDeductions: 1500,
  otherDeductions: 1500,
  advanceDeductions: 0,
  umwendaDeductions: 0,
  netAmount: 30000,
}];

const collectorEntry = {
  date: '2026-06-01',
  volumeLiters: 100,
  effectiveVolumeLiters: 90,
  farmerLostLiters: 10,
  pricePerLiter: 400,
  status: 'valid',
};

test('collector milk repository exports its report mapper and preserves PostgreSQL date-only values', () => {
  const mapped = CollectorMilkRepository.mapRow({
    id: 12,
    owner_user_id: 42,
    collection_date: new Date(2026, 9, 2),
    volume_liters: 100,
    price_per_liter: 400,
    status: 'valid',
    valid_volume_liters: 100,
    farmer_lost_liters: 10,
  });

  assert.equal(mapped.date, '2026-10-02');
  assert.equal(mapped.effectiveVolumeLiters, 90);
});

test('collector entry query resolves effective historical prices in one owner-scoped query', () => {
  const query = ReportRepository.buildCollectorEntriesQuery({
    ownerUserId: 42,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
  });

  assert.match(query.text, /cm\.owner_user_id = \$1/);
  assert.match(query.text, /collector_milk_prices p/);
  assert.match(query.text, /p\.effective_date <= cm\.date/);
  assert.match(query.text, /ORDER BY p\.effective_date DESC, p\.id DESC LIMIT 1/);
  assert.deepEqual(query.values, [42, '2026-10-01', '2026-10-15']);
});

const reportRepository = ({ accountType = 'COLLECTOR', links = [], allowed = [], profiles = [], entries = [collectorEntry] } = {}) => ({
  getTotalFarmers: async () => 1,
  getPeriodTotals: async () => ({ totalMorning: 85, totalEvening: 0, totalVolume: 85, totalAmount: 34000 }),
  getTodayTotals: async () => ({ todayMorning: 0, todayEvening: 0, todayTotal: 0, todayAmount: 0 }),
  getTotalDeductions: async () => 1500,
  getCurrentCenterPrice: async () => ({ pricePerLiter: 400 }),
  getFarmerTotals: async ({ ownerUserId }) => ownerUserId === 99 ? farmerRows : farmerRows,
  getUserProfile: async (id) => ({ id, name: 'Collector A', accountType: id === 77 ? accountType : 'COLLECTOR', nationalId: null, accountNumber: null, phone: null }),
  getCollectorEntries: async () => entries,
  getCollectorPriceAtDate: async () => null,
  getFarmerValidLitersByDate: async () => new Map([['2026-06-01', 85]]),
  getDairyCollectorTotals: async () => [...new Set(links.map((link) => Number(link.collectorUserId)))]
    .filter((collectorUserId) => allowed.map(Number).includes(collectorUserId))
    .map((collectorUserId) => {
      const profile = profiles.find((item) => Number(item.id) === collectorUserId);
      const entry = entries.find((item) => item.status !== 'cancelled');
      return {
        collectorUserId,
        name: profile?.name || 'Collector',
        assignedFarmerCount: links.filter((link) => Number(link.collectorUserId) === collectorUserId).length,
        totalVolume: Number(entry?.effectiveVolumeLiters || 0),
        grossAmount: Number(entry?.effectiveVolumeLiters || 0) * Number(entry?.pricePerLiter || 0),
      };
    }),
  getDairyCollectorLinks: async () => links,
  getAllowedCollectorIds: async () => allowed,
  getCollectorProfiles: async () => new Map(profiles.map((profile) => [profile.id, profile])),
});

test('period resolution preserves monthly, daily, and half-month report ranges', () => {
  const now = new Date(2026, 5, 20);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'monthly', month: 6, year: 2026, now }), ['2026-06-01', '2026-06-30']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'daily', now }), ['2026-06-20', '2026-06-20']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'first-half', month: 6, year: 2026, now }), ['2026-06-01', '2026-06-15']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'yearly', year: 2026, now }), ['2026-01-01', '2026-12-31']);
});

test('Ukwezi half-month boundaries override browser-supplied custom ranges', () => {
  assert.deepEqual(Reports.getPeriodRange({
    periodType: 'first-half',
    month: 2,
    year: 2024,
    startDate: '2024-02-01',
    endDate: '2024-02-29',
    now: new Date('2026-10-07T00:00:00.000Z'),
  }), ['2024-02-01', '2024-02-15']);
  assert.deepEqual(Reports.getPeriodRange({
    periodType: 'monthly',
    month: 2,
    year: 2024,
    startDate: '2024-02-03',
    endDate: '2024-02-09',
  }), ['2024-02-03', '2024-02-09']);
});

test('monthly summary applies owner totals, deductions, center pricing, and farmer net calculation', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    actorId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-30', collectionCenter: 'North Site' },
    repository: reportRepository(),
  });
  assert.equal(summary.totalFarmers, 1);
  assert.equal(summary.totalVolume, 85);
  assert.equal(summary.totalDeductions, 1500);
  assert.equal(summary.totalTransport, 2500);
  assert.equal(summary.totalRevenueMonth, 34000);
  assert.equal(summary.netAmount, 30000);
  assert.equal(summary.farmerPayments[0].netAmount, 30000);
  assert.equal(summary.pricePerLiter, 400);
});

test('collector report reconciles historical milk, farmer payable, transport, deductions, and surplus', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository: reportRepository(),
  });
  const settlement = summary.collectorSettlementRow;
  assert.equal(settlement.collectorGross, 36000);
  assert.equal(settlement.collectorTotalFarmersPayable, 34000);
  assert.equal(settlement.collectorSurplusLiters, 5);
  assert.equal(settlement.collectorSurplusAmount, 2000);
  assert.equal(settlement.collectorPayable, 6000);
  assert.equal(settlement.collectorPayableFromBreakdown, 6000);
  assert.equal(settlement.isReconciled, true);
  assert.equal(summary.ownerGeneratedGross, 36000);
  assert.equal(summary.ownerGeneratedVolume, 90);
  assert.equal(summary.totalRevenueMonth, 36000);
  assert.equal(summary.totalDeductionsMonth, 34000);
  assert.equal(summary.netRevenueMonth, 6000);
  assert.equal(summary.ownerSettlementRow.name, 'Collector A');
  assert.equal(summary.ownerSettlementRow.totalVolume, 90);
  assert.equal(summary.ownerSettlementRow.grossAmount, 36000);
  assert.equal(summary.ownerSettlementRow.totalDeductions, 34000);
  assert.equal(summary.ownerSettlementRow.netAmount, 6000);
  assert.equal(summary.ownerSettlementRow.isOwner, true);
});

test('collector report leaves owner gross and surplus unknown when no effective price exists', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository: reportRepository({ entries: [{ ...collectorEntry, pricePerLiter: 0 }] }),
  });

  assert.equal(summary.ownerGeneratedVolume, 90);
  assert.equal(summary.ownerGeneratedGross, null);
  assert.equal(summary.collectorGross, null);
  assert.equal(summary.collectorSurplusAmount, null);
  assert.equal(summary.collectorPayable, null);
  assert.equal(summary.collectorPayableFromBreakdown, null);
  assert.equal(summary.collectorIsReconciled, null);
});

test('half-month ukwezi range stays within the selected historical period for the chosen month and year', () => {
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'first-half', month: 2, year: 2024, now: new Date(2026, 9, 2) }), ['2024-02-01', '2024-02-15']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'second-half', month: 2, year: 2024, now: new Date(2026, 9, 2) }), ['2024-02-16', '2024-02-29']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'first-half', month: 6, year: 2025, now: new Date(2025, 5, 20) }), ['2025-06-01', '2025-06-15']);
});

test('center-filtered historical Collector Ukwezi keeps owner milk while scoping farmer payable', async () => {
  const centerCalls = [];
  const scopedFarmer = { ...farmerRows[0], totalVolume: 40, grossAmount: 16000, totalTransport: 1200, totalDeductions: 500, netAmount: 14300 };
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { periodType: 'first-half', month: '2', year: '2024', collectionCenter: 'North Site' },
    repository: {
      ...reportRepository({ entries: [{ ...collectorEntry, date: '2024-02-03', volumeLiters: 100, effectiveVolumeLiters: 100 }] }),
      getFarmerTotals: async () => [scopedFarmer],
      getCollectorEntries: async ({ startDate, endDate }) => {
        assert.deepEqual([startDate, endDate], ['2024-02-01', '2024-02-15']);
        return [{ ...collectorEntry, date: '2024-02-03', volumeLiters: 100, effectiveVolumeLiters: 100 }];
      },
      getFarmerValidLitersByDate: async (filters) => {
        centerCalls.push(filters);
        return new Map([['2024-02-03', 40]]);
      },
      getFarmerValidTotalsByDate: async (filters) => {
        centerCalls.push(filters);
        return new Map([['2024-02-03', { validLiters: 40, originalLiters: 40, lostLiters: 0, grossAmount: 16000 }]]);
      },
    },
  });

  assert.equal(summary.rangeStart, '2024-02-01');
  assert.equal(summary.rangeEnd, '2024-02-15');
  assert.equal(summary.ownerGeneratedVolume, 100);
  assert.equal(summary.collectorFarmersValidLiters, 40);
  assert.equal(summary.collectorSurplusLiters, 60);
  assert.equal(summary.collectorTotalFarmersPayable, 16000);
  assert.equal(summary.collectorFarmerTransport, 1200);
  assert.equal(summary.collectorFarmerDeductions, 500);
  assert.equal(summary.collectorIsReconciled, true);
  assert.deepEqual(centerCalls.map((filters) => filters.centerFilter), ['north site', 'north site']);
});

test('collection center dairy reports keep transport at zero and exclude the collector transport layer', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 77,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository: {
      ...reportRepository({ accountType: 'COLLECTION_CENTER' }),
      getUserProfile: async () => ({ id: 77, name: 'Dairy A', accountType: 'COLLECTION_CENTER', nationalId: null, accountNumber: null, phone: null }),
      getFarmerTotals: async () => [{
        farmerId: 1,
        farmerName: 'Abacunda A',
        totalVolume: 85,
        grossAmount: 34000,
        totalTransport: 0,
        totalDeductions: 1500,
        netAmount: 32500,
      }],
      getPeriodTotals: async () => ({ totalMorning: 85, totalEvening: 0, totalVolume: 85, totalAmount: 34000 }),
      getTotalDeductions: async () => 1500,
      getDairyCollectorTotals: async () => [],
    },
  });

  assert.equal(summary.totalTransport, 0);
  assert.equal(summary.totalTransportFeesMonth, 0);
  assert.equal(summary.collectorFarmerTransport, 0);
  assert.equal(summary.ownerSettlementRow.totalTransport, 0);
  assert.equal(summary.netRevenueMonth, 32500);
});

test('collector report settles a completely inactive period at zero without requiring a price', async () => {
  const emptyFarmerRows = farmerRows.map((farmer) => ({
    ...farmer,
    totalVolume: 0,
    grossAmount: 0,
    totalTransport: 0,
    totalDeductions: 0,
    netAmount: 0,
  }));
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-10-16', endDate: '2026-10-31' },
    repository: {
      ...reportRepository({ entries: [] }),
      getPeriodTotals: async () => ({ totalVolume: 0 }),
      getTotalDeductions: async () => 0,
      getFarmerTotals: async () => emptyFarmerRows,
    },
  });

  assert.equal(summary.ownerGeneratedVolume, 0);
  assert.equal(summary.ownerGeneratedGross, 0);
  assert.equal(summary.collectorPayable, 0);
  assert.equal(summary.collectorPayableFromBreakdown, 0);
  assert.equal(summary.collectorIsReconciled, true);
});

test('collector report reads farmer totals and deductions from only the assigned dairy scope', async () => {
  const calls = [];
  const repository = {
    ...reportRepository(),
    getUserProfile: async (id) => ({ id, name: 'Collector A', accountType: 'COLLECTOR' }),
    getCollectorDairyOwnerId: async (collectorUserId) => collectorUserId === 99 ? 42 : null,
    getTotalFarmers: async (input) => { calls.push(['farmers', input]); return 1; },
    getPeriodTotals: async (input) => { calls.push(['milk', input]); return { totalVolume: 85 }; },
    getTodayTotals: async (input) => { calls.push(['today', input]); return {}; },
    getTotalDeductions: async (input) => { calls.push(['deductions', input]); return 1500; },
    getFarmerTotals: async (input) => { calls.push(['farmerTotals', input]); return farmerRows; },
    getFarmerValidLitersByDate: async (input) => { calls.push(['validLiters', input]); return new Map([['2026-06-01', 85]]); },
  };

  await Reports.getSummary({ ownerUserId: 99, query: { periodType: 'current-half' }, repository, now: new Date(2026, 9, 2) });

  for (const [, input] of calls) {
    assert.equal(input.ownerUserId, 42);
    assert.equal(input.collectorUserId, 99);
  }
  assert.equal(calls.find(([name]) => name === 'validLiters')[1].ownerUserId, 42);
});

test('unassigned Collector settlement includes directly owned farmers without assignment filtering', async () => {
  const filters = {};
  const repository = {
    ...reportRepository(),
    getCollectorDairyOwnerId: async () => null,
    getTotalFarmers: async (input) => { filters.count = input; return 1; },
    getPeriodTotals: async (input) => { filters.milk = input; return { totalMorning: 85, totalEvening: 0, totalVolume: 85, totalAmount: 34000 }; },
    getTodayTotals: async (input) => { filters.today = input; return {}; },
    getTotalDeductions: async (input) => { filters.deductions = input; return 1500; },
    getFarmerTotals: async (input) => { filters.farmers = input; return farmerRows; },
    getFarmerValidLitersByDate: async (input) => { filters.validLiters = input; return new Map([['2026-06-01', 85]]); },
  };

  const summary = await Reports.getSummary({
    ownerUserId: 99,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository,
  });

  for (const key of ['count', 'milk', 'today', 'deductions', 'farmers']) {
    assert.equal(filters[key].ownerUserId, 99);
    assert.equal(filters[key].collectorUserId, null);
  }
  assert.equal(filters.validLiters.ownerUserId, 99);
  assert.equal(filters.validLiters.collectorUserId, null);
  assert.equal(summary.totalFarmers, 1);
  assert.equal(summary.farmerPayments.length, 1);
});

test('Dairy report projects one settlement row per linked Collector and does not expose a farmer ledger', async () => {
  const profile = { id: 99, name: 'Linked Collector', accountType: 'COLLECTOR' };
  const summary = await Reports.getSummary({
    ownerUserId: 77,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository: reportRepository({
      accountType: 'COLLECTION_CENTER',
      links: [{ farmerId: 3, farmerName: 'Assigned Farmer', accountNumber: 'A-3', collectorUserId: 99 }],
      allowed: [99],
      profiles: [profile],
    }),
  });
  assert.equal(summary.collectorSettlementRows.length, 1);
  assert.equal(summary.collectorSettlementRows[0].collectorUserId, 99);
  assert.equal(summary.collectorSettlementRows[0].name, 'Linked Collector');
  assert.equal(summary.collectorSettlementRows[0].assignedFarmerCount, 1);
  assert.deepEqual(summary.farmerPayments, []);
});

test('Dairy reports scope every farmer and milk aggregate to active assignments and the selected Ikigo', async () => {
  const filters = [];
  const repository = {
    ...reportRepository({ accountType: 'COLLECTION_CENTER' }),
    getUserProfile: async (id) => ({ id, name: 'Dairy A', accountType: 'COLLECTION_CENTER' }),
    getTotalFarmers: async (input) => { filters.push(input); return 0; },
    getPeriodTotals: async (input) => { filters.push(input); return {}; },
    getTodayTotals: async (input) => { filters.push(input); return {}; },
    getFarmerTotals: async (input) => { filters.push(input); return []; },
    getMilkLossRecords: async (input) => { filters.push(input); return []; },
    getDairyCollectorTotals: async (input) => { filters.push(input); return []; },
  };

  await Reports.getSummary({
    ownerUserId: 77,
    query: { periodType: 'first-half', month: '10', year: '2026', collectionCenter: 'Latina' },
    repository,
  });

  assert.equal(filters.length, 6);
  for (const input of filters.slice(0, 5)) {
    assert.equal(input.ownerUserId, 77);
    assert.equal(input.centerFilter, 'latina');
    assert.equal(input.assignedCollectorOnly, true);
  }
  assert.equal(filters[5].ownerUserId, 77);
});

test('collection-center summary excludes transport from dairy payable math while keeping collector transport separate', async () => {
  const dairyRepository = {
    ...reportRepository({ accountType: 'COLLECTION_CENTER' }),
    getUserProfile: async (id) => ({ id, name: 'Dairy A', accountType: 'COLLECTION_CENTER', nationalId: null, accountNumber: null, phone: null }),
    getTotalFarmers: async () => 1,
    getPeriodTotals: async () => ({ totalMorning: 85, totalEvening: 0, totalVolume: 85, totalAmount: 34000 }),
    getTodayTotals: async () => ({ todayMorning: 0, todayEvening: 0, todayTotal: 0, todayAmount: 0 }),
    getTotalDeductions: async () => 1500,
    getFarmerTotals: async () => [{
      farmerId: 1,
      farmerName: 'Aline',
      totalVolume: 85,
      grossAmount: 34000,
      totalTransport: 2500,
      totalDeductions: 1500,
      otherDeductions: 1500,
      netAmount: 30000,
    }],
  };

  const summary = await Reports.getSummary({
    ownerUserId: 77,
    query: { startDate: '2026-06-01', endDate: '2026-06-30' },
    repository: dairyRepository,
  });

  assert.equal(summary.totalTransport, 0);
  assert.equal(summary.totalTransportFeesMonth, 0);
  assert.equal(summary.netAmount, 34000);
  assert.equal(summary.collectorPayable, null);
  assert.deepEqual(summary.farmerPayments, []);
  assert.equal(summary.ownerSettlementRow.name, 'Dairy A');
  assert.equal(summary.ownerSettlementRow.totalVolume, 85);
  assert.equal(summary.ownerSettlementRow.grossAmount, 34000);
  assert.equal(summary.ownerSettlementRow.totalTransport, 0);
  assert.equal(summary.ownerSettlementRow.netAmount, 34000);
});

test('invalid report ranges and filters are rejected before repository reads', async () => {
  const repository = { getTotalFarmers: async () => { throw new Error('should not query'); } };
  await assert.rejects(() => Reports.getSummary({ ownerUserId: 42, query: { startDate: '2026-06-01' }, repository }), /Both startDate and endDate/i);
  await assert.rejects(() => Reports.getSummary({ ownerUserId: 42, query: { startDate: '2026-02-30', endDate: '2026-03-01' }, repository }), /Invalid startDate/i);
});

test('farmer totals SQL parameterizes all owner, period, farmer, and center filters', () => {
  const query = ReportRepository.buildFarmerTotalsQuery({
    ownerUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-30',
    centerFilter: 'North Site',
    farmerId: 7,
  });
  assert.match(query.text, /f\.owner_user_id = \$1/);
  assert.match(query.text, /mr\.owner_user_id = f\.owner_user_id/);
  assert.match(query.text, /d\.owner_user_id = f\.owner_user_id/);
  assert.match(query.text, /mr\.date BETWEEN \$2 AND \$3/);
  assert.match(query.text, /f\.id = \$4/);
  assert.match(query.text, /LOWER\(BTRIM\(\$5\)\)/);
  assert.match(query.text, /prices\.effective_date <= mr\.date/);
  assert.deepEqual(query.values, [42, '2026-06-01', '2026-06-30', 7, 'North Site']);
});

test('farmer totals SQL can additionally scope assigned collectors', () => {
  const query = ReportRepository.buildFarmerTotalsQuery({
    ownerUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-30',
    collectorUserId: 99,
  });
  assert.match(query.text, /f\.collector_user_id = \$4/);
  assert.deepEqual(query.values, [42, '2026-06-01', '2026-06-30', 99]);
});

test('Dairy farmer and loss SQL require a current owner-matched collector assignment', () => {
  const farmerQuery = ReportRepository.buildFarmerTotalsQuery({
    ownerUserId: 77,
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    centerFilter: 'latina',
    assignedCollectorOnly: true,
  });
  const lossQuery = ReportRepository.buildMilkLossRecordsQuery({
    ownerUserId: 77,
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    centerFilter: 'latina',
    assignedCollectorOnly: true,
  });

  for (const query of [farmerQuery, lossQuery]) {
    assert.match(query.text, /ca\.dairy_user_id = f\.owner_user_id/);
    assert.match(query.text, /ca\.collector_user_id = f\.collector_user_id/);
    assert.match(query.text, /ca\.revoked_at IS NULL/);
    assert.deepEqual(query.values, [77, '2026-10-01', '2026-10-15', 'latina']);
  }
});

test('Collector farmer transport is calculated once from valid litres and the owner center configuration', () => {
  const query = ReportRepository.buildFarmerTotalsQuery({ ownerUserId: 42, rangeStart: '2026-06-01', rangeEnd: '2026-06-15' });
  assert.match(query.text, /SUM\(COALESCE\(mr\.valid_volume_liters, mr\.volume_liters\) \* COALESCE\(c\.transport_rate_per_liter, 0\)\)/);
  assert.match(query.text, /c\.owner_user_id = f\.owner_user_id/);
  assert.match(query.text, /prices\.effective_date <= mr\.date/);
  assert.match(query.text, /COALESCE\(mr\.status, 'valid'\) <> 'cancelled'/);
});

test('active deduction queries whitelist supported farmer deduction types', () => {
  const farmerQuery = ReportRepository.buildFarmerTotalsQuery({
    ownerUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
  });
  const deductionQuery = ReportRepository.buildTotalDeductionsQuery({
    ownerUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
  });

  for (const query of [farmerQuery, deductionQuery]) {
    assert.doesNotMatch(query.text, /ejoheza/i);
  }
  assert.match(deductionQuery.text, /LOWER\(BTRIM\(d\.type\)\) IN \('other', 'advance', 'umwenda'\)/);
});

test('active farmer totals omit unsupported deduction categories', () => {
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
  assert.equal(Object.hasOwn(farmer, 'ejohezaDeductions'), false);
  assert.equal(farmer.ifishiTotalDeductions, 1000);
  assert.equal(farmer.netAmount, 6500);
  assert.equal(farmer.ifishiNetAmount, 6500);
  assert.equal(farmer.originalVolume, 22);
  assert.equal(farmer.lostVolume, 2);
});

test('monthly summary omits unsupported deduction categories', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-10-01', endDate: '2026-10-15', farmerId: 7 },
    repository: {
      ...reportRepository(),
      getUserProfile: async (id) => ({ id, name: 'Collector A', accountType: 'COLLECTOR' }),
      getFarmerTotals: async () => [{
        farmerId: 7,
        farmerName: 'Aline',
        totalVolume: 20,
        grossAmount: 8000,
        totalTransport: 500,
        totalDeductions: 1000,
        otherDeductions: 1000,
        netAmount: 6500,
        ifishiTotalDeductions: 1000,
        ifishiNetAmount: 6500,
      }],
      getMilkLossRecords: async () => [],
    },
  });
  assert.equal(Object.hasOwn(summary, 'totalEjoHeza'), false);
  assert.equal(Object.hasOwn(summary.farmerPayments[0], 'ejohezaDeductions'), false);
  assert.equal(summary.farmerPayments[0].ifishiNetAmount, 6500);
});

test('milk loss query remains date-, farmer-, collector-, and owner-scoped', () => {
  const losses = ReportRepository.buildMilkLossRecordsQuery({
    ownerUserId: 42,
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    farmerId: 7,
    collectorUserId: 99,
  });
  assert.match(losses.text, /mr\.owner_user_id = \$1/);
  assert.match(losses.text, /mr\.date BETWEEN \$2 AND \$3/);
  assert.match(losses.text, /status, 'valid'\) = 'cancelled'/);
  assert.match(losses.text, /f\.id = \$4/);
  assert.match(losses.text, /f\.collector_user_id = \$5/);
  assert.deepEqual(losses.values, [42, '2026-10-01', '2026-10-15', 7, 99]);
});

test('cancelled Collector milk remains in report history but contributes no valid volume or value', async () => {
  const cancelledEntry = { date: '2026-06-10', volumeLiters: 80, effectiveVolumeLiters: 0, farmerLostLiters: 0, pricePerLiter: 400, status: 'cancelled', voidReason: 'Contaminated' };
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-15' },
    repository: {
      ...reportRepository({ entries: [cancelledEntry] }),
      getFarmerTotals: async () => [],
      getFarmerValidLitersByDate: async () => new Map(),
      getPeriodTotals: async () => ({ totalVolume: 0, totalAmount: 0 }),
      getTotalDeductions: async () => 0,
    },
  });
  assert.equal(summary.collectorOriginalVolume, 80);
  assert.equal(summary.collectorLostVolume, 80);
  assert.equal(summary.collectorEffectiveVolume, 0);
  assert.equal(summary.collectorGross, 0);
  assert.equal(summary.collectorEntries[0].status, 'cancelled');
});

test('monthly report omits unsupported categories and retains owner-scoped void/loss history', async () => {
  const calls = [];
  const lossRecord = { id: 88, farmerId: 7, farmerName: 'Aline', date: '2026-10-04', status: 'adjusted', originalVolume: 20, validVolume: 18, lostVolume: 2, reason: 'Spillage', adjustedBy: 42, adjustedAt: '2026-10-04T09:00:00Z' };
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-10-01', endDate: '2026-10-15', farmerId: 7 },
    repository: {
      ...reportRepository(),
      getUserProfile: async (id) => ({ id, name: 'Collector A', accountType: 'COLLECTOR' }),
      getFarmerTotals: async () => [{ ...farmerRows[0], farmerId: 7, ifishiTotalDeductions: 1800, ifishiNetAmount: 28200 }],
      getMilkLossRecords: async (filters) => { calls.push(['losses', filters]); return [lossRecord]; },
    },
  });
  assert.equal(Object.hasOwn(summary, 'totalEjoHeza'), false);
  assert.equal(Object.hasOwn(summary.farmerPayments[0], 'ejohezaDeductions'), false);
  assert.equal(summary.farmerPayments[0].ifishiNetAmount, 30000);
  assert.deepEqual(summary.milkLossRecords, [lossRecord]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'losses');
  assert.equal(calls[0][1].ownerUserId, 42);
});

test('Collector payable reconciles surplus, farmer deductions, and configured transport exactly once', async () => {
  const sheet = await Reports.calculateCollectorBalanceSheet({
    collectorUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
    farmerTotals: [
      { totalVolume: 50, grossAmount: 20000, totalDeductions: 1000, totalTransport: 1500, netAmount: 17500 },
      { totalVolume: 35, grossAmount: 14000, totalDeductions: 500, totalTransport: 1000, netAmount: 12500 },
    ],
    repository: {
      getCollectorEntries: async () => [{ date: '2026-06-01', volumeLiters: 90, effectiveVolumeLiters: 90, pricePerLiter: 400, status: 'valid' }],
      getFarmerValidLitersByDate: async () => new Map([['2026-06-01', 85]]),
    },
  });

  assert.equal(sheet.collectorEffectiveLiters, 90);
  assert.equal(sheet.collectorFarmersValidLiters, 85);
  assert.equal(sheet.collectorSurplusLiters, 5);
  assert.equal(sheet.collectorGross, 36000);
  assert.equal(sheet.collectorTotalFarmersPayable, 34000);
  assert.equal(sheet.collectorSurplusAmount, 2000);
  assert.equal(sheet.collectorFarmerDeductions, 1500);
  assert.equal(sheet.collectorFarmerTransport, 2500);
  assert.equal(sheet.collectorPayable, 6000);
  assert.equal(sheet.collectorPayableFromBreakdown, 6000);
  assert.equal(sheet.isReconciled, true);
});

test('Collector owner total falls back to assigned valid milk when no owner entry exists', async () => {
  const summary = await Reports.getSummary({
    ownerUserId: 42,
    query: { startDate: '2026-06-01', endDate: '2026-06-15' },
    repository: {
      ...reportRepository({ entries: [] }),
      getPeriodTotals: async () => ({ totalVolume: 85, totalAmount: 34000 }),
      getFarmerTotals: async () => [{ ...farmerRows[0], totalVolume: 85, originalVolume: 90, lostVolume: 5, grossAmount: 34000, totalTransport: 2500, totalDeductions: 1500, netAmount: 30000 }],
      getFarmerValidLitersByDate: async () => new Map([['2026-06-01', 85]]),
    },
  });

  assert.equal(summary.ownerGeneratedVolume, 85);
  assert.equal(summary.ownerGeneratedGross, 34000);
  assert.equal(summary.collectorFarmersValidLiters, 85);
  assert.equal(summary.collectorSurplusLiters, 0);
  assert.equal(summary.collectorPayable, 4000);
  assert.equal(summary.collectorIsReconciled, true);
});

test('zero and owner-only/surplus-only Collector periods reconcile without farmer double counting', async () => {
  const empty = await Reports.calculateCollectorBalanceSheet({
    collectorUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
    farmerTotals: [],
    repository: {
      getCollectorEntries: async () => [],
      getFarmerValidLitersByDate: async () => new Map(),
    },
  });
  const ownerOnly = await Reports.calculateCollectorBalanceSheet({
    collectorUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
    farmerTotals: [],
    repository: {
      getCollectorEntries: async () => [{ date: '2026-06-02', volumeLiters: 20, effectiveVolumeLiters: 20, pricePerLiter: 400, status: 'valid' }],
      getFarmerValidLitersByDate: async () => new Map(),
    },
  });

  assert.equal(empty.collectorEffectiveLiters, 0);
  assert.equal(empty.collectorGross, 0);
  assert.equal(empty.collectorPayable, 0);
  assert.equal(empty.isReconciled, true);
  assert.equal(ownerOnly.collectorEffectiveLiters, 20);
  assert.equal(ownerOnly.collectorFarmersValidLiters, 0);
  assert.equal(ownerOnly.collectorSurplusLiters, 20);
  assert.equal(ownerOnly.collectorSurplusAmount, 8000);
  assert.equal(ownerOnly.collectorPayable, 8000);
  assert.equal(ownerOnly.isReconciled, true);
});

test('Collector reconciliation preserves different applicable owner and farmer historical prices', async () => {
  const sheet = await Reports.calculateCollectorBalanceSheet({
    collectorUserId: 42,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
    farmerTotals: [{ totalVolume: 85, grossAmount: 34000, totalDeductions: 1500, totalTransport: 2500, netAmount: 30000 }],
    repository: {
      getCollectorEntries: async () => [{ date: '2026-06-01', volumeLiters: 90, effectiveVolumeLiters: 90, pricePerLiter: 370, status: 'valid' }],
      getFarmerValidLitersByDate: async () => new Map([['2026-06-01', 85]]),
    },
  });

  assert.equal(sheet.collectorGross, 33300);
  assert.equal(sheet.collectorSurplusAmount, -700);
  assert.equal(sheet.collectorPayable, 3300);
  assert.equal(sheet.settlementTotal, 33300);
  assert.equal(sheet.isReconciled, true);
});

test('Collector owner total subtracts assigned-Dairy farmer losses once from the owner daily aggregate', async () => {
  const sheet = await Reports.calculateCollectorBalanceSheet({
    collectorUserId: 99,
    farmerOwnerUserId: 42,
    farmerCollectorUserId: 99,
    rangeStart: '2026-06-01',
    rangeEnd: '2026-06-15',
    farmerTotals: [{ totalVolume: 95, originalVolume: 100, lostVolume: 5, grossAmount: 38000, totalDeductions: 0, totalTransport: 0, netAmount: 38000 }],
    repository: {
      getCollectorEntries: async () => [{ date: '2026-06-01', volumeLiters: 100, validVolumeLiters: 100, effectiveVolumeLiters: 100, pricePerLiter: 400, status: 'valid' }],
      getFarmerValidLitersByDate: async () => new Map([['2026-06-01', 95]]),
      getFarmerValidTotalsByDate: async () => new Map([['2026-06-01', { validLiters: 95, originalLiters: 100, lostLiters: 5, grossAmount: 38000 }]]),
    },
  });

  assert.equal(sheet.collectorOriginalLiters, 100);
  assert.equal(sheet.collectorLostLiters, 5);
  assert.equal(sheet.collectorEffectiveLiters, 95);
  assert.equal(sheet.collectorGross, 38000);
  assert.equal(sheet.collectorSurplusLiters, 0);
  assert.equal(sheet.isReconciled, true);
});

test('Dairy selected-center payout uses collector aggregates and excludes farmer deductions and transport', async () => {
  let collectorFilters;
  const summary = await Reports.getSummary({
    ownerUserId: 77,
    query: { startDate: '2026-06-01', endDate: '2026-06-15', collectionCenter: 'North Site' },
    repository: {
      ...reportRepository({ accountType: 'COLLECTION_CENTER', links: [], allowed: [], profiles: [] }),
      getUserProfile: async (id) => ({ id, name: 'Dairy A', accountType: 'COLLECTION_CENTER' }),
      getPeriodTotals: async () => ({ totalVolume: 85, totalAmount: 34000 }),
      getTotalDeductions: async () => 9900,
      getFarmerTotals: async () => [{ ...farmerRows[0], totalVolume: 85, grossAmount: 34000, totalDeductions: 9900, totalTransport: 8000 }],
      getDairyCollectorTotals: async (filters) => {
        collectorFilters = filters;
        return [
          { collectorUserId: 99, name: 'Abacunda A', assignedFarmerCount: 1, totalVolume: 50, grossAmount: 20000 },
          { collectorUserId: 100, name: 'Abacunda B', assignedFarmerCount: 1, totalVolume: 35, grossAmount: 14000 },
        ];
      },
    },
  });

  assert.deepEqual(collectorFilters, { ownerUserId: 77, rangeStart: '2026-06-01', rangeEnd: '2026-06-15', centerFilter: 'north site' });
  assert.equal(summary.totalVolume, 85);
  assert.equal(summary.totalDeductionsMonth, 34000);
  assert.equal(summary.totalTransport, 0);
  assert.equal(summary.totalTransportFeesMonth, 0);
  assert.equal(summary.netRevenueMonth, 0);
  assert.deepEqual(summary.farmerPayments, []);
  assert.equal(summary.collectorSettlementRows.length, 2);
  assert.equal(summary.collectorSettlementRows[0].netAmount + summary.collectorSettlementRows[1].netAmount, 34000);
  assert.equal(summary.collectorSettlementRows[0].totalDeductions + summary.collectorSettlementRows[1].totalDeductions, 34000);
  assert.equal(summary.collectorSettlementRows[0].totalTransport + summary.collectorSettlementRows[1].totalTransport, 0);
  assert.equal(summary.ownerSettlementRow.totalDeductions, 34000);
  assert.equal(summary.ownerSettlementRow.netAmount, 0);
});

test('Dairy accounting rejects browser-supplied farmer filters instead of exposing farmer settlement scope', async () => {
  let dataQueryCalled = false;
  await assert.rejects(() => Reports.getSummary({
    ownerUserId: 77,
    query: { periodType: 'first-half', month: 6, year: 2026, farmerId: 9 },
    repository: {
      getUserProfile: async (id) => ({ id, accountType: 'COLLECTION_CENTER' }),
      getTotalFarmers: async () => { dataQueryCalled = true; return 0; },
    },
  }), /farmer filters are not available/i);
  assert.equal(dataQueryCalled, false);
});

test('historical half-month boundaries ignore today and support leap-month end dates', () => {
  const today = new Date(2030, 0, 1);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'first-half', month: 2, year: 2024, now: today }), ['2024-02-01', '2024-02-15']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'second-half', month: 2, year: 2024, now: today }), ['2024-02-16', '2024-02-29']);
  assert.deepEqual(Reports.getPeriodRange({ periodType: 'second-half', month: 6, year: 2025, now: today }), ['2025-06-16', '2025-06-30']);
});

test('active report response and deduction SQL do not expose retired deduction categories', async () => {
  const summary = await Reports.getSummary({ ownerUserId: 42, query: { startDate: '2026-06-01', endDate: '2026-06-15' }, repository: reportRepository() });
  const farmerQuery = ReportRepository.buildFarmerTotalsQuery({ ownerUserId: 42, rangeStart: '2026-06-01', rangeEnd: '2026-06-15' });
  const deductionsQuery = ReportRepository.buildTotalDeductionsQuery({ ownerUserId: 42, rangeStart: '2026-06-01', rangeEnd: '2026-06-15' });

  assert.equal(Object.hasOwn(summary, 'totalEjoHeza'), false);
  assert.equal(Object.hasOwn(summary.farmerPayments[0], 'ejohezaDeductions'), false);
  assert.doesNotMatch(farmerQuery.text, /ejoheza/i);
  assert.doesNotMatch(deductionsQuery.text, /ejoheza/i);
  assert.match(deductionsQuery.text, /LOWER\(BTRIM\(d\.type\)\) IN \('other', 'advance', 'umwenda'\)/);
});

test('Dairy collector SQL is owner-, assignment-, period-, and selected-center-scoped with no Collector-only charges', () => {
  const query = ReportRepository.buildDairyCollectorTotalsQuery({
    ownerUserId: 77,
    rangeStart: '2026-06-16',
    rangeEnd: '2026-06-30',
    centerFilter: 'north site',
  });

  assert.deepEqual(query.values, [77, '2026-06-16', '2026-06-30', 'north site']);
  assert.match(query.text, /ca\.dairy_user_id = \$1/);
  assert.match(query.text, /ca\.revoked_at IS NULL/);
  assert.match(query.text, /f\.owner_user_id = ca\.dairy_user_id/);
  assert.match(query.text, /u\.id = ca\.collector_user_id AND u\.account_type = 'COLLECTOR'/);
  assert.match(query.text, /mr\.date BETWEEN \$2 AND \$3/);
  assert.match(query.text, /LOWER\(BTRIM\(\$4\)\)/);
  assert.match(query.text, /mr\.status = 'cancelled'/);
  assert.match(query.text, /prices\.effective_date <= mr\.date/);
  assert.doesNotMatch(query.text, /transport|deductions|ejoheza/i);
});

test('Dairy center selection changes only the owner-scoped center filter, not tenant identity', () => {
  const north = ReportRepository.buildDairyCollectorTotalsQuery({ ownerUserId: 77, rangeStart: '2026-06-01', rangeEnd: '2026-06-15', centerFilter: 'north site' });
  const south = ReportRepository.buildDairyCollectorTotalsQuery({ ownerUserId: 77, rangeStart: '2026-06-01', rangeEnd: '2026-06-15', centerFilter: 'south site' });
  const otherOwner = ReportRepository.buildDairyCollectorTotalsQuery({ ownerUserId: 88, rangeStart: '2026-06-01', rangeEnd: '2026-06-15', centerFilter: 'north site' });

  assert.deepEqual(north.values, [77, '2026-06-01', '2026-06-15', 'north site']);
  assert.deepEqual(south.values, [77, '2026-06-01', '2026-06-15', 'south site']);
  assert.deepEqual(otherOwner.values, [88, '2026-06-01', '2026-06-15', 'north site']);
  assert.match(otherOwner.text, /ca\.dairy_user_id = \$1/);
});

test('Collector daily farmer aggregation binds authenticated owner and assigned collector without canceled volume', async () => {
  let captured;
  await ReportRepository.getFarmerValidTotalsByDate({
    ownerUserId: 42,
    collectorUserId: 99,
    rangeStart: '2026-06-16',
    rangeEnd: '2026-06-30',
    runQuery: async (text, values) => {
      captured = { text, values };
      return { rows: [{ date: '2026-06-20', valid_liters: 40, original_liters: 45, lost_liters: 5, gross_amount: 16000 }] };
    },
  });

  assert.deepEqual(captured.values, [42, '2026-06-16', '2026-06-30', 99]);
  assert.match(captured.text, /mr\.owner_user_id = \$1/);
  assert.match(captured.text, /f\.collector_user_id = \$4/);
  assert.match(captured.text, /mr\.status = 'cancelled' THEN 0/);
  assert.match(captured.text, /prices\.effective_date <= mr\.date/);
});

test('historical farmer aggregate keys preserve PostgreSQL date-only values', async () => {
  const dailyLiters = await ReportRepository.getFarmerValidLitersByDate({
    ownerUserId: 42,
    rangeStart: '2026-06-16',
    rangeEnd: '2026-06-30',
    runQuery: async () => ({ rows: [{ date: new Date(2026, 5, 20), valid_liters: 40 }] }),
  });
  const dailyTotals = await ReportRepository.getFarmerValidTotalsByDate({
    ownerUserId: 42,
    rangeStart: '2026-06-16',
    rangeEnd: '2026-06-30',
    runQuery: async () => ({ rows: [{ date: new Date(2026, 5, 20), valid_liters: 40, original_liters: 45, lost_liters: 5, gross_amount: 16000 }] }),
  });

  assert.equal(dailyLiters.get('2026-06-20'), 40);
  assert.deepEqual(dailyTotals.get('2026-06-20'), { validLiters: 40, originalLiters: 45, lostLiters: 5, grossAmount: 16000 });
});
