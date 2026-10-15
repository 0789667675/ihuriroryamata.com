const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Config = require('../lib/services/platform-config-service.js');
const ConfigRepository = require('../lib/repositories/platformConfigRepository.js');

test('platform admin collection-center pricing validates positive RWF prices and writes as the actor', async () => {
  let written;
  const result = await Config.updateCollectionCenterPricing({
    actorId: 1,
    input: { monthlyAmount: '32000', firstVolumeBoundaryLiters: '55000' },
    repository: { updateCollectionCenterPricing: async (value) => { written = value; return value; } },
  });
  assert.deepEqual(written, { actorId: 1, amount: 32000, boundary: 55000 });
  assert.equal(result.amount, 32000);
  for (const monthlyAmount of [0, -1, 32000.5]) {
    await assert.rejects(() => Config.updateCollectionCenterPricing({ actorId: 1, input: { monthlyAmount }, repository: {} }), /Invalid Collection Center pricing/i);
  }
});

test('Collection Center price transaction audits the prior and new configured amounts', async () => {
  const calls = [];
  const client = {
    query: async (text, values = []) => {
      calls.push({ text, values });
      if (text.includes('SELECT monthly_amount')) return { rows: [{ monthly_amount: '30000', first_volume_boundary_liters: '50000', currency: 'RWF' }] };
      if (text.includes('SELECT * FROM subscription_plans')) return { rows: [{ id: 91, price: '30000', currency: 'RWF' }] };
      if (text.includes('UPDATE collection_center_subscription_config')) return { rows: [{ id: 1 }] };
      if (text.includes('UPDATE subscription_plans')) return { rows: [{ id: 91, price: '32000', currency: 'RWF', billing_period: 'monthly' }] };
      return { rows: [] };
    },
    release() {},
  };
  await ConfigRepository.updateCollectionCenterPricing({
    actorId: 17,
    amount: 32000,
    boundary: 55000,
    poolProvider: () => ({ connect: async () => client }),
  });

  const audit = calls.find(({ text }) => text.includes('INSERT INTO audit_logs'));
  assert.ok(calls.some(({ text }) => text === 'BEGIN'));
  assert.ok(calls.some(({ text }) => text === 'COMMIT'));
  assert.equal(audit.values[2], 17);
  assert.deepEqual(JSON.parse(audit.values[1]), {
    previous: { monthlyAmount: 30000, firstVolumeBoundaryLiters: 50000, currency: 'RWF' },
    current: { monthlyAmount: 32000, firstVolumeBoundaryLiters: 55000, currency: 'RWF' },
  });
  assert.equal(calls.some(({ text }) => /UPDATE\s+subscription_payments|DELETE\s+FROM\s+subscription_payments/i.test(text)), false);
});

test('both subscription price configuration APIs remain Super Admin-only', () => {
  for (const file of [
    'app/api/admin/config/plans/route.js',
    'app/api/admin/config/collection-center/route.js',
  ]) {
    const route = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(route, /getAuthenticatedUser/);
    assert.match(route, /user\.role !== 'super_admin'/);
  }
});

test('platform plan views are delegated to the server repository', async () => {
  const plans = [{ code: 'USAGE_0_5000_MONTHLY' }];
  assert.equal(await Config.getPlans({ repository: { listPlans: async () => plans } }), plans);
  assert.deepEqual(await Config.getCollectionCenterPricing({ repository: { getCollectionCenterPricing: async () => ({ config: null, plan: null }) } }), { config: null, plan: null });
});

test('subscription price configuration routes permit edits only to Super Admin', () => {
  for (const file of ['plans', 'collection-center']) {
    const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'config', file, 'route.js'), 'utf8');
    assert.match(route, /getAuthenticatedUser/);
    assert.match(route, /user\.role !== 'super_admin'/);
  }
});

