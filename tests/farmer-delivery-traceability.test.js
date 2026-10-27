const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseFarmerNumber,
  formatFarmerNumber,
  calculateDeliveryReconciliation,
  enumerateIsoDates,
  calculateFarmerDeliveryHistory,
} = require('../lib/farmer-delivery.js');
const DomainRepository = require('../lib/repositories/domainRepository.js');
const MilkRepository = require('../lib/repositories/milkRepository.js');
const Milk = require('../lib/services/milk-service.js');

const root = path.resolve(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

const workspace = read('app', 'workspace.tsx');
const styles = read('app', 'globals.css');
const migration = read('supabase', 'migrations', '021_farmer_numbers.sql');
const historyRoute = read('app', 'api', 'farmers', '[id]', 'delivery-history', 'route.js');
const dailyRoute = read('app', 'api', 'milk', 'daily', 'route.js');
const farmersRoute = read('app', 'api', 'farmers', 'route.ts');
const healthRoute = read('app', 'api', 'health', 'route.ts');

test('permanent farmer numbers are stored, parsed, and formatted consistently', () => {
  for (const value of ['17', 'No. 17', 'No 17', '#17', 'number 17', '0017']) {
    assert.equal(parseFarmerNumber(value), 17, `${value} should resolve to farmer 17`);
  }
  assert.equal(formatFarmerNumber(17), 'No. 17');
  assert.equal(formatFarmerNumber('17'), 'No. 17');
  assert.equal(formatFarmerNumber(null), '');
  assert.equal(formatFarmerNumber(''), '');
  for (const value of ['0', '17A', 'farmer 17', '-17', '1.5', null]) {
    assert.equal(parseFarmerNumber(value), null, `${value} is not a farmer number`);
  }

  const query = DomainRepository.buildFarmerListQuery({ ownerUserId: 42, search: '', limit: 25 });
  assert.match(query.text, /farmer_number::integer AS "farmerNumber"/);
  assert.doesNotMatch(query.text, /ROW_NUMBER/i);
});

test('farmer directory search matches number, name, phone, national id, and account number', () => {
  const numberQuery = DomainRepository.buildFarmerListQuery({ ownerUserId: 42, search: 'No. 17', limit: 25 });
  assert.deepEqual(numberQuery.values, [42, 17, '%No. 17%', 26]);
  assert.match(numberQuery.text, /farmer_number = \$2/);
  assert.match(numberQuery.text, /name ILIKE \$3/);
  assert.match(numberQuery.text, /phone ILIKE \$3/);
  assert.match(numberQuery.text, /national_id ILIKE \$3/);
  assert.match(numberQuery.text, /account_number ILIKE \$3/);
  assert.match(numberQuery.text, /farmer_number::text ILIKE \$3/);

  const phoneQuery = DomainRepository.buildFarmerListQuery({ ownerUserId: 42, search: '0788 123 456', limit: 10 });
  assert.deepEqual(phoneQuery.values, [42, '%0788 123 456%', 11]);
  assert.match(phoneQuery.text, /phone ILIKE \$2/);
});

test('daily delivery search accepts a farmer number, name, phone, and existing identifiers', () => {
  const numberQuery = MilkRepository.buildDairyDailyCollectionQuery({
    dairyUserId: 77,
    date: '2026-10-07',
    centerId: 8,
    search: '17',
    limit: 10,
  });
  assert.deepEqual(numberQuery.values, [77, '2026-10-07', 8, 17, '%17%', 11]);
  assert.match(numberQuery.text, /"farmerNumber" = \$4/);
  assert.match(numberQuery.text, /"farmerName" ILIKE \$5/);
  assert.match(numberQuery.text, /COALESCE\("phone", ''\) ILIKE \$5/);
  assert.match(numberQuery.text, /COALESCE\("nationalId", ''\) ILIKE \$5/);
  assert.match(numberQuery.text, /COALESCE\("accountNumber", ''\) ILIKE \$5/);
  assert.match(numberQuery.text, /"farmerNumber"::text ILIKE \$5/);

  const phoneQuery = MilkRepository.buildDairyDailyCollectionQuery({
    dairyUserId: 77,
    date: '2026-10-07',
    centerId: 8,
    search: '0788-123-456',
    limit: 10,
  });
  assert.deepEqual(phoneQuery.values, [77, '2026-10-07', 8, '%0788-123-456%', 11]);
  assert.match(phoneQuery.text, /COALESCE\("phone", ''\) ILIKE \$4/);
});

test('Ifishi search results are directly selectable and expose the permanent number', () => {
  const ifishi = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));
  assert.match(ifishi, /onClick=\{\(\) => chooseIfishiFarmer\(farmer, index\)\}/);
  assert.match(ifishi, /setIfishiFarmerId\(String\(farmer\.id\)\)/);
  assert.match(ifishi, /setIfishiFarmerSearch\(farmer\.name\)/);
  assert.match(ifishi, /setIfishiSelectedFarmer\(farmer\)/);
  assert.match(ifishi, /farmer-number-badge/);
  assert.match(ifishi, /ifishi-selected-history/);
  assert.match(ifishi, /openFarmerHistory\(selectedFarmer\)/);

  const farmerView = workspace.slice(workspace.indexOf('const renderFarmers'), workspace.indexOf('const renderCenters'));
  assert.match(farmerView, /openFarmerHistory\(farmer\)/);
  assert.match(farmerView, /openIfishiForFarmer\(farmer\.id, farmer\.name\)/);
});

