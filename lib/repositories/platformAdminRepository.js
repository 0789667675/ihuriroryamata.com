const { query, getPool } = require('../postgres.js');

const ACCOUNT_EFFECTIVE_STATUS = `CASE
  WHEN u.account_status = 'suspended' THEN 'suspended'
  WHEN u.account_status = 'not_approved' THEN 'not_approved'
  WHEN us.billing_exempt THEN 'exempt'
  WHEN us.status IN ('pending', 'trial') AND COALESCE(us.payment_due_at, us.trial_ends_at) <= NOW() THEN 'suspended'
  WHEN us.status = 'active' AND us.subscription_ends_at IS NOT NULL AND us.subscription_ends_at <= NOW() THEN 'expired'
  ELSE us.status::text END`;

const listAccounts = async ({ page, limit, search, status }) => {
  const values = [];
  const conditions = ["u.role <> 'super_admin'"];
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  if (status === 'not_approved' || status === 'suspended') {
    values.push(status);
    conditions.push(`${ACCOUNT_EFFECTIVE_STATUS} = $${values.length}`);
  } else if (status === 'none') {
    conditions.push('us.id IS NULL');
  } else if (status) {
    values.push(status);
    conditions.push(`${ACCOUNT_EFFECTIVE_STATUS} = $${values.length}`);
  }
  const where = conditions.join(' AND ');
  const [count, items] = await Promise.all([
    query(
      `SELECT COUNT(*)::bigint AS total FROM users u LEFT JOIN user_subscriptions us ON us.user_id = u.id WHERE ${where}`,
      values
    ),
    query(
      `SELECT u.id AS user_id, u.name AS account_name, u.email AS account_email, u.role,
         u.account_type, u.phone, u.email_verified,
         COALESCE(u.account_status, 'active') AS account_status,
         u.created_at AS account_created_at, us.id AS subscription_id, us.status AS subscription_status,
         ${ACCOUNT_EFFECTIVE_STATUS} AS effective_status, us.access_started_at, us.payment_due_at,
         COALESCE(us.billing_exempt, FALSE) AS billing_exempt,
         COALESCE(us.tier_code, (us.current_plan_snapshot->>'code'), 'USAGE_STARTER') AS plan_code,
         ROUND(EXTRACT(EPOCH FROM (us.payment_due_at - NOW())) / 86400)::integer AS days_remaining,
         (SELECT COUNT(*)::integer FROM farmers f WHERE f.owner_user_id = u.id) AS farmer_count,
         (SELECT COUNT(*)::integer FROM milk_records mr WHERE mr.owner_user_id = u.id) AS milk_record_count,
         (SELECT COUNT(*)::integer FROM collection_centers c WHERE c.owner_user_id = u.id) AS center_count
       FROM users u LEFT JOIN user_subscriptions us ON us.user_id = u.id
       WHERE ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    ),
  ]);
  return { page, limit, total: Number(count.rows[0]?.total || 0), accounts: items.rows };
};

const getAccountDetails = async (userId) => {
  const { rows: accountRows } = await query(
    `SELECT id, name, email, role, account_type, account_status, email_verified, phone, language, created_at
     FROM users WHERE id = $1 AND role <> 'super_admin' LIMIT 1`,
    [userId]
  );
  if (!accountRows[0]) return null;
  const { rows: subscriptionRows } = await query(
    `SELECT us.*, CASE
       WHEN us.billing_exempt THEN 'exempt'
       WHEN us.status IN ('pending', 'trial') AND COALESCE(us.payment_due_at, us.trial_ends_at) <= NOW() THEN 'suspended'
       WHEN us.status = 'active' AND us.subscription_ends_at IS NOT NULL AND us.subscription_ends_at <= NOW() THEN 'expired'
       ELSE us.status::text END AS effective_status
     FROM user_subscriptions us WHERE us.user_id = $1 LIMIT 1`,
    [userId]
  );
  const { rows: countRows } = await query(
    `SELECT
      (SELECT COUNT(*)::integer FROM collection_centers WHERE owner_user_id = $1) AS centers,
      (SELECT COUNT(*)::integer FROM farmers WHERE owner_user_id = $1) AS farmers,
      (SELECT COUNT(*)::integer FROM milk_records WHERE owner_user_id = $1) AS milk_records,
      (SELECT COUNT(*)::integer FROM deductions WHERE owner_user_id = $1) AS deductions,
      (SELECT COUNT(*)::integer FROM farmer_settlement_records WHERE owner_user_id = $1) AS payments,
      (SELECT COUNT(*)::integer FROM notifications WHERE owner_user_id = $1) AS notifications`,
    [userId]
  );
  return { account: accountRows[0], subscription: subscriptionRows[0] || null, counts: countRows[0] };
};

const setSubscriptionExemption = async ({ userId, actorId, exempt, reason, poolProvider = getPool }) => {
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const { rows: users } = await client.query(
      "SELECT id FROM users WHERE id = $1 AND role <> 'super_admin' FOR KEY SHARE",
      [userId]
    );
    if (!users[0]) throw Object.assign(new Error('Customer account not found.'), { statusCode: 404 });
    const { rows: subscriptions } = await client.query(
      'SELECT * FROM user_subscriptions WHERE user_id = $1 LIMIT 1 FOR UPDATE',
      [userId]
    );
    const previous = subscriptions[0];
    if (!previous) throw Object.assign(new Error('Customer subscription not found.'), { statusCode: 404 });
    if (Boolean(previous.billing_exempt) === exempt && (!exempt || previous.exemption_reason === reason)) {
      await client.query('COMMIT');
      return previous;
    }
    const { rows } = await client.query(
      `UPDATE user_subscriptions SET billing_exempt = $1,
         exemption_reason = CASE WHEN $1 THEN $2 ELSE exemption_reason END,
         exemption_granted_by = CASE WHEN $1 THEN $3 ELSE exemption_granted_by END,
         exemption_granted_at = CASE WHEN $1 THEN NOW() ELSE exemption_granted_at END,
         exemption_revoked_at = CASE WHEN $1 THEN NULL ELSE NOW() END,
         status = CASE WHEN $1 AND status IN ('suspended', 'expired') THEN 'active'::subscription_status ELSE status END,
         updated_at = NOW()
       WHERE user_id = $4 RETURNING *`,
      [exempt, reason, actorId, userId]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('user_subscription', $1, $2, $3::jsonb, $4, $5)`,
      [previous.id, exempt ? 'subscription_exemption_granted' : 'subscription_exemption_revoked', JSON.stringify({
        previous: { billingExempt: Boolean(previous.billing_exempt), reason: previous.exemption_reason || null },
        current: { billingExempt: exempt, reason: exempt ? reason : previous.exemption_reason || null },
        changeReason: reason,
      }), actorId, userId]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const extendSubscriptionAccess = async ({ userId, actorId, days, reason, poolProvider = getPool }) => {
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const { rows: users } = await client.query(
      "SELECT id FROM users WHERE id = $1 AND role <> 'super_admin' FOR KEY SHARE",
      [userId]
    );
    if (!users[0]) throw Object.assign(new Error('Customer account not found.'), { statusCode: 404 });
    const { rows: subscriptions } = await client.query(
      'SELECT * FROM user_subscriptions WHERE user_id = $1 LIMIT 1 FOR UPDATE',
      [userId]
    );
    const previous = subscriptions[0];
    if (!previous) throw Object.assign(new Error('Customer subscription not found.'), { statusCode: 404 });

    const previousDeadline = previous.payment_due_at;
    const { rows } = await client.query(
      `UPDATE user_subscriptions
       SET payment_due_at = GREATEST(COALESCE(payment_due_at, NOW()), NOW()) + ($1 * INTERVAL '1 day'),
           subscription_ends_at = CASE WHEN subscription_ends_at IS NOT NULL THEN GREATEST(subscription_ends_at, NOW()) + ($1 * INTERVAL '1 day') ELSE subscription_ends_at END,
           status = 'active',
           updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [days, userId]
    );
    const updated = rows[0];
    const newDeadline = updated.payment_due_at;

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('user_subscription', $1, $2, $3::jsonb, $4, $5)`,
      [previous.id, 'subscription_extended', JSON.stringify({
        days,
        previousDeadline,
        newDeadline,
        reason: reason || null,
      }), actorId, userId]
    );
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getAccountsSummary = async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::integer AS total_accounts,
      COUNT(*) FILTER (WHERE us.id IS NULL)::integer AS without_subscription,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'pending')::integer AS pending,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'active')::integer AS active,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'not_approved')::integer AS not_approved,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'suspended')::integer AS suspended,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'expired')::integer AS expired,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'exempt')::integer AS exempt
     FROM users u LEFT JOIN user_subscriptions us ON us.user_id = u.id WHERE u.role <> 'super_admin'`
  );
  const { rows: registrations } = await query(
    `SELECT COUNT(*)::integer AS registrations_last_30_days FROM users
     WHERE role <> 'super_admin' AND created_at >= NOW() - INTERVAL '30 days'`
  );
  return { accounts: rows[0], registrations_last_30_days: registrations[0]?.registrations_last_30_days || 0 };
};

const setAccountStatus = async ({ userId, accountStatus }) => {
  const { rows } = await query(
    `UPDATE users SET account_status = $1, updated_at = NOW() WHERE id = $2 AND role <> 'super_admin'
     RETURNING id, name, email, account_status`,
    [accountStatus, userId]
  );
  return rows[0] || null;
};

const writeAdminAudit = async ({ actorId, userId, entityType, action, details }) => {
  await query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [entityType, userId, action, JSON.stringify(details || {}), actorId, userId]
  );
};

module.exports = { ACCOUNT_EFFECTIVE_STATUS, listAccounts, getAccountDetails, getAccountsSummary, setAccountStatus, setSubscriptionExemption, extendSubscriptionAccess, writeAdminAudit };
