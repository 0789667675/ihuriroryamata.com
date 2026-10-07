const { query } = require('../postgres.js');

const mapNotification = (row) => row ? ({
  ...row,
  isRead: Boolean(row.is_read),
  createdAt: row.created_at,
  details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : row.details,
}) : null;

const buildDedupeKey = ({ type, farmerId = null, center, date, period = null, reference = null }) => [
  type,
  farmerId ?? 'group',
  center ?? 'all',
  date || 'unknown-date',
  period || 'all',
  reference ?? 'default',
].join('|');

const upsertNotification = async (input) => {
  const dedupeKey = input.dedupeKey || buildDedupeKey({
    type: input.type,
    farmerId: input.farmerId,
    center: input.collectionCenter,
    date: input.collectionDate,
    period: input.period,
  });
  const { rows } = await query(
    `INSERT INTO notifications (notification_type, title, message, farmer_id, collection_center,
       collection_date, period, priority, owner_user_id, dedupe_key, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (owner_user_id, dedupe_key) DO NOTHING
     RETURNING *`,
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

const getNotifications = async ({ ownerUserId, center, status, priority, limit = 50, typePrefix }) => {
  const values = [ownerUserId];
  const clauses = ['owner_user_id = $1'];
  if (center) {
    values.push(center);
    clauses.push(`collection_center = $${values.length}`);
  }
  if (status === 'unread') clauses.push('is_read = FALSE');
  if (priority) {
    values.push(priority);
    clauses.push(`priority = $${values.length}`);
  }
  if (typePrefix) {
    values.push(`${typePrefix}%`);
    clauses.push(`notification_type LIKE $${values.length}`);
  }
  values.push(limit);
  const { rows } = await query(
    `SELECT * FROM notifications WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
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
    `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
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
  await query(`UPDATE notifications SET is_read = TRUE WHERE ${where}`, values);
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
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
  getCollectionCenters,
  getCenterSnapshot,
  getCenterPeriodHistory,
};
