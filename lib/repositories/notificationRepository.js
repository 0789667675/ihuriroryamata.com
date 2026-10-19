const { query } = require('../postgres.js');
const {
  ALL_OPERATIONAL_NOTIFICATION_TYPES,
  ALERT_TYPE_GROUPS,
  buildAlertDedupeKey,
} = require('../services/notification-taxonomy.js');

const mapNotification = (row) => row ? ({
  ...row,
  isRead: Boolean(row.is_read),
  createdAt: row.created_at,
  status: row.status || 'open',
  resolutionCode: row.resolution_code || null,
  resolutionNote: row.resolution_note || null,
  resolvedBy: row.resolved_by === null || row.resolved_by === undefined ? null : Number(row.resolved_by),
  resolvedAt: row.resolved_at || null,
  updatedAt: row.updated_at || row.created_at,
  details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : row.details,
}) : null;

// Kept as the shared key builder so a notification can never be duplicated for the
// same owner, type, farmer, center, date, session, and reference.
const buildDedupeKey = buildAlertDedupeKey;

const UPSERT_SQL = `INSERT INTO notifications (notification_type, title, message, farmer_id, collection_center,
     collection_date, period, priority, owner_user_id, dedupe_key, details)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
   ON CONFLICT (owner_user_id, dedupe_key) DO NOTHING
   RETURNING *`;

const upsertNotification = async (input) => {
  const dedupeKey = input.dedupeKey || buildDedupeKey({
    type: input.type,
    farmerId: input.farmerId,
    center: input.collectionCenter,
    date: input.collectionDate,
    period: input.period,
  });
  const { rows } = await query(
    UPSERT_SQL,
    [input.type, input.title, input.message, input.farmerId ?? null, input.collectionCenter ?? null,
      input.collectionDate ?? null, input.period ?? null, input.priority || 'warning',
      input.ownerUserId, dedupeKey, input.details ? JSON.stringify(input.details) : null]
  );
  if (rows[0]) return { created: true, notification: mapNotification(rows[0]) };
  const { rows: existing } = await query(
    'SELECT * FROM notifications WHERE owner_user_id = $1 AND dedupe_key = $2 LIMIT 1',
    [input.ownerUserId, dedupeKey]
  );
  return { created: false, notification: mapNotification(existing[0]) };
};

/**
 * Insert an operational alert, or reconcile the persisted row:
 * - open alerts stay as they are (content refresh is handled separately)
 * - alerts that a previous evaluation resolved automatically are reopened
 * - alerts a user resolved keep the user's decision
 */
const upsertOperationalAlert = async (input) => {
  const dedupeKey = input.dedupeKey || buildDedupeKey({
    type: input.type,
    farmerId: input.farmerId,
    center: input.collectionCenter,
    date: input.collectionDate,
    period: input.period,
  });
  const values = [input.type, input.title, input.message, input.farmerId ?? null, input.collectionCenter ?? null,
    input.collectionDate ?? null, input.period ?? null, input.priority || 'warning',
    input.ownerUserId, dedupeKey, input.details ? JSON.stringify(input.details) : null];
  const inserted = await query(UPSERT_SQL, values);
  if (inserted.rows[0]) return { created: true, reopened: false, notification: mapNotification(inserted.rows[0]) };

  const { rows: existingRows } = await query(
    'SELECT * FROM notifications WHERE owner_user_id = $1 AND dedupe_key = $2 LIMIT 1',
    [input.ownerUserId, dedupeKey]
  );
  const existing = existingRows[0];
  if (!existing) return { created: false, reopened: false, notification: null };
  if (existing.status !== 'resolved' || existing.resolved_by !== null) {
    return { created: false, reopened: false, notification: mapNotification(existing) };
  }
  const { rows: reopenedRows } = await query(
    `UPDATE notifications
        SET status = 'open', resolution_code = NULL, resolution_note = NULL,
            resolved_by = NULL, resolved_at = NULL, is_read = FALSE, updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND status = 'resolved' AND resolved_by IS NULL
      RETURNING *`,
    [existing.id, input.ownerUserId]
  );
  return { created: false, reopened: Boolean(reopenedRows[0]), notification: mapNotification(reopenedRows[0] || existing) };
};

/** Refresh the factual content of an open, system-generated alert. */
const refreshOperationalAlert = async ({ id, ownerUserId, title, message, details }) => {
  const { rows } = await query(
    `UPDATE notifications
        SET title = $3, message = $4, details = $5::jsonb, updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND status = 'open' AND resolved_by IS NULL
      RETURNING *`,
    [id, ownerUserId, title, message, details ? JSON.stringify(details) : null]
  );
  return mapNotification(rows[0]);
};

/**
 * Create or refresh the single in-app reminder for a subscription end date.
 * Read state is preserved, but the factual message and priority follow the
 * current days remaining. Reminders are never part of operational reconciliation.
 */
