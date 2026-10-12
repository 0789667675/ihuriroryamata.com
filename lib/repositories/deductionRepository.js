const { query, getPool } = require('../postgres.js');

const mapDeduction = (row) => row ? ({
  ...row,
  farmerId: Number(row.farmer_id),
  ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
  farmerName: row.farmer_name ?? null,
  amount: Number(row.amount),
  date: String(row.date).slice(0, 10),
}) : null;

const writeAudit = async (client, { id, ownerUserId, actorId, action, details }) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('deduction', $1, $2, $3::jsonb, $4, $5)`,
    [id, action, JSON.stringify(details), actorId, ownerUserId]
  );
};

const createDeduction = async ({ ownerUserId, actorId, input }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: farmers } = await client.query(
      'SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 LIMIT 1 FOR KEY SHARE',
      [input.farmerId, ownerUserId]
    );
    if (!farmers[0]) {
      const error = new Error('Invalid farmerId.');
      error.statusCode = 400;
      throw error;
    }
    const { rows } = await client.query(
      `INSERT INTO deductions (farmer_id, owner_user_id, amount, type, status, reason, date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [input.farmerId, ownerUserId, input.amount, input.type, input.status, input.reason, input.date, input.notes]
    );
    await writeAudit(client, {
      id: rows[0].id, ownerUserId, actorId, action: 'created',
      details: { farmerId: input.farmerId, amount: input.amount, date: input.date, type: input.type, notes: input.notes },
    });
    await client.query('COMMIT');
    return mapDeduction(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const buildDeductionListQuery = ({ ownerUserId, farmerId, type, status, search, cursor, limit, sortBy = 'date', sortDirection = 'desc' }) => {
  const values = [ownerUserId];
  const conditions = ['d.owner_user_id = $1', 'f.owner_user_id = d.owner_user_id'];
  if (farmerId) {
    values.push(farmerId);
    conditions.push(`d.farmer_id = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`d.type = $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`d.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(f.name ILIKE $${values.length} OR COALESCE(f.phone, '') ILIKE $${values.length} OR COALESCE(f.national_id, '') ILIKE $${values.length})`);
  }
  const sortColumns = { date: 'd.date', farmerName: `LOWER(BTRIM(COALESCE(f.name, '')))` , amount: 'd.amount' };
  const sortExpression = sortColumns[sortBy] || sortColumns.date;
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  if (cursor) {
    if (sortBy === 'date') {
      values.push(cursor.date, cursor.id);
      conditions.push(`(d.date, d.id) ${sortDirection === 'asc' ? '>' : '<'} ($${values.length - 1}::date, $${values.length}::bigint)`);
    } else {
      values.push(sortBy === 'amount' ? Number(cursor.value) : String(cursor.value).toLowerCase(), cursor.date, cursor.id);
      const valueSlot = `$${values.length - 2}`;
      const dateSlot = `$${values.length - 1}`;
      const idSlot = `$${values.length}`;
      const comparison = sortDirection === 'asc' ? '>' : '<';
      const cursorValue = sortBy === 'amount' ? `${valueSlot}::numeric` : valueSlot;
      const tieDirection = sortDirection === 'asc' ? '>' : '<';
      conditions.push(`(${sortExpression} ${comparison} ${cursorValue} OR (${sortExpression} = ${cursorValue} AND (d.date ${tieDirection} ${dateSlot}::date OR (d.date = ${dateSlot}::date AND d.id ${tieDirection} ${idSlot}::bigint))))`);
    }
  }
  values.push(limit + 1);
  return {
    text: `SELECT d.*, f.name AS farmer_name
      FROM deductions d JOIN farmers f ON f.id = d.farmer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${sortExpression} ${direction}${sortBy === 'date' ? `, d.id ${direction}` : `, d.date ${sortDirection === 'asc' ? 'ASC' : 'DESC'}, d.id ${sortDirection === 'asc' ? 'ASC' : 'DESC'}`} LIMIT $${values.length}`,
    values,
  };
};

const listDeductions = async (filters, runQuery = query) => {
  const { text, values } = buildDeductionListQuery(filters);
  const { rows } = await runQuery(text, values);
  const hasMore = rows.length > filters.limit;
  const data = (hasMore ? rows.slice(0, filters.limit) : rows).map(mapDeduction);
  const last = data[data.length - 1];
  return {
    data,
    pageSize: filters.limit,
    hasMore,
    nextCursor: hasMore && last ? `d1.${Buffer.from(JSON.stringify({
      sortBy: filters.sortBy || 'date',
      sortDirection: filters.sortDirection || 'desc',
      value: filters.sortBy === 'amount' ? Number(last.amount) : filters.sortBy === 'farmerName' ? String(last.farmerName || '') : last.date,
      date: last.date,
      id: Number(last.id),
    }), 'utf8').toString('base64url')}` : null,
  };
};

const getDeduction = async (id, ownerUserId) => {
  const { rows } = await query(
    `SELECT d.*, f.name AS farmer_name FROM deductions d
     JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
     WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2 LIMIT 1`,
    [id, ownerUserId]
  );
  return mapDeduction(rows[0]);
};

const updateDeduction = async ({ id, ownerUserId, actorId, input }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `SELECT d.*, f.name AS farmer_name FROM deductions d
       JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
       WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2
       LIMIT 1 FOR UPDATE OF d`,
      [id, ownerUserId]
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows } = await client.query(
      `UPDATE deductions SET amount = $1, type = $2, status = $3, reason = $4, date = $5, notes = $6, updated_at = NOW()
       WHERE id = $7 AND owner_user_id = $8 RETURNING *`,
      [input.amount, input.type, input.status, input.reason, input.date, input.notes, id, ownerUserId]
    );
    const updated = rows[0];
    await writeAudit(client, {
      id, ownerUserId, actorId, action: 'updated',
      details: {
        farmerId: existing.farmer_id,
        before: { amount: existing.amount, date: existing.date, type: existing.type, status: existing.status },
        after: { amount: input.amount, date: input.date, type: input.type, status: input.status },
      },
    });
    await client.query('COMMIT');
    return mapDeduction({ ...updated, farmer_name: existing.farmer_name });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const deleteDeduction = async ({ id, ownerUserId, actorId, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT d.* FROM deductions d JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
       WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2
       LIMIT 1 FOR UPDATE OF d`,
      [id, ownerUserId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    if (rows[0].status === 'Cleared') {
      await client.query('COMMIT');
      return true;
    }
    const { rows: clearedRows } = await client.query(
      `UPDATE deductions SET status = 'Cleared', updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2 AND status = 'Active' RETURNING id`,
      [id, ownerUserId]
    );
    if (!clearedRows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await writeAudit(client, {
      id, ownerUserId, actorId, action: 'cleared',
      details: { farmerId: rows[0].farmer_id, amount: rows[0].amount, date: rows[0].date, type: rows[0].type, previousStatus: rows[0].status },
    });
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { mapDeduction, buildDeductionListQuery, createDeduction, listDeductions, getDeduction, updateDeduction, deleteDeduction };
