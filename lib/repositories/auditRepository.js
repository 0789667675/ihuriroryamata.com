const { query } = require('../postgres.js');

const buildAuditFilter = ({ ownerUserId, entityType, action, startDate, endDate }) => {
  const values = [ownerUserId];
  const clauses = ['al.owner_user_id = $1'];
  if (entityType) {
    values.push(entityType);
    clauses.push(`al.entity_type = $${values.length}`);
  }
  if (action) {
    values.push(action);
    clauses.push(`al.action = $${values.length}`);
  }
  if (startDate) {
    values.push(`${startDate}T00:00:00.000Z`);
    clauses.push(`al.created_at >= $${values.length}::timestamptz`);
  }
  if (endDate) {
    values.push(`${endDate}T23:59:59.999Z`);
    clauses.push(`al.created_at <= $${values.length}::timestamptz`);
  }
  return { clauses, values };
};

const listAuditLogs = async (filters) => {
  const { clauses, values } = buildAuditFilter(filters);
  const where = clauses.join(' AND ');
  const [countResult, itemsResult] = await Promise.all([
    query(`SELECT COUNT(*)::bigint AS total FROM audit_logs al WHERE ${where}`, values),
    query(
      `SELECT al.id, al.entity_type, al.entity_id, al.action, al.details, al.changed_by,
       al.created_at, u.name AS actor_name
       FROM audit_logs al LEFT JOIN users u ON u.id = al.changed_by
       WHERE ${where} ORDER BY al.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, (filters.page - 1) * filters.limit]
    ),
  ]);
  return {
    items: itemsResult.rows.map((row) => ({
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    })),
    total: Number(countResult.rows[0]?.total || 0),
    page: filters.page,
    limit: filters.limit,
  };
};

const createAuditLog = async ({ ownerUserId, actorId, entityType, entityId = 0, action, details = null }) => {
  const { rows } = await query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
    [String(entityType).slice(0, 100), Number(entityId) || 0, String(action).slice(0, 100), details == null ? null : JSON.stringify(details), actorId, ownerUserId]
  );
  return rows[0] || null;
};

module.exports = { buildAuditFilter, listAuditLogs, createAuditLog };
