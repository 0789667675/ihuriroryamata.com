const test = require('node:test');
const assert = require('node:assert/strict');
const { requireActiveSubscription, SUBSCRIPTION_EXPIRED } = require('../lib/security/subscription-access.js');

test('initial access remains available until the authoritative payment deadline', async () => {
  await assert.doesNotReject(() => requireActiveSubscription(
    { id: 42, role: 'user' },
    { getSubscription: async () => ({ status: 'pending', effective_status: 'pending' }) }
  ));
});

test('unpaid initial access is denied once the deadline is reached', async () => {
  await assert.rejects(() => requireActiveSubscription(
    { id: 42, role: 'user' },
    { getSubscription: async () => ({ status: 'pending', effective_status: 'suspended' }) }
  ), (error) => error.statusCode === 403 && error.code === SUBSCRIPTION_EXPIRED);
});

test('pending, failed, and unverified payments do not restore suspended access', async () => {
  for (const paymentStatus of ['PENDING', 'FAILED', 'UNKNOWN']) {
    await assert.rejects(() => requireActiveSubscription(
      { id: 42, role: 'user' },
      { getSubscription: async () => ({ status: 'suspended', effective_status: 'suspended', latest_payment_status: paymentStatus }) }
    ), (error) => error.statusCode === 403);
  }
});

test('a provider-confirmed successful payment restores subscription access', async () => {
  await assert.doesNotReject(() => requireActiveSubscription(
    { id: 42, role: 'user' },
    { getSubscription: async () => ({ status: 'active', effective_status: 'active' }) }
  ));
});

test('Super Admin remains outside customer subscription enforcement', async () => {
  await assert.doesNotReject(() => requireActiveSubscription({ id: 1, role: 'super_admin' }, {
    getSubscription: async () => assert.fail('Super Admin access must not query customer subscription state.'),
  }));
});

test('an audited billing exemption allows access without changing subscription payment status', async () => {
  await assert.doesNotReject(() => requireActiveSubscription({ id: 42, role: 'user' }, {
    getSubscription: async () => ({ status: 'expired', effective_status: 'expired', billing_exempt: true }),
  }));
});