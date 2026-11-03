const test = require('node:test');
const assert = require('node:assert/strict');
const MilkMatrixRepository = require('../lib/repositories/milkMatrixRepository.js');

const collector = { id: 99, accountType: 'COLLECTOR' };

function makeInput({ farmerCount = 1, days = [1], morning = '2', evening = '1' } = {}) {
  return {
    collectionCenterId: 5,
    year: 2026,
    month: 11,
    periodType: 'first-half',
    entries: Array.from({ length: farmerCount }, (_, farmerIndex) => ({
      farmerId: farmerIndex + 1,
      days: Object.fromEntries(days.map((day) => [String(day), { morning, evening }])),
    })),
  };
}

function makeDatabase({ ownerUserId = 99, farmerIds = null, existingRows = [], savedRows = null } = {}) {
  const statements = [];
  let releases = 0;
  const client = {
    query: async (text, values = []) => {
      statements.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('FROM public.collection_centers')) {
        return { rows: [{ id: 5, name: 'North Site', owner_user_id: ownerUserId, price_per_liter: 400, transport_rate_per_liter: 12 }] };
      }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('FROM public.farmers f')) {
        const requestedIds = values[0].map(Number);
        return { rows: (farmerIds || requestedIds).map((id) => ({ id })) };
      }
      if (text.includes('public.milk_records mr')) return { rows: existingRows };
      if (text.includes('public.collection_center_prices')) {
        return { rows: values[2].map((record_date) => ({ record_date, price_per_liter: 400 })) };
      }
      if (text.includes('INSERT INTO public.collection_sessions')) {
        return { rows: values[3].map((collection_date, index) => ({ id: index + 100, collection_date })) };
      }
      if (text.includes('INSERT INTO public.milk_records AS current_record')) {
        return { rows: savedRows || values[0].map((id) => ({ id })) };
      }
      return { rows: [] };
    },
    release: () => { releases += 1; },
  };
  return {
    statements,
    get releases() { return releases; },
    poolProvider: () => ({ connect: async () => client }),
  };
}

test('a 100-farmer 15-day save uses a bounded number of set-based database queries', async () => {
  const database = makeDatabase();
  const input = makeInput({ farmerCount: 100, days: Array.from({ length: 15 }, (_, index) => index + 1) });
  const result = await MilkMatrixRepository.saveMilkMatrixBatch({
    user: collector,
    input,
    poolProvider: database.poolProvider,
  });

  assert.equal(result.success, true);
  assert.equal(result.savedCount, 1500);
  assert.equal(result.changedCount, 1500);
  assert.equal(result.totalVolume, 4500);
  assert.equal(database.statements.filter(({ text }) => text.includes('INSERT INTO public.collection_sessions')).length, 1);
  assert.equal(database.statements.filter(({ text }) => text.includes('INSERT INTO public.milk_records AS current_record')).length, 1);
  assert.equal(database.statements.filter(({ text }) => text === 'BEGIN' || text === 'COMMIT').length, 2);
  assert.equal(database.statements.length, 10);
  assert.equal(database.releases, 1);
  const bulkWrite = database.statements.find(({ text }) => text.includes('INSERT INTO public.milk_records AS current_record'));
  assert.equal(bulkWrite.values[0].length, 1500);
  assert.equal(bulkWrite.values[9].length, 1500);
});

test('batch validation rejects invalid quantities and dates before opening a transaction', async () => {
  const database = makeDatabase();
  const invalidVolume = makeInput();
  invalidVolume.entries[0].days['1'].morning = '3l';
  await assert.rejects(() => MilkMatrixRepository.saveMilkMatrixBatch({
    user: collector,
    input: invalidVolume,
    poolProvider: database.poolProvider,
  }), (error) => error.statusCode === 400);

  const invalidDay = makeInput();
  invalidDay.entries[0].days['16'] = { morning: '1', evening: '0' };
  await assert.rejects(() => MilkMatrixRepository.saveMilkMatrixBatch({
    user: collector,
    input: invalidDay,
    poolProvider: database.poolProvider,
  }), (error) => error.statusCode === 400);
  assert.equal(database.statements.length, 0);
});

