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

test('platform account status follows account policy independently of optional email verification', () => {
  const { ACCOUNT_EFFECTIVE_STATUS } = PlatformAdminRepository;
  assert.match(ACCOUNT_EFFECTIVE_STATUS, /WHEN u\.account_status = 'suspended' THEN 'suspended'/);
  assert.match(ACCOUNT_EFFECTIVE_STATUS, /WHEN u\.account_status = 'not_approved' THEN 'not_approved'/);
  assert.match(ACCOUNT_EFFECTIVE_STATUS, /WHEN us\.status = 'active'/);
  assert.doesNotMatch(ACCOUNT_EFFECTIVE_STATUS, /email_verified/);
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

test('Super Admin exemption actions validate reason and delegate grant/revoke to audited repository operation', async () => {
  const calls = [];
  const testRepository = {
    getAccountDetails: async () => owner,
    setSubscriptionExemption: async (input) => { calls.push(input); return { billing_exempt: input.exempt, exemption_reason: input.reason }; },
    writeAdminAudit: async () => assert.fail('Exemption audit is committed with its repository update.'),
  };
  const granted = await Admin.manageAccount({ userId: accountId, actorId: 9, action: 'grant-exemption', input: { reason: 'Approved hardship' }, repository: testRepository });
  const revoked = await Admin.manageAccount({ userId: accountId, actorId: 9, action: 'revoke-exemption', input: { reason: 'Standard billing resumes' }, repository: testRepository });

  assert.deepEqual(calls.map(({ userId, actorId, exempt, reason }) => ({ userId, actorId, exempt, reason })), [
    { userId: accountId, actorId: 9, exempt: true, reason: 'Approved hardship' },
    { userId: accountId, actorId: 9, exempt: false, reason: 'Standard billing resumes' },
  ]);
  assert.equal(granted.billing_exempt, true);
  assert.equal(revoked.billing_exempt, false);
  await assert.rejects(() => Admin.manageAccount({ userId: accountId, actorId: 9, action: 'grant-exemption', input: { reason: 'bad' }, repository: testRepository }), /5 to 255 characters/);
  await assert.rejects(() => Admin.manageAccount({ userId: accountId, actorId: 9, action: 'grant-exemption', input: { reason: { value: 'not a string' } }, repository: testRepository }), /5 to 255 characters/);
});

test('exemption repository updates and audits the same subscription transaction', async () => {
  const calls = [];
  const previous = { id: 12, user_id: accountId, billing_exempt: false, exemption_reason: null, status: 'expired' };
  const client = {
    query: async (text, values = []) => {
      calls.push({ text, values });
      if (text.includes('SELECT id FROM users')) return { rows: [{ id: accountId }] };
      if (text.includes('SELECT * FROM user_subscriptions')) return { rows: [previous] };
      if (text.includes('UPDATE user_subscriptions')) return { rows: [{ ...previous, billing_exempt: true, exemption_reason: 'Approved hardship' }] };
      return { rows: [] };
    },
    release() {},
  };
  const result = await PlatformAdminRepository.setSubscriptionExemption({
    userId: accountId,
    actorId: 9,
    exempt: true,
    reason: 'Approved hardship',
    poolProvider: () => ({ connect: async () => client }),
  });
  const audit = calls.find(({ text }) => text.includes('INSERT INTO audit_logs'));
  assert.ok(calls.some(({ text }) => text === 'BEGIN'));
  assert.ok(calls.some(({ text }) => text === 'COMMIT'));
  assert.equal(audit.values[3], 9);
  assert.equal(audit.values[4], accountId);
  assert.equal(audit.values[1], 'subscription_exemption_granted');
  assert.deepEqual(JSON.parse(audit.values[2]), {
    previous: { billingExempt: false, reason: null },
    current: { billingExempt: true, reason: 'Approved hardship' },
    changeReason: 'Approved hardship',
  });
  assert.equal(result.billing_exempt, true);
});

test('exemption action API remains Super Admin-only', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'accounts', '[userId]', '[action]', 'route.js'), 'utf8');
  assert.match(route, /actor\.role !== 'super_admin'/);
  assert.match(route, /Admin\.manageAccount/);
});

