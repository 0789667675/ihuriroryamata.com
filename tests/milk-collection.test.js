const test = require('node:test');
const assert = require('node:assert/strict');

const Milk = require('../lib/services/milk-service.js');
const MilkAdjustment = require('../lib/services/milk-adjustment-service.js');
const MilkRepository = require('../lib/repositories/milkRepository.js');
const { buildIfishiVolumeRows } = require('../lib/utils/ifishi-ledger.js');

const ownerUserId = 42;
const farmer = {
  id: 7,
  name: 'A Farmer',
  location: 'North Site',
  collectionCenter: 'North Site',
};

const baseRepository = (saveResult = { created: true, record: { id: 101 } }) => ({
  getMilkContext: async ({ ownerUserId: scopedOwner, farmerId }) => scopedOwner === ownerUserId && farmerId === farmer.id
    ? { farmer, center: { id: 5, name: 'North Site' }, pricePerLiter: 400 }
    : null,
  upsertMilkRecord: async (input) => ({ ...saveResult, input }),
});

test('milk record dates retain their database calendar day when mapped from a local Date', () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'Africa/Kigali';
  try {
    const mapped = MilkRepository.mapMilkRow({ date: new Date('2026-10-03T22:00:00.000Z') });
    assert.equal(mapped.date, '2026-10-04');
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('recordMilk validates positive session volumes and calculates the owner center price', async () => {
  let saved;
  const result = await Milk.recordMilk({
    ownerUserId,
    actorId: ownerUserId,
    farmerId: farmer.id,
    date: '2026-10-01',
    volumeMorning: '5.25',
    volumeEvening: '2',
    repository: {
      ...baseRepository(),
      upsertMilkRecord: async (input) => { saved = input; return { created: true, record: { id: 101 } }; },
    },
  });

  assert.equal(saved.ownerUserId, ownerUserId);
  assert.equal(saved.collectionCenterId, 5);
  assert.equal(saved.collectionSession.period, 'daily');
  assert.equal(saved.volume, 7.25);
  assert.equal(saved.pricePerLiter, 400);
  assert.equal(saved.amount, 2900);
  assert.equal(result.statusCode, 201);
});

test('milk context resolves the center price effective on the recorded date', async () => {
  const calls = [];
  const context = await MilkRepository.getMilkContext({
    ownerUserId,
    farmerId: farmer.id,
    date: '2024-02-29',
    client: {
      query: async (text, values) => {
        calls.push({ text, values });
        if (text.includes('FROM farmers')) return { rows: [{ id: farmer.id, name: farmer.name, owner_user_id: ownerUserId, location: farmer.location, collectionCenter: farmer.collectionCenter }] };
        if (text.includes('FROM collection_centers')) return { rows: [{ id: 5, name: 'North Site', owner_user_id: ownerUserId, pricePerLiter: 500, transportRatePerLiter: 0 }] };
        return { rows: [{ pricePerLiter: 325 }] };
      },
    },
  });

  assert.equal(context.pricePerLiter, 325);
  assert.deepEqual(calls[2].values, [5, ownerUserId, '2024-02-29']);
});

test('recordMilk rejects identical same-day submissions with the duplicate contract', async () => {
  await assert.rejects(() => Milk.recordMilk({
    ownerUserId,
    farmerId: farmer.id,
    date: '2026-10-01',
    volumeMorning: 5,
    volumeEvening: 2,
    repository: baseRepository({ duplicate: true, existingRecordId: 88 }),
  }), (error) => error.code === 'DUPLICATE_MILK_RECORD' && error.statusCode === 409 && error.existingRecordId === 88);
});

test('recordMilk accepts changed values as an update to the existing daily row', async () => {
  const result = await Milk.recordMilk({
    ownerUserId,
    farmerId: farmer.id,
    date: '2026-10-01',
    volumeMorning: 6,
    volumeEvening: 1,
    repository: baseRepository({ updated: true, record: { id: 88 } }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.record.id, 88);
});

test('collector milk writes stay under the assigned dairy owner and identify the collector actor', async () => {
  let saved;
  let contextOwner;
  const result = await Milk.recordMilk({
    ownerUserId: 99,
    actorId: 99,
    collectorUserId: 99,
    farmerId: farmer.id,
    date: '2026-10-02',
    volumeMorning: 4,
    volumeEvening: 2,
    repository: {
      getCollectorFarmerScope: async ({ collectorUserId, farmerId }) => collectorUserId === 99 && farmerId === 7 ? { ownerUserId: 42 } : null,
      getMilkContext: async ({ ownerUserId }) => {
        contextOwner = ownerUserId;
        return { farmer, center: { id: 5, name: 'North Site' }, pricePerLiter: 400 };
      },
      upsertMilkRecord: async (input) => { saved = input; return { created: true, record: { id: 102 } }; },
    },
  });

  assert.equal(result.record.id, 102);
  assert.equal(contextOwner, 42);
  assert.equal(saved.ownerUserId, 42);
  assert.equal(saved.actorId, 99);
  assert.equal(saved.collectorUserId, 99);
  assert.equal(saved.collectionSession.ownerUserId, 42);
  assert.equal(saved.collectionSession.collectorUserId, 99);
});

test('collector can record milk for a farmer owned by the authenticated Collector account', async () => {
  let contextOwner;
  let saved;
  const result = await Milk.recordMilk({
    ownerUserId: 99,
    actorId: 99,
    collectorUserId: 99,
    farmerId: farmer.id,
    date: '2026-10-02',
    volumeMorning: 4,
    volumeEvening: 2,
    repository: {
      getCollectorFarmerScope: async () => ({ ownerUserId: 99 }),
      getMilkContext: async ({ ownerUserId: scopedOwner }) => {
        contextOwner = scopedOwner;
        return { farmer, center: { id: 5, name: 'North Site' }, pricePerLiter: 400 };
      },
      upsertMilkRecord: async (input) => { saved = input; return { created: true, record: { id: 103 } }; },
    },
  });

  assert.equal(result.record.id, 103);
  assert.equal(contextOwner, 99);
  assert.equal(saved.ownerUserId, 99);
  assert.equal(saved.collectorUserId, 99);
});

test('collector farmer scope falls back to its own farmers when no Dairy assignment exists', async () => {
  const statements = [];
  const scope = await MilkRepository.getCollectorFarmerScope({
    collectorUserId: 99,
    farmerId: 7,
    runQuery: async (text, values) => {
      statements.push({ text, values });
      if (text.includes('collector_assignments')) return { rows: [] };
      return { rows: [{ ownerUserId: 99 }] };
    },
  });

  assert.deepEqual(scope, { ownerUserId: 99 });
  assert.equal(statements.length, 2);
  assert.match(statements[1].text, /f\.owner_user_id = \$1/);
  assert.deepEqual(statements[1].values, [99, 7]);
});

test('daily collection returns directly owned Collector farmers when no Dairy assignment exists', async () => {
  const queries = [];
  const result = await MilkRepository.getDailyCollection({
    ownerUserId: 99,
    collectorUserId: 99,
    date: '2026-10-04',
    centerId: 5,
    limit: 50,
  }, async (text, values) => {
    queries.push({ text, values });
    if (text.includes('FROM collector_assignments')) return { rows: [] };
    if (text.includes('FROM collection_centers')) return { rows: [{ id: 5, name: 'North Site', owner_user_id: 99, pricePerLiter: 400, transportRatePerLiter: 0 }] };
    if (text.includes('SELECT DISTINCT')) return { rows: [{ name: 'North Site' }] };
    if (text.includes('COUNT(f.id)')) return { rows: [{ totalFarmers: 1, presentCount: 0, totalMorning: 0, totalEvening: 0, totalVolume: 0, totalAmount: 0 }] };
    if (text.includes('SELECT f.id AS "farmerId"')) return { rows: [{ farmerId: 7, farmerName: 'A Farmer', collectionCenter: 'North Site', volumeMorning: 0, volumeEvening: 0, totalVolume: 0, amount: 0 }] };
    if (text.includes('FROM collection_center_prices')) return { rows: [{ pricePerLiter: 400 }] };
    throw new Error(`Unexpected daily collection query: ${text}`);
  }, async () => [{ id: 50, volumeLiters: 50 }]);

  assert.equal(result.center, 'North Site');
  assert.deepEqual(result.farmers.map((row) => row.farmerId), [7]);
  assert.equal(result.summary.totalFarmers, 1);
  assert.equal(result.collectorMilk[0].volumeLiters, 50);
  const farmerQuery = queries.find(({ text }) => text.includes('SELECT f.id AS "farmerId"'));
  assert.match(farmerQuery.text, /f\.owner_user_id = \$2/);
  assert.doesNotMatch(farmerQuery.text, /collector_user_id =/);
  assert.deepEqual(farmerQuery.values.slice(0, 3), ['2026-10-04', 99, 'North Site']);
});

test('recordMilk rejects invalid, zero, or cross-owner collection input before writing', async () => {
  let writes = 0;
  const repository = {
    ...baseRepository(),
    upsertMilkRecord: async () => { writes += 1; return { created: true, record: {} }; },
  };
  await assert.rejects(() => Milk.recordMilk({ ownerUserId, farmerId: 7, date: '2026-02-30', volumeMorning: 1, repository }), /valid date/i);
  await assert.rejects(() => Milk.recordMilk({ ownerUserId, farmerId: 7, date: '2026-10-01', volumeMorning: 0, volumeEvening: 0, repository }), /total volume/i);
  await assert.rejects(() => Milk.recordMilk({ ownerUserId: 99, farmerId: 7, date: '2026-10-01', volumeMorning: 1, repository }), /farmer not found/i);
  assert.equal(writes, 0);
});

test('recordMilk requires a configured collection center price', async () => {
  await assert.rejects(() => Milk.recordMilk({
    ownerUserId,
    farmerId: farmer.id,
    date: '2026-10-01',
    volumeMorning: 1,
    repository: { getMilkContext: async () => ({ farmer, center: null, pricePerLiter: null }) },
  }), /configured collection center/i);
});

test('milk update and void stay within the authenticated owner scope', async () => {
  const calls = [];
  const repository = {
    getMilkRecord: async (id, scopedOwner) => scopedOwner === ownerUserId
      ? { id, farmer_id: farmer.id, owner_user_id: scopedOwner }
      : null,
    getMilkContext: async () => ({ farmer, center: { id: 5 }, pricePerLiter: 410 }),
    updateMilkRecord: async (input) => { calls.push(input); return input; },
    voidMilkRecord: async (input) => { calls.push(input); return { alreadyVoided: false, record: { id: input.id, status: 'cancelled' } }; },
  };
  const updated = await Milk.updateMilkRecord({
    id: 10,
    ownerUserId,
    date: '2026-10-02',
    volumeMorning: 2,
    volumeEvening: 3,
    repository,
  });
  assert.equal(updated.ownerUserId, ownerUserId);
  assert.equal(updated.amount, 2050);
  assert.equal(await Milk.updateMilkRecord({ id: 10, ownerUserId: 99, date: '2026-10-02', volumeMorning: 2, repository }), null);
  const voided = await Milk.voidMilkRecord({ id: 10, ownerUserId, reason: 'Contaminated', repository });
  assert.equal(voided.record.status, 'cancelled');
  assert.deepEqual(calls[1], { id: 10, ownerUserId: 42, actorId: 42, reason: 'Contaminated' });
  await assert.rejects(() => Milk.voidMilkRecord({ id: 10, ownerUserId, reason: ' ', repository }), /void reason/i);
});

test('milk history uses a bounded keyset cursor and validates date ranges', async () => {
  let filters;
  const expected = { data: [], pageSize: 20, hasMore: false, nextCursor: null };
  const result = await Milk.listMilkRecords({
    ownerUserId,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    cursor: '2026-10-15:82',
    limit: '20',
    repository: { listMilkRecords: async (value) => { filters = value; return expected; } },
  });
  assert.equal(result, expected);
  assert.equal(filters.ownerUserId, ownerUserId);
  assert.equal(filters.cursor, '2026-10-15:82');
  await assert.rejects(() => Milk.listMilkRecords({ ownerUserId, startDate: '2026-02-30', repository: { listMilkRecords() {} } }), /Invalid startDate/i);
  await assert.rejects(() => Milk.listMilkRecords({ ownerUserId, limit: 101, repository: { listMilkRecords() {} } }), /between 1 and 100/i);
});

test('milk history carries authenticated Collector scope to the assigned Dairy owner', async () => {
  let filters;
  await Milk.listMilkRecords({
    ownerUserId: 99,
    collectorUserId: 99,
    farmerId: 7,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    repository: { listMilkRecords: async (input) => { filters = input; return { data: [], hasMore: false, nextCursor: null, pageSize: 50 }; } },
  });
  assert.equal(filters.ownerUserId, 99);
  assert.equal(filters.collectorUserId, 99);
  assert.equal(filters.farmerId, 7);
  await assert.rejects(() => Milk.listMilkRecords({
    ownerUserId: 99,
    collectorUserId: 42,
    repository: { listMilkRecords: async () => ({}) },
  }), (error) => error.statusCode === 403);
});

test('milk repository resolves assigned and direct-owned historical record contexts safely', async () => {
  const assigned = await MilkRepository.resolveMilkRecordScope({
    ownerUserId: 99,
    collectorUserId: 99,
    runQuery: async (text) => text.includes('collector_assignments') ? { rows: [{ dairy_user_id: 42 }] } : { rows: [] },
  });
  assert.deepEqual(assigned, { ownerUserId: 42, collectorUserId: 99 });
  const direct = await MilkRepository.resolveMilkRecordScope({
    ownerUserId: 99,
    collectorUserId: 99,
    runQuery: async (text) => text.includes('collector_assignments') ? { rows: [] } : { rows: [] },
  });
  assert.deepEqual(direct, { ownerUserId: 99, collectorUserId: null });
});

test('milk adjustment validates losses and passes only authenticated ownership to persistence', async () => {
  let adjustmentInput;
  const result = await MilkAdjustment.applyCollectionAdjustment({
    ownerUserId,
    actorId: ownerUserId,
    input: {
      collectionCenterId: 5,
      date: '2026-10-01',
      period: 'morning',
      lossPercentage: '20',
      reason: 'Transport spill',
    },
    repository: {
      applyCollectionAdjustment: async (value) => { adjustmentInput = value; return { corrected: false }; },
    },
  });
  assert.equal(result.corrected, false);
  assert.equal(adjustmentInput.ownerUserId, ownerUserId);
  assert.equal(adjustmentInput.adjustedBy, ownerUserId);
  assert.equal(adjustmentInput.lossPercentage, 20);
  await assert.rejects(() => MilkAdjustment.applyCollectionAdjustment({
    ownerUserId,
    input: { collectionCenterId: 5, date: '2026-02-30', period: 'all', lossPercentage: 20, reason: 'Bad date' },
    repository: { applyCollectionAdjustment() {} },
  }), /required/i);
  await assert.rejects(() => MilkAdjustment.applyCollectionAdjustment({
    ownerUserId,
    input: { collectionCenterId: 5, date: '2026-10-01', period: 'all', lossPercentage: 101, reason: 'Too much' },
    repository: { applyCollectionAdjustment() {} },
  }), /required/i);
});

test('daily collection accepts collector-scoped filtering and preserves owner assignment', async () => {
  let args;
  const expected = { center: 'North Site', farmers: [], farmerPagination: { pageSize: 30, hasMore: false, nextCursor: null } };
  const result = await Milk.getDailyCollection({
    ownerUserId,
    collectorUserId: 99,
    date: '2026-10-01',
    center: 'North Site',
    cursor: '30',
    limit: '30',
    repository: { getDailyCollection: async (input) => { args = input; return expected; } },
  });
  assert.equal(result, expected);
  assert.equal(args.ownerUserId, ownerUserId);
  assert.equal(args.collectorUserId, 99);
  assert.equal(args.center, 'North Site');
  assert.equal(args.cursor, 30);
});

test('daily collection requires an owned center and returns a bounded farmer cursor page', async () => {
  let args;
  const expected = { center: 'North Site', farmerPagination: { pageSize: 30, hasMore: true, nextCursor: '15' } };
  const result = await Milk.getDailyCollection({
    ownerUserId,
    date: '2026-10-01',
    centerId: '5',
    cursor: '30',
    limit: '30',
    repository: { getDailyCollection: async (input) => { args = input; return expected; } },
  });
  assert.equal(result, expected);
  assert.equal(args.ownerUserId, ownerUserId);
  assert.equal(args.centerId, 5);
  assert.equal(args.cursor, 30);
  await assert.rejects(() => Milk.getDailyCollection({ ownerUserId, date: '2026-02-30', center: 'North Site', repository: {} }), /Invalid date/i);
});

test('Dairy daily collection aggregates linked Abacunda by owned active center with complete summary totals', () => {
  const query = MilkRepository.buildDairyDailyCollectionQuery({
    dairyUserId: 77,
    date: '2026-10-07',
    centerId: 8,
    cursor: 900,
    limit: 25,
  });

  assert.match(query.text, /ca\.dairy_user_id = \$1/);
  assert.match(query.text, /ca\.revoked_at IS NULL/);
  assert.match(query.text, /u\.account_type = 'COLLECTOR'/);
  assert.match(query.text, /f\.owner_user_id = ca\.dairy_user_id/);
  assert.match(query.text, /f\.collector_user_id = ca\.collector_user_id/);
  assert.match(query.text, /owned\.owner_user_id = f\.owner_user_id/);
  assert.match(query.text, /c\.id = \$3/);
  assert.match(query.text, /summary AS/);
  assert.match(query.text, /SUM\("totalFarmers"\).*AS "allAbacundaCount"/s);
  assert.match(query.text, /SUM\("presentCount"\).*AS "presentAbacundaCount"/s);
  assert.deepEqual(query.values, [77, '2026-10-07', 8, 900, 26]);
});

test('Dairy daily summary counts Abacunda, not linked collectors', async () => {
  let queryCount = 0;
  const result = await MilkRepository.getDairyDailyCollection({
    dairyUserId: 77,
    date: '2026-10-07',
    centerId: 8,
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return { rows: [{ id: 8, name: 'North Ikigo', pricePerLiter: '400', transportRatePerLiter: '0' }] };
      }
      return { rows: [{
        collectorUserId: 900,
        collectorName: 'Abacunda A',
        totalFarmers: 4,
        presentCount: 2,
        totalMorning: 12,
        totalEvening: 8,
        totalVolume: 20,
        totalAmount: 8000,
        allAbacundaCount: 6,
        presentAbacundaCount: 3,
      }] };
    },
  });

  assert.equal(result.summary.totalFarmers, 6);
  assert.equal(result.summary.presentCount, 3);
  assert.equal(result.collectors[0].totalFarmers, 4);
  assert.equal(result.collectors[0].presentCount, 2);
});

test('Dairy daily service returns Abacunda aggregates without farmer rows or owner milk', async () => {
  let received;
  const result = await Milk.getDailyCollection({
    ownerUserId: 77,
    accountType: 'COLLECTION_CENTER',
    date: '2026-10-07',
    centerId: '8',
    limit: '10',
    repository: {
      getDairyDailyCollection: async (filters) => {
        received = filters;
        return {
          center: { id: 8, name: 'North Ikigo' },
          collectors: [{ collectorUserId: 900, collectorName: 'Abacunda A', totalFarmers: 4, presentCount: 3, totalMorning: 12, totalEvening: 8, totalVolume: 20, totalAmount: 8000 }],
          summary: { totalFarmers: 1, presentCount: 1, totalMorning: 12, totalEvening: 8, totalVolume: 20, totalAmount: 8000, pricePerLiter: 400, transportRate: 0 },
          pagination: { pageSize: 10, hasMore: false, nextCursor: null },
        };
      },
    },
  });

  assert.deepEqual(received, { dairyUserId: 77, date: '2026-10-07', centerId: 8, cursor: null, limit: 10 });
  assert.equal(result.farmers[0].farmerName, 'Abacunda A');
  assert.equal(result.farmers[0].abacundaCount, 4);
  assert.equal(result.summary.totalFarmers, 1);
  assert.deepEqual(result.collectorMilk, []);
});

test('collector daily overview can resolve its assigned center without a caller-supplied center', async () => {
  let args;
  const expected = { center: 'North Site', centers: ['North Site'], farmers: [], farmerPagination: { pageSize: 50, hasMore: false, nextCursor: null } };
  const result = await Milk.getDailyCollection({
    ownerUserId: 99,
    collectorUserId: 99,
    date: '2026-10-02',
    repository: { getDailyCollection: async (input) => { args = input; return expected; } },
  });
  assert.equal(result, expected);
  assert.equal(args.center, '');
  assert.equal(args.collectorUserId, 99);
});

test('Ifishi ledger rows only expose milk volume data and never settlement values', () => {
  const rows = buildIfishiVolumeRows([
    {
      date: '2026-10-02',
      volumeMorning: 5,
      volumeEvening: 2,
      validVolumeLiters: 7,
      lostVolumeLiters: 0,
      status: 'recorded',
      adjustmentReason: '',
      grossAmount: 2400,
      totalTransport: 150,
      totalDeductions: 300,
      finalPayment: 1950,
    },
    {
      date: '2026-10-04',
      volumeMorning: 0,
      volumeEvening: 0,
      validVolumeLiters: 0,
      lostVolumeLiters: 0,
      status: 'missing',
      adjustmentReason: '',
    },
  ]);

  assert.deepEqual(rows, [
    { date: '2026-10-02', morning: 5, evening: 2, total: 7, valid: 7, lost: 0, status: 'recorded', note: '' },
    { date: '2026-10-04', morning: 0, evening: 0, total: 0, valid: 0, lost: 0, status: 'missing', note: '' },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /grossAmount|totalTransport|totalDeductions|finalPayment|RWF/i);
});

test('Ifishi month reads return only persisted milk and do not generate blank days', async () => {
  const calls = [];
  const existing = [{ id: 101, farmer_id: farmer.id, owner_user_id: ownerUserId, date: '2026-10-02', volume_liters: 7, volume_morning: 5, volume_evening: 2 }];
  const rows = await MilkRepository.getMilkTemplate({
    farmerId: farmer.id,
    ownerUserId,
    month: 10,
    year: 2026,
    runQuery: async (text, values) => {
      calls.push({ text, values });
      return text.includes('FROM farmers') ? { rows: [{ id: farmer.id }] } : { rows: existing };
    },
  });

  assert.deepEqual(rows, existing);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ text }) => /^\s*SELECT/i.test(text)));
  assert.deepEqual(calls[1].values, [farmer.id, ownerUserId, 10, 2026]);
});

