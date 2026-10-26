const test = require('node:test');
const assert = require('node:assert/strict');

const Farmers = require('../lib/services/farmer-service.js');
const Milk = require('../lib/services/milk-service.js');

test('farmer batch import normalizes rows and keeps validation errors row-local', async () => {
  let captured;
  const result = await Farmers.importFarmers({
    ownerUserId: 42,
    actorId: 7,
    batchKey: 'batch-key-1234',
    rows: [
      { rowNumber: 3, name: '  MUKAMANA Alice  ', phone: '', nationalId: null, accountNumber: '', cowType: 'Friesian', collectionCenterId: 5 },
      { rowNumber: 4, name: '   ' },
      { rowNumber: 5, name: 'Excluded row', excluded: true },
      { rowNumber: 6, name: 'Bad phone', phone: 123 },
    ],
    repository: {
      createFarmersBatch: async (input) => {
        captured = input;
        return { batchId: 9, idempotent: true, created: 1, failed: 3, rows: [] };
      },
    },
  });

  assert.equal(result.batchId, 9);
  assert.equal(captured.ownerUserId, 42);
  assert.equal(captured.actorId, 7);
  assert.equal(captured.batchKey, 'batch-key-1234');
  assert.equal(captured.rows.length, 4);
  assert.deepEqual(captured.rows[0], {
    rowNumber: 3,
    input: {
      name: 'MUKAMANA Alice',
      phone: null,
      nationalId: null,
      accountNumber: null,
      cowType: 'Friesian',
      collectionCenter: null,
      collectionCenterId: 5,
    },
  });
  assert.equal(captured.rows[1].error, true);
  assert.equal(captured.rows[1].errorCode, 'VALIDATION_ERROR');
  assert.match(captured.rows[1].message, /name is required/i);
  assert.equal(captured.rows[2].errorCode, 'EXCLUDED');
  assert.equal(captured.rows[3].errorCode, 'VALIDATION_ERROR');
  assert.match(captured.rows[3].message, /phone must be a string/i);
});

test('farmer batch import rejects empty, oversized, and unsafe request metadata', async () => {
  const repository = { createFarmersBatch: async () => assert.fail('repository must not be called') };
  await assert.rejects(() => Farmers.importFarmers({ rows: [], ownerUserId: 42, batchKey: 'batch-key-1234', repository }), /at least one farmer/i);
  await assert.rejects(() => Farmers.importFarmers({
    rows: Array.from({ length: 501 }, (_, index) => ({ name: `Farmer ${index}` })),
    ownerUserId: 42,
    batchKey: 'batch-key-1234',
    repository,
  }), /at most 500/i);
  await assert.rejects(() => Farmers.importFarmers({ rows: [{ name: 'Alice' }], ownerUserId: 42, batchKey: 'short', repository }), /valid import key/i);
  await assert.rejects(() => Farmers.importFarmers({ rows: [{ name: 'Alice' }], ownerUserId: 42, batchKey: 'has spaces and !!!', repository }), /valid import key/i);
});

function createMilkRepository() {
  const records = new Map();
  let nextId = 99;
  const upserts = [];
  records.set(12, {
    id: 80,
    farmerId: 12,
    volumeMorning: 1,
    volumeEvening: 0,
    volume: 1,
    pricePerLiter: 400,
    amount: 400,
    status: 'valid',
  });
  const scopes = new Map([[11, { ownerUserId: 42 }], [12, { ownerUserId: 42 }]]);
  return {
    upserts,
    records,
    repository: {
      getCollectorFarmerScope: async ({ collectorUserId, farmerId }) => {
        assert.equal(collectorUserId, 7);
        return scopes.get(Number(farmerId)) || null;
      },
      getMilkContext: async ({ ownerUserId, farmerId, date }) => {
        assert.equal(ownerUserId, 42);
        assert.equal(date, '2026-10-25');
        if (!scopes.has(Number(farmerId))) return null;
        return { farmer: { id: Number(farmerId) }, center: { id: 5, pricePerLiter: 400, transportRatePerLiter: 20 }, pricePerLiter: 400 };
      },
      upsertMilkRecord: async (input) => {
        upserts.push(input);
        const existing = records.get(Number(input.farmerId));
        if (existing) {
          const identical = Number(existing.volumeMorning) === input.volumeMorning
            && Number(existing.volumeEvening) === input.volumeEvening
            && Number(existing.pricePerLiter) === input.pricePerLiter
            && Number(existing.amount) === input.amount;
          return {
            record: existing,
            created: false,
            updated: false,
            duplicate: true,
            conflict: identical ? 'identical' : 'changed',
            existingRecordId: existing.id,
          };
        }
        const record = {
          id: nextId += 1,
          farmerId: Number(input.farmerId),
          volumeMorning: input.volumeMorning,
          volumeEvening: input.volumeEvening,
          volume: input.volume,
          pricePerLiter: input.pricePerLiter,
          amount: input.amount,
          status: 'valid',
        };
        records.set(record.farmerId, record);
        return { record, created: true, updated: false, duplicate: false };
      },
    },
  };
}