test('filtered, sorted, and paginated farmer rows keep the stored permanent number', () => {
  const query = DomainRepository.buildFarmerListQuery({
    ownerUserId: 42,
    search: '17',
    center: 'North Site',
    collectorUserId: 77,
    cursor: { value: 'Miller', id: 17 },
    sortBy: 'name',
    sortDirection: 'asc',
    limit: 10,
  });

  assert.match(query.text, /farmer_number::integer AS "farmerNumber"/);
  assert.match(query.text, /ORDER BY LOWER\(BTRIM\(COALESCE\(name, ''\)\)\) ASC, id ASC/);
  assert.match(query.text, /collector_user_id = \$2/);
  assert.match(query.text, /LOWER\(BTRIM\(collection_center\)\) = LOWER\(BTRIM\(\$3\)\)/);
  assert.match(query.text, /farmer_number = \$4/);
  assert.deepEqual(query.values, [42, 77, 'North Site', 17, '%17%', 'miller', 17, 11]);
  assert.doesNotMatch(workspace, /formatFarmerNumber\(index/);
  assert.doesNotMatch(workspace, /farmerNumber:\s*index/);
});

test('delivery reconciliation derives expected, delivered, missing, and rate', () => {
  assert.deepEqual(calculateDeliveryReconciliation({ expectedCount: 10, deliveredCount: 7 }), {
    expectedCount: 10,
    deliveredCount: 7,
    missingCount: 3,
    deliveryRate: 70,
  });
  assert.equal(calculateDeliveryReconciliation({ expectedCount: 3, deliveredCount: 2 }).deliveryRate, 66.67);
  assert.deepEqual(calculateDeliveryReconciliation({ expectedCount: 8, deliveredCount: 8 }), {
    expectedCount: 8,
    deliveredCount: 8,
    missingCount: 0,
    deliveryRate: 100,
  });
});

test('zero expected farmers reports a safe 0% reconciliation', () => {
  const empty = calculateDeliveryReconciliation({ expectedCount: 0, deliveredCount: 0 });
  assert.deepEqual(empty, { expectedCount: 0, deliveredCount: 0, missingCount: 0, deliveryRate: 0 });
  assert.deepEqual(calculateDeliveryReconciliation({}), empty);
  assert.deepEqual(calculateDeliveryReconciliation({ expectedCount: null, deliveredCount: 'n/a' }), empty);
});

test('daily summary counts unique expected and delivered farmers rather than records', async () => {
  const captured = [];
  const result = await MilkRepository.getDailyCollection({
    ownerUserId: 42,
    collectorUserId: 77,
    date: '2026-10-07',
    centerId: 5,
    limit: 25,
  }, async (text, values) => {
    captured.push({ text, values });
    if (text.includes('FROM collector_assignments')) return { rows: [{ dairy_user_id: 42 }] };
    if (text.includes('FROM collection_centers WHERE id = $1 AND owner_user_id = $2')) {
      return values[1] === 77
        ? { rows: [] }
        : { rows: [{ id: 5, name: 'North Site', owner_user_id: 42, pricePerLiter: 400, transportRatePerLiter: 0 }] };
    }
    if (text.includes('SELECT DISTINCT COALESCE')) return { rows: [{ name: 'North Site' }] };
    if (text.includes('COUNT(DISTINCT f.id)')) {
      return { rows: [{ totalFarmers: 5, presentCount: 3, totalMorning: 12, totalEvening: 8, totalVolume: 20, totalAmount: 8000 }] };
    }
    if (text.includes('SELECT f.id AS "farmerId"')) {
      return { rows: [{
        farmerId: 7,
        farmerName: 'Jean Bosco',
        farmerNumber: '17',
        phone: '0788123456',
        collectorUserId: 77,
        collectorName: 'Aline',
        recordId: 51,
        status: 'valid',
        delivered: 1,
        volumeMorning: 5,
        volumeEvening: 2,
        totalVolume: 7,
        amount: 2800,
      }] };
    }
    if (text.includes('FROM collection_center_prices')) return { rows: [] };
    throw new Error(`Unexpected daily collection query: ${text}`);
  }, async () => []);

  const summaryQuery = captured.find(({ text }) => text.includes('COUNT(DISTINCT f.id)'));
  const listQuery = captured.find(({ text }) => text.includes('SELECT f.id AS "farmerId"'));
  assert.match(summaryQuery.text, /COUNT\(DISTINCT f\.id\)::integer AS "totalFarmers"/);
  assert.match(summaryQuery.text, /COUNT\(DISTINCT f\.id\) FILTER \(WHERE .*\)::integer AS "presentCount"/);
  assert.deepEqual(summaryQuery.values, ['2026-10-07', 42, 77, 'North Site']);
  assert.deepEqual(listQuery.values, ['2026-10-07', 42, 77, 'North Site', 26]);
  assert.match(listQuery.text, /f\.owner_user_id = \$2/);
  assert.match(listQuery.text, /f\.collector_user_id = \$3/);
  assert.match(listQuery.text, /f\.farmer_number::integer AS "farmerNumber"/);

  assert.equal(result.farmers[0].farmerNumber, 17);
  assert.equal(result.farmers[0].deliveryStatus, 'delivered');
  assert.deepEqual(result.summary, {
    totalFarmers: 5,
    presentCount: 3,
    missedCount: 2,
    expectedCount: 5,
    deliveredCount: 3,
    missingCount: 2,
    deliveryRate: 60,
    totalMorning: 12,
    totalEvening: 8,
    totalVolume: 20,
    totalAmount: 8000,
    pricePerLiter: 400,
    transportRate: 0,
  });
});

test('cancelled and zero-volume records are not counted as delivered', () => {
  const history = calculateFarmerDeliveryHistory({
    farmer: { createdDate: '2026-10-01' },
    today: '2026-10-04',
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    records: [
      { id: 1, date: '2026-10-01', status: 'valid', volumeMorning: 5, volumeEvening: 0 },
      { id: 2, date: '2026-10-02', status: 'cancelled', volumeMorning: 4, volumeEvening: 0, validVolumeMorning: 0 },
      { id: 3, date: '2026-10-03', status: 'valid', volumeMorning: 0, volumeEvening: 0 },
      { id: 4, date: '2026-10-04', status: 'adjusted', volumeMorning: 2, volumeEvening: 0, validVolumeMorning: 2 },
    ],
  });

  const days = Object.fromEntries(history.days.map((day) => [day.date, day]));
  assert.equal(days['2026-10-01'].deliveryStatus, 'delivered');
  assert.equal(days['2026-10-02'].deliveryStatus, 'missing');
  assert.equal(days['2026-10-02'].status, 'cancelled');
  assert.equal(days['2026-10-03'].deliveryStatus, 'missing');
  assert.equal(days['2026-10-04'].deliveryStatus, 'delivered');
  assert.equal(history.deliveredDays, 2);
  assert.deepEqual(history.missedDates, ['2026-10-02', '2026-10-03']);
});

test('morning and evening sessions reconcile independently and together', () => {
  const input = {
    farmer: { createdDate: '2026-10-01' },
    today: '2026-10-03',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    records: [
      { date: '2026-10-01', status: 'valid', volumeMorning: 5, volumeEvening: 0 },
      { date: '2026-10-02', status: 'valid', volumeMorning: 0, volumeEvening: 4 },
      { date: '2026-10-03', status: 'valid', volumeMorning: 2, volumeEvening: 3 },
    ],
  };
  const morning = calculateFarmerDeliveryHistory({ ...input, session: 'morning' });
  const evening = calculateFarmerDeliveryHistory({ ...input, session: 'evening' });
  const all = calculateFarmerDeliveryHistory({ ...input, session: 'all' });

  assert.equal(morning.expectedDays, 3);
  assert.equal(morning.deliveredDays, 2);
  assert.deepEqual(morning.missedDates, ['2026-10-02']);
  assert.equal(evening.deliveredDays, 2);
  assert.deepEqual(evening.missedDates, ['2026-10-01']);
  assert.equal(all.deliveredDays, 3);

  const sessions = Object.fromEntries(all.days.map((day) => [day.date, day.session]));
  assert.equal(sessions['2026-10-01'], 'morning');
  assert.equal(sessions['2026-10-02'], 'evening');
  assert.equal(sessions['2026-10-03'], 'morning-evening');
});

test('history uses expected calendar days, caps at today, and clamps to farmer creation', () => {
  const history = calculateFarmerDeliveryHistory({
    farmer: { createdDate: '2026-10-01' },
    records: [],
    startDate: '2026-09-25',
    endDate: '2026-10-10',
    today: '2026-10-03',
  });

  assert.equal(history.requestedStartDate, '2026-09-25');
  assert.equal(history.requestedEndDate, '2026-10-10');
  assert.equal(history.startDate, '2026-10-01');
  assert.equal(history.endDate, '2026-10-03');
  assert.equal(history.expectedDays, 3);
  assert.deepEqual(history.missedDates, ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(enumerateIsoDates('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(enumerateIsoDates('2026-10-03', '2026-10-01'), []);
});

test('history derives exact missed dates without inserting fake milk records', async () => {
  const statements = [];
  const result = await MilkRepository.getFarmerDeliveryHistory({
    ownerUserId: 42,
    farmerId: 7,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    today: '2026-10-05',
    runQuery: async (text, values) => {
      statements.push({ text, values });
      if (text.includes('FROM farmers f')) {
        return { rows: [{
          id: 7,
          name: 'Jean Bosco',
          farmerNumber: '17',
          phone: '0788123456',
          collectionCenter: 'North Site',
          collectorUserId: 77,
          createdDate: '2026-10-01',
        }] };
      }
      if (text.includes('FROM milk_records')) {
        return { rows: [
          { id: 1, date: '2026-10-01', status: 'valid', volumeMorning: 5, volumeEvening: 0 },
          { id: 2, date: '2026-10-03', status: 'valid', volumeMorning: 0, volumeEvening: 4 },
        ] };
      }
      throw new Error(`Unexpected history query: ${text}`);
    },
  });

  assert.equal(result.farmer.farmerNumber, 17);
  assert.equal(result.expectedDays, 5);
  assert.equal(result.deliveredDays, 2);
  assert.equal(result.missingDays, 3);
  assert.equal(result.deliveryRate, 40);
  assert.deepEqual(result.missedDates, ['2026-10-02', '2026-10-04', '2026-10-05']);
  assert.equal(result.days.length, 5);

  assert.equal(statements.length, 2);
  for (const { text } of statements) {
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE)\b/i);
  }
  const recordQuery = statements.find(({ text }) => text.includes('FROM milk_records'));
  assert.match(recordQuery.text, /owner_user_id = \$1 AND farmer_id = \$2/);
  assert.match(recordQuery.text, /is_owner_milk = FALSE/);
  assert.deepEqual(recordQuery.values, [42, 7, '2026-10-01', '2026-10-05']);
});

test('duplicate same-day history records still count one expected day', () => {
  const history = calculateFarmerDeliveryHistory({
    farmer: { createdDate: '2026-10-01' },
    today: '2026-10-02',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    records: [
      { id: 1, date: '2026-10-01', status: 'valid', volumeMorning: 5, volumeEvening: 0 },
      { id: 2, date: '2026-10-01', status: 'valid', volumeMorning: 2, volumeEvening: 0 },
    ],
  });
  assert.equal(history.days.length, 2);
  assert.equal(history.expectedDays, 2);
  assert.equal(history.deliveredDays, 1);
  assert.equal(history.missingDays, 1);
  assert.deepEqual(history.missedDates, ['2026-10-02']);
});

test('collector history stays scoped to the owner, collector, and farmer', async () => {
  const statements = [];
  const result = await MilkRepository.getFarmerDeliveryHistory({
    ownerUserId: 77,
    collectorUserId: 77,
    farmerId: 7,
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    today: '2026-10-02',
    runQuery: async (text, values) => {
      statements.push({ text, values });
      if (text.includes('FROM collector_assignments')) return { rows: [{ dairy_user_id: 42 }] };
      if (text.includes('FROM farmers f')) {
        return { rows: [{
          id: 7,
          name: 'Jean Bosco',
          farmerNumber: 17,
          collectorUserId: 77,
          createdDate: '2026-10-01',
        }] };
      }
      if (text.includes('FROM milk_records')) return { rows: [] };
      throw new Error(`Unexpected collector history query: ${text}`);
    },
  });

  assert.equal(result.farmer.farmerNumber, 17);
  assert.equal(result.expectedDays, 2);
  assert.equal(result.deliveredDays, 0);
  const farmerQuery = statements.find(({ text }) => text.includes('FROM farmers f'));
  assert.match(farmerQuery.text, /f\.owner_user_id = \$2/);
  assert.match(farmerQuery.text, /f\.collector_user_id = \$3/);
  assert.deepEqual(farmerQuery.values, [7, 42, 77]);
});

test('Collection Center aggregation keeps the full expected scope and supports a collector filter', () => {
  const query = MilkRepository.buildDairyDailyCollectionQuery({
    dairyUserId: 77,
    date: '2026-10-07',
    centerId: 8,
    collectorUserId: 55,
    search: 'No. 17',
    limit: 10,
  });

  assert.deepEqual(query.values, [77, '2026-10-07', 8, 55, 17, '%No. 17%', 11]);
  assert.match(query.text, /AND f\.collector_user_id = \$4/);
  assert.match(query.text, /f\.farmer_number::integer AS "farmerNumber"/);
  assert.match(query.text, /COUNT\(DISTINCT "farmerId"\)::integer AS "totalFarmers"/);
  assert.match(query.text, /COUNT\(DISTINCT "farmerId"\) FILTER \(WHERE "delivered"\)::integer AS "presentCount"/);
  assert.match(query.text, /summary AS/);
  assert.match(query.text, /page AS/);
  assert.match(query.text, /WHERE TRUE/);
  assert.ok(query.text.indexOf('page AS') < query.text.indexOf('"farmerNumber" = $5'));
  assert.doesNotMatch(query.text, /collector_assignments/);
});

test('missing-farmer navigation opens history and can show all missing farmers', () => {
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  assert.match(milkEntry, /const missingRows = visibleRows\.filter\(\(row\) => row\.deliveryStatus === 'missing'\)/);
  assert.match(milkEntry, /farmerNumberLabel\(row\.farmerNumber\)/);
  assert.match(milkEntry, /— \{row\.farmerName\}/);
  assert.match(milkEntry, /onClick=\{\(\) => openFarmerHistory\(row\)\}/);
  assert.match(milkEntry, /setDailyDeliveryFilter\('missing'\)/);
  assert.match(milkEntry, /setDailyPageSize\(100\)/);
  assert.match(milkEntry, /deliveryMissingTitle/);
  assert.match(milkEntry, /deliveryMissingHint/);
  assert.match(styles, /\.missing-farmers-panel/);
  assert.match(styles, /\.missing-farmers-panel ul \{[^}]*max-height/);
});

test('farmer history shows date, session, litres, status, counts, and missed dates', () => {
  const history = workspace.slice(workspace.indexOf('const renderFarmerHistory'), workspace.indexOf('const renderMilk'));
  assert.match(history, /formatFarmerNumber\(historyFarmer\?\.farmerNumber/);
  assert.match(history, /farmerHistory\.expectedDays/);
  assert.match(history, /farmerHistory\.deliveredDays/);
  assert.match(history, /farmerHistory\.missingDays/);
  assert.match(history, /farmerHistory\.deliveryRate/);
  assert.match(history, /farmerHistory\.missedDates\.map/);
  assert.match(history, /farmerHistory\.days\.map/);
  assert.match(history, /sessionLabel\(day\.session\)/);
  assert.match(history, /statusLabel\(day\)/);
  assert.match(history, /<\/table>/);
  assert.match(styles, /\.farmer-history-mobile-list/);
  assert.match(styles, /\.farmer-history-day dl/);
});

test('delivery history and daily routes enforce authentication and owner scoping', async () => {
  assert.match(historyRoute, /getAuthenticatedUser/);
  assert.match(historyRoute, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
  assert.match(historyRoute, /ownerUserId: user\.id/);
  assert.match(historyRoute, /collectorUserId: user\.accountType === 'COLLECTOR' \? user\.id : null/);
  assert.match(historyRoute, /farmerId: params\.id/);
  assert.match(historyRoute, /searchParams\.get\('startDate'\)/);
  assert.match(historyRoute, /searchParams\.get\('session'\) \|\| 'all'/);

  assert.match(dailyRoute, /deliveryStatus/);
  assert.match(dailyRoute, /collectorUserId: user\.accountType === 'COLLECTOR' \? String\(user\.id\) : params\.get\('collectorUserId'\) \|\| ''/);
  assert.match(farmersRoute, /user\.accountType === 'COLLECTOR'[\s\S]*params\.get\('collectorUserId'\)/);
  assert.match(farmersRoute, /ownerUserId: user\.id/);
  assert.doesNotMatch(farmersRoute, /ownerUserId: params/);

  let received;
  await Milk.getDailyCollection({
    ownerUserId: 77,
    accountType: 'COLLECTION_CENTER',
    centerId: 8,
    date: '2026-10-07',
    deliveryStatus: 'missing',
    collectorUserId: '55',
    repository: {
      getDairyDailyCollection: async (filters) => {
        received = filters;
        return {
          center: { id: 8, name: 'North Ikigo' },
          farmers: [],
          summary: { totalFarmers: 0, presentCount: 0 },
          pagination: { pageSize: 50, hasMore: false, nextCursor: null },
        };
      },
    },
  });
  assert.equal(received.deliveryStatus, 'missing');
  assert.equal(received.collectorUserId, 55);
});

test('migration and health checks guarantee stable owner-scoped numbering', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS farmer_number BIGINT/);
  assert.match(migration, /ROW_NUMBER\(\) OVER \(PARTITION BY owner_user_id ORDER BY id ASC\)/);
  assert.match(migration, /UPDATE farmers AS f/);
  assert.match(migration, /PERFORM pg_advisory_xact_lock\(NEW\.owner_user_id\)/);
  assert.match(migration, /SELECT COALESCE\(MAX\(farmer_number\), 0\) \+ 1/);
  assert.match(migration, /CREATE TRIGGER farmers_assign_number/);
  assert.match(migration, /BEFORE INSERT ON farmers/);
  assert.match(migration, /ALTER COLUMN farmer_number SET NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_owner_farmer_number/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_farmers_owner_number/);
  assert.match(healthRoute, /'019',\s*'020',\s*'021'/);
});

test('mobile delivery views keep numbers, status, history, and readable missed days', () => {
  assert.match(styles, /\.milk-search-control/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /\.farmer-number-badge/);
  assert.match(styles, /\.milk-entry-card header > \.delivery-status-pill/);
  assert.match(styles, /\.milk-entry-card footer \{ flex-wrap: wrap;/);
  assert.match(styles, /\.farmer-history-missed ul \{[^}]*max-height/);
  assert.match(styles, /\.farmer-history-summary \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});
