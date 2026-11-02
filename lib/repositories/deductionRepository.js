const { query, getPool } = require('../postgres.js');
const { resolveCollectorScope } = require('./domainRepository.js');

const resolveDeductionScope = async ({ ownerUserId, collectorUserId = null, client }) => {
  const scope = await resolveCollectorScope({
    collectorUserId: Number(collectorUserId || ownerUserId),
    ownerUserId: Number(ownerUserId),
    client,
  });
  return {
    ownerUserId: Number(scope.dairyUserId || ownerUserId),
    collectorUserId: scope.dairyUserId ? Number(scope.collectorUserId) : null,
  };
};

const mapDeduction = (row) => row ? ({
  ...row,
  farmerId: Number(row.farmer_id),
  ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
  farmerName: row.farmer_name ?? null,
  amount: Number(row.amount),
  date: String(row.date).slice(0, 10),
}) : null;

const mapFarmerDeductionGroup = (row) => row ? ({
  farmerId: Number(row.farmer_id),
  farmerName: row.farmer_name ?? null,
  deductionCount: Number(row.deduction_count || 0),
  activeDeductionCount: Number(row.active_count || 0),
  clearedDeductionCount: Number(row.cleared_count || 0),
  totalActiveDeductionAmount: Number(row.total_active_amount || 0),
  totalClearedDeductionAmount: Number(row.total_cleared_amount || 0),
  mostRecentDeductionDate: row.latest_deduction_date ? String(row.latest_deduction_date).slice(0, 10) : null,
}) : null;

