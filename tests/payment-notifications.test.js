const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Notifications = require('../lib/services/notification-service.js');
const Subscriptions = require('../lib/services/subscription-service.js');
const publicCopy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'i18n', 'public-copy.ts'), 'utf8');

const ownerUserId = 42;
const payment = (overrides = {}) => ({
  id: 12,
  user_id: ownerUserId,
  amount: 5000,
  currency: 'RWF',
  plan_name: 'Tier A',
  status: 'PENDING',
  ...overrides,
});

const captureRepository = () => {
  const calls = [];
  return {
    calls,
    repository: {
      upsertNotification: async (input) => {
        calls.push(input);
        return { created: true, notification: { id: 1, ...input } };
      },
    },
  };
};

const types = [
  ['payment_initiated', 'PENDING', 'info'],
  ['payment_success', 'SUCCESS', 'success'],
  ['payment_failed', 'FAILED', 'warning'],
  ['payment_cancelled', 'CANCELLED', 'warning'],
  ['payment_expired', 'EXPIRED', 'warning'],
];

test('payment notifications are owner-scoped, localized, and emitted for every verified payment state', async () => {
  for (const [type, status, priority] of types) {
    const { calls, repository } = captureRepository();
    const result = await Notifications.createPaymentNotification({
      payment: payment({ status, amount: 12345, currency: 'RWF', plan_name: 'Tier B' }),
      type,
      repository,
    });
    assert.equal(calls.length, 1);
    const saved = calls[0];
    assert.equal(saved.ownerUserId, ownerUserId);
    assert.equal(saved.type, type);
    assert.equal(saved.priority, priority);
    assert.equal(saved.farmerId, null);
    assert.equal(saved.collectionDate, null);
    assert.equal(saved.details.paymentId, 12);
    assert.equal(saved.details.paymentStatus, status);
    assert.equal(saved.details.titleKey, `alertTitle${type.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`);
    assert.equal(saved.details.messageKey, `alertMessage${type.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`);
    assert.match(saved.message, /12,345/);
    assert.match(saved.message, /Tier B/);
    assert.doesNotMatch(saved.message, /\{(plan|amount|currency)\}/);
    assert.equal(result.ownerUserId, ownerUserId);
    assert.equal(result.type, type);
  }
});

test('payment notifications use stable per-payment/per-status dedupe keys', async () => {
  const { calls, repository } = captureRepository();
  const input = { payment: payment({ status: 'SUCCESS' }), type: 'payment_success', repository };
  const first = await Notifications.createPaymentNotification(input);
  const second = await Notifications.createPaymentNotification(input);
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.equal(calls[0].dedupeKey, calls[1].dedupeKey);
  assert.match(first.dedupeKey, /^payment_success\|group\|all\|unknown-date\|all\|payment:12$/);
  assert.notEqual(
    first.dedupeKey,
    (await Notifications.createPaymentNotification({ ...input, payment: payment({ id: 13, status: 'SUCCESS' }) })).dedupeKey
  );
});

test('payment notifications tolerate missing optional amount, currency, and plan fields without printing undefined', async () => {
  const { calls, repository } = captureRepository();
  const result = await Notifications.createPaymentNotification({
    payment: { id: 21, user_id: ownerUserId, status: 'FAILED' },
    type: 'payment_failed',
    repository,
  });
  const saved = calls[0];
  assert.match(saved.message, /Milk System/);
  assert.match(saved.message, /— RWF/);
  assert.doesNotMatch(saved.message, /undefined|null|NaN/);
  assert.equal(saved.details.amount, '—');
  assert.equal(saved.details.currency, 'RWF');
  assert.equal(result.type, 'payment_failed');
});

test('payment notification rejects mismatched status, missing owner, missing reference, and unknown event types', async () => {
  const { repository } = captureRepository();
  await assert.rejects(
    () => Notifications.createPaymentNotification({ payment: payment({ status: 'SUCCESS' }), type: 'payment_failed', repository }),
    /does not match/i
  );
  await assert.rejects(
    () => Notifications.createPaymentNotification({ payment: payment({ user_id: null, status: 'PENDING' }), type: 'payment_initiated', repository }),
    /valid payment owner/i
  );
  await assert.rejects(
    () => Notifications.createPaymentNotification({ payment: { user_id: ownerUserId, status: 'PENDING' }, type: 'payment_initiated', repository }),
    /reference is required/i
  );
  await assert.rejects(
    () => Notifications.createPaymentNotification({ payment: payment(), type: 'payment_unknown', repository }),
    /Unsupported/i
  );
});

test('payment and health UI copy exists in both locales', () => {
  const keys = [
    'alertTitlePaymentInitiated', 'alertMessagePaymentInitiated',
    'alertTitlePaymentSuccess', 'alertMessagePaymentSuccess',
    'alertTitlePaymentFailed', 'alertMessagePaymentFailed',
    'alertTitlePaymentCancelled', 'alertMessagePaymentCancelled',
    'alertTitlePaymentExpired', 'alertMessagePaymentExpired',
    'healthSubscriptionEmailJob', 'healthCadenceNotDocumented',
    'healthConfigured', 'healthEmailConfiguredDetail', 'healthEmailNotConfiguredDetail',
    'healthSchedulerUnavailable', 'healthEvaluationUnavailable',
    'systemActor', 'close',
  ];
  for (const key of keys) {
    assert.equal(
      (publicCopy.match(new RegExp(`\\b${key}:`, 'g')) || []).length,
      2,
      `${key} must exist in both locales`
    );
  }
});

test('payment notification delivery failure is observable and never changes or blocks the payment result', async () => {
  const original = Notifications.createPaymentNotification;
  const originalError = console.error;
  const errors = [];
  Notifications.createPaymentNotification = async () => {
    throw Object.assign(new Error('notification sink unavailable'), { code: 'NOTIFICATION_SINK_FAILED' });
  };
  console.error = (...args) => errors.push(args);
  try {
    await assert.doesNotReject(() => Subscriptions.notifyPayment({ id: 77, user_id: ownerUserId }, 'payment_success'));
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /Payment notification failed/);
    assert.equal(errors[0][1].code, 'NOTIFICATION_SINK_FAILED');
    assert.equal(errors[0][1].paymentId, 77);
    assert.equal(errors[0][1].type, 'payment_success');
    assert.equal(Object.hasOwn(errors[0][1], 'user_id'), false);
    assert.equal(Object.hasOwn(errors[0][1], 'amount'), false);
  } finally {
    Notifications.createPaymentNotification = original;
    console.error = originalError;
  }
});