const upsertSubscriptionReminder = async (input) => {
  const { rows } = await query(
    `INSERT INTO notifications (notification_type, title, message, farmer_id, collection_center,
       collection_date, period, priority, owner_user_id, dedupe_key, details)
     VALUES ($1, $2, $3, NULL, NULL, $4, NULL, $5, $6, $7, $8::jsonb)
     ON CONFLICT (owner_user_id, dedupe_key) DO UPDATE
       SET title = EXCLUDED.title,
           message = EXCLUDED.message,
           priority = EXCLUDED.priority,
           details = EXCLUDED.details,
           updated_at = NOW()
       WHERE notifications.status = 'open'
     RETURNING *, (xmax = 0) AS created`,
    [input.type, input.title, input.message, input.collectionDate ?? null, input.priority || 'info',
      input.ownerUserId, input.dedupeKey, input.details ? JSON.stringify(input.details) : null]
  );
  const row = rows[0];
  if (!row) return { created: false, notification: null };
  const { created, ...notificationRow } = row;
  return { created: Boolean(created), notification: mapNotification(notificationRow) };
};

/** Close reminders that no longer match the current subscription end date. */
const resolveStaleSubscriptionReminders = async ({ ownerUserId, currentEndDate = null, now = new Date() }) => {
  await query(
    `UPDATE notifications
        SET status = 'resolved', resolution_code = 'issue_cleared',
            resolved_at = $4, updated_at = $4, is_read = TRUE
      WHERE owner_user_id = $1 AND notification_type = $2 AND status = 'open'
        AND ($3::date IS NULL OR collection_date IS NULL OR collection_date <> $3::date)`,
    [Number(ownerUserId), 'subscription_expiring', currentEndDate || null, now]
  );
  return { success: true };
};

/** Resolve open, system-generated alerts in bulk (reconciliation). */
const resolveOperationalAlerts = async ({ ownerUserId, ids, resolutionCode, now = new Date() }) => {
  const alertIds = (ids || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!alertIds.length) return [];
  const { rows } = await query(
    `UPDATE notifications
        SET status = 'resolved', resolution_code = $3, resolved_at = $4,
            updated_at = $4, is_read = TRUE
      WHERE owner_user_id = $1 AND id = ANY($2::bigint[]) AND status = 'open' AND resolved_by IS NULL
      RETURNING *`,
    [ownerUserId, alertIds, resolutionCode, now]
  );
  return rows.map(mapNotification);
};

const getNotificationById = async ({ id, ownerUserId }) => {
  const { rows } = await query(
    'SELECT * FROM notifications WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
    [Number(id), Number(ownerUserId)]
  );
  return mapNotification(rows[0]);
};

/** Resolve an alert with a user-supplied, auditable reason. */
const resolveNotification = async ({ id, ownerUserId, actorId, resolutionCode, note = null, now = new Date() }) => {
  const { rows } = await query(
    `UPDATE notifications
        SET status = 'resolved', resolution_code = $3, resolution_note = $4, resolved_by = $5,
            resolved_at = $6, updated_at = $6, is_read = TRUE
      WHERE id = $1 AND owner_user_id = $2 AND status = 'open'
      RETURNING *`,
    [Number(id), Number(ownerUserId), resolutionCode, note, Number(actorId), now]
  );
  return mapNotification(rows[0]);
};

const reopenNotification = async ({ id, ownerUserId, now = new Date() }) => {
  const { rows } = await query(
    `UPDATE notifications
        SET status = 'open', resolution_code = NULL, resolution_note = NULL, resolved_by = NULL,
            resolved_at = NULL, is_read = FALSE, updated_at = $3
      WHERE id = $1 AND owner_user_id = $2 AND status = 'resolved'
      RETURNING *`,
    [Number(id), Number(ownerUserId), now]
  );
  return mapNotification(rows[0]);
};

