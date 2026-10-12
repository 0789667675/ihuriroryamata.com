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
    ['USAGE_0_5000_MONTHLY', 5000, 0, 5000],
    ['USAGE_5001_10000_MONTHLY', 10000, 5001, 10000],
    ['USAGE_10001_20000_MONTHLY', 17000, 10001, 20000],
    ['USAGE_20001_40000_MONTHLY', 20000, 20001, 40000],
    ['USAGE_40001_PLUS_MONTHLY', 25000, 40001, null],
  ].map(([code, price, minVolumeLiters, maxVolumeLiters]) => ({ code, price, minVolumeLiters, maxVolumeLiters }));

  await Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers },
    repository: { updateCollectorTierPrices: async (input) => { written = input; return input; } },
  });

  assert.deepEqual(written, { actorId: 1, tiers: tiers.map((tier, index) => ({
    ...tier,
    name: ['0-5,000 L / Monthly', '5,001-10,000 L / Monthly', '10,001-20,000 L / Monthly', '20,001-40,000 L / Monthly', '40,001+ L / Monthly'][index],
  })) });
});

test('admin tier pricing rejects non-positive or fractional RWF prices without writing', async () => {
  const tiers = [
    ['USAGE_0_5000_MONTHLY', 5000, 0, 5000],
    ['USAGE_5001_10000_MONTHLY', 10000, 5001, 10000],
    ['USAGE_10001_20000_MONTHLY', 17000, 10001, 20000],
    ['USAGE_20001_40000_MONTHLY', 20000, 20001, 40000],
    ['USAGE_40001_PLUS_MONTHLY', 25000, 40001, null],
  ].map(([code, price, minVolumeLiters, maxVolumeLiters]) => ({ code, price, minVolumeLiters, maxVolumeLiters }));
  let writes = 0;
  const repository = { updateCollectorTierPrices: async () => { writes += 1; } };

  for (const price of [0, -1, 5000.5]) {
    await assert.rejects(() => Config.updateCollectorTierPrices({
      actorId: 1,
      input: { tiers: tiers.map((tier, index) => index === 0 ? { ...tier, price } : tier) },
      repository,
    }), /positive whole RWF/i);
  }
  await assert.rejects(() => Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers: tiers.map((tier, index) => index === 1 ? { ...tier, minVolumeLiters: 5002 } : tier) },
    repository,
  }), /no gaps or overlaps/i);
  assert.equal(writes, 0);
});

test('Collector tier pricing rejects the protected Dairy monthly plan code', async () => {
  const tiers = [
    ['COLLECTION_CENTER_MONTHLY', 30000, 0, 5000],
    ['USAGE_5001_10000_MONTHLY', 10000, 5001, 10000],
    ['USAGE_10001_20000_MONTHLY', 17000, 10001, 20000],
    ['USAGE_20001_40000_MONTHLY', 20000, 20001, 40000],
    ['USAGE_40001_PLUS_MONTHLY', 25000, 40001, null],
  ].map(([code, price, minVolumeLiters, maxVolumeLiters]) => ({ code, price, minVolumeLiters, maxVolumeLiters }));

  await assert.rejects(() => Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers },
    repository: { updateCollectorTierPrices: async () => assert.fail('Dairy pricing must not be updated') },
  }), /Invalid or duplicate Collector pricing tier/i);
});
