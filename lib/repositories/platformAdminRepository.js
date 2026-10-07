const { query, getPool } = require('../postgres.js');

const ACCOUNT_EFFECTIVE_STATUS = `CASE
  WHEN us.status = 'trial' AND us.trial_ends_at <= NOW() THEN 'expired'
  WHEN us.status = 'active' AND us.subscription_ends_at IS NOT NULL AND us.subscription_ends_at <= NOW() THEN 'expired'
  ELSE us.status END`;

const listAccounts = async ({ page, limit, search, status }) => {
  const values = [];
  const conditions = ["u.role <> 'super_admin'"];
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  if (status === 'not_approved' || status === 'suspended' || status === 'active') {
    values.push(status);
    conditions.push(`CASE WHEN u.email_verified = FALSE THEN 'not_approved' ELSE COALESCE(u.account_status, 'active') END = $${values.length}`);
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
         CASE WHEN u.email_verified = FALSE THEN 'not_approved' ELSE COALESCE(u.account_status, 'active') END AS account_status,
         u.created_at AS account_created_at, us.id AS subscription_id, us.status AS subscription_status,
         ${ACCOUNT_EFFECTIVE_STATUS} AS effective_status, us.trial_started_at, us.trial_ends_at,
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
    `SELECT id, name, email, role, account_type, account_status, email_verified, phone, created_at
     FROM users WHERE id = $1 AND role <> 'super_admin' LIMIT 1`,
    [userId]
  );
  if (!accountRows[0]) return null;
  const { rows: subscriptionRows } = await query('SELECT * FROM user_subscriptions WHERE user_id = $1 LIMIT 1', [userId]);
  const { rows: countRows } = await query(
    `SELECT
      (SELECT COUNT(*)::integer FROM collection_centers WHERE owner_user_id = $1) AS centers,
      (SELECT COUNT(*)::integer FROM farmers WHERE owner_user_id = $1) AS farmers,
      (SELECT COUNT(*)::integer FROM milk_records WHERE owner_user_id = $1) AS milk_records,
      (SELECT COUNT(*)::integer FROM deductions WHERE owner_user_id = $1) AS deductions,
      (SELECT COUNT(*)::integer FROM farmer_payments WHERE owner_user_id = $1) AS payments,
      (SELECT COUNT(*)::integer FROM notifications WHERE owner_user_id = $1) AS notifications`,
    [userId]
  );
  return { account: accountRows[0], subscription: subscriptionRows[0] || null, counts: countRows[0] };
};

const getAccountsSummary = async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::integer AS total_accounts,
      COUNT(*) FILTER (WHERE us.id IS NULL)::integer AS without_subscription,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'pending')::integer AS pending,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'trial')::integer AS trial,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'active')::integer AS active,
      COUNT(*) FILTER (WHERE u.account_status = 'suspended')::integer AS suspended,
      COUNT(*) FILTER (WHERE ${ACCOUNT_EFFECTIVE_STATUS} = 'expired')::integer AS expired
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

const updateUserSubscription = async ({ userId, status, extendDays, reactivate = false, grantTrial = false }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM user_subscriptions WHERE user_id = $1 LIMIT 1 FOR UPDATE', [userId]);
    const subscription = rows[0];
    if (!subscription) {
      await client.query('ROLLBACK');
      return null;
    }
    let updated;
    if (grantTrial) {
      const result = await client.query(
        `UPDATE user_subscriptions SET status = 'trial', trial_started_at = NOW(),
         trial_ends_at = NOW() + INTERVAL '15 days', updated_at = NOW()
         WHERE user_id = $1 RETURNING *`,
        [userId]
      );
      updated = result.rows[0];
    } else {
      const targetStatus = reactivate ? 'active' : status;
      const result = await client.query(
        `UPDATE user_subscriptions SET
         status = COALESCE($1, status),
         trial_ends_at = CASE WHEN $2::integer IS NULL THEN trial_ends_at ELSE GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + ($2::text || ' days')::interval END,
         updated_at = NOW()
         WHERE user_id = $3 RETURNING *`,
        [targetStatus || null, extendDays ?? null, userId]
      );
      updated = result.rows[0];
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const writeAdminAudit = async ({ actorId, userId, entityType, action, details }) => {
  await query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [entityType, userId, action, JSON.stringify(details || {}), actorId, userId]
  );
};

module.exports = { listAccounts, getAccountDetails, getAccountsSummary, setAccountStatus, updateUserSubscription, writeAdminAudit };
