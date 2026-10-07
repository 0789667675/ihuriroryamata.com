const test = require('node:test');
const assert = require('node:assert/strict');

const Admin = require('../lib/services/platform-admin-service.js');
const Config = require('../lib/services/platform-config-service.js');
const PlatformAdminRepository = require('../lib/repositories/platformAdminRepository.js');

const accountId = 73;
const owner = { account: { id: accountId }, subscription: { id: 12, status: 'trial' } };

const repository = (events) => ({
  getAccountDetails: async (userId) => userId === accountId ? owner : null,
  listAccounts: async (filters) => { events.push(['list', filters]); return filters; },
  getAccountsSummary: async () => ({ accounts: { total_accounts: 1 } }),
  setAccountStatus: async (input) => { events.push(['account', input]); return input; },
  updateUserSubscription: async (input) => { events.push(['subscription', input]); return { id: 12, user_id: accountId, status: input.status || (input.grantTrial ? 'trial' : 'active') }; },
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
  const result = await Admin.listAccounts({ page: '2', limit: '25', search: '  dairy  ', status: 'trial', repository: repository(events) });
  assert.equal(result.page, 2);
  assert.equal(result.limit, 25);
  assert.equal(result.search, 'dairy');
  await assert.rejects(() => Admin.listAccounts({ limit: 101, repository: repository([]) }), /between 1 and 100/i);
  await assert.rejects(() => Admin.listAccounts({ status: 'unknown', repository: repository([]) }), /Invalid status/i);
});

test('platform admin actions audit by the acting Super Admin and honor distinct account/subscription behavior', async () => {
  const events = [];
  const result = await Admin.manageAccount({ userId: accountId, actorId: 1, action: 'suspend', repository: repository(events) });
  assert.equal(result.accountStatus, 'suspended');
  assert.equal(events[0][1].userId, accountId);
  assert.equal(events[0][1].accountStatus, 'suspended');
  assert.equal(events[1][1].actorId, 1);

  events.length = 0;
  await Admin.manageAccount({ userId: accountId, actorId: 1, action: 'extend-trial', input: { days: 20, reason: 'Approved extension' }, repository: repository(events) });
  assert.equal(events[0][1].status, 'trial');
  assert.equal(events[0][1].extendDays, 20);
  assert.equal(events[1][1].details.reason, 'Approved extension');
});

test('platform admin forbids non-policy trials and extensions without a reason', async () => {
  const empty = repository([]);
  await assert.rejects(() => Admin.manageAccount({ userId: accountId, actorId: 1, action: 'grant-trial', input: { days: 30 }, repository: empty }), /exactly 15 days/i);
  await assert.rejects(() => Admin.manageAccount({ userId: accountId, actorId: 1, action: 'extend-trial', input: { days: 20 }, repository: empty }), /reason is required/i);
  assert.equal(await Admin.manageAccount({ userId: 999, actorId: 1, action: 'suspend', repository: empty }), null);
});

test('platform admin edits the complete Collector tier price schedule only with positive RWF integers', async () => {
  let update;
  const tiers = [
    ['USAGE_0_5000_MONTHLY', 6100],
    ['USAGE_5001_10000_MONTHLY', 11200],
    ['USAGE_10001_20000_MONTHLY', 16300],
    ['USAGE_20001_40000_MONTHLY', 21400],
    ['USAGE_40001_PLUS_MONTHLY', 26500],
  ].map(([code, price]) => ({ code, price }));
  const repository = { updateCollectorTierPrices: async (input) => { update = input; return input.tiers; } };
  await Config.updateCollectorTierPrices({ actorId: 2, input: { tiers }, repository });
  assert.equal(update.actorId, 2);
  assert.deepEqual(update.tiers, tiers);
  await assert.rejects(() => Config.updateCollectorTierPrices({ actorId: 2, input: { tiers: tiers.slice(1) }, repository }), /All five/i);
  await assert.rejects(() => Config.updateCollectorTierPrices({ actorId: 2, input: { tiers: tiers.map((tier, index) => index ? tier : { ...tier, price: 0 }) }, repository }), /positive whole RWF/i);
});
