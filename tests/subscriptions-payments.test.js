const test = require('node:test');
const assert = require('node:assert/strict');
const Subscriptions = require('../lib/services/subscription-service.js');
const Provider = require('../lib/services/payment-provider.js');
const SubscriptionRepository = require('../lib/repositories/subscriptionRepository.js');
const EmailService = require('../lib/services/email-service.js');

const plan = {
  id: 8,
  code: 'USAGE_0_5000_MONTHLY',
  name: '0-5000 L monthly',
  price: 5000,
  intro_price: 0,
  intro_periods: 0,
  currency: 'RWF',
  billing_period: 'monthly',
  duration_days: 30,
  duration_unit: 'day',
  min_volume_liters: 0,
  max_volume_liters: 5000,
  is_active: true,
  sort_order: 1,
};

test('subscription payment helpers resolve legacy tier aliases and enforce monthly-only pricing', () => {
  assert.equal(Subscriptions.canonicalPlanCode('USAGE_20001_35000', 'monthly'), 'USAGE_20001_40000_MONTHLY');
  assert.equal(Subscriptions.canonicalPlanCode('USAGE_20001_35000_MONTHLY', 'monthly'), 'USAGE_20001_40000_MONTHLY');
  assert.equal(Subscriptions.canonicalPlanCode('USAGE_40001_PLUS', 'monthly'), 'USAGE_40001_PLUS_MONTHLY');
  assert.equal(Subscriptions.canonicalPlanCode('USAGE_35001_PLUS_MONTHLY', 'monthly'), 'USAGE_40001_PLUS_MONTHLY');
  assert.equal(Subscriptions.canonicalPlanCode('USAGE_5001_10000', 'monthly'), 'USAGE_5001_10000_MONTHLY');
  assert.equal(Subscriptions.calculatePrice({}, { ...plan, price: 10000, intro_price: 7000, intro_periods: 1 }, 'monthly').amount, 10000);
  assert.throws(() => Subscriptions.calculatePrice({}, plan, '6_months'), (error) => error.code === 'BILLING_PERIOD_NOT_SUPPORTED');
  assert.throws(() => Subscriptions.calculatePrice({}, plan, 'yearly'), (error) => error.code === 'BILLING_PERIOD_NOT_SUPPORTED');
});

test('phone normalization requires a Rwanda mobile number and canonicalizes local/international forms', () => {
  assert.equal(Subscriptions.canonicalPhone('0788 000 000'), '+250788000000');
  assert.equal(Subscriptions.canonicalPhone('+250788000000'), '+250788000000');
  assert.equal(Subscriptions.canonicalPhone('1234'), null);
});

test('only a provider-confirmed success before the initial deadline qualifies', () => {
  const paymentDueAt = '2026-10-26T22:00:00.000Z';
  assert.equal(Subscriptions.isInitialPaymentQualifying({ payment: { status: 'SUCCESS', completed_at: '2026-10-26T21:59:59.999Z' }, paymentDueAt }), true);
  for (const status of ['PENDING', 'FAILED', 'UNKNOWN']) {
    assert.equal(Subscriptions.isInitialPaymentQualifying({ payment: { status, completed_at: '2026-10-26T21:00:00.000Z' }, paymentDueAt }), false);
  }
  assert.equal(Subscriptions.isInitialPaymentQualifying({ payment: { status: 'SUCCESS', completed_at: paymentDueAt }, paymentDueAt }), false);
});