const getNotifications = async ({
  ownerUserId, center, status, priority, type, typePrefix, search,
  state = null, category = null, alertGroup = null,
  sortBy = 'date', sortDirection = 'desc', limit = 50, runQuery = query,
}) => {
  const values = [ownerUserId];
  const clauses = ['owner_user_id = $1'];
  if (center) {
    values.push(center);
    clauses.push(`collection_center = $${values.length}`);
  }
  if (status === 'unread') clauses.push('is_read = FALSE');
  if (status === 'read') clauses.push('is_read = TRUE');
  if (state === 'open' || state === 'resolved') clauses.push(`status = '${state}'`);
  if (state === 'action') clauses.push("status = 'open' AND priority IN ('high', 'warning')");
  if (priority) {
    values.push(priority);
    clauses.push(`priority = $${values.length}`);
  }
  if (type) {
    values.push(type);
    clauses.push(`notification_type = $${values.length}`);
  }
  if (typePrefix) {
    values.push(`${typePrefix}%`);
    clauses.push(`notification_type LIKE $${values.length}`);
  }
  if (category === 'operational') {
    values.push(ALL_OPERATIONAL_NOTIFICATION_TYPES);
    clauses.push(`notification_type = ANY($${values.length}::text[])`);
  }
  if (category === 'activity') {
    values.push(ALL_OPERATIONAL_NOTIFICATION_TYPES);
    clauses.push(`NOT (notification_type = ANY($${values.length}::text[])) AND notification_type NOT LIKE 'payment_%'`);
  }
  if (category === 'payment') clauses.push("notification_type LIKE 'payment_%'");
  if (alertGroup && ALERT_TYPE_GROUPS[alertGroup]) {
    values.push(ALERT_TYPE_GROUPS[alertGroup]);
    clauses.push(`notification_type = ANY($${values.length}::text[])`);
  }
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(title ILIKE $${values.length} OR message ILIKE $${values.length})`);
  }
  const sortColumn = sortBy === 'type' ? 'notification_type' : 'created_at';
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  values.push(limit);
  const { rows } = await runQuery(
    `SELECT * FROM notifications WHERE ${clauses.join(' AND ')}
     ORDER BY ${sortColumn} ${direction}, id ${direction} LIMIT $${values.length}`,
    values
  );
  return rows.map(mapNotification);
};

const getUnreadCount = async ({ ownerUserId, center }) => {
  const values = [ownerUserId];
  let where = 'owner_user_id = $1 AND is_read = FALSE';
  if (center) {
    values.push(center);
    where += ` AND collection_center = $${values.length}`;
  }
  const { rows } = await query(`SELECT COUNT(*)::integer AS total FROM notifications WHERE ${where}`, values);
  return Number(rows[0]?.total || 0);
};

const markNotificationRead = async ({ id, ownerUserId }) => {
  const { rows } = await query(
    `UPDATE notifications SET is_read = TRUE, updated_at = NOW() WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
    [id, ownerUserId]
  );
  return mapNotification(rows[0]);
};

const markAllRead = async ({ ownerUserId, center }) => {
  const values = [ownerUserId];
  let where = 'owner_user_id = $1';
  if (center) {
    values.push(center);
    where += ` AND collection_center = $${values.length}`;
  }
  await query(`UPDATE notifications SET is_read = TRUE, updated_at = NOW() WHERE ${where}`, values);
  return { success: true };
};

const getCollectionCenters = async ({ ownerUserId, center }) => {
  if (center) {
    const { rows } = await query(
      `SELECT id, name, morning_start, morning_end, evening_start, evening_end
       FROM collection_centers WHERE owner_user_id = $1 AND LOWER(BTRIM(name)) = LOWER(BTRIM($2)) LIMIT 1`,
      [ownerUserId, center]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, name, morning_start, morning_end, evening_start, evening_end
     FROM collection_centers WHERE owner_user_id = $1 ORDER BY name ASC`,
    [ownerUserId]
  );
  return rows;
};

const getCenterSnapshot = async ({ ownerUserId, centerName, startDate, endDate }) => {
  const { rows: farmers } = await query(
    `SELECT id, name, location, collection_center AS "collectionCenter"
     FROM farmers WHERE owner_user_id = $1
       AND (LOWER(BTRIM(collection_center)) = LOWER(BTRIM($2)) OR LOWER(BTRIM(location)) = LOWER(BTRIM($2)))
     ORDER BY name ASC, id ASC`,
    [ownerUserId, centerName]
  );
  const { rows: records } = await query(
    `SELECT mr.farmer_id, mr.date, mr.volume_morning, mr.volume_evening, mr.volume_liters
     FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
     WHERE mr.owner_user_id = $1 AND mr.date BETWEEN $2 AND $3
       AND (LOWER(BTRIM(f.collection_center)) = LOWER(BTRIM($4)) OR LOWER(BTRIM(f.location)) = LOWER(BTRIM($4)))
     ORDER BY mr.date DESC`,
    [ownerUserId, startDate, endDate, centerName]
  );
  return { farmers, records };
};

const getCenterPeriodHistory = async ({ ownerUserId, centerName, startDate, endDate }) => {
  const { rows } = await query(
    `SELECT mr.date,
       COALESCE(SUM(COALESCE(mr.valid_volume_morning, mr.volume_morning)), 0) AS morning,
       COALESCE(SUM(COALESCE(mr.valid_volume_evening, mr.volume_evening)), 0) AS evening
     FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
     WHERE mr.owner_user_id = $1 AND mr.date >= $2 AND mr.date < $3
       AND (LOWER(BTRIM(f.collection_center)) = LOWER(BTRIM($4)) OR LOWER(BTRIM(f.location)) = LOWER(BTRIM($4)))
       AND COALESCE(mr.status, 'valid') <> 'cancelled'
     GROUP BY mr.date ORDER BY mr.date DESC`,
    [ownerUserId, startDate, endDate, centerName]
  );
  return rows;
};

module.exports = {
  mapNotification,
  buildDedupeKey,
  upsertNotification,
  upsertOperationalAlert,
  refreshOperationalAlert,
  upsertSubscriptionReminder,
  resolveStaleSubscriptionReminders,
  resolveOperationalAlerts,
  getNotificationById,
  resolveNotification,
  reopenNotification,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
  getCollectionCenters,
  getCenterSnapshot,
  getCenterPeriodHistory,
};
