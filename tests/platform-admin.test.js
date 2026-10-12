const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Admin = require('../lib/services/platform-admin-service.js');
const Config = require('../lib/services/platform-config-service.js');
const PlatformAdminRepository = require('../lib/repositories/platformAdminRepository.js');

const accountId = 73;
const owner = { account: { id: accountId }, subscription: { id: 12, status: 'pending' } };

const repository = (events) => ({
  getAccountDetails: async (userId) => userId === accountId ? owner : null,
  listAccounts: async (filters) => { events.push(['list', filters]); return filters; },
  getAccountsSummary: async () => ({ accounts: { total_accounts: 1 } }),
  setAccountStatus: async (input) => { events.push(['account', input]); return input; },
  writeAdminAudit: async (input) => { events.push(['audit', input]); },
});

test('platform admin summary supports the route default repository call', async () => {
  const original = PlatformAdminRepository.getAccountsSummary;
  const summary = { accounts: { total_accounts: 3 } };
  PlatformAdminRepository.getAccountsSummary = async () => summary;
  try {
    assert.deepEqual(await Admin.getAccountsSummary(), summary);
  } finally {
    PlatformAdminRepository.getAccountsSummary = original;
  }
});

test('platform admin account list validates filters and bounds while forwarding server paging', async () => {
  const events = [];
  const result = await Admin.listAccounts({ page: '2', limit: '25', search: '  dairy  ', status: 'pending', repository: repository(events) });
  assert.equal(result.page, 2);
  assert.equal(result.limit, 25);
  assert.equal(result.search, 'dairy');
  await assert.rejects(() => Admin.listAccounts({ limit: 101, repository: repository([]) }), /between 1 and 100/i);
  await assert.rejects(() => Admin.listAccounts({ status: 'unknown', repository: repository([]) }), /Invalid status/i);
});

test('platform account status prioritizes unverified and suspended accounts over subscription status', () => {
  const { ACCOUNT_EFFECTIVE_STATUS } = PlatformAdminRepository;
  assert.match(ACCOUNT_EFFECTIVE_STATUS, /WHEN u\.email_verified = FALSE THEN 'not_approved'/);
  assert.match(ACCOUNT_EFFECTIVE_STATUS, /WHEN u\.account_status = 'suspended' THEN 'suspended'/);
  assert.match(ACCOUNT_EFFECTIVE_STATUS, /WHEN us\.status = 'active'/);
});

test('platform admin account suspension actions are audited and cannot bypass subscription payment', async () => {
  const events = [];
  const result = await Admin.manageAccount({ userId: accountId, actorId: 1, action: 'suspend', repository: repository(events) });
  assert.equal(result.accountStatus, 'suspended');
  assert.equal(events[0][1].userId, accountId);
  assert.equal(events[0][1].accountStatus, 'suspended');
  assert.equal(events[1][1].actorId, 1);

  for (const action of ['activate', 'grant-trial', 'extend-trial']) {
    await assert.rejects(() => Admin.manageAccount({ userId: accountId, actorId: 1, action, repository: repository([]) }), /Unsupported account action/i);
  }
});

test('platform admin does not accept the retired trial status filter', async () => {
  const empty = repository([]);
  await assert.rejects(() => Admin.listAccounts({ status: 'trial', repository: empty }), /Invalid status/i);
  assert.equal(await Admin.manageAccount({ userId: 999, actorId: 1, action: 'suspend', repository: empty }), null);
});

test('platform payment history is server-authorized for Super Admin and uses subscription service', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'payments', 'route.js'), 'utf8');
  assert.match(route, /getAuthenticatedUser/);
  assert.match(route, /user\.role !== 'super_admin'/);
  assert.match(route, /Subscriptions\.getAdminPaymentHistory/);
  assert.doesNotMatch(route, /params\.get\(['"](?:userId|ownerUserId|accountId)['"]\)/);
});

test('platform admin tier settings allow dynamic ranges with positive RWF integers', async () => {
  let update;
  const tiers = [
    ['USAGE_0_5000_MONTHLY', 6100, 0, 5000],
    ['USAGE_5001_10000_MONTHLY', 11200, 5001, 10000],
    ['USAGE_10001_20000_MONTHLY', 16300, 10001, 20000],
    ['USAGE_20001_40000_MONTHLY', 21400, 20001, 40000],
    ['USAGE_40001_PLUS_MONTHLY', 26500, 40001, null],
  ].map(([code, price, minVolumeLiters, maxVolumeLiters], index) => ({
    id: index + 1, name: code, price, minVolumeLiters, maxVolumeLiters, isActive: true,
  }));
  const repository = { updateCollectorTiers: async (input) => { update = input; return input.tiers; } };
  await Config.updateCollectorTierPrices({ actorId: 2, input: { tiers }, repository });
  assert.equal(update.actorId, 2);
  assert.equal(update.tiers.length, tiers.length);
  assert.equal(update.tiers[0].price, tiers[0].price);
  assert.equal(update.tiers[0].minVolumeLiters, 0);
  assert.equal(update.tiers[4].maxVolumeLiters, null);
  await assert.rejects(() => Config.updateCollectorTierPrices({ actorId: 2, input: { tiers: tiers.map((tier, index) => index ? tier : { ...tier, price: 0 }) }, repository }), /positive whole RWF/i);
});
