const crypto = require('node:crypto');
const defaultRepository = require('../repositories/subscriptionRepository.js');
const DefaultProvider = require('./payment-provider.js');
const DefaultLmbtechProvider = new DefaultProvider.LmbtechProvider();

const SUPPORTED_PROVIDERS = ['mtn_momo'];
const { addMonthlyPeriod, isBeforeDeadline, localDateAt } = require('../utils/subscription-time.js');
const SUBSCRIPTION_TIME_ZONE = 'Africa/Kigali';

const addBillingPeriod = (value, billingPeriod) => {
  if (billingPeriod !== 'monthly') throw Object.assign(new Error('Only monthly billing is available.'), { code: 'BILLING_PERIOD_NOT_SUPPORTED', statusCode: 400 });
  return addMonthlyPeriod(value);
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
  const suffixed = clean.match(/^(.*)_(MONTHLY|6_MONTHS|YEARLY)$/);
  const baseCode = suffixed ? suffixed[1] : clean;
  const aliases = {
    USAGE_0_5000: 'USAGE_0_5000',
    USAGE_5001_10000: 'USAGE_5001_10000',
    USAGE_10001_20000: 'USAGE_10001_20000',
    USAGE_20001_35000: 'USAGE_20001_40000',
    USAGE_20001_PLUS: 'USAGE_20001_40000',
    USAGE_20001_40000: 'USAGE_20001_40000',
    USAGE_35001_PLUS: 'USAGE_40001_PLUS',
    USAGE_40001_PLUS: 'USAGE_40001_PLUS',
  };
  if (aliases[baseCode]) return `${aliases[baseCode]}_${suffixed?.[2] || billingPeriodSuffix(billingPeriod)}`;
  if (suffixed) return clean;
  return clean;
};

const validatePricingTiers = (plans) => {
  if (!Array.isArray(plans) || plans.length === 0) throw new Error('No active monthly subscription tiers are configured.');
  const normalized = plans.map(normalizePlan).sort((left, right) => left.min_volume_liters - right.min_volume_liters);
  for (const plan of normalized) {
    if (!String(plan.code || '').startsWith('USAGE_')
      || !String(plan.name || '').trim()
      || !Number.isSafeInteger(plan.price)
      || plan.price <= 0
      || String(plan.currency).toUpperCase() !== 'RWF'
      || plan.billing_period !== 'monthly'
      || String(plan.duration_unit || 'day') !== 'day'
      || !(plan.is_active === true || Number(plan.is_active) === 1)) {
      throw new Error('Active subscription tiers must have a label, positive RWF price, and monthly billing.');
    }
  }
  let expectedMin = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const tier = normalized[index];
    const min = tier.min_volume_liters;
    const max = tier.max_volume_liters;
    const isLastTier = index === normalized.length - 1;
    if (!Number.isSafeInteger(min) || min !== expectedMin
      || (isLastTier ? max !== null : !Number.isSafeInteger(max) || max < min)) {
      throw new Error(`Pricing tier ${tier.code} has a gap, overlap, or invalid volume range.`);
    }
    if (!isLastTier) expectedMin = max + 1;
  }
  return normalized;
};

const calculatePrice = (subscription, planInput, billingPeriod = planInput.billing_period || 'monthly') => {
  const plan = normalizePlan(planInput);
  if (billingPeriod !== 'monthly') throw Object.assign(new Error('Only monthly billing is available.'), { code: 'BILLING_PERIOD_NOT_SUPPORTED', statusCode: 400 });
  if (String(plan.currency).toUpperCase() !== 'RWF') {
    throw Object.assign(new Error('Subscription payments must be configured in RWF.'), { code: 'PAYMENT_CURRENCY_UNSUPPORTED', statusCode: 400 });
  }
  return {
    amount: plan.price,
    priceType: 'standard',
    introEligible: false,
  };
};

