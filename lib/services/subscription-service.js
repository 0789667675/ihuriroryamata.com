const crypto = require('node:crypto');
const defaultRepository = require('../repositories/subscriptionRepository.js');
const DefaultProvider = require('./payment-provider.js');
const DefaultLmbtechProvider = new DefaultProvider.LmbtechProvider();

const TRIAL_DAYS = 15;
const TRIAL_PROJECTION_FACTOR = 2;
const SUPPORTED_PROVIDERS = ['mtn_momo'];
const REQUIRED_TIER_CODES = [
  'USAGE_0_5000_MONTHLY',
  'USAGE_5001_10000_MONTHLY',
  'USAGE_10001_20000_MONTHLY',
  'USAGE_20001_35000_MONTHLY',
  'USAGE_35001_PLUS_MONTHLY',
];
const BILLING_MONTHS = { monthly: 1, '6_months': 6, yearly: 12 };

const toDateOnly = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};
const addDays = (value, days) => {
  const date = new Date(`${toDateOnly(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date;
};
const addBillingPeriod = (value, billingPeriod) => {
  const date = new Date(value);
  if (billingPeriod === 'monthly') {
    date.setUTCDate(date.getUTCDate() + 30);
    return date;
  }
  const monthCount = BILLING_MONTHS[billingPeriod];
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + monthCount);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
};
const normalizePlan = (plan) => plan ? ({
  ...plan,
  price: Number(plan.price),
  intro_price: plan.intro_price === null || plan.intro_price === undefined ? null : Number(plan.intro_price),
  intro_periods: Number(plan.intro_periods || 0),
  duration_days: Number(plan.duration_days || (plan.billing_period === 'monthly' ? 30 : 0)),
  min_volume_liters: plan.min_volume_liters === null || plan.min_volume_liters === undefined ? null : Number(plan.min_volume_liters),
  max_volume_liters: plan.max_volume_liters === null || plan.max_volume_liters === undefined ? null : Number(plan.max_volume_liters),
}) : null;

const billingPeriodSuffix = (billingPeriod = 'monthly') => ({ monthly: 'MONTHLY', '6_months': '6_MONTHS', yearly: 'YEARLY' }[billingPeriod] || 'MONTHLY');
const canonicalPlanCode = (code, billingPeriod = 'monthly') => {
  if (!code || typeof code !== 'string') return code;
  const clean = code.trim().toUpperCase();
  const aliases = {
    USAGE_0_5000: 'USAGE_0_5000',
    USAGE_5001_10000: 'USAGE_5001_10000',
    USAGE_10001_20000: 'USAGE_10001_20000',
    USAGE_20001_35000: 'USAGE_20001_35000',
    USAGE_20001_PLUS: 'USAGE_20001_35000',
    USAGE_20001_40000: 'USAGE_20001_35000',
    USAGE_35001_PLUS: 'USAGE_35001_PLUS',
    USAGE_40001_PLUS: 'USAGE_35001_PLUS',
  };
  if (aliases[clean]) return `${aliases[clean]}_${billingPeriodSuffix(billingPeriod)}`;
  if (/^USAGE_.+_(MONTHLY|6_MONTHS|YEARLY)$/.test(clean)) return clean;
  return clean;
};

const validatePricingTiers = (plans) => {
  if (plans.length !== REQUIRED_TIER_CODES.length) throw new Error('Active subscription plans do not match the approved five-plan monthly contract.');
  const normalized = plans.map(normalizePlan);
  for (let index = 0; index < REQUIRED_TIER_CODES.length; index += 1) {
    const plan = normalized[index];
    if (plan.code !== REQUIRED_TIER_CODES[index]
      || !Number.isSafeInteger(plan.price)
      || plan.price <= 0
      || String(plan.currency).toUpperCase() !== 'RWF'
      || plan.billing_period !== 'monthly'
      || Number(plan.duration_days) !== 30
      || String(plan.duration_unit || 'day') !== 'day'
      || (typeof plan.is_active === 'boolean' ? !plan.is_active : Number(plan.is_active) !== 1)) {
      throw new Error('Active subscription plans do not match the approved five-plan monthly contract.');
    }
  }
  const ranges = [[0, 5000], [5001, 10000], [10001, 20000], [20001, 35000], [35001, null]];
  for (let index = 0; index < ranges.length; index += 1) {
    const [min, max] = ranges[index];
    if (Number(normalized[index].min_volume_liters ?? 0) !== min
      || (max === null ? normalized[index].max_volume_liters !== null : Number(normalized[index].max_volume_liters) !== max)) {
      throw new Error(`Pricing tier ${normalized[index].code} has an invalid volume range.`);
    }
  }
  return normalized;
};

const calculatePrice = (subscription, planInput, billingPeriod = planInput.billing_period || 'monthly') => {
  const plan = normalizePlan(planInput);
  const introEligible = plan.billing_period === 'monthly'
    && plan.intro_price !== null
    && Number(subscription.intro_periods_used || 0) < plan.intro_periods;
  const basePrice = introEligible ? plan.intro_price : plan.price;
  const multiplier = { monthly: 1, '6_months': 6 * 0.9, yearly: 12 * 0.88 }[billingPeriod] || 1;
  return {
    amount: billingPeriod === 'monthly' ? basePrice : Number(basePrice) * multiplier,
    priceType: introEligible ? `intro_${Number(subscription.intro_periods_used || 0) + 1}` : 'standard',
    introEligible,
  };
};

const getUsageWindow = (subscription, now = new Date()) => {
  const status = subscription?.status === 'trial' ? 'trial' : subscription?.effective_status || subscription?.status;
  const trial = status === 'trial';
  const startDate = toDateOnly(trial ? subscription.trial_started_at : subscription.current_period_started_at)
    || toDateOnly(now);
  const exclusiveEnd = toDateOnly(trial ? subscription.trial_ends_at : subscription.current_period_ends_at)
    || toDateOnly(addDays(startDate, trial ? TRIAL_DAYS : 30));
  return { startDate, endDate: toDateOnly(addDays(exclusiveEnd, -1)), exclusiveEnd, status };
};

const validatePricing = async (repository) => validatePricingTiers(await repository.getActivePlans());
const getTierForVolume = async (liters, repository = defaultRepository) => {
  if (repository.getTierForVolume) return repository.getTierForVolume(liters);
  const volume = Math.max(0, Number(liters) || 0);
  const tiers = await validatePricing(repository);
  return tiers.find((tier) => tier.max_volume_liters === null || volume <= tier.max_volume_liters) || tiers[tiers.length - 1];
};
const getTierByCode = async (code, repository = defaultRepository) => {
  if (repository.getTierByCode) return repository.getTierByCode(code);
  const tiers = await validatePricing(repository);
  return tiers.find((tier) => tier.code === canonicalPlanCode(code)) || null;
};
const getNextTier = async (tier, repository = defaultRepository) => {
  if (repository.getNextTier) return repository.getNextTier(tier);
  const tiers = await validatePricing(repository);
  const index = tiers.findIndex((candidate) => candidate.code === tier?.code);
  return index < 0 ? tiers[0] : tiers[index + 1] || null;
};

const getUsage = async ({ userId, subscription, now = new Date(), repository = defaultRepository }) => {
  const window = getUsageWindow(subscription, now);
  const isTrial = window.status === 'trial';
  const today = toDateOnly(now);
  const observedEnd = isTrial && today < window.endDate ? today : window.endDate;
  const usageEnd = observedEnd < window.startDate ? window.startDate : observedEnd;
  const entries = await repository.getCollectorMilk({ userId, startDate: window.startDate, endDate: usageEnd });
  const farmerUsage = await repository.getFarmerMilkUsage({ userId, startDate: window.startDate, endDate: usageEnd });
  const hasFarmerMilk = Number(farmerUsage.recordCount || 0) > 0;
  const actualLiters = hasFarmerMilk
    ? Number(farmerUsage.validLiters || 0)
    : Number(entries.reduce((sum, entry) => sum + Number(entry.volumeLiters || 0), 0).toFixed(2));
  const elapsedTrialDays = isTrial
    ? Math.max(1, Math.min(TRIAL_DAYS, Math.floor((Date.parse(`${usageEnd}T00:00:00.000Z`) - Date.parse(`${window.startDate}T00:00:00.000Z`)) / 86400000) + 1))
    : TRIAL_DAYS;
  const projectedMonthlyLiters = Number((isTrial ? actualLiters * (TRIAL_DAYS * TRIAL_PROJECTION_FACTOR / elapsedTrialDays) : actualLiters).toFixed(2));
  const recommendedTier = await getTierForVolume(projectedMonthlyLiters, repository);
  const purchasedLimit = subscription?.volume_limit_liters === null || subscription?.volume_limit_liters === undefined
    ? (isTrial ? recommendedTier.max_volume_liters : null)
    : Number(subscription.volume_limit_liters);
  const currentTier = isTrial
    ? recommendedTier
    : (await getTierByCode(subscription?.tier_code, repository) || await getTierForVolume(actualLiters, repository));
  const nextTier = await getNextTier(currentTier, repository);
  const usagePercentage = purchasedLimit ? Number(((actualLiters / purchasedLimit) * 100).toFixed(2)) : 0;
  const exceeded = !isTrial && purchasedLimit !== null && actualLiters > purchasedLimit;
  return {
    source: 'collector_milk_records',
    window,
    actualLiters,
    projectedMonthlyLiters,
    currentTier,
    recommendedTier,
    nextTier,
    applicableVolumeLimit: purchasedLimit,
    usagePercentage,
    limitExceeded: exceeded,
    upgradeRequired: exceeded,
    estimate: isTrial,
    trialDays: isTrial ? TRIAL_DAYS : null,
    entries,
    history: entries,
  };
};

const cleanPhone = DefaultProvider.cleanPhone;
const canonicalPhone = DefaultProvider.canonicalPhone;
const normalizeBillingPeriod = (value = 'monthly') => {
  const normalized = String(value).trim().toLowerCase();
  if (!Object.hasOwn(BILLING_MONTHS, normalized)) {
    throw Object.assign(new Error('Choose monthly, 6-month, or yearly billing.'), { code: 'BILLING_PERIOD_NOT_SUPPORTED', statusCode: 400 });
  }
  return normalized;
};
const hasUncertainOutcome = (payment) => payment.status === 'PENDING'
  && (!payment.provider_reference || /outcome uncertain/i.test(payment.failure_reason || ''));

const getPlanForRequest = async (planIdOrCode, repository, billingPeriod = 'monthly') => {
  const key = String(planIdOrCode);
  const plan = /^\d+$/.test(key)
    ? await repository.getPlanById(Number(key))
    : await repository.getPlanByCode(canonicalPlanCode(key, billingPeriod));
  if (!plan || !(plan.is_active === true || Number(plan.is_active) === 1)) {
    throw Object.assign(new Error('Subscription plan is not available.'), { code: 'PLAN_NOT_AVAILABLE' });
  }
  return normalizePlan(plan);
};

const notifyPayment = async (payment, type) => {
  try {
    const Notifications = require('./notification-service.js');
    await Notifications.createPaymentNotification({ payment, type });
  } catch {
    // Payment settlement must not depend on the notification sink.
  }
};

const deliverSubscriptionEmails = async ({ paymentId = null, limit = 20, repository = defaultRepository, mailer = require('./email-service.js') } = {}) => {
  if (!repository.claimSubscriptionEmailEvents) return { sent: 0, failed: 0, attempted: 0 };
  const events = await repository.claimSubscriptionEmailEvents({ paymentId, limit });
  let sent = 0;
  let failed = 0;
  for (const event of events) {
    try {
      if (event.event_type === 'payment_confirmation') await mailer.sendPaymentConfirmation({ to: event.recipient, payload: event.payload });
      else if (event.event_type === 'subscription_reminder') await mailer.sendSubscriptionReminder({ to: event.recipient, payload: event.payload });
      else if (event.event_type === 'subscription_expired') await mailer.sendSubscriptionExpired({ to: event.recipient, payload: event.payload });
      else throw Object.assign(new Error('Unsupported subscription email event.'), { code: 'EMAIL_EVENT_UNSUPPORTED' });
      await repository.markSubscriptionEmailSent(event.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await repository.markSubscriptionEmailFailed({ eventId: event.id, errorCode: error.code || 'EMAIL_DELIVERY_FAILED' }).catch(() => undefined);
    }
  }
  return { sent, failed, attempted: events.length };
};

const runSubscriptionEmailJob = async ({ reminderDays = [], repository = defaultRepository, mailer } = {}) => {
  const schedule = await repository.scheduleSubscriptionEmailEvents({ reminderDays });
  const delivery = await deliverSubscriptionEmails({ limit: 100, repository, mailer });
  return { schedule, delivery };
};

const reconcilePayment = async ({ paymentId, userId = null, repository = defaultRepository, provider = DefaultLmbtechProvider, mailer }) => {
  const payment = userId === null
    ? await repository.getPaymentById(paymentId)
    : await repository.getPaymentByIdForUser(paymentId, userId);
  if (!payment || payment.status !== 'PENDING' || payment.provider !== 'mtn_momo' || !payment.provider_reference) return payment;
  try {
    const result = await provider.getPaymentStatus({ providerReference: payment.provider_reference });
    if (result.providerReference !== payment.provider_reference) {
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_reference_mismatch', details: { referenceId: payment.provider_reference } });
      return payment;
    }
    if (result.amount === null || result.amount === undefined || !Number.isFinite(Number(result.amount))) {
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_missing_amount', details: { referenceId: payment.provider_reference } });
      return payment;
    }
    if (Math.round(Number(result.amount) * 100) !== Math.round(Number(payment.amount) * 100)) {
      const failed = await repository.settlePayment({ paymentId: payment.id, status: 'FAILED', failureReason: 'Provider status amount did not match the payment record.', transactionId: result.transactionId || null });
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_amount_mismatch', details: { referenceId: payment.provider_reference } });
      await notifyPayment(failed, 'payment_failed');
      return failed;
    }
    if (result.paymentMethod !== 'MTN_MOMO_RWA') {
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_method_mismatch', details: { referenceId: payment.provider_reference } });
      return payment;
    }
    if (['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(result.status)) {
      if (result.status === 'SUCCESS' && (!result.transactionId || result.amount === null || result.paymentMethod !== 'MTN_MOMO_RWA')) return payment;
      const settlement = await repository.settlePayment({
        paymentId: payment.id,
        status: result.status,
        failureReason: result.status === 'FAILED' ? 'Payment provider reported a failure.'
          : result.status === 'CANCELLED' ? 'Payment was cancelled.'
            : result.status === 'EXPIRED' ? 'Payment expired before completion.' : null,
        transactionId: result.transactionId || null,
      });
      const settlementApplied = settlement.settlementApplied ?? settlement.status !== payment.status;
      const settled = { ...settlement };
      delete settled.settlementApplied;
      if (settlementApplied) {
        await notifyPayment(settled, `payment_${String(settled.status).toLowerCase()}`);
        if (settled.status === 'SUCCESS') await deliverSubscriptionEmails({ paymentId: settled.id, repository, mailer }).catch(() => undefined);
      }
      return settled;
    }
  } catch {
    return payment;
  }
  return repository.getPaymentById(payment.id);
};

const createPendingPayment = async ({
  userId,
  providerName = 'mtn_momo',
  paymentMethod = 'MTN_MOMO_RWA',
  billingPeriod = 'monthly',
  repository = defaultRepository,
  provider = DefaultLmbtechProvider,
  now = new Date(),
}) => {
  if (!SUPPORTED_PROVIDERS.includes(providerName)) throw Object.assign(new Error('Unsupported Mobile Money provider.'), { code: 'UNSUPPORTED_PROVIDER' });
  billingPeriod = normalizeBillingPeriod(billingPeriod);
  const user = await repository.getUser(userId);
  if (!user) throw Object.assign(new Error('Account not found.'), { code: 'USER_NOT_FOUND' });
  const savedPhone = cleanPhone(user.phone);
  const savedCanonical = canonicalPhone(savedPhone);
  if (!savedCanonical) throw Object.assign(new Error('A valid Rwanda MTN mobile phone must be saved in account settings.'), { code: 'PHONE_NUMBER_MISSING' });

  const existingPayments = await repository.findActivePayments(userId);
  if (existingPayments.length) {
    const reconciled = [];
    for (const payment of existingPayments) reconciled.push(await reconcilePayment({ paymentId: payment.id, userId, repository, provider }));
    const pending = reconciled.find((payment) => payment?.status === 'PENDING');
    if (pending) return { payment: pending, plan: null, pricing: null, reused: true, outcomeUncertain: hasUncertainOutcome(pending) };
    if (reconciled[0]) return { payment: reconciled[0], plan: null, pricing: null, reused: true, outcomeUncertain: false };
  }

  provider.assertReady();
  const subscription = await repository.getSubscription(userId);
  if (!subscription) throw Object.assign(new Error('Subscription not found.'), { code: 'SUBSCRIPTION_NOT_FOUND' });
  const collectionCenterAccount = user.accountType === 'COLLECTION_CENTER';
  const centerPlan = collectionCenterAccount
    ? await getPlanForRequest('COLLECTION_CENTER_MONTHLY', repository, 'monthly')
    : null;
  let usage = null;
  let selectedPlan = centerPlan;
  if (!collectionCenterAccount) {
    const tiers = await validatePricing(repository);
    usage = await getUsage({ userId, subscription, now, repository });
    selectedPlan = tiers.find((tier) => tier.id === usage.recommendedTier?.id && tier.code === usage.recommendedTier?.code);
    if (!selectedPlan) throw Object.assign(new Error('The system could not resolve the calculated subscription tier.'), { code: 'PLAN_NOT_AVAILABLE' });
  }
  const pricing = calculatePrice(subscription, selectedPlan, billingPeriod);
  const activeExpiry = subscription.effective_status === 'active' && subscription.subscription_ends_at
    && new Date(subscription.subscription_ends_at) > now;
  const periodStart = activeExpiry ? new Date(subscription.subscription_ends_at) : now;
  const periodEnd = addBillingPeriod(periodStart, billingPeriod);
  const providerReference = `milk-subscription-${crypto.randomUUID()}`;
  const reservation = await repository.reservePayment({
    userId,
    subscriptionId: subscription.id,
    planId: selectedPlan.id,
    amount: pricing.amount,
    currency: selectedPlan.currency,
    paymentMethod,
    phoneNumber: savedPhone,
    periodStart,
    periodEnd,
    priceType: pricing.priceType,
    billingPeriod,
    providerReference,
  });
  if (reservation.reused) {
    const payment = await reconcilePayment({ paymentId: reservation.payment.id, userId, repository, provider });
    return { payment, plan: selectedPlan, pricing, reused: true, outcomeUncertain: hasUncertainOutcome(payment) };
  }

  let request;
  try {
    request = await provider.createPaymentRequest({
      paymentId: reservation.payment.id,
      userId,
      referenceId: providerReference,
      phoneNumber: savedPhone,
      amount: pricing.amount,
      currency: selectedPlan.currency,
      userEmail: user.email,
      userName: user.name,
    });
  } catch (error) {
    if (error.uncertain) {
      await repository.updateUncertainReason({ paymentId: reservation.payment.id, reason: 'Provider outcome uncertain; reconcile the stored reference before retrying.' });
      return { payment: await repository.getPaymentById(reservation.payment.id), plan: selectedPlan, pricing, outcomeUncertain: true };
    }
    const failed = await repository.settlePayment({
      paymentId: reservation.payment.id,
      status: 'FAILED',
      failureReason: error.code === 'LMBTECH_INITIATION_REJECTED' ? `Provider rejected payment initiation (${error.message}).` : error.message,
    });
    await notifyPayment(failed, 'payment_failed');
    return { payment: failed, plan: selectedPlan, pricing, initiationError: error };
  }
  if (request.providerReference && request.providerReference !== providerReference) {
    await repository.updateUncertainReason({ paymentId: reservation.payment.id, reason: 'Provider returned a different payment reference; verify the stored reference before retrying.' });
    return { payment: await repository.getPaymentById(reservation.payment.id), plan: selectedPlan, pricing, outcomeUncertain: true };
  }
  let payment = await repository.getPaymentById(reservation.payment.id);
  if (['FAILED', 'CANCELLED'].includes(request.status)) {
    payment = await repository.settlePayment({ paymentId: payment.id, status: request.status, failureReason: request.status === 'FAILED' ? 'Provider reported that payment initiation failed.' : null });
  } else {
    payment = await reconcilePayment({ paymentId: payment.id, userId, repository, provider });
  }
  if (payment.status === 'PENDING') await notifyPayment(payment, 'payment_initiated');
  return { payment, plan: selectedPlan, pricing };
};

const getCustomerSubscription = async ({ userId, billingPeriod = 'monthly', repository = defaultRepository, now = new Date() }) => {
  billingPeriod = normalizeBillingPeriod(billingPeriod);
  const [subscription, user] = await Promise.all([repository.getSubscription(userId), repository.getUser(userId)]);
  if (!user) return null;
  const plans = user.accountType === 'COLLECTION_CENTER'
    ? [await repository.getPlanByCode('COLLECTION_CENTER_MONTHLY')].filter(Boolean).map(normalizePlan)
    : await validatePricing(repository);
  const payments = await repository.getPaymentsByUser(userId);
  const usage = subscription && user.accountType !== 'COLLECTION_CENTER'
    ? await getUsage({ userId, subscription, now, repository })
    : null;
  const calculatedPlan = user.accountType === 'COLLECTION_CENTER' ? plans[0] : usage?.recommendedTier;
  const calculatedPrice = calculatedPlan
    ? calculatePrice(subscription || {}, calculatedPlan, billingPeriod)
    : null;
  const pricing = calculatedPlan && calculatedPrice ? {
    planId: calculatedPlan.id,
    planCode: calculatedPlan.code,
    planName: calculatedPlan.name,
    amount: Number(calculatedPrice.amount),
    currency: calculatedPlan.currency,
    priceType: calculatedPrice.priceType,
    billingPeriod,
    estimatedMonthlyLiters: usage?.projectedMonthlyLiters ?? null,
    isEstimate: usage?.estimate ?? false,
  } : null;
  return {
    account: { id: user.id, phone: user.phone, accountType: user.accountType },
    subscription,
    plans,
    payments,
    usage,
    pricing,
    paymentConfiguration: DefaultProvider.getLmbtechPublicStatus(),
  };
};

const getCustomerUsage = async ({ userId, repository = defaultRepository, now = new Date() }) => {
  const subscription = await repository.getSubscription(userId);
  if (!subscription) return null;
  return getUsage({ userId, subscription, now, repository });
};

const handleProviderCallback = async ({ body, repository = defaultRepository, provider = DefaultLmbtechProvider, mailer }) => {
  const payloadCheck = DefaultProvider.verifyCallbackPayload(body);
  if (!payloadCheck.valid) {
    await repository.recordPaymentEvent?.({ action: 'payment_callback_invalid', details: { reason: payloadCheck.reason } });
    throw Object.assign(new Error(payloadCheck.reason), { statusCode: 400 });
  }
  const reference = DefaultProvider.findCallbackReference(body);
  if (!reference) throw Object.assign(new Error('Payment callback is missing a reference.'), { statusCode: 400 });
  const payment = await repository.findPaymentByReference(reference);
  if (!payment) {
    await repository.recordPaymentEvent?.({ action: 'payment_callback_unknown_reference', details: { referenceId: String(reference).slice(0, 255) } });
    throw Object.assign(new Error('Unknown payment reference.'), { statusCode: 404 });
  }
  await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_received', details: { referenceId: payment.provider_reference, status: DefaultProvider.resolveCallbackStatus(body), transactionId: String(body.transaction_id).trim() } });
  const reject = async (action, message) => {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action, details: { referenceId: payment.provider_reference } });
    throw Object.assign(new Error(message), { statusCode: 400 });
  };
  if (payment.provider !== 'mtn_momo' || payment.provider_reference !== reference) {
    await reject('payment_callback_reference_mismatch', 'Payment callback reference does not match the stored payment.');
  }
  if (Math.round(Number(body.amount) * 100) !== Math.round(Number(payment.amount) * 100)) {
    await repository.settlePayment({ paymentId: payment.id, status: 'FAILED', failureReason: 'Provider callback amount did not match the payment record.', transactionId: body.transaction_id });
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_amount_mismatch', details: { referenceId: payment.provider_reference } });
    throw Object.assign(new Error('Payment callback amount does not match the payment record.'), { statusCode: 400 });
  }
  if (String(payment.payment_method).toUpperCase() !== String(body.payment_method).trim().toUpperCase()) {
    await reject('payment_callback_method_mismatch', 'Payment callback method does not match the stored payment.');
  }
  const savedPhone = DefaultProvider.canonicalPhone(payment.mobile_money_phone);
  const callbackPhone = DefaultProvider.canonicalPhone(body.payer_phone);
  if (!savedPhone || savedPhone !== callbackPhone) {
    await reject('payment_callback_phone_mismatch', 'Payment callback phone does not match the saved account phone.');
  }
  const transactionId = String(body.transaction_id).trim();
  const status = DefaultProvider.resolveCallbackStatus(body);
  if (status === 'UNKNOWN') throw Object.assign(new Error('Payment callback status is unsupported.'), { statusCode: 400 });
  if (payment.status !== 'PENDING') {
    if (payment.status === status && (!payment.provider_transaction_id || payment.provider_transaction_id === transactionId)) {
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_duplicate', details: { referenceId: payment.provider_reference, status } });
      return { ok: true, paymentId: payment.id, status: payment.status, idempotent: true };
    }
    throw Object.assign(new Error('Payment already has a different final status.'), { statusCode: 409, currentStatus: payment.status });
  }
  if (status === 'PENDING') {
    await repository.recordProviderTransaction?.({ paymentId: payment.id, transactionId });
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_provider_pending', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING' };
  }
  let confirmation;
  try {
    confirmation = await provider.getPaymentStatus({ providerReference: payment.provider_reference });
  } catch {
    await repository.recordProviderTransaction?.({ paymentId: payment.id, transactionId });
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_status_check_pending', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (confirmation.providerReference !== payment.provider_reference) {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_reference_mismatch', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (confirmation.amount === null || confirmation.amount === undefined || !Number.isFinite(Number(confirmation.amount))) {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_missing_amount', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (Math.round(Number(confirmation.amount) * 100) !== Math.round(Number(payment.amount) * 100)) {
    await repository.settlePayment({ paymentId: payment.id, status: 'FAILED', failureReason: 'Provider status amount did not match the payment record.', transactionId: confirmation.transactionId || transactionId });
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_amount_mismatch', details: { referenceId: payment.provider_reference } });
    throw Object.assign(new Error('Provider status amount does not match the payment record.'), { statusCode: 400 });
  }
  if (confirmation.paymentMethod !== 'MTN_MOMO_RWA') {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_method_mismatch', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (confirmation.status === 'PENDING' || confirmation.status === 'UNKNOWN') {
    await repository.recordProviderTransaction?.({ paymentId: payment.id, transactionId });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (confirmation.status !== status || (confirmation.transactionId && confirmation.transactionId !== transactionId)) {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_status_mismatch', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (status === 'SUCCESS' && !confirmation.transactionId) {
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  const settlement = await repository.settlePayment({
    paymentId: payment.id,
    status: confirmation.status,
    failureReason: status === 'FAILED' ? 'Provider callback reported a failed transaction.'
      : status === 'CANCELLED' ? 'Provider callback reported a cancelled transaction.'
        : status === 'EXPIRED' ? 'Provider callback reported an expired transaction.' : null,
    transactionId: confirmation.transactionId || transactionId,
  });
  const settlementApplied = settlement.settlementApplied ?? payment.status === 'PENDING';
  const settled = { ...settlement };
  delete settled.settlementApplied;
  if (settlementApplied) {
    await notifyPayment(settled, status === 'SUCCESS' ? 'payment_success' : `payment_${status.toLowerCase()}`);
    if (settled.status === 'SUCCESS') await deliverSubscriptionEmails({ paymentId: settled.id, repository, mailer }).catch(() => undefined);
  }
  return { ok: true, paymentId: payment.id, status: settled.status, idempotent: !settlementApplied };
};

module.exports = {
  TRIAL_DAYS,
  TRIAL_PROJECTION_FACTOR,
  SUPPORTED_PROVIDERS,
  REQUIRED_TIER_CODES,
  normalizePlan,
  canonicalPlanCode,
  validatePricingTiers,
  calculatePrice,
  getUsageWindow,
  getTierForVolume,
  getTierByCode,
  getNextTier,
  getUsage,
  cleanPhone,
  canonicalPhone,
  getPlanForRequest,
  reconcilePayment,
  createPendingPayment,
  getCustomerSubscription,
  getCustomerUsage,
  handleProviderCallback,
  deliverSubscriptionEmails,
  runSubscriptionEmailJob,
};
