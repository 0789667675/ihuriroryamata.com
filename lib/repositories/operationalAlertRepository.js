const { query } = require('../postgres.js');

// Read-only data access for operational alert evaluation. Every query is scoped to
// the authenticated owner (and, for collectors, only to their own active assignment),
// so one account can never evaluate another account's farmers.

const FARMER_SCOPE_SQL = `(f.owner_user_id = $1
   OR ($2::bigint IS NOT NULL AND f.owner_user_id = $2 AND f.collector_user_id = $1
       AND EXISTS (SELECT 1 FROM collector_assignments ca2
                   WHERE ca2.dairy_user_id = $2 AND ca2.collector_user_id = $1 AND ca2.revoked_at IS NULL)))`;

const getAlertOwnerScope = async ({ ownerUserId }) => {
  const { rows } = await query(
    `SELECT u.account_type AS "accountType",
            u.account_status AS "accountStatus",
            ca.dairy_user_id AS "dairyUserId"
       FROM users u
       LEFT JOIN collector_assignments ca
              ON ca.collector_user_id = u.id AND ca.revoked_at IS NULL
      WHERE u.id = $1
      LIMIT 1`,
    [Number(ownerUserId)]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    accountType: row.accountType,
    accountStatus: row.accountStatus,
    dairyUserId: row.dairyUserId === null || row.dairyUserId === undefined ? null : Number(row.dairyUserId),
  };
};

const getAlertFarmers = async ({ ownerUserId, dairyUserId = null, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT f.id, f.name,
            f.account_number AS "accountNumber",
            f.owner_user_id AS "ownerUserId",
            COALESCE(NULLIF(f.collection_center, ''), f.location) AS "centerName",
            f.collector_user_id AS "collectorUserId",
            cu.name AS "collectorName",
            (ca.id IS NOT NULL AND COALESCE(cu.account_status::text, 'active') <> 'suspended') AS "collectorActive",
            (f.created_at AT TIME ZONE 'Africa/Kigali')::date::text AS "createdDate"
       FROM farmers f
       LEFT JOIN users cu ON cu.id = f.collector_user_id
       LEFT JOIN collector_assignments ca
              ON ca.dairy_user_id = f.owner_user_id
             AND ca.collector_user_id = f.collector_user_id
             AND ca.revoked_at IS NULL
      WHERE ${FARMER_SCOPE_SQL}
      ORDER BY f.id ASC`,
    [Number(ownerUserId), dairyUserId === null || dairyUserId === undefined ? null : Number(dairyUserId)]
  );
  return rows;
};

const getAlertMilkRecords = async ({ ownerUserId, dairyUserId = null, startDate, endDate, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT mr.farmer_id AS "farmerId", mr.date,
            COALESCE(mr.valid_volume_morning, mr.volume_morning, 0) AS morning,
            COALESCE(mr.valid_volume_evening, mr.volume_evening, 0) AS evening
       FROM milk_records mr
       JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
      WHERE ${FARMER_SCOPE_SQL}
        AND mr.date BETWEEN $3 AND $4
        AND COALESCE(mr.status, 'valid') <> 'cancelled'
      ORDER BY mr.date ASC, mr.farmer_id ASC`,
    [Number(ownerUserId), dairyUserId === null || dairyUserId === undefined ? null : Number(dairyUserId), startDate, endDate]
  );
  return rows;
};

/** Owner-produced milk for reconciliation checks (never farmer rows). */
const getAlertOwnerMilkRecords = async ({ ownerUserId, startDate, endDate, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT mr.date,
            COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) AS volume
       FROM milk_records mr
      WHERE mr.owner_user_id = $1
        AND mr.is_owner_milk = TRUE
        AND mr.date BETWEEN $2 AND $3
        AND COALESCE(mr.status, 'valid') <> 'cancelled'
      ORDER BY mr.date ASC`,
    [Number(ownerUserId), startDate, endDate]
  );
  return rows;
};

/** Active subscription facts used for in-app renewal reminders. */
const getSubscriptionReminderInput = async ({ ownerUserId, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT us.id, us.status::text AS status,
            COALESCE((to_jsonb(us)->>'billing_exempt')::boolean, FALSE) AS "billingExempt",
            CASE WHEN us.status IN ('pending', 'trial')
              THEN COALESCE(us.payment_due_at, us.trial_ends_at)
              ELSE us.subscription_ends_at END AS "endDate",
            p.name AS "planName",
            EXISTS (
              SELECT 1 FROM subscription_payments sp
               WHERE sp.user_id = us.user_id AND sp.subscription_id = us.id AND sp.status = 'PENDING'
            ) AS "hasPendingPayment"
       FROM user_subscriptions us
       LEFT JOIN subscription_plans p ON p.id = us.plan_id
      WHERE us.user_id = $1
      LIMIT 1`,
    [Number(ownerUserId)]
  );
  return rows[0] || null;
};

/** Alerts already stored for this owner, used for dedupe, refresh, and reconciliation. */
const getAlertsForEvaluation = async ({ ownerUserId, types, startDate, endDate, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT * FROM notifications
      WHERE owner_user_id = $1
        AND notification_type = ANY($2::text[])
        AND (collection_date IS NULL OR collection_date BETWEEN $3 AND $4)
      ORDER BY id ASC`,
    [Number(ownerUserId), types, startDate, endDate]
  );
  return rows;
};

module.exports = {
  getAlertOwnerScope,
  getAlertFarmers,
  getAlertMilkRecords,
  getAlertOwnerMilkRecords,
  getSubscriptionReminderInput,
  getAlertsForEvaluation,
};
