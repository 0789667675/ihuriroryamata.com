const test = require('node:test');
const assert = require('node:assert/strict');

const Config = require('../lib/services/platform-config-service.js');

test('platform admin collection-center pricing validates non-negative values and writes as the actor', async () => {
  let written;
  const result = await Config.updateCollectionCenterPricing({
    actorId: 1,
    input: { monthlyAmount: '32000', firstVolumeBoundaryLiters: '55000' },
    repository: { updateCollectionCenterPricing: async (value) => { written = value; return value; } },
  });
  assert.deepEqual(written, { actorId: 1, amount: 32000, boundary: 55000 });
  assert.equal(result.amount, 32000);
  await assert.rejects(() => Config.updateCollectionCenterPricing({ actorId: 1, input: { monthlyAmount: -1 }, repository: {} }), /Invalid Collection Center pricing/i);
});

test('platform plan views are delegated to the server repository', async () => {
  const plans = [{ code: 'USAGE_0_5000_MONTHLY' }];
  assert.equal(await Config.getPlans({ repository: { listPlans: async () => plans } }), plans);
  assert.deepEqual(await Config.getCollectionCenterPricing({ repository: { getCollectionCenterPricing: async () => ({ config: null, plan: null }) } }), { config: null, plan: null });
});

test('admin tier pricing accepts the five active Collector tier codes', async () => {
  let written;
  const tiers = [
    ['USAGE_0_5000_MONTHLY', 5000],
    ['USAGE_5001_10000_MONTHLY', 10000],
    ['USAGE_10001_20000_MONTHLY', 17000],
    ['USAGE_20001_40000_MONTHLY', 20000],
    ['USAGE_40001_PLUS_MONTHLY', 25000],
  ].map(([code, price]) => ({ code, price }));

  await Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers },
    repository: { updateCollectorTierPrices: async (input) => { written = input; return input; } },
  });

  assert.deepEqual(written, { actorId: 1, tiers });
});