test('Ifishi month save routes recorded days through daily milk persistence and skips blank days', async () => {
  const saved = [];
  const rows = await Milk.saveMilkTemplate({
    ownerUserId,
    farmerId: 7,
    month: 2,
    year: 2024,
    rows: [
      { day: 29, volumeMorning: '2.5', volumeEvening: 1 },
      { day: 28, volumeMorning: 0, volumeEvening: 0 },
    ],
    repository: {
      getMilkContext: async () => ({ farmer, center: { id: 5, name: 'North Site' }, pricePerLiter: 400 }),
      upsertMilkRecord: async (input) => { saved.push(input); return { created: true, record: { id: 101 } }; },
      getMilkTemplate: async (input) => { assert.equal(input.year, 2024); return [{ id: 101 }]; },
    },
  });
  assert.deepEqual(rows, [{ id: 101 }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].date, '2024-02-29');
  assert.equal(saved[0].volumeMorning, 2.5);
  assert.equal(saved[0].amount, 1400);
  await assert.rejects(() => Milk.saveMilkTemplate({
    ownerUserId,
    farmerId: 7,
    month: 2,
    year: 2023,
    rows: [{ day: 29, volumeMorning: 1 }],
    repository: { saveMilkTemplate() {} },
  }), /between 1 and 28/i);
});
