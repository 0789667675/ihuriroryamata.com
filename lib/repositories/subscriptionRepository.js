const { query, getPool } = require('../postgres.js');
const CollectorMilkRepository = require('./collectorMilkRepository.js');
const { addMonthlyPeriod } = require('../utils/subscription-time.js');

const PAYMENT_SELECT = `SELECT sp.id, sp.user_id, sp.subscription_id, sp.plan_id, sp.amount, sp.currency,
  sp.status, sp.payment_method, sp.provider, sp.provider_reference, sp.provider_transaction_id, sp.mobile_money_phone,
  sp.failure_reason, sp.completed_at, sp.period_started_at, sp.period_ends_at, sp.price_type,
  sp.billing_period, sp.plan_snapshot, sp.created_at, sp.updated_at,
  COALESCE(sp.plan_snapshot->>'name', p.name) AS plan_name,
  COALESCE(sp.plan_snapshot->>'code', p.code) AS plan_code
  FROM subscription_payments sp LEFT JOIN subscription_plans p ON p.id = sp.plan_id`;

const getUser = async (id) => {
  const { rows } = await query(
    `SELECT id, name, email, phone, language, role, account_type AS "accountType", account_status AS "accountStatus"
     FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

const getUsageAlertCandidates = async ({ limit = 500 } = {}) => {
  const { rows } = await query(
    `SELECT us.*, u.id AS candidate_user_id, u.email AS candidate_email, u.language AS candidate_language
     FROM user_subscriptions us JOIN users u ON u.id = us.user_id
     WHERE u.account_type = 'COLLECTOR' AND us.status IN ('active', 'pending')
       AND (us.status <> 'active' OR us.subscription_ends_at > NOW())
     ORDER BY us.updated_at ASC, us.id ASC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 500, 1), 1000)]
  );
  return rows;
};