const writeAudit = async (client, { id, ownerUserId, actorId, action, details }) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('deduction', $1, $2, $3::jsonb, $4, $5)`,
    [id, action, JSON.stringify(details), actorId, ownerUserId]
  );
};

const createDeduction = async ({ ownerUserId, collectorUserId = null, actorId, input }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client });
    ownerUserId = scope.ownerUserId;
    const scopedCollectorId = scope.collectorUserId;
    const { rows: farmers } = await client.query(
      'SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 AND ($3::bigint IS NULL OR collector_user_id = $3) LIMIT 1 FOR KEY SHARE',
      [input.farmerId, ownerUserId, scopedCollectorId]
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

const buildDeductionListQuery = ({ ownerUserId, collectorUserId = null, farmerId, type, status, search, cursor, limit, sortBy = 'date', sortDirection = 'desc' }) => {
  const values = [ownerUserId];
  const conditions = ['d.owner_user_id = $1', 'f.owner_user_id = d.owner_user_id'];
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
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
  let resolvedFilters = filters;
  if (filters.collectorUserId || runQuery === query) {
    const scope = await resolveDeductionScope({
      ownerUserId: filters.ownerUserId,
      collectorUserId: filters.collectorUserId,
      client: { query: runQuery },
    });
    resolvedFilters = { ...filters, ownerUserId: scope.ownerUserId, collectorUserId: scope.collectorUserId };
  }
  const { text, values } = buildDeductionListQuery(resolvedFilters);
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

const buildFarmerGroupQuery = ({ ownerUserId, collectorUserId = null, farmerId = null, type = null, status = null, search = '', sortBy = 'date', sortDirection = 'desc', cursor = null, limit = 50 }) => {
  const values = [Number(ownerUserId)];
  const conditions = ['f.owner_user_id = $1'];

  if (collectorUserId !== null && collectorUserId !== undefined && collectorUserId !== '') {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  if (farmerId !== null && farmerId !== undefined && farmerId !== '') {
    values.push(Number(farmerId));
    conditions.push(`f.id = $${values.length}`);
  }

  const deductionFilters = [];
  if (type) {
    values.push(type);
    deductionFilters.push(`d.type = $${values.length}`);
  }
  if (status) {
    values.push(status);
    deductionFilters.push(`d.status = $${values.length}`);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    values.push(term);
    conditions.push(`(f.name ILIKE $${values.length} OR COALESCE(f.phone, '') ILIKE $${values.length} OR COALESCE(f.national_id, '') ILIKE $${values.length})`);
  }

  const sortExpressions = {
    date: 'latest_deduction_date',
    farmerName: "LOWER(BTRIM(COALESCE(farmer_name, ''))) ",
    amount: 'total_active_amount',
  };
  const sortExpression = sortExpressions[sortBy] || sortExpressions.date;
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  let cursorCondition = '';
  if (cursor) {
    const cursorValue = sortBy === 'date' ? cursor.value : sortBy === 'amount' ? Number(cursor.value) : String(cursor.value);
    values.push(cursorValue, Number(cursor.farmerId));
    const valueSlot = `$${values.length - 1}`;
    const farmerIdSlot = `$${values.length}`;
    const comparison = sortDirection === 'asc' ? '>' : '<';
    const typedCursorValue = sortBy === 'date' ? `${valueSlot}::date` : sortBy === 'amount' ? `${valueSlot}::numeric` : valueSlot;
    cursorCondition = `WHERE (${sortExpression} ${comparison} ${typedCursorValue} OR (${sortExpression} = ${typedCursorValue} AND farmer_id > ${farmerIdSlot}::bigint))`;
  }

  values.push(Number(limit) + 1);
  return {
    text: `WITH grouped AS (
      SELECT
        f.id AS farmer_id,
        f.name AS farmer_name,
        COUNT(d.id)::integer AS deduction_count,
        SUM(CASE WHEN d.status = 'Active' THEN 1 ELSE 0 END)::integer AS active_count,
        SUM(CASE WHEN d.status = 'Cleared' THEN 1 ELSE 0 END)::integer AS cleared_count,
        COALESCE(SUM(CASE WHEN d.status = 'Active' THEN d.amount ELSE 0 END), 0)::numeric(18,2) AS total_active_amount,
        COALESCE(SUM(CASE WHEN d.status = 'Cleared' THEN d.amount ELSE 0 END), 0)::numeric(18,2) AS total_cleared_amount,
        MAX(d.date)::date AS latest_deduction_date
      FROM farmers f
      JOIN deductions d ON d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id${deductionFilters.length ? ` AND ${deductionFilters.join(' AND ')}` : ''}
      WHERE ${conditions.join(' AND ')}
      GROUP BY f.id, f.name
    )
    SELECT * FROM grouped
    ${cursorCondition}
    ORDER BY ${sortExpression} ${direction}, farmer_id ASC
    LIMIT $${values.length}`,
    values,
  };
};

const listFarmerDeductionGroups = async (filters, runQuery = query) => {
  const ownerUserId = Number(filters.ownerUserId);
  const collectorUserId = filters.collectorUserId !== undefined && filters.collectorUserId !== null ? Number(filters.collectorUserId) : null;
  const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client: { query: runQuery } });
  const resolvedFilters = {
    ...filters,
    ownerUserId: scope.ownerUserId,
    collectorUserId: scope.collectorUserId,
  };
  const { text, values } = buildFarmerGroupQuery({
    ownerUserId: resolvedFilters.ownerUserId,
    collectorUserId: resolvedFilters.collectorUserId,
    type: resolvedFilters.type || null,
    status: resolvedFilters.status || null,
    farmerId: resolvedFilters.farmerId || null,
    search: resolvedFilters.search || '',
    sortBy: resolvedFilters.sortBy || 'date',
    sortDirection: resolvedFilters.sortDirection || 'desc',
    cursor: resolvedFilters.cursor || null,
    limit: Number(resolvedFilters.limit || 50),
  });
  const { rows } = await runQuery(text, values);
  const pageSize = Number(resolvedFilters.limit || 50);
  const hasMore = rows.length > pageSize;
  const data = (hasMore ? rows.slice(0, pageSize) : rows).map(mapFarmerDeductionGroup);
  const last = data[data.length - 1];
  const nextCursor = hasMore && last ? `g1.${Buffer.from(JSON.stringify({
    sortBy: resolvedFilters.sortBy || 'date',
    sortDirection: resolvedFilters.sortDirection || 'desc',
    value: (resolvedFilters.sortBy || 'date') === 'date'
      ? last.mostRecentDeductionDate
      : (resolvedFilters.sortBy || 'date') === 'amount'
        ? last.totalActiveDeductionAmount
        : String(last.farmerName || '').trim().toLowerCase(),
    farmerId: last.farmerId,
  }), 'utf8').toString('base64url')}` : null;
  return { data, hasMore, pageSize, nextCursor };
};

const getDeduction = async (id, ownerUserId, collectorUserId = null) => {
  const scope = await resolveDeductionScope({ ownerUserId, collectorUserId });
  ownerUserId = scope.ownerUserId;
  if (scope.collectorUserId) {
    const { rows: scopedRows } = await query(
      `SELECT d.*, f.name AS farmer_name FROM deductions d
       JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
       WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2 AND f.collector_user_id = $3 LIMIT 1`,
      [id, ownerUserId, scope.collectorUserId]
    );
    return mapDeduction(scopedRows[0]);
  }
  const { rows } = await query(
    `SELECT d.*, f.name AS farmer_name FROM deductions d
     JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
     WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2 LIMIT 1`,
    [id, ownerUserId]
  );
  return mapDeduction(rows[0]);
};

const updateDeduction = async ({ id, ownerUserId, collectorUserId = null, actorId, input }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client });
    ownerUserId = scope.ownerUserId;
    const { rows: existingRows } = await client.query(
      `SELECT d.*, f.name AS farmer_name FROM deductions d
       JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
       WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2
       LIMIT 1 FOR UPDATE OF d`,
      [id, ownerUserId]
    );
    let existing = existingRows[0];
    if (existing && scope.collectorUserId) {
      const { rows: cf } = await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 AND collector_user_id = $3 LIMIT 1', [existing.farmer_id, ownerUserId, scope.collectorUserId]);
      if (!cf[0]) existing = null;
    }
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    if (Number(existing.farmer_id) !== Number(input.farmerId)) {
      const error = new Error('farmerId cannot be changed.');
      error.statusCode = 400;
      throw error;
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
        before: { amount: existing.amount, date: existing.date, type: existing.type, status: existing.status, reason: existing.reason, notes: existing.notes },
        after: { amount: input.amount, date: input.date, type: input.type, status: input.status, reason: input.reason, notes: input.notes },
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

const deleteDeduction = async ({ id, ownerUserId, collectorUserId = null, actorId, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let scopedCollectorId = null;
    if (collectorUserId || poolProvider === getPool) {
      const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client });
      ownerUserId = scope.ownerUserId;
      scopedCollectorId = scope.collectorUserId;
    }
    const { rows } = await client.query(
      `SELECT d.* FROM deductions d JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
       WHERE d.id = $1 AND d.owner_user_id = $2 AND f.owner_user_id = $2
       LIMIT 1 FOR UPDATE OF d`,
      [id, ownerUserId]
    );
    if (rows[0] && scopedCollectorId) {
      const { rows: cf } = await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 AND collector_user_id = $3 LIMIT 1', [rows[0].farmer_id, ownerUserId, scopedCollectorId]);
      if (!cf[0]) rows.length = 0;
    }
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

module.exports = {
  mapDeduction,
  mapFarmerDeductionGroup,
  buildDeductionListQuery,
  buildFarmerGroupQuery,
  createDeduction,
  listDeductions,
  listFarmerDeductionGroups,
  getDeduction,
  updateDeduction,
  deleteDeduction,
};