test('milk notebook import uses strict normal milk saves and never updates/duplicates existing rows', async () => {
  const { repository, upserts, records } = createMilkRepository();
  const rows = [
    { rowNumber: 1, farmerId: 11, volumeMorning: 5, volumeEvening: 0 },
    { rowNumber: 2, farmerId: 11, volumeMorning: 5, volumeEvening: 0 },
    { rowNumber: 3, farmerId: 12, volumeMorning: 6, volumeEvening: 0 },
    { rowNumber: 4, farmerId: 99, volumeMorning: 1, volumeEvening: 0 },
    { rowNumber: 5, farmerId: 11, volumeMorning: -1, volumeEvening: 0 },
  ];

  const result = await Milk.importMilkRecords({
    ownerUserId: 7,
    actorId: 7,
    collectorUserId: 7,
    date: '2026-10-25',
    rows,
    repository,
  });

  assert.deepEqual(result.summary, { total: 5, created: 1, duplicates: 2, failed: 2 });
  assert.equal(result.rows[0].status, 'created');
  assert.equal(result.rows[1].status, 'duplicate');
  assert.equal(result.rows[1].errorCode, 'DUPLICATE_MILK_RECORD');
  assert.equal(result.rows[1].existingRecordId, 100);
  assert.equal(result.rows[2].status, 'conflict');
  assert.equal(result.rows[2].errorCode, 'MILK_RECORD_CONFLICT');
  assert.equal(result.rows[2].existingRecordId, 80);
  assert.equal(result.rows[3].status, 'failed');
  assert.equal(result.rows[3].errorCode, 'FORBIDDEN');
  assert.equal(result.rows[4].status, 'failed');
  assert.equal(result.rows[4].errorCode, 'INVALID_ROW');

  assert.equal(records.size, 2);
  assert.equal(upserts.length, 3);
  for (const input of upserts) {
    assert.equal(input.strictInsert, true);
    assert.equal(input.ownerUserId, 42);
    assert.equal(input.actorId, 7);
    assert.equal(input.collectorUserId, 7);
    assert.equal(input.collectionCenterId, 5);
    assert.equal(input.pricePerLiter, 400);
    assert.equal(input.transportRatePerLiter, 20);
  }
  assert.equal(upserts[0].volumeMorning, 5);
  assert.equal(upserts[0].amount, 2000);

  // Replaying the same reviewed page is idempotent: no extra rows are created,
  // and the already-saved/changed rows are reported rather than overwritten.
  const retry = await Milk.importMilkRecords({
    ownerUserId: 7,
    actorId: 7,
    collectorUserId: 7,
    date: '2026-10-25',
    rows: rows.slice(0, 3),
    repository,
  });
  assert.deepEqual(retry.summary, { total: 3, created: 0, duplicates: 3, failed: 0 });
  assert.equal(records.size, 2);
  assert.equal(records.get(11).volumeMorning, 5);
  assert.equal(records.get(12).volumeMorning, 1);
});

test('milk import validates the date and batch bounds before touching records', async () => {
  const repository = {
    getCollectorFarmerScope: async () => assert.fail('must not read scope'),
  };
  await assert.rejects(() => Milk.importMilkRecords({ ownerUserId: 7, date: '2026-02-30', rows: [{ farmerId: 1 }], repository }), /valid date/i);
  await assert.rejects(() => Milk.importMilkRecords({ ownerUserId: 7, date: '2026-10-25', rows: [], repository }), /at least one milk row/i);
  await assert.rejects(() => Milk.importMilkRecords({
    ownerUserId: 7,
    date: '2026-10-25',
    rows: Array.from({ length: 101 }, (_, index) => ({ rowNumber: index + 1, farmerId: 1, volumeMorning: 1 })),
    repository,
  }), /at most 100/i);
});

test('strict milk insert reports a changed existing row instead of updating it', async () => {
  const inputs = [];
  const repository = {
    getCollectorFarmerScope: async () => ({ ownerUserId: 42 }),
    getMilkContext: async () => ({ farmer: { id: 11 }, center: { id: 5, pricePerLiter: 400, transportRatePerLiter: 20 }, pricePerLiter: 400 }),
    upsertMilkRecord: async (input) => {
      inputs.push(input);
      return { record: { id: 88 }, created: false, updated: false, duplicate: true, conflict: 'changed', existingRecordId: 88 };
    },
  };
  await assert.rejects(() => Milk.recordMilk({
    ownerUserId: 7,
    actorId: 7,
    collectorUserId: 7,
    farmerId: 11,
    date: '2026-10-25',
    volumeMorning: 9,
    volumeEvening: 0,
    strictInsert: true,
    repository,
  }), (error) => error.code === 'MILK_RECORD_CONFLICT' && error.statusCode === 409 && error.existingRecordId === 88);
  assert.equal(inputs[0].strictInsert, true);
  assert.equal(inputs[0].volumeMorning, 9);
});
