const test = require('node:test');
const assert = require('node:assert/strict');

const CollectorMilk = require('../lib/services/collector-milk-service.js');

const ownerUserId = 42;

test('collector daily entry is owner scoped, allows zero, and snapshots the effective price', async () => {
  let saved;
  const result = await CollectorMilk.saveDaily({
    ownerUserId,
    date: '2026-10-01',
    volumeLiters: '25.5',
    repository: {
      getPriceAtDate: async (input) => {
        assert.deepEqual(input, { ownerUserId, date: '2026-10-01' });
        return { pricePerLiter: 400 };
      },
      upsertDaily: async (input) => { saved = input; return input; },
    },
  });
  assert.equal(saved.ownerUserId, ownerUserId);
  assert.equal(saved.volumeLiters, 25.5);
  assert.equal(saved.pricePerLiter, 400);
  assert.equal(result, saved);

  const zero = await CollectorMilk.saveDaily({
    ownerUserId,
    date: '2026-10-02',
    volumeLiters: 0,
    repository: {
      getPriceAtDate: async () => null,
      upsertDaily: async (input) => input,
    },
  });
  assert.equal(zero.volumeLiters, 0);
  assert.equal(zero.pricePerLiter, 0);
});

test('collector history excludes canceled rows from totals and recalculates farmer losses', async () => {
  const result = await CollectorMilk.getHistory({
    ownerUserId,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    repository: {
      getForPeriod: async (filters) => {
        assert.deepEqual(filters, { ownerUserId, startDate: '2026-10-01', endDate: '2026-10-31' });
        return [{ date: '2026-10-02', volumeLiters: 100, effectiveVolumeLiters: 80, farmerLostLiters: 20, pricePerLiter: 0 }];
      },
      getPriceAtDate: async () => ({ pricePerLiter: 410 }),
    },
  });
  assert.equal(result.originalVolume, 100);
  assert.equal(result.lostVolume, 20);
  assert.equal(result.totalVolume, 80);
  assert.equal(result.totalAmount, 32800);
  await assert.rejects(() => CollectorMilk.getHistory({ ownerUserId, startDate: '2026-10-31', endDate: '2026-10-01', repository: {} }), /date range/i);
});

test('collector void requires a reason and persists an owner-scoped, idempotent cancellation', async () => {
  let request;
  const response = { entry: { status: 'cancelled' }, alreadyVoided: true, validVolumeLiters: 0, voided: true };
  const result = await CollectorMilk.voidDaily({
    ownerUserId,
    actorId: ownerUserId,
    date: '2026-10-03',
    reason: '  Contaminated container  ',
    repository: { voidDaily: async (input) => { request = input; return response; } },
  });
  assert.equal(request.ownerUserId, ownerUserId);
  assert.equal(request.voidedBy, ownerUserId);
  assert.equal(request.reason, 'Contaminated container');
  assert.equal(result.alreadyVoided, true);
  assert.equal(result.validVolumeLiters, 0);
  await assert.rejects(() => CollectorMilk.voidDaily({ ownerUserId, date: '2026-10-03', reason: ' ', repository: {} }), /reason/i);
});

test('collector milk prices require a positive amount and valid effective date', async () => {
  let priceInput;
  await CollectorMilk.addPrice({
    ownerUserId,
    pricePerLiter: '425',
    effectiveDate: '2026-10-01',
    repository: { addPrice: async (input) => { priceInput = input; return input; } },
  });
  assert.equal(priceInput.ownerUserId, ownerUserId);
  assert.equal(priceInput.pricePerLiter, 425);
  await assert.rejects(() => CollectorMilk.addPrice({ ownerUserId, pricePerLiter: 0, effectiveDate: '2026-10-01', repository: {} }), /valid price/i);
});