test('platform admin does not accept the retired trial status filter', async () => {
  const empty = repository([]);
  await assert.rejects(() => Admin.listAccounts({ status: 'trial', repository: empty }), /Invalid status/i);
  assert.equal(await Admin.manageAccount({ userId: 999, actorId: 1, action: 'suspend', repository: empty }), null);
});

test('Super Admin resend verification is canonical-base-URL, rate-limited, provider-backed, and audited', async () => {
  const events = [];
  const unverified = {
    account: { id: accountId, email: 'unverified@example.com', email_verified: false, language: 'en' },
    subscription: null,
  };
  const resendRepository = {
    getAccountDetails: async () => unverified,
    writeAdminAudit: async (input) => events.push(['audit', input]),
  };
  let delivered;
  const accountService = {
    sendRegistrationEmailVerification: async (input) => {
      delivered = input;
      return { ok: true, email: input.userId };
    },
  };
  const rateLimits = { consumeRateLimit: async (key, limit, windowSeconds) => { events.push(['rate', key, limit, windowSeconds]); return true; } };
  const result = await Admin.resendVerificationEmail({
    userId: accountId,
    actorId: 9,
    baseUrl: 'https://www.ihuriroryamata.com',
    repository: resendRepository,
    userRepository: {},
    rateLimits,
    accountService,
  });
  assert.deepEqual(result, { ok: true, userId: accountId, email: 'unverified@example.com', auditRecorded: true });
  assert.equal(delivered.baseUrl, 'https://www.ihuriroryamata.com');
  assert.equal(delivered.language, 'en');
  assert.equal(delivered.userId, accountId);
  assert.equal(events[0][2], 5);
  assert.equal(events[0][3], 3600);
  assert.equal(events[1][1].action, 'email_verification_resent');
  assert.equal(events[1][1].actorId, 9);
  assert.equal(events[1][1].details.userId, accountId);

  await assert.rejects(() => Admin.resendVerificationEmail({
    userId: accountId,
    actorId: 9,
    baseUrl: 'https://www.ihuriroryamata.com',
    repository: resendRepository,
    userRepository: {},
    rateLimits: { consumeRateLimit: async () => false },
    accountService,
  }), (error) => error.statusCode === 429 && error.code === 'RESEND_RATE_LIMITED');
});

test('Super Admin resend verification refuses verified accounts and missing canonical base URL', async () => {
  const verifiedRepository = {
    getAccountDetails: async () => ({ account: { id: accountId, email: 'verified@example.com', email_verified: true } }),
  };
  await assert.rejects(() => Admin.resendVerificationEmail({
    userId: accountId,
    baseUrl: 'https://www.ihuriroryamata.com',
    repository: verifiedRepository,
    userRepository: {},
    rateLimits: { consumeRateLimit: async () => true },
    accountService: { sendRegistrationEmailVerification: async () => assert.fail('must not send') },
  }), (error) => error.statusCode === 409 && error.code === 'ALREADY_VERIFIED');

  await assert.rejects(() => Admin.resendVerificationEmail({
    userId: accountId,
    baseUrl: null,
    repository: { getAccountDetails: async () => ({ account: { id: accountId, email: 'unverified@example.com', email_verified: false } }) },
    userRepository: {},
    rateLimits: { consumeRateLimit: async () => true },
    accountService: { sendRegistrationEmailVerification: async () => assert.fail('must not send') },
  }), (error) => error.statusCode === 503 && error.code === 'PUBLIC_APP_URL_NOT_CONFIGURED');
});

test('resend verification action passes the canonical request base URL through the Super Admin API', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'accounts', '[userId]', '[action]', 'route.js'), 'utf8');
  assert.match(route, /resolvePublicBaseUrl\(\{ request \}\)/);
  assert.match(route, /baseUrl/);
  assert.match(route, /error\.code/);
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