const getUsageWindow = (subscription, now = new Date()) => {
  const status = subscription?.effective_status || (subscription?.status === 'trial' ? 'pending' : subscription?.status);
  const start = subscription?.current_period_started_at || subscription?.access_started_at
    || subscription?.trial_started_at || subscription?.subscription_started_at || now;
  const end = subscription?.current_period_ends_at || subscription?.payment_due_at
    || subscription?.trial_ends_at || addBillingPeriod(start, 'monthly');
  const startDate = localDateAt(start, SUBSCRIPTION_TIME_ZONE);
  const endDate = localDateAt(new Date(new Date(end).getTime() - 1), SUBSCRIPTION_TIME_ZONE);
  return { startDate, endDate, exclusiveEnd: localDateAt(end, SUBSCRIPTION_TIME_ZONE), status };
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
  const today = localDateAt(now, SUBSCRIPTION_TIME_ZONE);
  const observedEnd = today < window.endDate ? today : window.endDate;
  const usageEnd = observedEnd < window.startDate ? window.startDate : observedEnd;
  const entries = await repository.getCollectorMilk({ userId, startDate: window.startDate, endDate: usageEnd });
  const farmerUsage = await repository.getFarmerMilkUsage({ userId, startDate: window.startDate, endDate: usageEnd });
  const hasFarmerMilk = Number(farmerUsage.recordCount || 0) > 0;
  const actualLiters = hasFarmerMilk
    ? Number(farmerUsage.validLiters || 0)
    : Number(entries.reduce((sum, entry) => sum + Number(entry.effectiveVolumeLiters ?? entry.validVolumeLiters ?? entry.volumeLiters ?? 0), 0).toFixed(2));
  const projectedMonthlyLiters = Number(actualLiters.toFixed(2));
  const recommendedTier = await getTierForVolume(projectedMonthlyLiters, repository);
  const snapshot = subscription?.current_plan_snapshot
    || (['pending', 'suspended', 'expired', 'trial'].includes(subscription?.effective_status || subscription?.status)
      ? subscription?.selected_plan_snapshot : null);
  const currentTier = snapshot
    ? normalizePlan({
      ...snapshot,
      min_volume_liters: snapshot.minVolumeLiters ?? snapshot.min_volume_liters,
      max_volume_liters: snapshot.maxVolumeLiters ?? snapshot.max_volume_liters,
    })
    : await getTierByCode(subscription?.tier_code, repository) || recommendedTier;
  const purchasedLimit = subscription?.volume_limit_liters !== null && subscription?.volume_limit_liters !== undefined
    ? Number(subscription.volume_limit_liters)
    : currentTier?.max_volume_liters ?? null;
  const nextTier = await getNextTier(currentTier, repository);
  const usagePercentage = purchasedLimit ? Number(((actualLiters / purchasedLimit) * 100).toFixed(2)) : 0;
  const exceeded = purchasedLimit !== null && actualLiters > purchasedLimit;
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
    estimate: false,
    entries,
    history: entries,
  };
};

const cleanPhone = DefaultProvider.cleanPhone;
const canonicalPhone = DefaultProvider.canonicalPhone;
const normalizeBillingPeriod = (value = 'monthly') => {
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'monthly') {
    throw Object.assign(new Error('Only monthly billing is available.'), { code: 'BILLING_PERIOD_NOT_SUPPORTED', statusCode: 400 });
  }
  return normalized;
};
const hasUncertainOutcome = (payment) => payment.status === 'PENDING'
  && (!payment.provider_reference || /outcome uncertain/i.test(payment.failure_reason || ''));

const isInitialPaymentQualifying = ({ payment, paymentDueAt }) => payment?.status === 'SUCCESS'
  && isBeforeDeadline(payment.completed_at, paymentDueAt);

const getPlanForRequest = async (planIdOrCode, repository = defaultRepository, billingPeriod = 'monthly') => {
  const key = String(planIdOrCode);
  const plan = /^\d+$/.test(key)
    ? await repository.getPlanById(Number(key))
    : await repository.getPlanByCode(canonicalPlanCode(key, billingPeriod));
  if (!plan || !(plan.is_active === true || Number(plan.is_active) === 1)) {
    throw Object.assign(new Error('Subscription plan is not available.'), { code: 'PLAN_NOT_AVAILABLE' });
  }
  return normalizePlan(plan);
};

const getAvailablePlans = async (repository = defaultRepository) => (await validatePricing(repository)).map((plan) => ({
  id: plan.id,
  code: plan.code,
  name: plan.name,
  price: plan.price,
  currency: plan.currency,
  billing_period: plan.billing_period,
  min_volume_liters: plan.min_volume_liters,
  max_volume_liters: plan.max_volume_liters,
  is_active: true,
}));

const getPublicSubscriptionConfiguration = async (repository = defaultRepository) => {
  const [plans, savedPolicy] = await Promise.all([
    getAvailablePlans(repository),
    repository.getSubscriptionPolicy ? repository.getSubscriptionPolicy() : null,
  ]);
  return {
    plans,
    policy: {
      initial_access_days: Number(savedPolicy?.initial_access_days || 15),
      grace_period_days: Number(savedPolicy?.grace_period_days || 0),
      enforcement_time: savedPolicy?.enforcement_time || '00:00:00',
      time_zone: SUBSCRIPTION_TIME_ZONE,
    },
  };
};