test('payment configuration identifies MTN Rwanda flow without exposing credentials', () => {
  const names = ['LMBTECH_APP_KEY', 'LMBTECH_SECRET_KEY', 'LMBTECH_BASE_URL', 'LMBTECH_CALLBACK_URL', 'LMBTECH_ALLOW_REAL_PAYMENTS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.LMBTECH_APP_KEY = 'private-app-key';
    process.env.LMBTECH_SECRET_KEY = 'private-secret';
    process.env.LMBTECH_BASE_URL = 'https://pay.lmbtech.rw/pay/config/api';
    process.env.LMBTECH_CALLBACK_URL = 'https://milk.example.com/api/subscription/payments/callback';
    process.env.LMBTECH_ALLOW_REAL_PAYMENTS = 'true';
    const status = Provider.getLmbtechPublicStatus();
    assert.equal(status.paymentMethod, 'MTN_MOMO_RWA');
    assert.equal(status.payerAccount, 'user');
    assert.equal(status.payerPhoneSource, 'users.phone');
    assert.equal(status.ready, true);
    assert.equal(status.apiConfigured, true);
    assert.equal('appKey' in status, false);
    assert.equal('secretKey' in status, false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('payment configuration rejects localhost or non-HTTPS callback origins', () => {
  assert.equal(Provider.normalizeLmbtechCallbackUrl('http://milk.example.test/api/subscription/payments/callback'), null);
  assert.equal(Provider.normalizeLmbtechCallbackUrl('https://localhost/api/subscription/payments/callback'), null);
  assert.equal(Provider.normalizeLmbtechCallbackUrl('https://127.0.0.1/api/subscription/payments/callback'), null);
  assert.equal(Provider.normalizeLmbtechCallbackUrl('https://[fd00::1]/api/subscription/payments/callback'), null);
  assert.equal(Provider.normalizeLmbtechCallbackUrl('https://milk.example.test'), 'https://milk.example.test/api/subscription/payments/callback');
});

test('LMBTech credential aliases work with canonical variables taking precedence', () => {
  const names = ['LMBTECH_APP_KEY', 'LMBTECH_SECRET_KEY', 'LMBTECH_API_KEY', 'LMBTECH_API_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.LMBTECH_APP_KEY;
    delete process.env.LMBTECH_SECRET_KEY;
    process.env.LMBTECH_API_KEY = 'legacy-app-test';
    process.env.LMBTECH_API_SECRET = 'legacy-secret-test';
    assert.deepEqual(
      [Provider.getLmbtechCredentials().appKey, Provider.getLmbtechCredentials().secretKey],
      ['legacy-app-test', 'legacy-secret-test']
    );
    process.env.LMBTECH_APP_KEY = 'canonical-app-test';
    process.env.LMBTECH_SECRET_KEY = 'canonical-secret-test';
    assert.deepEqual(
      [Provider.getLmbtechCredentials().appKey, Provider.getLmbtechCredentials().secretKey],
      ['canonical-app-test', 'canonical-secret-test']
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('initial access usage window is 15 days and counts valid server-side farmer volumes', async () => {
  const subscription = {
    status: 'pending',
    access_started_at: '2026-10-01T10:00:00.000Z',
    payment_due_at: '2026-10-15T22:00:00.000Z',
    volume_limit_liters: 5000,
    selected_plan_snapshot: { ...plan, minVolumeLiters: 0, maxVolumeLiters: 5000 },
  };
  assert.deepEqual(Subscriptions.getUsageWindow(subscription), {
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    exclusiveEnd: '2026-10-16',
    status: 'pending',
  });
  let farmerUsageWindow;
  const usage = await Subscriptions.getUsage({
    userId: 42,
    subscription,
    now: new Date('2026-10-10T00:00:00.000Z'),
    repository: {
      getCollectorMilk: async () => [{ volumeLiters: 100, effectiveVolumeLiters: 0 }],
      getFarmerMilkUsage: async (filters) => { farmerUsageWindow = filters; return { recordCount: 3, validLiters: 120 }; },
      getTierForVolume: async (liters) => ({ code: liters <= 5000 ? 'USAGE_0_5000_MONTHLY' : 'USAGE_5001_10000_MONTHLY', maxLiters: 5000 }),
      getTierByCode: async () => null,
      getNextTier: async () => null,
    },
  });
  assert.equal(usage.actualLiters, 120);
  assert.equal(usage.projectedMonthlyLiters, 120);
  assert.equal(farmerUsageWindow.endDate, '2026-10-10');
  assert.equal(usage.estimate, false);
  assert.equal(usage.recommendedTier.code, 'USAGE_0_5000_MONTHLY');
});

test('suspended initial access retains its completed usage window without projection', async () => {
  let farmerUsageWindow;
  const usage = await Subscriptions.getUsage({
    userId: 42,
    subscription: {
      status: 'suspended', effective_status: 'suspended',
      access_started_at: '2026-10-01T10:00:00.000Z', payment_due_at: '2026-10-15T22:00:00.000Z',
      volume_limit_liters: 5000, selected_plan_snapshot: { ...plan, minVolumeLiters: 0, maxVolumeLiters: 5000 },
    },
    now: new Date('2026-10-20T00:00:00.000Z'),
    repository: {
      getCollectorMilk: async () => [],
      getFarmerMilkUsage: async (filters) => { farmerUsageWindow = filters; return { recordCount: 5, validLiters: 150 }; },
      getTierForVolume: async (liters) => ({ code: liters <= 5000 ? 'USAGE_0_5000_MONTHLY' : 'USAGE_5001_10000_MONTHLY' }),
      getTierByCode: async () => null,
      getNextTier: async () => null,
    },
  });

  assert.equal(farmerUsageWindow.startDate, '2026-10-01');
  assert.equal(farmerUsageWindow.endDate, '2026-10-15');
  assert.equal(usage.projectedMonthlyLiters, 150);
  assert.equal(usage.estimate, false);
});

test('collector farmer usage query is scoped through its dairy assignment', () => {
  const query = SubscriptionRepository.buildFarmerMilkUsageQuery({
    userId: 99,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
  });
  assert.match(query.text, /f\.owner_user_id = mr\.owner_user_id/);
  assert.match(query.text, /ca\.dairy_user_id = f\.owner_user_id/);
  assert.match(query.text, /ca\.collector_user_id = f\.collector_user_id/);
  assert.match(query.text, /ca\.collector_user_id = \$1/);
  assert.deepEqual(query.values, [99, '2026-10-01', '2026-10-15']);
});

test('callback validation requires the documented LMBTech transaction fields', () => {
  const body = { reference_id: 'ref-1', transaction_id: 'txn-1', status: 'success', amount: '5000.00', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
  assert.deepEqual(Provider.verifyCallbackPayload(body), { valid: true });
  assert.equal(Provider.resolveCallbackStatus(body), 'SUCCESS');
  assert.equal(Provider.canonicalPhone(body.payer_phone), '+250788000000');
  assert.equal(Provider.verifyCallbackPayload({ ...body, transaction_id: '' }).valid, false);
  assert.equal(Provider.verifyCallbackPayload({ ...body, payment_method: 'card' }).valid, false);
  assert.equal(Provider.verifyCallbackPayload({ ...body, status: 'processing' }).valid, false);
});

const usagePlans = [
  ['USAGE_0_5000_MONTHLY', 5000, 0, 5000],
  ['USAGE_5001_10000_MONTHLY', 10000, 5001, 10000],
  ['USAGE_10001_20000_MONTHLY', 17000, 10001, 20000],
  ['USAGE_20001_40000_MONTHLY', 20000, 20001, 40000],
  ['USAGE_40001_PLUS_MONTHLY', 25000, 40001, null],
].map(([code, price, min, max], index) => ({
  ...plan,
  id: index + 1,
  code,
  price,
  min_volume_liters: min,
  max_volume_liters: max,
  sort_order: index + 1,
}));

test('customer subscription returns validated plan and payment arrays for collectors', async () => {
  const result = await Subscriptions.getCustomerSubscription({
    userId: 42,
    now: new Date('2026-10-10T00:00:00.000Z'),
    repository: {
      getSubscription: async () => ({ status: 'pending', access_started_at: '2026-10-01T10:00:00.000Z', payment_due_at: '2026-10-15T22:00:00.000Z' }),
      getUser: async () => ({ id: 42, name: 'Milk User', phone: '0788000000', accountType: 'COLLECTOR' }),
      getActivePlans: async () => usagePlans,
      getPaymentsByUser: async () => [],
      getCollectorMilk: async () => [],
      getFarmerMilkUsage: async () => ({ recordCount: 0, validLiters: 0 }),
      getTierForVolume: async () => usagePlans[0],
      getTierByCode: async () => usagePlans[0],
      getNextTier: async () => usagePlans[1],
    },
  });

  assert.equal(result.plans.length, 5);
  assert.ok(Array.isArray(result.plans));
  assert.ok(Array.isArray(result.payments));
  assert.equal(result.account.name, 'Milk User');
  assert.equal(result.account.accountType, 'COLLECTOR');
  assert.equal(result.pricing.planCode, 'USAGE_0_5000_MONTHLY');
  assert.equal(result.pricing.amount, 5000);
  assert.equal(result.pricing.estimatedMonthlyLiters, 0);
});

test('saved current-period terms stay unchanged while a new renewal quote uses the saved live price', async () => {
  const activePlans = usagePlans.map((item, index) => index === 0 ? { ...item, price: 6200, name: 'Repriced first tier' } : item);
  const subscription = {
    id: 32,
    status: 'active',
    effective_status: 'active',
    plan_id: usagePlans[0].id,
    current_price: 5000,
    tier_code: 'USAGE_0_5000',
    volume_limit_liters: 5000,
    current_period_started_at: '2026-10-01T00:00:00.000Z',
    current_period_ends_at: '2026-11-01T00:00:00.000Z',
    current_plan_snapshot: { id: 1, code: usagePlans[0].code, name: 'Original tier', price: 5000, currency: 'RWF', minVolumeLiters: 0, maxVolumeLiters: 5000 },
  };
  const usageAlerts = [];
  const result = await Subscriptions.getCustomerSubscription({
    userId: 42,
    planCode: usagePlans[0].code,
    repository: {
      getSubscription: async () => subscription,
      getUser: async () => ({ id: 42, name: 'Milk User', phone: '0788000000', email: 'milk@example.com', language: 'rw', accountType: 'COLLECTOR' }),
      getActivePlans: async () => activePlans,
      getPaymentsByUser: async () => [],
      getCollectorMilk: async () => [],
      getFarmerMilkUsage: async () => ({ recordCount: 1, validLiters: 6000 }),
      getTierForVolume: async () => activePlans[1],
      getTierByCode: async () => activePlans[0],
      getNextTier: async () => activePlans[1],
      queueUsageExceededNotice: async (input) => usageAlerts.push(input),
    },
  });

  assert.equal(result.pricing.amount, 6200);
  assert.equal(subscription.current_price, 5000);
  assert.equal(subscription.current_plan_snapshot.price, 5000);
  assert.equal(result.usage.limitExceeded, true);
  assert.equal(usageAlerts.length, 1);
  assert.equal(usageAlerts[0].actualLiters, 6000);
  assert.equal(usageAlerts[0].currentTier.name, 'Original tier');
  assert.equal(usageAlerts[0].recommendedTier.code, activePlans[1].code);
  assert.equal(usageAlerts[0].effectiveDate, subscription.current_period_ends_at);
});

test('Collector owner usage excludes voided volume when no farmer records are available', async () => {
  const usage = await Subscriptions.getUsage({
    userId: 42,
    subscription: { status: 'pending', access_started_at: '2026-10-01T10:00:00.000Z', payment_due_at: '2026-10-15T22:00:00.000Z' },
    now: new Date('2026-10-10T00:00:00.000Z'),
    repository: {
      getCollectorMilk: async () => [
        { volumeLiters: 120, effectiveVolumeLiters: 0 },
        { volumeLiters: 60, validVolumeLiters: 45 },
      ],
      getFarmerMilkUsage: async () => ({ recordCount: 0, validLiters: 0 }),
      getTierForVolume: async () => ({ ...usagePlans[0] }),
      getTierByCode: async () => null,
      getNextTier: async () => usagePlans[1],
    },
  });
  assert.equal(usage.actualLiters, 45);
});

test('usage alert dedupe keys are stable within a tier period and change next period', () => {
  const buildKey = SubscriptionRepository.buildUsageExceededEventKey;
  const key = buildKey({ subscriptionId: 7, periodStart: '2026-10-01T00:00:00.000Z', tierCode: 'USAGE_0_5000_MONTHLY' });
  assert.equal(key, buildKey({ subscriptionId: 7, periodStart: new Date('2026-10-01T00:00:00.000Z'), tierCode: 'USAGE_0_5000_MONTHLY' }));
  assert.notEqual(key, buildKey({ subscriptionId: 7, periodStart: '2026-11-01T00:00:00.000Z', tierCode: 'USAGE_0_5000_MONTHLY' }));
});

test('admin payment history query is customer-linked and bounded with real provider fields', () => {
  const statements = SubscriptionRepository.buildAdminPaymentHistoryQueries({ limit: 20, offset: 40, status: 'PENDING' });
  assert.match(statements.payments.text, /u\.email AS account_email/);
  assert.match(statements.payments.text, /sp\.mobile_money_phone/);
  assert.match(statements.payments.text, /sp\.provider_transaction_id/);
  assert.match(statements.payments.text, /sp\.created_at/);
  assert.match(statements.payments.text, /sp\.completed_at/);
  assert.match(statements.payments.text, /JOIN users u ON u\.id = sp\.user_id/);
  assert.match(statements.payments.text, /LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(statements.payments.values, ['PENDING', 20, 40]);
  assert.match(statements.count.text, /COUNT\(\*\)::bigint AS total/);
  assert.deepEqual(statements.count.values, ['PENDING']);
});

test('customer payment history is owner-scoped and bounded to the newest 100 rows', () => {
  const statement = SubscriptionRepository.buildCustomerPaymentHistoryQuery(42);
  assert.match(statement.text, /sp\.user_id = \$1/);
  assert.match(statement.text, /ORDER BY sp\.created_at DESC, sp\.id DESC LIMIT \$2/);
  assert.deepEqual(statement.values, [42, 100]);
});

test('collector billing accepts editable contiguous tier ranges and current stored prices', async () => {
  const ranges = [[0, 4500], [4501, 9000], [9001, 18000], [18001, 36000], [36001, null]];
  const adjustedPlans = usagePlans.map((item, index) => ({
    ...item,
    price: 6200 + index * 1000,
    min_volume_liters: ranges[index][0],
    max_volume_liters: ranges[index][1],
  }));
  const validated = Subscriptions.validatePricingTiers(adjustedPlans);
  assert.equal(validated[0].price, 6200);
  assert.equal(validated[4].price, 10200);
  assert.equal(validated[3].max_volume_liters, 36000);
  assert.equal(validated[4].min_volume_liters, 36001);
  assert.equal((await Subscriptions.getTierForVolume(4500, { getActivePlans: async () => adjustedPlans })).code, usagePlans[0].code);
  assert.equal((await Subscriptions.getTierForVolume(4501, { getActivePlans: async () => adjustedPlans })).code, usagePlans[1].code);
  assert.throws(() => Subscriptions.validatePricingTiers(adjustedPlans.map((tier, index) => index === 1 ? { ...tier, min_volume_liters: 4502 } : tier)), /invalid volume range/i);
});

test('public tier catalog immediately reflects saved active labels, ranges, and prices', async () => {
  const activePlans = usagePlans.slice(0, 2).map((item, index) => ({
    ...item,
    name: index === 0 ? 'Small dairy' : 'Large dairy',
    price: 7000 + (index * 3000),
    min_volume_liters: index === 0 ? 0 : 5001,
    max_volume_liters: index === 0 ? 5000 : null,
  }));
  const catalog = await Subscriptions.getAvailablePlans({ getActivePlans: async () => activePlans });
  assert.deepEqual(catalog.map(({ name, price, min_volume_liters, max_volume_liters }) => ({ name, price, min_volume_liters, max_volume_liters })), [
    { name: 'Small dairy', price: 7000, min_volume_liters: 0, max_volume_liters: 5000 },
    { name: 'Large dairy', price: 10000, min_volume_liters: 5001, max_volume_liters: null },
  ]);
  assert.equal('metadata' in catalog[0], false);
});

test('public registration configuration reflects saved tier prices and access timing', async () => {
  const configuration = await Subscriptions.getPublicSubscriptionConfiguration({
    getActivePlans: async () => usagePlans,
    getSubscriptionPolicy: async () => ({ initial_access_days: 20, grace_period_days: 0, enforcement_time: '00:00:00', time_zone: 'Africa/Kigali' }),
  });
  assert.equal(configuration.policy.initial_access_days, 20);
  assert.equal(configuration.policy.grace_period_days, 0);
  assert.equal(configuration.policy.time_zone, 'Africa/Kigali');
  assert.equal(configuration.plans[0].price, usagePlans[0].price);
});

test('Collection Center customer pricing is a single server-calculated flat monthly amount', async () => {
  const centerPlan = { ...usagePlans[0], id: 50, code: 'COLLECTION_CENTER_MONTHLY', name: 'Collection Center Monthly', price: 30000 };
  const result = await Subscriptions.getCustomerSubscription({
    userId: 51,
    repository: {
      getSubscription: async () => ({ id: 9, status: 'pending' }),
      getUser: async () => ({ id: 51, phone: '0788000000', accountType: 'COLLECTION_CENTER' }),
      getPlanByCode: async () => centerPlan,
      getPaymentsByUser: async () => [],
    },
  });
  assert.equal(result.pricing.planCode, 'COLLECTION_CENTER_MONTHLY');
  assert.equal(result.pricing.amount, 30000);
  assert.equal(result.pricing.estimatedMonthlyLiters, null);
  assert.equal(result.usage, null);
});

test('pending payment uses the canonical usage tier and never activates a subscription', async () => {
  let reserved;
  let providerRequest;
  const adjustedPlans = usagePlans.map((item, index) => index === 0 ? { ...item, price: 6200 } : item);
  let payment = { id: 120, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-120', mobile_money_phone: '0788000000', amount: 5000 };
  const repository = {
    getUser: async () => ({ id: 42, name: 'Milk User', email: 'milk@example.com', phone: '0788000000', accountType: 'COLLECTOR' }),
    findActivePayments: async () => [],
    getSubscription: async () => ({ id: 7, status: 'pending', effective_status: 'pending', access_started_at: '2026-10-01T10:00:00.000Z', payment_due_at: '2026-10-15T22:00:00.000Z', selected_plan_snapshot: { ...usagePlans[4], minVolumeLiters: 40001, maxVolumeLiters: null } }),
    getActivePlans: async () => adjustedPlans,
    getPlanByCode: async (code) => usagePlans.find((item) => item.code === code) || null,
    getCollectorMilk: async () => [],
    getFarmerMilkUsage: async () => ({ recordCount: 0, validLiters: 0 }),
    getTierForVolume: async (liters) => adjustedPlans[liters <= 5000 ? 0 : 1],
    getTierByCode: async () => null,
    getNextTier: async () => adjustedPlans[1],
    reservePayment: async (input) => { reserved = input; return { payment, reused: false }; },
    getPaymentById: async () => payment,
    getPaymentByIdForUser: async () => payment,
    updateProviderReference: async ({ providerReference }) => { payment.provider_reference = providerReference; return payment; },
  };
  const provider = {
    assertReady() {},
    createPaymentRequest: async (request) => { providerRequest = request; return { status: 'PENDING', providerReference: request.referenceId }; },
    getPaymentStatus: async () => ({ status: 'PENDING' }),
  };
  const result = await Subscriptions.createPendingPayment({
    userId: 42,
    planCode: 'USAGE_40001_PLUS_MONTHLY',
    billingPeriod: 'monthly',
    repository,
    provider,
    now: new Date('2026-10-10T00:00:00.000Z'),
  });
  assert.equal(result.payment.status, 'PENDING');
  assert.equal(reserved.amount, 25000);
  assert.equal(reserved.billingPeriod, 'monthly');
  assert.equal(reserved.periodEnd.toISOString().slice(0, 10), '2026-11-10');
  assert.equal(reserved.planId, 5);
  assert.equal(reserved.planSnapshot.maxVolumeLiters, null);
  assert.equal(reserved.paymentMethod, 'MTN_MOMO_RWA');
  assert.equal(providerRequest.phoneNumber, '0788000000');
  assert.equal(providerRequest.amount, 25000);
  assert.match(reserved.providerReference, /^milk-subscription-[0-9a-f-]{36}$/i);
  assert.equal(providerRequest.referenceId, reserved.providerReference);
  assert.equal(result.payment.status, 'PENDING');
});

test('payment initiation rejects every non-monthly billing period', async () => {
  let reserved = false;
  for (const billingPeriod of ['6_months', 'yearly', 'quarterly']) {
    await assert.rejects(() => Subscriptions.createPendingPayment({
      userId: 42,
      billingPeriod,
      repository: { reservePayment: async () => { reserved = true; } },
      provider: { assertReady() {} },
    }), (error) => error.code === 'BILLING_PERIOD_NOT_SUPPORTED');
  }
  assert.equal(reserved, false);
});

test('documented concurrent success callbacks confirm provider status and settle once', async () => {
  const body = { reference_id: 'ref-200', transaction_id: 'txn-200', status: 'success', amount: '5000.00', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
  let payment = { id: 200, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-200', provider_transaction_id: null, payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
  let settlements = 0;
  let emailClaims = 0;
  const confirmationRecipients = [];
  const repository = {
    findPaymentByReference: async () => payment,
    settlePayment: async ({ status, transactionId }) => {
      await new Promise((resolve) => setImmediate(resolve));
      const settlementApplied = payment.status === 'PENDING';
      if (settlementApplied) {
        settlements += 1;
        payment = { ...payment, status, provider_transaction_id: transactionId };
      }
      return { ...payment, settlementApplied };
    },
    recordPaymentEvent: async () => {},
    claimSubscriptionEmailEvents: async ({ paymentId }) => {
      if (paymentId !== payment.id || emailClaims) return [];
      emailClaims += 1;
      return [{ id: 1, event_type: 'payment_confirmation', recipient: 'customer@example.test', payload: { customerName: 'Milk Customer', amount: 5000 } }];
    },
    markSubscriptionEmailSent: async () => {},
    markSubscriptionEmailFailed: async () => {},
  };
  const provider = { getPaymentStatus: async () => ({ providerReference: 'ref-200', transactionId: 'txn-200', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' }) };
  const mailer = { sendPaymentConfirmation: async ({ to, payload }) => confirmationRecipients.push([to, payload.amount]) };
  const [settled, duplicate] = await Promise.all([
    Subscriptions.handleProviderCallback({ body, repository, provider, mailer }),
    Subscriptions.handleProviderCallback({ body, repository, provider, mailer }),
  ]);
  assert.equal(settled.status, 'SUCCESS');
  assert.equal(duplicate.status, 'SUCCESS');
  assert.equal([settled.idempotent, duplicate.idempotent].filter(Boolean).length, 1);
  assert.equal(payment.provider_transaction_id, 'txn-200');
  assert.equal(settlements, 1);
  assert.deepEqual(confirmationRecipients, [['customer@example.test', 5000]]);
});

test('callback amount mismatch cannot fail or settle a payment without matching provider verification', async () => {
  const body = { reference_id: 'ref-201', transaction_id: 'txn-201', status: 'success', amount: '4000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
  let payment = { id: 201, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-201', payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
  let statusChecks = 0;
  let settlements = 0;
  const repository = {
    findPaymentByReference: async () => payment,
    settlePayment: async ({ status, transactionId }) => { settlements += 1; payment = { ...payment, status, provider_transaction_id: transactionId }; return payment; },
    recordPaymentEvent: async () => {},
  };
  const result = await Subscriptions.handleProviderCallback({
    body,
    repository,
    provider: { getPaymentStatus: async () => { statusChecks += 1; return { providerReference: 'ref-201', transactionId: 'txn-201', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' }; } },
  });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.verificationPending, true);
  assert.equal(payment.status, 'PENDING');
  assert.equal(statusChecks, 1);
  assert.equal(settlements, 0);
});

test('callback status mismatch and provider verification failure leave payment pending', async () => {
  const payment = { id: 209, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-209', payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
  const body = { reference_id: 'ref-209', transaction_id: 'txn-209', status: 'failed', amount: '5000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
  let settlements = 0;
  const repository = {
    findPaymentByReference: async () => payment,
    settlePayment: async () => { settlements += 1; },
    recordPaymentEvent: async () => {},
  };
  const mismatch = await Subscriptions.handleProviderCallback({
    body,
    repository,
    provider: { getPaymentStatus: async () => ({ providerReference: 'ref-209', transactionId: 'txn-209', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' }) },
  });
  assert.equal(mismatch.status, 'PENDING');
  assert.equal(mismatch.verificationPending, true);
  const unavailable = await Subscriptions.handleProviderCallback({
    body: { ...body, status: 'success' },
    repository,
    provider: { getPaymentStatus: async () => { throw new Error('status lookup unavailable'); } },
  });
  assert.equal(unavailable.status, 'PENDING');
  assert.equal(unavailable.verificationPending, true);
  assert.equal(payment.status, 'PENDING');
  assert.equal(settlements, 0);
});

test('terminal provider status without its transaction ID remains pending', async () => {
  const payment = { id: 206, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-206', payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
  const result = await Subscriptions.handleProviderCallback({
    body: { reference_id: 'ref-206', transaction_id: 'callback-txn', status: 'success', amount: '5000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' },
    repository: {
      findPaymentByReference: async () => payment,
      settlePayment: async () => { throw new Error('Must not settle without provider transaction ID.'); },
      recordPaymentEvent: async () => {},
    },
    provider: { getPaymentStatus: async () => ({ providerReference: 'ref-206', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' }) },
  });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.verificationPending, true);
  assert.equal(payment.status, 'PENDING');
});

test('callback transaction, phone, method, and reference mismatches never settle a payment', async () => {
  const basePayment = { id: 208, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-208', payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
  const baseBody = { reference_id: 'ref-208', transaction_id: 'txn-208', status: 'success', amount: '5000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
  const cases = [
    { body: { ...baseBody, transaction_id: 'forged-transaction' }, confirmation: { providerReference: 'ref-208', transactionId: 'txn-208', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' } },
    { body: { ...baseBody, payer_phone: '+250799000000' }, confirmation: { providerReference: 'ref-208', transactionId: 'txn-208', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' } },
    { body: baseBody, payment: { ...basePayment, payment_method: 'CARD' }, confirmation: { providerReference: 'ref-208', transactionId: 'txn-208', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' } },
    { body: baseBody, confirmation: { providerReference: 'other-reference', transactionId: 'txn-208', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: 'SUCCESS' } },
    { body: baseBody, confirmation: { providerReference: 'ref-208', transactionId: 'txn-208', amount: 5000, paymentMethod: 'CARD', status: 'SUCCESS' } },
  ];
  for (const item of cases) {
    const payment = item.payment || basePayment;
    let settlements = 0;
    const result = await Subscriptions.handleProviderCallback({
      body: item.body,
      repository: {
        findPaymentByReference: async () => payment,
        settlePayment: async () => { settlements += 1; },
        recordPaymentEvent: async () => {},
      },
      provider: { getPaymentStatus: async () => item.confirmation },
    });
    assert.equal(result.status, 'PENDING');
    assert.equal(result.verificationPending, true);
    assert.equal(payment.status, 'PENDING');
    assert.equal(settlements, 0);
  }
});

test('stale callback cannot downgrade a previously successful payment', async () => {
  const body = { reference_id: 'ref-207', transaction_id: 'txn-207', status: 'failed', amount: '5000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
  const payment = { id: 207, status: 'SUCCESS', provider: 'mtn_momo', provider_reference: 'ref-207', provider_transaction_id: 'txn-207', payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
  let lookups = 0;
  let settlements = 0;
  await assert.rejects(() => Subscriptions.handleProviderCallback({
    body,
    repository: {
      findPaymentByReference: async () => payment,
      settlePayment: async () => { settlements += 1; },
      recordPaymentEvent: async () => {},
    },
    provider: { getPaymentStatus: async () => { lookups += 1; } },
  }), (error) => error.statusCode === 409);
  assert.equal(payment.status, 'SUCCESS');
  assert.equal(lookups, 0);
  assert.equal(settlements, 0);
});

test('callback pending, failed, and cancelled states follow the provider-confirmed status', async () => {
  for (const [callbackStatus, providerStatus, expected] of [
    ['pending', 'PENDING', 'PENDING'],
    ['failed', 'FAILED', 'FAILED'],
    ['cancelled', 'CANCELLED', 'CANCELLED'],
  ]) {
    let payment = { id: 210, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-210', payment_method: 'MTN_MOMO_RWA', mobile_money_phone: '0788000000', amount: 5000, user_id: 42 };
    const body = { reference_id: 'ref-210', transaction_id: 'txn-210', status: callbackStatus, amount: '5000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' };
    const result = await Subscriptions.handleProviderCallback({
      body,
      repository: {
        findPaymentByReference: async () => payment,
        recordPaymentEvent: async () => {},
        recordProviderTransaction: async ({ transactionId }) => { payment.provider_transaction_id = transactionId; },
        settlePayment: async ({ status, transactionId }) => {
          payment = { ...payment, status, provider_transaction_id: transactionId, settlementApplied: true };
          return payment;
        },
      },
      provider: { getPaymentStatus: async () => ({ providerReference: 'ref-210', transactionId: 'txn-210', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: providerStatus }) },
    });
    assert.equal(result.status, expected);
    assert.equal(payment.status, expected);
  }
});

test('payment status checks are scoped to the authenticated customer ID', async () => {
  const observedIds = [];
  const payment = { id: 202, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-202', amount: 5000 };
  const result = await Subscriptions.reconcilePayment({
    paymentId: 202,
    userId: 42,
    repository: {
      getPaymentByIdForUser: async (paymentId, userId) => { observedIds.push([paymentId, userId]); return userId === 42 ? payment : null; },
    },
    provider: { getPaymentStatus: async () => { throw new Error('Must not query another account.'); } },
  });
  assert.equal(result.status, 'PENDING');
  assert.deepEqual(observedIds, [[202, 42]]);
  const otherCustomerPayment = await Subscriptions.reconcilePayment({
    paymentId: 202,
    userId: 99,
    repository: {
      getPaymentByIdForUser: async (paymentId, userId) => { observedIds.push([paymentId, userId]); return null; },
    },
    provider: { getPaymentStatus: async () => { throw new Error('Must not query another account.'); } },
  });
  assert.equal(otherCustomerPayment, null);
  assert.deepEqual(observedIds, [[202, 42], [202, 99]]);
});

test('unknown callback references are audited and never create a payment', async () => {
  let settlements = 0;
  const repository = {
    findPaymentByReference: async () => null,
    recordPaymentEvent: async () => {},
    settlePayment: async () => { settlements += 1; },
  };
  await assert.rejects(() => Subscriptions.handleProviderCallback({
    body: { reference_id: 'unknown', transaction_id: 'txn', status: 'success', amount: '5000', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' },
    repository,
    provider: {},
  }), (error) => error.statusCode === 404);
  assert.equal(settlements, 0);
});

test('email provider failures remain queued and are never reported as delivered', async () => {
  let failedEvent;
  let markedSent = false;
  const result = await Subscriptions.deliverSubscriptionEmails({
    repository: {
      claimSubscriptionEmailEvents: async () => [{ id: 90, event_type: 'payment_confirmation', recipient: 'payer@example.test', payload: { amount: 5000 } }],
      markSubscriptionEmailSent: async () => { markedSent = true; },
      markSubscriptionEmailFailed: async (input) => { failedEvent = input; },
    },
    mailer: { sendPaymentConfirmation: async () => { throw Object.assign(new Error('Provider rejected delivery.'), { code: 'EMAIL_PROVIDER_REJECTED' }); } },
  });
  assert.deepEqual(result, { sent: 0, failed: 1, attempted: 1 });
  assert.equal(markedSent, false);
  assert.deepEqual(failedEvent, { eventId: 90, errorCode: 'EMAIL_PROVIDER_REJECTED' });
});

test('subscription email job schedules only explicitly configured reminder offsets', async () => {
  let scheduledOffsets;
  let sentReminder;
  const result = await Subscriptions.runSubscriptionEmailJob({
    reminderDays: [7, 1],
    repository: {
      scheduleSubscriptionEmailEvents: async ({ reminderDays }) => { scheduledOffsets = reminderDays; return { remindersQueued: 2, expired: 1 }; },
      claimSubscriptionEmailEvents: async () => [{ id: 91, event_type: 'subscription_reminder', recipient: 'owner@example.test', payload: { subscriptionEnd: '2026-11-01' } }],
      markSubscriptionEmailSent: async () => {},
      markSubscriptionEmailFailed: async () => {},
    },
    mailer: { sendSubscriptionReminder: async (message) => { sentReminder = message; } },
  });
  assert.deepEqual(scheduledOffsets, [7, 1]);
  assert.equal(sentReminder.to, 'owner@example.test');
  assert.equal(result.delivery.sent, 1);
  assert.equal(result.schedule.expired, 1);
});

test('daily subscription job evaluates authoritative tier usage and queues one deduplicated alert', async () => {
  let queued = 0;
  const repository = {
    scheduleSubscriptionEmailEvents: async () => ({ expired: 0 }),
    getUsageAlertCandidates: async () => [{
      id: 12,
      user_id: 42,
      status: 'active',
      current_period_started_at: '2026-10-01T00:00:00.000Z',
      current_period_ends_at: '2026-11-01T00:00:00.000Z',
      current_plan_snapshot: { ...usagePlans[0], minVolumeLiters: 0, maxVolumeLiters: 5000 },
      volume_limit_liters: 5000,
      candidate_user_id: 42,
      candidate_email: 'owner@example.test',
      candidate_language: 'en',
    }],
    getCollectorMilk: async () => [],
    getFarmerMilkUsage: async () => ({ recordCount: 1, validLiters: 6000 }),
    getTierForVolume: async () => usagePlans[1],
    getTierByCode: async () => usagePlans[0],
    getNextTier: async () => usagePlans[1],
    queueUsageExceededNotice: async (input) => {
      queued += 1;
      assert.equal(input.actualLiters, 6000);
      assert.equal(input.language, 'en');
      return { notificationCreated: true, emailQueued: true };
    },
    claimSubscriptionEmailEvents: async () => [],
  };
  const result = await Subscriptions.runSubscriptionEmailJob({ repository, mailer: {} });
  assert.equal(queued, 1);
  assert.equal(result.usageAlertsQueued, 1);
});

test('Resend delivery refuses to use an implicit sample sender', async () => {
  const names = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'RESEND_FROM', 'EMAIL_FROM'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test-only-key';
    delete process.env.RESEND_FROM;
    delete process.env.EMAIL_FROM;
    await assert.rejects(() => EmailService.sendPaymentConfirmation({ to: 'payer@example.test', payload: {} }), (error) => error.code === 'EMAIL_NOT_CONFIGURED');
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('LMBTech initiation and status lookup use the documented endpoints, Basic auth, and fields', async () => {
  const names = ['LMBTECH_APP_KEY', 'LMBTECH_SECRET_KEY', 'LMBTECH_BASE_URL', 'LMBTECH_CALLBACK_URL', 'LMBTECH_ALLOW_REAL_PAYMENTS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const calls = [];
  const responses = [
    { status: 'pending', data: { reference_id: 'milk-subscription-test-1', status: 'pending' }, message: 'Payment initiated' },
    { status: 'success', data: { reference_id: 'milk-subscription-test-1', transaction_id: 'txn-1', amount: '5000.00', status: 'success', payment_method: 'MTN_MOMO_RWA', payer_phone: '+250788000000' } },
  ];
  try {
    process.env.LMBTECH_APP_KEY = 'test-app-key';
    process.env.LMBTECH_SECRET_KEY = 'test-secret-key';
    process.env.LMBTECH_BASE_URL = 'https://pay.lmbtech.rw/pay/config/api';
    process.env.LMBTECH_CALLBACK_URL = 'https://milk.example.test/api/subscription/payments/callback';
    process.env.LMBTECH_ALLOW_REAL_PAYMENTS = 'true';
    const provider = new Provider.LmbtechProvider(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify(responses.shift()) };
    });
    const initiated = await provider.createPaymentRequest({
      paymentId: 1,
      userId: 42,
      referenceId: 'milk-subscription-test-1',
      phoneNumber: '0788000000',
      amount: 5000,
      currency: 'RWF',
      userEmail: 'customer@example.test',
      userName: 'Milk Customer',
    });
    assert.equal(initiated.status, 'PENDING');
    assert.equal(calls[0].url, 'https://pay.lmbtech.rw/pay/config/api.php');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('test-app-key:test-secret-key').toString('base64')}`);
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    const requestBody = JSON.parse(calls[0].options.body);
    assert.deepEqual(requestBody, {
      email: 'customer@example.test',
      name: 'Milk Customer',
      payment_method: 'MTN_MOMO_RWA',
      amount: 5000,
      payer_phone: '+250788000000',
      service_paid: 'milk-system-subscription',
      reference_id: 'milk-subscription-test-1',
      callback_url: 'https://milk.example.test/api/subscription/payments/callback',
      action: 'pay',
    });
    const result = await provider.getPaymentStatus({ providerReference: 'milk-subscription-test-1' });
    assert.equal(calls[1].url, 'https://pay.lmbtech.rw/pay/config/api.php?reference_id=milk-subscription-test-1');
    assert.equal(calls[1].options.method, 'GET');
    assert.equal(calls[1].options.headers.Authorization, `Basic ${Buffer.from('test-app-key:test-secret-key').toString('base64')}`);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.transactionId, 'txn-1');
    assert.equal(result.amount, 5000);
    assert.equal(result.paymentMethod, 'MTN_MOMO_RWA');
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('LMBTech initiation distinguishes uncertain transport/server failures from explicit rejection', async () => {
  const names = ['LMBTECH_APP_KEY', 'LMBTECH_SECRET_KEY', 'LMBTECH_API_KEY', 'LMBTECH_API_SECRET', 'LMBTECH_CALLBACK_URL', 'LMBTECH_ALLOW_REAL_PAYMENTS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.LMBTECH_APP_KEY = 'mock-app-key';
    process.env.LMBTECH_SECRET_KEY = 'mock-secret-key';
    process.env.LMBTECH_CALLBACK_URL = 'https://milk.example.test/api/subscription/payments/callback';
    process.env.LMBTECH_ALLOW_REAL_PAYMENTS = 'true';
    const request = {
      paymentId: 1,
      userId: 42,
      referenceId: 'milk-subscription-failure-test',
      phoneNumber: '0788000000',
      amount: 5000,
      currency: 'RWF',
      userEmail: 'customer@example.test',
      userName: 'Milk Customer',
    };
    await assert.rejects(
      () => new Provider.LmbtechProvider(async () => { throw new Error('mock network timeout'); }).createPaymentRequest(request),
      (error) => error.code === 'LMBTECH_INITIATION_UNCERTAIN' && error.uncertain === true
    );
    await assert.rejects(
      () => new Provider.LmbtechProvider(async () => ({ ok: false, status: 503, text: async () => '{"message":"unavailable"}' })).createPaymentRequest(request),
      (error) => error.code === 'LMBTECH_INITIATION_UNCERTAIN' && error.uncertain === true
    );
    await assert.rejects(
      () => new Provider.LmbtechProvider(async () => ({ ok: false, status: 400, text: async () => '{"message":"rejected"}' })).createPaymentRequest(request),
      (error) => error.code === 'LMBTECH_INITIATION_REJECTED' && error.uncertain === false
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('malformed provider responses remain unknown and cannot settle a payment', async () => {
  const names = ['LMBTECH_APP_KEY', 'LMBTECH_SECRET_KEY', 'LMBTECH_API_KEY', 'LMBTECH_API_SECRET', 'LMBTECH_CALLBACK_URL', 'LMBTECH_ALLOW_REAL_PAYMENTS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.LMBTECH_APP_KEY = 'mock-app-key';
    process.env.LMBTECH_SECRET_KEY = 'mock-secret-key';
    process.env.LMBTECH_CALLBACK_URL = 'https://milk.example.test/api/subscription/payments/callback';
    process.env.LMBTECH_ALLOW_REAL_PAYMENTS = 'true';
    const provider = new Provider.LmbtechProvider(async () => ({ ok: true, status: 200, text: async () => 'not-json' }));
    const status = await provider.getPaymentStatus({ providerReference: 'ref-malformed' });
    assert.equal(status.status, 'UNKNOWN');
    assert.equal(status.providerReference, null);

    const payment = { id: 205, user_id: 42, status: 'PENDING', provider: 'mtn_momo', provider_reference: 'ref-malformed', amount: 5000 };
    let settlements = 0;
    const result = await Subscriptions.reconcilePayment({
      paymentId: payment.id,
      userId: payment.user_id,
      repository: {
        getPaymentByIdForUser: async () => payment,
        settlePayment: async () => { settlements += 1; },
        recordPaymentEvent: async () => {},
      },
      provider: { getPaymentStatus: async () => status },
    });
    assert.equal(result.status, 'PENDING');
    assert.equal(settlements, 0);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('payment readiness remains disabled when required credentials or public callback are missing', () => {
  const names = ['LMBTECH_APP_KEY', 'LMBTECH_SECRET_KEY', 'LMBTECH_API_KEY', 'LMBTECH_API_SECRET', 'LMBTECH_CALLBACK_URL', 'NEXT_PUBLIC_APP_URL', 'FRONTEND_URL', 'LMBTECH_ALLOW_REAL_PAYMENTS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(Provider.getLmbtechPublicStatus().ready, false);
    process.env.LMBTECH_API_KEY = 'test-app-key';
    process.env.LMBTECH_API_SECRET = 'test-secret-key';
    process.env.LMBTECH_ALLOW_REAL_PAYMENTS = 'true';
    assert.equal(Provider.getLmbtechPublicStatus().credentialsConfigured, true);
    assert.equal(Provider.getLmbtechPublicStatus().callbackConfigured, false);
    assert.equal(Provider.getLmbtechPublicStatus().ready, false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('unknown LMBTech states remain unknown and cannot become pending or successful', () => {
  assert.equal(Provider.normalizeLmbtechStatus('success'), 'SUCCESS');
  assert.equal(Provider.normalizeLmbtechStatus('pending'), 'PENDING');
  assert.equal(Provider.normalizeLmbtechStatus('failed'), 'FAILED');
  assert.equal(Provider.normalizeLmbtechStatus('fail'), 'FAILED');
  assert.equal(Provider.normalizeLmbtechStatus('cancelled'), 'CANCELLED');
  assert.equal(Provider.normalizeLmbtechStatus('canceled'), 'UNKNOWN');
  assert.equal(Provider.normalizeLmbtechStatus('expired'), 'UNKNOWN');
  assert.equal(Provider.normalizeLmbtechStatus('processing'), 'UNKNOWN');
});

test('payment initiation stops before reservation when the account phone is missing or invalid', async () => {
  for (const phone of [null, '12345']) {
    let reserved = false;
    await assert.rejects(() => Subscriptions.createPendingPayment({
      userId: 42,
      repository: { getUser: async () => ({ id: 42, phone, accountType: 'COLLECTOR' }) },
      provider: { assertReady() {} },
    }), (error) => error.code === 'PHONE_NUMBER_MISSING');
    assert.equal(reserved, false);
  }
});

test('provider state reconciliation handles pending, failed, and cancelled without activating subscriptions', async () => {
  for (const [status, expected] of [['pending', 'PENDING'], ['failed', 'FAILED'], ['cancelled', 'CANCELLED']]) {
    let payment = { id: 300, user_id: 42, status: 'PENDING', provider: 'mtn_momo', provider_reference: `ref-${status}`, amount: 5000 };
    const result = await Subscriptions.reconcilePayment({
      paymentId: payment.id,
      userId: 42,
      repository: {
        getPaymentByIdForUser: async () => payment,
        getPaymentById: async () => payment,
        settlePayment: async ({ status: nextStatus }) => { payment = { ...payment, status: nextStatus }; return payment; },
      },
      provider: { getPaymentStatus: async () => ({ providerReference: payment.provider_reference, transactionId: 'txn-300', amount: 5000, paymentMethod: 'MTN_MOMO_RWA', status: expected }) },
    });
    assert.equal(result.status, expected);
  }
});

test('monthly prices use the canonical server tier price without prepayment discounts', () => {
  const tier = usagePlans[2];
  assert.equal(Subscriptions.calculatePrice({}, tier, 'monthly').amount, 17000);
  assert.throws(() => Subscriptions.calculatePrice({}, tier, '6_months'), /Only monthly billing/);
  assert.throws(() => Subscriptions.calculatePrice({}, tier, 'yearly'), /Only monthly billing/);
});