test('unauthorized farmers roll back the batch before any milk or session writes', async () => {
  const database = makeDatabase({ farmerIds: [] });
  await assert.rejects(() => MilkMatrixRepository.saveMilkMatrixBatch({
    user: collector,
    input: makeInput(),
    poolProvider: database.poolProvider,
  }), (error) => error.statusCode === 403 && error.code === 'FARMER_SCOPE_FORBIDDEN');
  assert.ok(database.statements.some(({ text }) => text === 'ROLLBACK'));
  assert.equal(database.statements.some(({ text }) => text.includes('INSERT INTO public.collection_sessions')), false);
  assert.equal(database.statements.some(({ text }) => text.includes('INSERT INTO public.milk_records')), false);
});

test('correcting an existing record retains historical price and transport snapshots', async () => {
  const existing = {
    id: 44,
    farmer_id: 1,
    owner_user_id: 99,
    record_date: '2026-11-01',
    status: 'valid',
    lost_volume_liters: 0,
    volume_morning: 1,
    volume_evening: 1,
    price_per_liter: 350,
    transport_rate_per_liter: 21,
  };
  const database = makeDatabase({ existingRows: [existing] });
  const result = await MilkMatrixRepository.saveMilkMatrixBatch({
    user: collector,
    input: makeInput({ morning: '2', evening: '1' }),
    poolProvider: database.poolProvider,
  });

  assert.equal(result.changedCount, 1);
  assert.equal(database.statements.some(({ text }) => text.includes('public.collection_center_prices')), false);
  const bulkWrite = database.statements.find(({ text }) => text.includes('INSERT INTO public.milk_records AS current_record'));
  assert.deepEqual(bulkWrite.values[6], [350]);
  assert.deepEqual(bulkWrite.values[8], [21]);
  assert.match(bulkWrite.text, /amount = EXCLUDED\.volume_liters \* current_record\.price_per_liter/);
  assert.doesNotMatch(bulkWrite.text, /price_per_liter = EXCLUDED\.price_per_liter/);
  assert.doesNotMatch(bulkWrite.text, /transport_rate_per_liter = EXCLUDED\.transport_rate_per_liter/);
});

test('identical retries make no milk write and do not duplicate batch audit events', async () => {
  const existing = {
    id: 44,
    farmer_id: 1,
    owner_user_id: 99,
    record_date: '2026-11-01',
    status: 'valid',
    lost_volume_liters: 0,
    adjustment_reason: null,
    adjusted_at: null,
    volume_liters: 3,
    volume_morning: 2,
    volume_evening: 1,
    valid_volume_liters: 3,
    valid_volume_morning: 2,
    valid_volume_evening: 1,
    amount: 1200,
    valid_amount: 1200,
    original_volume_liters: 3,
    original_volume_morning: 2,
    original_volume_evening: 1,
    original_amount: 1200,
    price_per_liter: 400,
  };
  const database = makeDatabase({ existingRows: [existing] });
  const result = await MilkMatrixRepository.saveMilkMatrixBatch({
    user: collector,
    input: makeInput(),
    poolProvider: database.poolProvider,
  });
  assert.equal(result.success, true);
  assert.equal(result.savedCount, 1);
  assert.equal(result.changedCount, 0);
  assert.equal(database.statements.some(({ text }) => text.includes('INSERT INTO public.milk_records AS current_record')), false);
  assert.equal(database.statements.some(({ text }) => text.includes('INSERT INTO public.audit_logs')), false);
});

test('loss-adjusted and voided records cannot be replaced through Save All', async () => {
  for (const status of ['adjusted', 'cancelled']) {
    const database = makeDatabase({ existingRows: [{
      id: 44,
      farmer_id: 1,
      owner_user_id: 99,
      record_date: '2026-11-01',
      status,
      lost_volume_liters: status === 'adjusted' ? 1 : 3,
      volume_morning: 1,
      volume_evening: 1,
    }] });
    await assert.rejects(() => MilkMatrixRepository.saveMilkMatrixBatch({
      user: collector,
      input: makeInput({ morning: '2' }),
      poolProvider: database.poolProvider,
    }), (error) => error.statusCode === 409 && error.code === 'MILK_RECORD_ADJUSTED');
    assert.ok(database.statements.some(({ text }) => text === 'ROLLBACK'));
    assert.equal(database.statements.some(({ text }) => text.includes('INSERT INTO public.collection_sessions')), false);
  }
});