test('admin tier pricing accepts editable monthly tiers and creates tiers without client-assigned codes', async () => {
  let written;
  const tiers = [
    ['Small dairy', 5000, 0, 5000],
    ['Growing dairy', 10000, 5001, 10000],
    ['Large dairy', 17000, 10001, null],
  ].map(([name, price, minVolumeLiters, maxVolumeLiters], index) => ({
    id: index === 2 ? null : index + 1,
    name,
    price,
    minVolumeLiters,
    maxVolumeLiters,
    isActive: true,
  }));

  await Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers },
    repository: { updateCollectorTiers: async (input) => { written = input; return input; } },
  });

  assert.equal(written.actorId, 1);
  assert.equal(written.tiers.length, 3);
  assert.equal(written.tiers[2].id, null);
  assert.equal(written.tiers[2].name, 'Large dairy');
  assert.equal(written.tiers[2].maxVolumeLiters, null);
  assert.equal(written.tiers[2].sortOrder, 3);
});

test('admin tier pricing rejects non-positive or fractional RWF prices without writing', async () => {
  const tiers = [
    ['USAGE_0_5000_MONTHLY', 5000, 0, 5000],
    ['USAGE_5001_10000_MONTHLY', 10000, 5001, 10000],
    ['USAGE_10001_20000_MONTHLY', 17000, 10001, 20000],
    ['USAGE_20001_40000_MONTHLY', 20000, 20001, 40000],
    ['USAGE_40001_PLUS_MONTHLY', 25000, 40001, null],
  ].map(([code, price, minVolumeLiters, maxVolumeLiters], index) => ({
    id: index + 1, name: code, price, minVolumeLiters, maxVolumeLiters, isActive: true,
  }));
  let writes = 0;
  const repository = { updateCollectorTiers: async () => { writes += 1; } };

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
  }), /gaps|open range/i);
  assert.equal(writes, 0);
});

test('tier codes are generated by the server and client-supplied codes are not forwarded', async () => {
  let written;
  await Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers: [{ code: 'COLLECTION_CENTER_MONTHLY', name: 'Tier', price: 1000, minVolumeLiters: 0, maxVolumeLiters: null, isActive: true }] },
    repository: { updateCollectorTiers: async (input) => { written = input; return input.tiers; } },
  });
  assert.equal('code' in written.tiers[0], false);
});

test('inactive tier ranges may overlap while active tiers remain contiguous and unique', async () => {
  let saved;
  await Config.updateCollectorTierPrices({
    actorId: 1,
    input: { tiers: [
      { id: 1, name: 'Active low', price: 1000, minVolumeLiters: 0, maxVolumeLiters: 5000, isActive: true },
      { id: 2, name: 'Archived range', price: 2000, minVolumeLiters: 1000, maxVolumeLiters: 2000, isActive: false },
      { id: 3, name: 'Active high', price: 3000, minVolumeLiters: 5001, maxVolumeLiters: null, isActive: true },
    ] },
    repository: { updateCollectorTiers: async (input) => { saved = input; return input.tiers; } },
  });
  assert.equal(saved.tiers.filter((tier) => tier.isActive).length, 2);
});

test('subscription policy API permits only Super Admin edits', () => {
  const route = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app', 'api', 'admin', 'config', 'subscription', 'route.js'), 'utf8');
  assert.match(route, /getAuthenticatedUser/);
  assert.match(route, /user\.role !== 'super_admin'/);
  assert.match(route, /Config\.updateSubscriptionPolicy/);
});

test('subscription policy validates initial access, grace, enforcement time, and fixed Kigali timezone', async () => {
  let written;
  await Config.updateSubscriptionPolicy({
    actorId: 1,
    input: { initialAccessDays: '15', gracePeriodDays: '0', enforcementTime: '00:00', timeZone: 'Africa/Kigali' },
    repository: { updateSubscriptionPolicy: async (input) => { written = input; return input.policy; } },
  });
  assert.equal(written.policy.initialAccessDays, 15);
  assert.equal(written.policy.gracePeriodDays, 0);
  for (const input of [
    { initialAccessDays: 0, gracePeriodDays: 0, enforcementTime: '00:00' },
    { initialAccessDays: 15, gracePeriodDays: -1, enforcementTime: '00:00' },
    { initialAccessDays: 15, gracePeriodDays: 0, enforcementTime: '24:00' },
    { initialAccessDays: 15, gracePeriodDays: 0, enforcementTime: '00:00', timeZone: 'UTC' },
  ]) {
    await assert.rejects(() => Config.updateSubscriptionPolicy({ actorId: 1, input, repository: {} }));
  }
});