const getSubscription = async (userId) => {
  await query(
    `UPDATE user_subscriptions SET plan_id = next_plan_id,
       current_price = (next_plan_snapshot->>'price')::numeric,
       currency = next_plan_snapshot->>'currency',
       tier_code = regexp_replace(next_plan_snapshot->>'code', '_(MONTHLY|6_MONTHS|YEARLY)$', ''),
       volume_limit_liters = NULLIF(next_plan_snapshot->>'maxVolumeLiters', '')::numeric,
       selected_plan_snapshot = next_plan_snapshot, current_plan_snapshot = next_plan_snapshot,
       current_period_started_at = next_period_started_at, current_period_ends_at = next_period_ends_at,
       next_plan_id = NULL, next_plan_snapshot = NULL, next_period_started_at = NULL,
       next_period_ends_at = NULL, updated_at = NOW()
     WHERE user_id = $1 AND status = 'active' AND next_period_started_at <= NOW()
       AND next_plan_snapshot IS NOT NULL`,
    [userId]
  );
  const { rows } = await query(
    `SELECT us.*, CASE
       WHEN us.status IN ('pending', 'trial') AND COALESCE(us.payment_due_at, us.trial_ends_at) <= NOW() THEN 'suspended'
       WHEN us.status = 'active' AND us.subscription_ends_at IS NOT NULL AND us.subscription_ends_at <= NOW() THEN 'expired'
       ELSE us.status END AS effective_status
     FROM user_subscriptions us WHERE us.user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

const getPlanById = async (id) => {
  const { rows } = await query('SELECT * FROM subscription_plans WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
};

const getPlanByCode = async (code) => {
  const { rows } = await query('SELECT * FROM subscription_plans WHERE code = $1 LIMIT 1', [code]);
  return rows[0] || null;
};

const getActivePlans = async () => {
  const { rows } = await query(
    `SELECT * FROM subscription_plans WHERE is_active = TRUE AND LEFT(code, 6) = 'USAGE_'
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
};

const buildCustomerPaymentHistoryQuery = (userId) => ({
  text: `${PAYMENT_SELECT} WHERE sp.user_id = $1 AND (sp.provider IS NULL OR sp.provider <> 'manual_test') ORDER BY sp.created_at DESC, sp.id DESC LIMIT $2`,
  values: [userId, 100],
});

const getPaymentsByUser = async (userId) => {
  const statement = buildCustomerPaymentHistoryQuery(userId);
  const { rows } = await query(
    statement.text,
    statement.values
  );
  return rows;
};

const buildAdminPaymentHistoryQueries = ({ limit = 50, offset = 0, status = null } = {}) => {
  const values = [];
  const conditions = ["sp.provider = 'mtn_momo'"];
  if (status) {
    values.push(status);
    conditions.push(`sp.status = $${values.length}`);
  }
  const where = conditions.join(' AND ');
  return {
    payments: {
      text: `SELECT sp.id, sp.user_id, u.name AS account_name, u.email AS account_email,
       sp.subscription_id, us.status AS subscription_status, sp.plan_id,
      COALESCE(sp.plan_snapshot->>'name', p.name) AS plan_name,
      COALESCE(sp.plan_snapshot->>'code', p.code) AS plan_code, sp.amount, sp.currency,
       sp.status, sp.payment_method, sp.provider, sp.provider_reference,
       sp.provider_transaction_id, sp.mobile_money_phone, sp.billing_period, sp.failure_reason, sp.completed_at,
       sp.created_at, sp.updated_at
     FROM subscription_payments sp
     JOIN users u ON u.id = sp.user_id
     JOIN user_subscriptions us ON us.id = sp.subscription_id AND us.user_id = sp.user_id
     LEFT JOIN subscription_plans p ON p.id = sp.plan_id
     WHERE ${where}
     ORDER BY sp.created_at DESC, sp.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      values: [...values, limit, offset],
    },
    count: {
      text: `SELECT COUNT(*)::bigint AS total FROM subscription_payments sp
       JOIN users u ON u.id = sp.user_id
       JOIN user_subscriptions us ON us.id = sp.subscription_id AND us.user_id = sp.user_id
       WHERE ${where}`,
      values,
    },
    verifiedSummary: {
      text: `SELECT
        COUNT(*) FILTER (WHERE sp.status = 'SUCCESS')::bigint AS successful_count,
        COALESCE(SUM(sp.amount) FILTER (WHERE sp.status = 'SUCCESS'), 0)::numeric(14,2)::text AS successful_amount,
        COUNT(*) FILTER (WHERE sp.status = 'PENDING')::bigint AS pending_count,
        COUNT(*) FILTER (WHERE sp.status = 'FAILED')::bigint AS failed_count,
        COUNT(*) FILTER (WHERE sp.status = 'CANCELLED')::bigint AS cancelled_count,
        COUNT(*) FILTER (WHERE sp.status = 'EXPIRED')::bigint AS expired_count
       FROM subscription_payments sp WHERE sp.provider = 'mtn_momo'`,
      values: [],
    },
  };
};

const getAdminPaymentHistory = async (filters = {}) => {
  const statements = buildAdminPaymentHistoryQueries(filters);
  const [payments, count, verifiedSummary] = await Promise.all([
    query(statements.payments.text, statements.payments.values),
    query(statements.count.text, statements.count.values),
    query(statements.verifiedSummary.text, statements.verifiedSummary.values),
  ]);
  const summary = verifiedSummary.rows[0] || {};
  return {
    payments: payments.rows,
    total: Number(count.rows[0]?.total || 0),
    summary: {
      successfulCount: Number(summary.successful_count || 0),
      successfulAmount: Number(summary.successful_amount || 0),
      pendingCount: Number(summary.pending_count || 0),
      failedCount: Number(summary.failed_count || 0),
      cancelledCount: Number(summary.cancelled_count || 0),
      expiredCount: Number(summary.expired_count || 0),
    },
  };
};

const rwandaDate = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const scheduleSubscriptionEmailEvents = async ({ reminderDays = [], now = new Date() } = {}) => {
  const today = rwandaDate(now);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: scheduled } = await client.query(
      `WITH changed AS (
         UPDATE user_subscriptions
         SET status = CASE WHEN status = 'active' THEN 'expired'::subscription_status ELSE 'suspended'::subscription_status END,
           updated_at = NOW()
         WHERE (status = 'active' AND subscription_ends_at <= $2::timestamptz)
           OR (status IN ('pending', 'trial') AND COALESCE(payment_due_at, trial_ends_at) <= $2::timestamptz)
         RETURNING id, user_id, plan_id, status, subscription_ends_at, payment_due_at, trial_ends_at
       ), queued AS (
         INSERT INTO subscription_email_events
           (owner_user_id, subscription_id, event_type, event_key, recipient, payload)
         SELECT changed.user_id, changed.id, 'subscription_expired',
           'subscription-expired:' || changed.id || ':' || (CASE WHEN changed.subscription_ends_at IS NOT NULL THEN changed.subscription_ends_at ELSE COALESCE(changed.payment_due_at, changed.trial_ends_at) END)::date,
           u.email,
           jsonb_build_object(
             'customerName', u.name,
             'planName', COALESCE(p.name, 'Milk System subscription'),
             'subscriptionEnd', (CASE WHEN changed.subscription_ends_at IS NOT NULL THEN changed.subscription_ends_at ELSE COALESCE(changed.payment_due_at, changed.trial_ends_at) END)::text,
             'pendingPayment', EXISTS (SELECT 1 FROM subscription_payments sp WHERE sp.user_id = changed.user_id AND sp.subscription_id = changed.id AND sp.status = 'PENDING')
           )
         FROM changed JOIN users u ON u.id = changed.user_id
         LEFT JOIN subscription_plans p ON p.id = changed.plan_id
         ON CONFLICT (event_key) DO NOTHING
         RETURNING owner_user_id, subscription_id
       ), audited AS (
         INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         SELECT 'user_subscription', subscription_id, 'access_suspended', '{"source":"subscription_email_scheduler"}'::jsonb, NULL, owner_user_id
         FROM queued RETURNING id
       )
       SELECT (SELECT COUNT(*)::integer FROM changed) AS expired,
         (SELECT COUNT(*)::integer FROM queued) AS expiredEmailsQueued,
         (SELECT COUNT(*)::integer FROM audited) AS expirationAudits`,
      [today, now]
    );

    const offsets = [...new Set(reminderDays.map(Number).filter((day) => Number.isInteger(day) && day > 0 && day <= 90))];
    let remindersQueued = 0;
    for (const days of offsets) {
      const { rowCount } = await client.query(
        `INSERT INTO subscription_email_events
           (owner_user_id, subscription_id, event_type, event_key, recipient, payload)
         SELECT us.user_id, us.id, 'subscription_reminder',
           'subscription-reminder:' || us.id || ':' || end_date::date || ':' || $2,
           u.email,
           jsonb_build_object('customerName', u.name, 'planName', COALESCE(p.name, 'Milk System subscription'),
             'subscriptionEnd', end_date::text, 'reminderDays', $2)
         FROM (
           SELECT us.*, CASE WHEN us.status IN ('pending', 'trial') THEN COALESCE(us.payment_due_at, us.trial_ends_at) ELSE us.subscription_ends_at END AS end_date
           FROM user_subscriptions us WHERE us.status IN ('active', 'pending', 'trial')
         ) us
         JOIN users u ON u.id = us.user_id
         LEFT JOIN subscription_plans p ON p.id = us.plan_id
         WHERE us.end_date::date = $1::date + $2::integer
           AND NOT EXISTS (
             SELECT 1 FROM subscription_payments sp
             WHERE sp.user_id = us.user_id AND sp.subscription_id = us.id AND sp.status = 'PENDING'
           )
         ON CONFLICT (event_key) DO NOTHING`,
        [today, days]
      );
      remindersQueued += rowCount || 0;
    }
    await client.query('COMMIT');
    return { expired: Number(scheduled[0]?.expired || 0), expiredEmailsQueued: Number(scheduled[0]?.expiredEmailsQueued || 0), remindersQueued, reminderDays: offsets };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const claimSubscriptionEmailEvents = async ({ limit = 20, paymentId = null } = {}) => {
  const values = [];
  let paymentFilter = '';
  if (paymentId !== null) {
    values.push(paymentId);
    paymentFilter = `AND payment_id = $${values.length}`;
  }
  values.push(limit);
  const { rows } = await query(
    `WITH claimable AS (
       SELECT id FROM subscription_email_events
       WHERE ((status = 'pending' AND available_at <= NOW())
         OR (status = 'processing' AND lease_until < NOW())) ${paymentFilter}
       ORDER BY id ASC LIMIT $${values.length} FOR UPDATE SKIP LOCKED
     )
     UPDATE subscription_email_events e
     SET status = 'processing', attempts = attempts + 1, lease_until = NOW() + INTERVAL '5 minutes', updated_at = NOW()
     FROM claimable WHERE e.id = claimable.id
     RETURNING e.*`,
    values
  );
  return rows.map((row) => ({ ...row, payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload }));
};

const markSubscriptionEmailSent = async (eventId) => {
  await query(
    `UPDATE subscription_email_events SET status = 'sent', sent_at = NOW(), lease_until = NULL,
     last_error = NULL, updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
    [eventId]
  );
};

const markSubscriptionEmailFailed = async ({ eventId, errorCode = 'EMAIL_DELIVERY_FAILED' }) => {
  const safeCode = String(errorCode).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) || 'EMAIL_DELIVERY_FAILED';
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE subscription_email_events SET status = 'pending', lease_until = NULL,
       available_at = NOW() + (LEAST(POWER(2, LEAST(attempts, 10)), 3600)::text || ' seconds')::interval,
       last_error = $2, updated_at = NOW() WHERE id = $1 AND status = 'processing'
       RETURNING owner_user_id, subscription_id, event_type, attempts`,
      [eventId, safeCode]
    );
    if (rows[0]) {
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('subscription_email', $1, 'delivery_failed', $2::jsonb, NULL, $3)`,
        [rows[0].subscription_id, JSON.stringify({ eventType: rows[0].event_type, attempts: rows[0].attempts, errorCode: safeCode }), rows[0].owner_user_id]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getPaymentById = async (id) => {
  const { rows } = await query(`${PAYMENT_SELECT} WHERE sp.id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
};

const getPaymentByIdForUser = async (id, userId) => {
  const { rows } = await query(`${PAYMENT_SELECT} WHERE sp.id = $1 AND sp.user_id = $2 LIMIT 1`, [id, userId]);
  return rows[0] || null;
};

const findActivePayments = async (userId) => {
  const { rows } = await query(
    `${PAYMENT_SELECT} WHERE sp.user_id = $1 AND sp.provider = 'mtn_momo' AND sp.status = 'PENDING' ORDER BY sp.created_at DESC, sp.id DESC`,
    [userId]
  );
  return rows;
};

const findPaymentByReference = async (reference) => {
  const { rows } = await query(
    `${PAYMENT_SELECT} WHERE sp.provider = 'mtn_momo' AND sp.provider_reference = $1 LIMIT 1`,
    [reference]
  );
  return rows[0] || null;
};

const recordPaymentEvent = async ({ userId = null, paymentId = 0, action, details = {} }) => {
  await query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('subscription_payment', $1, $2, $3::jsonb, NULL, $4)`,
    [Number(paymentId) || 0, String(action).slice(0, 100), JSON.stringify(details), userId]
  );
};

const buildUsageExceededEventKey = ({ subscriptionId, periodStart, tierCode }) => `subscription-usage-exceeded:${subscriptionId}:${new Date(periodStart).toISOString()}:${tierCode}`;

const queueUsageExceededNotice = async ({ ownerUserId, subscriptionId, recipient, language, periodStart, tierCode, actualLiters, currentTier, recommendedTier, effectiveDate }) => {
  const client = await getPool().connect();
  const eventKey = buildUsageExceededEventKey({ subscriptionId, periodStart, tierCode });
  const english = language === 'en';
  const range = (tier) => tier.max_volume_liters === null || tier.max_volume_liters === undefined
    ? `${Number(tier.min_volume_liters ?? tier.minVolumeLiters).toLocaleString('en-US')}+ L`
    : `${Number(tier.min_volume_liters ?? tier.minVolumeLiters).toLocaleString('en-US')}-${Number(tier.max_volume_liters ?? tier.maxVolumeLiters).toLocaleString('en-US')} L`;
  const details = {
    actualLiters,
    currentTier: { code: currentTier.code, name: currentTier.name, range: range(currentTier) },
    recommendedTier: {
      code: recommendedTier.code,
      name: recommendedTier.name,
      range: range(recommendedTier),
      price: Number(recommendedTier.price),
      currency: recommendedTier.currency,
    },
    effectiveDate,
  };
  const title = english ? 'Monthly volume tier exceeded' : 'Litiro zarenze iz’icyiciro cyatoranyijwe';
  const message = english
    ? `${Number(actualLiters).toLocaleString('en-US')} L recorded; current tier ${currentTier.name} (${range(currentTier)}). Suggested tier: ${recommendedTier.name} (${range(recommendedTier)}) at ${Number(recommendedTier.price).toLocaleString('en-US')} ${recommendedTier.currency}/month. Effective date: ${effectiveDate || 'next renewal'}. No change is made unless you accept it.`
    : `Handitswe ${Number(actualLiters).toLocaleString('en-US')} L; icyiciro kiriho ni ${currentTier.name} (${range(currentTier)}). Icyiciro gishya cyasabwa: ${recommendedTier.name} (${range(recommendedTier)}) kuri ${Number(recommendedTier.price).toLocaleString('en-US')} ${recommendedTier.currency}/ukwezi. Itangira: ${effectiveDate || 'ku ivugururwa ritaha'}. Nta gihinduka utabyemeye.`;
  try {
    await client.query('BEGIN');
    const { rows: notices } = await client.query(
      `INSERT INTO notifications (notification_type, title, message, priority, owner_user_id, dedupe_key, details)
       VALUES ('subscription_usage_exceeded', $1, $2, 'warning', $3, $4, $5::jsonb)
       ON CONFLICT (owner_user_id, dedupe_key) DO NOTHING RETURNING id`,
      [title, message, ownerUserId, eventKey, JSON.stringify(details)]
    );
    const { rows: events } = await client.query(
      `INSERT INTO subscription_email_events
       (owner_user_id, subscription_id, event_type, event_key, recipient, payload)
       VALUES ($1, $2, 'subscription_usage_exceeded', $3, $4, $5::jsonb)
       ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [ownerUserId, subscriptionId, `email:${eventKey}`, recipient, JSON.stringify({ ...details, language })]
    );
    await client.query('COMMIT');
    return { notificationCreated: notices.length > 0, emailQueued: events.length > 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const recordProviderTransaction = async ({ paymentId, transactionId }) => {
  await query(
    `UPDATE subscription_payments SET provider_transaction_id = $1, updated_at = NOW()
     WHERE id = $2 AND status = 'PENDING' AND provider = 'mtn_momo'`,
    [transactionId, paymentId]
  );
  return getPaymentById(paymentId);
};

const getCollectorMilk = async ({ userId, startDate, endDate }) => CollectorMilkRepository.getForPeriod({ ownerUserId: userId, startDate, endDate });

const buildFarmerMilkUsageQuery = ({ userId, startDate, endDate }) => ({
  text: `SELECT COUNT(*)::integer AS record_count,
       COALESCE(SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters)), 0) AS valid_liters
     FROM milk_records mr
     JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
     JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id AND ca.collector_user_id = f.collector_user_id
      WHERE ca.collector_user_id = $1 AND mr.date BETWEEN $2 AND $3
       AND COALESCE(mr.status, 'valid') <> 'cancelled'`,
  values: [userId, startDate, endDate],
});

const getFarmerMilkUsage = async (filters) => {
  const { text, values } = buildFarmerMilkUsageQuery(filters);
  const { rows } = await query(
    text,
    values
  );
  return { recordCount: Number(rows[0]?.record_count || 0), validLiters: Number(rows[0]?.valid_liters || 0) };
};

const reservePayment = async ({ userId, subscriptionId, planId, amount, currency, paymentMethod, phoneNumber, periodStart, periodEnd, priceType, billingPeriod, planSnapshot, providerReference }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const { rows: pending } = await client.query(
      `${PAYMENT_SELECT} WHERE sp.user_id = $1 AND sp.provider = 'mtn_momo' AND sp.status = 'PENDING'
       ORDER BY sp.created_at DESC, sp.id DESC LIMIT 1 FOR UPDATE OF sp`,
      [userId]
    );
    if (pending[0]) {
      await client.query('ROLLBACK');
      return { payment: pending[0], reused: true };
    }
    const { rows } = await client.query(
      `INSERT INTO subscription_payments
       (user_id, subscription_id, plan_id, amount, currency, status, payment_method, provider,
        provider_reference, mobile_money_phone, period_started_at, period_ends_at, price_type, billing_period, plan_snapshot)
        VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, 'mtn_momo', $7, $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING id`,
       [userId, subscriptionId, planId, amount, currency, paymentMethod, providerReference, phoneNumber, periodStart, periodEnd, priceType, billingPeriod, JSON.stringify(planSnapshot || {})]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('subscription_payment', $1, 'payment_initiated', $2::jsonb, $3, $3)`,
        [rows[0].id, JSON.stringify({ provider: 'mtn_momo', referenceId: providerReference, amount, currency, billingPeriod, planSnapshot }), userId]
    );
    await client.query('COMMIT');
    return { payment: await getPaymentById(rows[0].id), reused: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateUncertainReason = async ({ paymentId, reason }) => {
  await query(`UPDATE subscription_payments SET failure_reason = $1, updated_at = NOW() WHERE id = $2 AND status = 'PENDING'`, [reason, paymentId]);
  return getPaymentById(paymentId);
};

const settlePayment = async ({ paymentId, status, failureReason, transactionId = null, now = new Date() }) => {
  if (!['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
    throw Object.assign(new Error('Unsupported payment state.'), { code: 'PAYMENT_STATE_INVALID' });
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: paymentRows } = await client.query(`${PAYMENT_SELECT} WHERE sp.id = $1 FOR UPDATE OF sp`, [paymentId]);
    const payment = paymentRows[0];
    if (!payment) {
      const error = new Error('Payment not found.');
      error.code = 'PAYMENT_NOT_FOUND';
      throw error;
    }
    if (payment.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return { ...payment, settlementApplied: false };
    }
    if (status !== 'SUCCESS') {
      await client.query(
        `UPDATE subscription_payments SET status = $1, failure_reason = $2,
         provider_transaction_id = COALESCE($3, provider_transaction_id),
         completed_at = NOW(), updated_at = NOW() WHERE id = $4 AND status = 'PENDING'`,
        [status, failureReason, transactionId, paymentId]
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('subscription_payment', $1, $2, $3::jsonb, NULL, $4)`,
        [payment.id, `payment_${status.toLowerCase()}`, JSON.stringify({ referenceId: payment.provider_reference, transactionId }), payment.user_id]
      );
      await client.query('COMMIT');
      return { ...(await getPaymentById(paymentId)), settlementApplied: true };
    }

    const { rows: subscriptionRows } = await client.query(
      `SELECT * FROM user_subscriptions WHERE id = $1 AND user_id = $2 LIMIT 1 FOR UPDATE`,
      [payment.subscription_id, payment.user_id]
    );
    const subscription = subscriptionRows[0];
    if (!subscription) {
      const error = new Error('Subscription not found.');
      error.code = 'SUBSCRIPTION_NOT_FOUND';
      throw error;
    }
    const { rows: planRows } = await client.query('SELECT * FROM subscription_plans WHERE id = $1 LIMIT 1', [payment.plan_id]);
    const plan = planRows[0];
    if (!plan) {
      const error = new Error('Subscription plan is not available.');
      error.code = 'PLAN_NOT_AVAILABLE';
      throw error;
    }
    const activeExpiry = subscription.status === 'active' && subscription.subscription_ends_at
      && new Date(subscription.subscription_ends_at) > now;
    const start = activeExpiry ? new Date(subscription.subscription_ends_at) : new Date(now);
    const end = addMonthlyPeriod(start);
    const scheduled = Boolean(activeExpiry && start > now);
    const storedSnapshot = typeof payment.plan_snapshot === 'string' ? JSON.parse(payment.plan_snapshot) : payment.plan_snapshot || {};
    const snapshot = {
      ...storedSnapshot,
      id: plan.id,
      code: storedSnapshot.code || plan.code,
      name: storedSnapshot.name || plan.name,
      price: Number(payment.amount),
      currency: payment.currency,
      minVolumeLiters: storedSnapshot.minVolumeLiters ?? (plan.min_volume_liters === null ? null : Number(plan.min_volume_liters)),
      maxVolumeLiters: Object.hasOwn(storedSnapshot, 'maxVolumeLiters')
        ? storedSnapshot.maxVolumeLiters : (plan.max_volume_liters === null ? null : Number(plan.max_volume_liters)),
      billingPeriod: 'monthly',
      periodStartedAt: start.toISOString(),
      periodEndsAt: end.toISOString(),
    };
    const tierCode = String(snapshot.code).replace(/_(MONTHLY|6_MONTHS|YEARLY)$/i, '');
    const volumeLimit = snapshot.maxVolumeLiters;
    await client.query(
      `UPDATE subscription_payments SET status = 'SUCCESS', period_started_at = $1, period_ends_at = $2,
       plan_snapshot = $3::jsonb,
      provider_transaction_id = COALESCE($4, provider_transaction_id),
      completed_at = NOW(), updated_at = NOW() WHERE id = $5 AND status = 'PENDING'`,
      [start, end, JSON.stringify(snapshot), transactionId, paymentId]
    );
    if (scheduled) {
      await client.query(
        `UPDATE user_subscriptions SET status = 'active', subscription_ends_at = $1,
         next_plan_id = $2, next_plan_snapshot = $3::jsonb, next_period_started_at = $4,
         next_period_ends_at = $1, selected_plan_snapshot = $3::jsonb, updated_at = NOW()
         WHERE id = $5 AND user_id = $6`,
        [end, plan.id, JSON.stringify(snapshot), start, subscription.id, payment.user_id]
      );
    } else {
      await client.query(
        `UPDATE user_subscriptions SET plan_id = $1, status = 'active',
         subscription_started_at = COALESCE(subscription_started_at, $2), subscription_ends_at = $3,
         current_period_started_at = $2, current_period_ends_at = $3,
         current_price = $4, currency = $5, tier_code = $6, volume_limit_liters = $7,
         selected_plan_snapshot = $8::jsonb, current_plan_snapshot = $8::jsonb,
         next_plan_id = NULL, next_plan_snapshot = NULL, next_period_started_at = NULL,
         next_period_ends_at = NULL, updated_at = NOW()
         WHERE id = $9 AND user_id = $10`,
        [plan.id, start, end, payment.amount, payment.currency, tierCode, volumeLimit,
          JSON.stringify(snapshot), subscription.id, payment.user_id]
      );
    }
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('subscription_payment', $1, 'payment_success', $2::jsonb, NULL, $3)`,
        [payment.id, JSON.stringify({ referenceId: payment.provider_reference, transactionId, subscriptionId: subscription.id, planSnapshot: snapshot, effectiveAt: start.toISOString() }), payment.user_id]
    );
    const { rows: accountRows } = await client.query('SELECT name, email FROM users WHERE id = $1 LIMIT 1', [payment.user_id]);
    if (accountRows[0]?.email) {
      await client.query(
        `INSERT INTO subscription_email_events
         (owner_user_id, subscription_id, payment_id, event_type, event_key, recipient, payload)
         VALUES ($1, $2, $3, 'payment_confirmation', $4, $5, $6::jsonb)
         ON CONFLICT (event_key) DO NOTHING`,
        [payment.user_id, subscription.id, payment.id, `payment-confirmation:${payment.id}`, accountRows[0].email, JSON.stringify({
          customerName: accountRows[0].name,
          paymentStatus: 'SUCCESS',
          amount: Number(payment.amount),
          currency: payment.currency,
          billingPeriod: payment.billing_period,
          planName: snapshot.name,
          planCode: snapshot.code,
          paymentDate: now.toISOString(),
          referenceId: payment.provider_reference,
          transactionId,
          subscriptionStart: start.toISOString(),
          subscriptionEnd: end.toISOString(),
        })]
      );
    }
    await client.query('COMMIT');
    return { ...(await getPaymentById(paymentId)), settlementApplied: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  PAYMENT_SELECT,
  getUser,
  getUsageAlertCandidates,
  getSubscription,
  getPlanById,
  getPlanByCode,
  getActivePlans,
  getPaymentsByUser,
  buildCustomerPaymentHistoryQuery,
  buildAdminPaymentHistoryQueries,
  getAdminPaymentHistory,
  scheduleSubscriptionEmailEvents,
  claimSubscriptionEmailEvents,
  markSubscriptionEmailSent,
  markSubscriptionEmailFailed,
  getPaymentById,
  getPaymentByIdForUser,
  findActivePayments,
  findPaymentByReference,
  recordPaymentEvent,
  queueUsageExceededNotice,
  buildUsageExceededEventKey,
  recordProviderTransaction,
  getCollectorMilk,
  buildFarmerMilkUsageQuery,
  getFarmerMilkUsage,
  reservePayment,
  updateUncertainReason,
  settlePayment,
};