const queueTierExceededNotice = async ({ user, subscription, usage, repository, mailer }) => {
  if (!usage?.limitExceeded || !usage.currentTier || !usage.recommendedTier || !repository.queueUsageExceededNotice) return;
  const periodStart = subscription.current_period_started_at || subscription.access_started_at || subscription.trial_started_at;
  if (!periodStart) return;
  try {
    const queued = await repository.queueUsageExceededNotice({
      ownerUserId: Number(user.id),
      subscriptionId: Number(subscription.id),
      recipient: user.email,
      language: user.language || 'rw',
      periodStart,
      tierCode: usage.currentTier.code,
      actualLiters: usage.actualLiters,
      currentTier: usage.currentTier,
      recommendedTier: usage.recommendedTier,
      effectiveDate: subscription.current_period_ends_at || subscription.subscription_ends_at || null,
    });
    await deliverSubscriptionEmails({ limit: 20, repository, mailer }).catch(() => undefined);
    return queued;
  } catch {
    return null;
  }
};

const notifyPayment = async (payment, type) => {
  try {
    const Notifications = require('./notification-service.js');
    await Notifications.createPaymentNotification({ payment, type });
  } catch (error) {
    // Payment settlement must not depend on the notification sink, but a failure
    // must be observable. Log only a safe code and identifiers, never payer data.
    const code = error?.code ? String(error.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) : null;
    console.error('[payments] Payment notification failed.', {
      code,
      paymentId: Number(payment?.id) || null,
      type: String(type || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
    });
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
      else if (event.event_type === 'subscription_usage_exceeded') await mailer.sendSubscriptionUsageExceeded({ to: event.recipient, payload: event.payload });
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
  let usageAlertsQueued = 0;
  if (repository.getUsageAlertCandidates) {
    const candidates = await repository.getUsageAlertCandidates({ limit: 500 });
    for (const subscription of candidates) {
      const user = {
        id: Number(subscription.candidate_user_id),
        email: subscription.candidate_email,
        language: subscription.candidate_language || 'rw',
      };
      const usage = await getUsage({ userId: user.id, subscription, repository });
      if (usage.limitExceeded && usage.recommendedTier) {
        const queued = await queueTierExceededNotice({ user, subscription, usage, repository, mailer });
        if (queued?.notificationCreated || queued?.emailQueued) usageAlertsQueued += 1;
      }
    }
  }
  const delivery = await deliverSubscriptionEmails({ limit: 100, repository, mailer });
  return { schedule, usageAlertsQueued, delivery };
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
    if (String(payment.currency || '').toUpperCase() !== 'RWF'
      || (result.currency && String(result.currency).trim().toUpperCase() !== String(payment.currency).trim().toUpperCase())) {
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_status_currency_mismatch', details: { referenceId: payment.provider_reference } });
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
  planCode = null,
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
    const requestedCode = planCode || subscription.next_plan_snapshot?.code
      || subscription.selected_plan_snapshot?.code || subscription.current_plan_snapshot?.code
      || usage.recommendedTier?.code;
    selectedPlan = tiers.find((tier) => tier.code === canonicalPlanCode(requestedCode));
    if (!selectedPlan) throw Object.assign(new Error('Select an available monthly tier before payment.'), { code: 'PLAN_NOT_AVAILABLE' });
  }
  const pricing = calculatePrice(subscription, selectedPlan, billingPeriod);
  if (subscription.next_period_started_at && new Date(subscription.next_period_started_at) > now) {
    throw Object.assign(new Error('A future monthly period is already paid.'), { code: 'NEXT_PERIOD_ALREADY_PAID', statusCode: 409 });
  }
  const activeExpiry = subscription.effective_status === 'active' && subscription.subscription_ends_at
    && new Date(subscription.subscription_ends_at) > now;
  const periodStart = activeExpiry ? new Date(subscription.subscription_ends_at) : now;
  const periodEnd = addBillingPeriod(periodStart, billingPeriod);
  const planSnapshot = {
    id: selectedPlan.id,
    code: selectedPlan.code,
    name: selectedPlan.name,
    price: pricing.amount,
    currency: selectedPlan.currency,
    minVolumeLiters: selectedPlan.min_volume_liters,
    maxVolumeLiters: selectedPlan.max_volume_liters,
    billingPeriod,
  };
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
    planSnapshot,
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
    const settlement = await repository.settlePayment({ paymentId: payment.id, status: request.status, failureReason: request.status === 'FAILED' ? 'Provider reported that payment initiation failed.' : null });
    const settlementApplied = settlement.settlementApplied ?? true;
    payment = { ...settlement };
    delete payment.settlementApplied;
    if (settlementApplied) {
      await notifyPayment(payment, `payment_${request.status.toLowerCase()}`);
    }
  } else {
    payment = await reconcilePayment({ paymentId: payment.id, userId, repository, provider });
  }
  if (payment.status === 'PENDING') await notifyPayment(payment, 'payment_initiated');
  return { payment, plan: selectedPlan, pricing };
};

const getCustomerSubscription = async ({ userId, planCode = null, billingPeriod = 'monthly', paymentSortBy = 'date', paymentSortDirection = 'desc', paymentStatus = null, repository = defaultRepository, now = new Date() }) => {
  billingPeriod = normalizeBillingPeriod(billingPeriod);
  if (!['date', 'amount'].includes(paymentSortBy)) throw Object.assign(new Error('Unsupported payment sort field.'), { statusCode: 400 });
  if (!['asc', 'desc'].includes(paymentSortDirection)) throw Object.assign(new Error('paymentSortDirection must be asc or desc.'), { statusCode: 400 });
  if (paymentStatus && !['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(paymentStatus)) throw Object.assign(new Error('Unsupported payment status.'), { statusCode: 400 });
  const [subscription, user] = await Promise.all([repository.getSubscription(userId), repository.getUser(userId)]);
  if (!user) return null;
  const plans = user.accountType === 'COLLECTION_CENTER'
    ? [await repository.getPlanByCode('COLLECTION_CENTER_MONTHLY')].filter(Boolean).map(normalizePlan)
    : await validatePricing(repository);
  const allPayments = await repository.getPaymentsByUser(userId);
  const initialPaymentQualified = Boolean(subscription?.payment_due_at && allPayments.some((payment) => isInitialPaymentQualifying({ payment, paymentDueAt: subscription.payment_due_at })));
  const paymentDirection = paymentSortDirection === 'asc' ? 1 : -1;
  const payments = allPayments
    .filter((payment) => !paymentStatus || payment.status === paymentStatus)
    .sort((left, right) => {
      const primary = paymentSortBy === 'amount'
        ? (Number(left.amount || 0) - Number(right.amount || 0)) * paymentDirection
        : (new Date(left.created_at).getTime() - new Date(right.created_at).getTime()) * paymentDirection;
      return primary || (Number(left.id) - Number(right.id)) * paymentDirection;
    });
  const usage = subscription && user.accountType !== 'COLLECTION_CENTER'
    ? await getUsage({ userId, subscription, now, repository })
    : null;
  const storedCode = subscription?.next_plan_snapshot?.code || subscription?.selected_plan_snapshot?.code
    || subscription?.current_plan_snapshot?.code || subscription?.tier_code;
  const requestedCode = planCode || storedCode;
  const calculatedPlan = user.accountType === 'COLLECTION_CENTER'
    ? plans[0]
    : plans.find((plan) => plan.code === canonicalPlanCode(requestedCode)) || usage?.recommendedTier;
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
    minVolumeLiters: calculatedPlan.min_volume_liters,
    maxVolumeLiters: calculatedPlan.max_volume_liters,
  } : null;
  if (subscription && user.accountType !== 'COLLECTION_CENTER') {
    await queueTierExceededNotice({ user, subscription, usage, repository });
  }
  const policy = repository.getSubscriptionPolicy
    ? await repository.getSubscriptionPolicy()
    : { initial_access_days: 15, grace_period_days: 0, enforcement_time: '00:00:00', time_zone: SUBSCRIPTION_TIME_ZONE };
  return {
    account: { id: user.id, name: user.name, phone: user.phone, accountType: user.accountType },
    subscription,
    initialPaymentQualified,
    plans,
    policy,
    payments,
    usage,
    pricing,
    paymentConfiguration: DefaultProvider.getLmbtechPublicStatus(),
  };
};

const getAdminPaymentHistory = async ({ limit = 20, offset = 0, status = null, repository = defaultRepository }) => repository.getAdminPaymentHistory({ limit, offset, status });

const getCustomerUsage = async ({ userId, repository = defaultRepository, now = new Date() }) => {
  const subscription = await repository.getSubscription(userId);
  if (!subscription) return null;
  const [usage, user] = await Promise.all([getUsage({ userId, subscription, now, repository }), repository.getUser(userId)]);
  if (user) await queueTierExceededNotice({ user, subscription, usage, repository });
  return usage;
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
  const transactionId = body.transaction_id === undefined || body.transaction_id === null ? '' : String(body.transaction_id).trim();
  const callbackStatus = DefaultProvider.resolveCallbackStatus(body);
  await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_received', details: { referenceId: payment.provider_reference, status: callbackStatus, transactionId } });
  if (payment.provider !== 'mtn_momo' || payment.provider_reference !== reference) {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_reference_mismatch', details: { referenceId: payment.provider_reference } });
    throw Object.assign(new Error('Payment callback reference does not match the stored payment.'), { statusCode: 400 });
  }
  if (payment.status !== 'PENDING') {
    if (payment.status === callbackStatus && (!payment.provider_transaction_id || payment.provider_transaction_id === transactionId)) {
      await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_duplicate', details: { referenceId: payment.provider_reference, status: callbackStatus } });
      return { ok: true, paymentId: payment.id, status: payment.status, idempotent: true };
    }
    throw Object.assign(new Error('Payment already has a different final status.'), { statusCode: 409, currentStatus: payment.status });
  }
  let confirmation;
  try {
    confirmation = await provider.getPaymentStatus({ providerReference: payment.provider_reference });
  } catch {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_status_check_pending', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  const callbackPhone = DefaultProvider.canonicalPhone(body.payer_phone);
  const savedPhone = DefaultProvider.canonicalPhone(payment.mobile_money_phone);
  const mismatch = confirmation.providerReference !== payment.provider_reference
    || String(payment.currency || '').toUpperCase() !== 'RWF'
    || (body.currency !== undefined && body.currency !== null && String(body.currency).trim().toUpperCase() !== String(payment.currency || '').toUpperCase())
    || (confirmation.currency && String(confirmation.currency).trim().toUpperCase() !== String(payment.currency || '').toUpperCase())
    || confirmation.amount === null || confirmation.amount === undefined
    || !Number.isFinite(Number(confirmation.amount))
    || Math.round(Number(confirmation.amount) * 100) !== Math.round(Number(payment.amount) * 100)
    || Math.round(Number(body.amount) * 100) !== Math.round(Number(payment.amount) * 100)
    || String(payment.payment_method).toUpperCase() !== String(body.payment_method).trim().toUpperCase()
    || confirmation.paymentMethod !== 'MTN_MOMO_RWA'
    || !savedPhone || savedPhone !== callbackPhone
    || (confirmation.status === 'SUCCESS' && (!confirmation.transactionId || confirmation.transactionId !== transactionId))
    || (['FAILED', 'CANCELLED'].includes(confirmation.status) && Boolean(confirmation.transactionId) && Boolean(transactionId) && confirmation.transactionId !== transactionId)
    || confirmation.status !== callbackStatus;
  if (mismatch) {
    await repository.recordPaymentEvent?.({ userId: payment.user_id, paymentId: payment.id, action: 'payment_callback_verification_mismatch', details: { referenceId: payment.provider_reference } });
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  if (confirmation.status === 'PENDING' || confirmation.status === 'UNKNOWN') {
    return { ok: true, paymentId: payment.id, status: 'PENDING', verificationPending: true };
  }
  const settlement = await repository.settlePayment({
    paymentId: payment.id,
    status: confirmation.status,
    failureReason: confirmation.status === 'FAILED' ? 'Payment provider reported a failure.'
      : confirmation.status === 'CANCELLED' ? 'Payment was cancelled.' : null,
    transactionId: confirmation.transactionId || transactionId || null,
  });
  const settlementApplied = settlement.settlementApplied ?? payment.status === 'PENDING';
  const settled = { ...settlement };
  delete settled.settlementApplied;
  if (settlementApplied) {
    await notifyPayment(settled, confirmation.status === 'SUCCESS' ? 'payment_success' : `payment_${confirmation.status.toLowerCase()}`);
    if (settled.status === 'SUCCESS') await deliverSubscriptionEmails({ paymentId: settled.id, repository, mailer }).catch(() => undefined);
  }
  return { ok: true, paymentId: payment.id, status: settled.status, idempotent: !settlementApplied };
};

module.exports = {
  SUPPORTED_PROVIDERS,
  normalizePlan,
  canonicalPlanCode,
  validatePricingTiers,
  calculatePrice,
  getUsageWindow,
  getTierForVolume,
  getTierByCode,
  getNextTier,
  getUsage,
  getAvailablePlans,
  getPublicSubscriptionConfiguration,
  cleanPhone,
  canonicalPhone,
  isInitialPaymentQualifying,
  getPlanForRequest,
  reconcilePayment,
  createPendingPayment,
  getCustomerSubscription,
  getAdminPaymentHistory,
  getCustomerUsage,
  handleProviderCallback,
  notifyPayment,
  deliverSubscriptionEmails,
  runSubscriptionEmailJob,
};
