const { query, getPool } = require('../postgres.js');

const getAssignments = async (dairyUserId, centerId = null, runQuery = query) => {
  const centerFilter = centerId ? Number(centerId) : null;
  const { rows } = await runQuery(
    `SELECT ca.id, ca.dairy_user_id, ca.collector_user_id, ca.created_at,
       u.name AS collector_name, u.national_id AS collector_national_id,
       u.account_number AS collector_account_number, u.phone AS collector_phone,
       u.account_type AS collector_account_type,
       COUNT(DISTINCT f.id)::integer AS abacunda_count
     FROM collector_assignments ca JOIN users u ON u.id = ca.collector_user_id
     LEFT JOIN farmers f ON f.owner_user_id = ca.dairy_user_id AND f.collector_user_id = ca.collector_user_id
     LEFT JOIN collection_centers c ON c.owner_user_id = f.owner_user_id
       AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
     WHERE ca.dairy_user_id = $1 AND ($2::bigint IS NULL OR c.id = $2)
     GROUP BY ca.id, u.id ORDER BY u.name ASC`,
    [Number(dairyUserId), centerFilter]
  );
  return rows;
};

const assignCollector = async ({ dairyUserId, collectorUserId, assignedBy }) => {
  const dairyId = Number(dairyUserId);
  const collectorId = Number(collectorUserId);
  if (!Number.isSafeInteger(dairyId) || dairyId <= 0 || !Number.isSafeInteger(collectorId) || collectorId <= 0) {
    throw Object.assign(new Error('A valid collector account is required.'), { code: 'INVALID_COLLECTOR_ID' });
  }
  if (dairyId === collectorId) throw Object.assign(new Error('A collection center cannot assign itself.'), { code: 'SELF_ASSIGNMENT' });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: users } = await client.query(
      'SELECT id, account_type, account_status FROM users WHERE id = ANY($1::bigint[]) FOR UPDATE',
      [[dairyId, collectorId]]
    );
    const dairy = users.find((user) => Number(user.id) === dairyId);
    const collector = users.find((user) => Number(user.id) === collectorId);
    if (!dairy) throw Object.assign(new Error('That collection center account does not exist.'), { code: 'DAIRY_NOT_FOUND' });
    if (dairy.account_type !== 'COLLECTION_CENTER') throw Object.assign(new Error('Only a COLLECTION_CENTER account can hold collector assignments.'), { code: 'NOT_A_DAIRY_ACCOUNT' });
    if (!collector) throw Object.assign(new Error('That collector account does not exist.'), { code: 'COLLECTOR_NOT_FOUND' });
    if (collector.account_type !== 'COLLECTOR') throw Object.assign(new Error('Only a COLLECTOR account can be linked.'), { code: 'NOT_A_COLLECTOR_ACCOUNT' });
    if (collector.account_status === 'suspended') throw Object.assign(new Error('That collector account is suspended.'), { code: 'COLLECTOR_ACCOUNT_SUSPENDED' });

    const { rows: existing } = await client.query(
      `SELECT id FROM collector_assignments WHERE dairy_user_id = $1 AND collector_user_id = $2 LIMIT 1`,
      [dairyId, collectorId]
    );
    if (existing[0]) {
      await client.query('COMMIT');
      return (await getAssignments(dairyId)).find((row) => Number(row.collector_user_id) === collectorId);
    }
    const { rows: holders } = await client.query(
      'SELECT dairy_user_id FROM collector_assignments WHERE collector_user_id = $1 LIMIT 1',
      [collectorId]
    );
    if (holders[0]) throw Object.assign(new Error('That collector is already linked to another collection center.'), { code: 'COLLECTOR_ALREADY_ASSIGNED' });
    const { rows } = await client.query(
      `INSERT INTO collector_assignments (dairy_user_id, collector_user_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING id, dairy_user_id, collector_user_id, created_at`,
      [dairyId, collectorId, assignedBy]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('collector_assignment', $1, 'created', $2::jsonb, $3, $4)`,
      [rows[0].id, JSON.stringify({ collectorUserId: collectorId }), assignedBy, dairyId]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && error.constraint === 'uq_collector_assignments_collector') {
      throw Object.assign(new Error('That collector is already linked to another collection center.'), { code: 'COLLECTOR_ALREADY_ASSIGNED' });
    }
    throw error;
  } finally {
    client.release();
  }
};

const revokeAssignment = async ({ dairyUserId, collectorUserId, actorId }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM collector_assignments WHERE dairy_user_id = $1 AND collector_user_id = $2 LIMIT 1 FOR UPDATE`,
      [dairyUserId, collectorUserId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      'UPDATE farmers SET collector_user_id = NULL, updated_at = NOW() WHERE owner_user_id = $1 AND collector_user_id = $2',
      [dairyUserId, collectorUserId]
    );
    await client.query('DELETE FROM collector_assignments WHERE dairy_user_id = $1 AND collector_user_id = $2', [dairyUserId, collectorUserId]);
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('collector_assignment', 0, 'revoked', $1::jsonb, $2, $3)`,
      [JSON.stringify({ collectorUserId: Number(collectorUserId) }), actorId, dairyUserId]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { getAssignments, assignCollector, revokeAssignment };
