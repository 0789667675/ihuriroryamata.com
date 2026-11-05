const { query, getPool } = require('../postgres.js');
const { resolveCollectorScope } = require('./domainRepository.js');
const { validateDeductionPeriod, calculateDeductionRecovery } = require('../utils/deduction-period.js');

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

const mapDeductionConfiguration = (row) => row ? ({
  id: Number(row.id),
  ownerUserId: Number(row.owner_user_id),
  name: row.name,
  description: row.description,
  amountPerFarmer: Number(row.amount_per_farmer),
  type: row.type,
  eligibilityMode: row.eligibility_mode,
  eligibleFarmerIds: (row.eligible_farmer_ids || []).map(Number),
  frequency: row.frequency,
  effectiveStartDate: row.effective_start_date instanceof Date ? row.effective_start_date.toISOString().slice(0, 10) : String(row.effective_start_date).slice(0, 10),
  executionMode: row.execution_mode,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}) : null;

const validateEligibleFarmerIds = async (client, { ownerUserId, collectorUserId, eligibilityMode, eligibleFarmerIds }) => {
  if (eligibilityMode === 'ALL') return [];
  const ids = [...new Set((eligibleFarmerIds || []).map(Number))];
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw Object.assign(new Error('Choose at least one valid eligible farmer.'), { statusCode: 400 });
  }
  const { rows } = await client.query(
    `SELECT id FROM farmers WHERE owner_user_id = $1 AND id = ANY($2::bigint[])
      AND ($3::bigint IS NULL OR collector_user_id = $3) ORDER BY id ASC FOR KEY SHARE`,
    [ownerUserId, ids, collectorUserId]
  );
  if (rows.length !== ids.length) throw Object.assign(new Error('One or more eligible farmers are outside this account.'), { statusCode: 400 });
  return ids;
};

const listDeductionConfigurations = async ({ ownerUserId, collectorUserId = null }) => {
  const scope = await resolveDeductionScope({ ownerUserId, collectorUserId });
  const { rows } = await query(
    `SELECT * FROM deduction_configurations WHERE owner_user_id = $1 ORDER BY is_active DESC, name ASC, id ASC`,
    [scope.ownerUserId]
  );
  return rows.map(mapDeductionConfiguration);
};

const createDeductionConfiguration = async ({ ownerUserId, collectorUserId = null, actorId, input, poolProvider = getPool }) => {
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client });
    ownerUserId = scope.ownerUserId;
    const eligibleFarmerIds = await validateEligibleFarmerIds(client, {
      ownerUserId,
      collectorUserId: scope.collectorUserId,
      ...input,
    });
    const { rows } = await client.query(
      `INSERT INTO deduction_configurations (
        owner_user_id, name, description, amount_per_farmer, type, eligibility_mode,
        eligible_farmer_ids, frequency, effective_start_date, execution_mode, is_active,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::bigint[], $8, $9::date, 'MANUAL', $10, $11, $11)
      RETURNING *`,
      [ownerUserId, input.name, input.description, input.amountPerFarmer, input.type, input.eligibilityMode,
        eligibleFarmerIds, input.frequency, input.effectiveStartDate, input.isActive, actorId]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('deduction_configuration', $1, 'created', $2::jsonb, $3, $4)`,
      [rows[0].id, JSON.stringify({ ...input, eligibleFarmerIds, executionMode: 'MANUAL' }), actorId, ownerUserId]
    );
    await client.query('COMMIT');
    return mapDeductionConfiguration(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateDeductionConfiguration = async ({ id, ownerUserId, collectorUserId = null, actorId, input, poolProvider = getPool }) => {
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client });
    ownerUserId = scope.ownerUserId;
    const { rows: existingRows } = await client.query(
      'SELECT * FROM deduction_configurations WHERE id = $1 AND owner_user_id = $2 FOR UPDATE',
      [id, ownerUserId]
    );
    const existing = existingRows[0];
    if (!existing) throw Object.assign(new Error('Deduction configuration not found.'), { statusCode: 404 });
    const eligibleFarmerIds = await validateEligibleFarmerIds(client, {
      ownerUserId,
      collectorUserId: scope.collectorUserId,
      ...input,
    });
    const { rows } = await client.query(
      `UPDATE deduction_configurations SET name = $1, description = $2, amount_per_farmer = $3,
        type = $4, eligibility_mode = $5, eligible_farmer_ids = $6::bigint[], frequency = $7,
        effective_start_date = $8::date, is_active = $9, updated_by = $10, updated_at = NOW()
       WHERE id = $11 AND owner_user_id = $12 RETURNING *`,
      [input.name, input.description, input.amountPerFarmer, input.type, input.eligibilityMode,
        eligibleFarmerIds, input.frequency, input.effectiveStartDate, input.isActive, actorId, id, ownerUserId]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('deduction_configuration', $1, 'updated', $2::jsonb, $3, $4)`,
      [id, JSON.stringify({ before: mapDeductionConfiguration(existing), after: { ...input, eligibleFarmerIds, executionMode: 'MANUAL' } }), actorId, ownerUserId]
    );
    await client.query('COMMIT');
    return mapDeductionConfiguration(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const applyDeductionBatch = async ({ ownerUserId, collectorUserId = null, actorId, configurationId, farmerIds, periodStart, periodEnd, requestKey, poolProvider = getPool }) => {
  const reportRepository = require('./reportRepository.js');
  const pool = poolProvider();
  const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client: { query: (...args) => pool.query(...args) } });
  ownerUserId = scope.ownerUserId;
  const results = { succeeded: [], duplicates: [], failed: [] };
  const client = await pool.connect();
  let currentFarmerId = null;
  try {
    await client.query('BEGIN');
    for (const farmerId of farmerIds) {
      currentFarmerId = Number(farmerId);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`deduction-batch:${ownerUserId}:${farmerId}:${periodStart}`]);
      const { rows: configRows } = await client.query(
        'SELECT * FROM deduction_configurations WHERE id = $1 AND owner_user_id = $2 FOR SHARE',
        [configurationId, ownerUserId]
      );
      const config = configRows[0];
      if (!config) throw Object.assign(new Error('Deduction configuration not found.'), { statusCode: 404 });
      if (!config.is_active) throw Object.assign(new Error('Deduction configuration is inactive.'), { statusCode: 409 });
      if (config.execution_mode !== 'MANUAL') throw Object.assign(new Error('Only explicitly confirmed manual batches are supported.'), { statusCode: 400 });
      if (config.frequency === 'ONE_TIME') {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`deduction-one-time:${ownerUserId}:${configurationId}:${farmerId}`]);
      }
      const effectiveStartDate = config.effective_start_date instanceof Date
        ? config.effective_start_date.toISOString().slice(0, 10)
        : String(config.effective_start_date).slice(0, 10);
      validateDeductionPeriod({ periodStart, periodEnd, frequency: config.frequency, effectiveStartDate });
      if (config.eligibility_mode === 'SELECTED' && !(config.eligible_farmer_ids || []).map(Number).includes(Number(farmerId))) {
        throw Object.assign(new Error('This farmer is not eligible for the selected deduction.'), { statusCode: 400 });
      }

      const farmerQuery = scope.collectorUserId
        ? await client.query(
          `SELECT f.id FROM farmers f
           JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
             AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
           WHERE f.id = $1 AND f.owner_user_id = $2 AND f.collector_user_id = $3
           FOR KEY SHARE OF f, ca`,
          [farmerId, ownerUserId, scope.collectorUserId]
        )
        : await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 FOR KEY SHARE', [farmerId, ownerUserId]);
      if (!farmerQuery.rows[0]) throw Object.assign(new Error('Farmer does not belong to this account.'), { statusCode: 404 });

      const { rows: existingItems } = config.frequency === 'ONE_TIME'
        ? await client.query(
          `SELECT id FROM deduction_batch_items
           WHERE owner_user_id = $1 AND farmer_id = $2 AND configuration_id = $3`,
          [ownerUserId, farmerId, configurationId]
        )
        : await client.query(
          `SELECT id FROM deduction_batch_items
           WHERE owner_user_id = $1 AND farmer_id = $2 AND configuration_id = $3 AND period_start = $4::date`,
          [ownerUserId, farmerId, configurationId, periodStart]
        );
      if (existingItems[0]) {
        results.duplicates.push({ farmerId: Number(farmerId), batchItemId: Number(existingItems[0].id) });
        continue;
      }

      const { text, values } = reportRepository.buildFarmerTotalsQuery({
        ownerUserId,
        rangeStart: periodStart,
        rangeEnd: periodEnd,
        farmerId,
        collectorUserId: scope.collectorUserId,
      });
      const { rows: farmerRows } = await client.query(text, values);
      const farmer = reportRepository.mapFarmerRow(farmerRows[0] || {}, 400);
      const chargeAmount = Number(config.amount_per_farmer);
      const { rows: reservedRows } = await client.query(
        `SELECT
          COALESCE((SELECT SUM(s.amount) FROM farmer_settlement_records s
            WHERE s.owner_user_id = $1 AND s.farmer_id = $2
              AND s.period_start = $3::date AND s.period_end = $4::date
              AND ((s.payment_type = 'CASH' AND s.status IN ('APPROVED', 'CONFIRMED'))
                OR (s.payment_type = 'SACCO' AND s.status = 'CONFIRMED'))), 0) AS reserved_settlements,
          COALESCE((SELECT SUM(r.amount) FROM farmer_debt_repayments r
            JOIN farmer_debt_ledgers d ON d.id = r.debt_ledger_id AND d.owner_user_id = r.owner_user_id
            WHERE d.owner_user_id = $1 AND d.farmer_id = $2
              AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN $3::date AND $4::date), 0) AS debt_repaid`,
        [ownerUserId, farmerId, periodStart, periodEnd]
      );
      const availableEarnings = Math.max(0, Number(farmer.netAmount || 0)
        - Number(reservedRows[0]?.reserved_settlements || 0)
        - Number(reservedRows[0]?.debt_repaid || 0));
      const { recoveredAmount, outstandingAmount } = calculateDeductionRecovery({
        chargeAmount,
        availableEarnings,
      });
      const status = outstandingAmount === 0 ? 'DEDUCTED' : recoveredAmount > 0 ? 'PARTIAL' : 'OUTSTANDING';
      const reference = `deduction-${configurationId}-${farmerId}-${periodStart}`;
      const itemResult = await client.query(
        `INSERT INTO deduction_batch_items (
          owner_user_id, farmer_id, configuration_id, period_start, period_end,
          charge_amount, recovered_amount, outstanding_amount, request_key, reference, status, created_by
        ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [ownerUserId, farmerId, configurationId, periodStart, periodEnd, chargeAmount, recoveredAmount,
          outstandingAmount, requestKey, reference, status, actorId]
      );
      const itemId = Number(itemResult.rows[0].id);
      let deductionId = null;
      if (recoveredAmount > 0) {
        const { rows: deductionRows } = await client.query(
          `INSERT INTO deductions (
            farmer_id, owner_user_id, amount, type, status, reason, date, notes,
            configuration_id, accounting_period_start, accounting_period_end
          ) VALUES ($1, $2, $3, $4, 'Active', $5, $6::date, $7, $8, $9::date, $10::date) RETURNING id`,
          [farmerId, ownerUserId, recoveredAmount, config.type, config.name, periodStart,
            `Manual batch ${reference}; configured charge ${chargeAmount} RWF.`, configurationId, periodStart, periodEnd]
        );
        deductionId = Number(deductionRows[0].id);
        await writeAudit(client, {
          id: deductionId,
          ownerUserId,
          actorId,
          action: 'created',
          details: { farmerId, amount: recoveredAmount, configuredAmount: chargeAmount, date: periodStart, type: config.type, configurationId, batchItemId: itemId, periodStart, periodEnd },
        });
      }

      let debtLedgerId = null;
      if (outstandingAmount > 0) {
        const debtRequestKey = `deduction-batch-${configurationId}-${farmerId}-${periodStart}`;
        const { rows: debtRows } = await client.query(
          `INSERT INTO farmer_debt_ledgers (
            farmer_id, owner_user_id, opening_balance, remaining_balance, total_repaid,
            status, period_start, period_end, reason, source, notes, created_by, audit_context, request_key
          ) VALUES ($1, $2, $3, $3, 0, 'OPEN', $4::date, $5::date, $6, 'DEDUCTION', $7, $8, $9::jsonb, $10)
          ON CONFLICT (owner_user_id, request_key) WHERE request_key IS NOT NULL DO NOTHING RETURNING id`,
          [farmerId, ownerUserId, outstandingAmount, periodStart, periodEnd, config.name,
            `Outstanding amount from configured manual deduction ${reference}.`, actorId,
            JSON.stringify({ configurationId, batchItemId: itemId, reference, chargeAmount, recoveredAmount }), debtRequestKey]
        );
        if (debtRows[0]) debtLedgerId = Number(debtRows[0].id);
        else {
          const existingDebt = await client.query('SELECT id FROM farmer_debt_ledgers WHERE owner_user_id = $1 AND request_key = $2', [ownerUserId, debtRequestKey]);
          debtLedgerId = Number(existingDebt.rows[0]?.id);
        }
        await client.query(
          `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
           VALUES ('farmer_debt_ledger', $1, 'created', $2::jsonb, $3, $4)`,
          [debtLedgerId, JSON.stringify({ farmerId, amount: outstandingAmount, configurationId, batchItemId: itemId, periodStart, periodEnd, reference }), actorId, ownerUserId]
        );
      }

      await client.query(
        'UPDATE deduction_batch_items SET deduction_id = $1, debt_ledger_id = $2 WHERE id = $3 AND owner_user_id = $4',
        [deductionId, debtLedgerId, itemId, ownerUserId]
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('deduction_batch_item', $1, 'applied', $2::jsonb, $3, $4)`,
        [itemId, JSON.stringify({ farmerId, configurationId, chargeAmount, recoveredAmount, outstandingAmount, periodStart, periodEnd, requestKey, reference }), actorId, ownerUserId]
      );
      results.succeeded.push({ farmerId: Number(farmerId), batchItemId: itemId, deductionId, debtLedgerId, chargeAmount, recoveredAmount, outstandingAmount, status });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const reason = error instanceof Error ? error.message : 'Deduction batch item failed.';
    const duplicateFarmerIds = new Set(results.duplicates.map((item) => item.farmerId));
    results.succeeded = [];
    results.failed = farmerIds
      .map(Number)
      .filter((farmerId) => !duplicateFarmerIds.has(farmerId))
      .map((farmerId) => ({ farmerId, reason: farmerId === currentFarmerId ? reason : 'The batch was rolled back because another farmer could not be processed.' }));
  } finally {
    client.release();
  }
  return results;
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

const buildFarmerPeriodLedgerQuery = ({ ownerUserId, collectorUserId = null, periodStart, periodEnd, configurationId = null, farmerStatus = 'ALL', search = '', cursor = null, limit = 100 }) => {
  const values = [Number(ownerUserId), periodStart, periodEnd, configurationId ? Number(configurationId) : null];
  const conditions = ['f.owner_user_id = $1'];
  const pageConditions = [];
  if (collectorUserId !== null && collectorUserId !== undefined) {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  if (search && String(search).trim()) {
    values.push(`%${String(search).trim()}%`);
    conditions.push(`(f.name ILIKE $${values.length} OR f.farmer_number::text ILIKE $${values.length} OR COALESCE(f.phone, '') ILIKE $${values.length} OR COALESCE(f.national_id, '') ILIKE $${values.length})`);
  }
  if (cursor) {
    values.push(Number(cursor));
    pageConditions.push(`farmer_id > $${values.length}::bigint`);
  }
  const statusConditions = {
    ALL: null,
    DEDUCTED: 'ledger_status = \'DEDUCTED\'',
    NOT_DEDUCTED: 'ledger_status = \'NOT_DEDUCTED\'',
    PARTIALLY_DEDUCTED: 'ledger_status = \'PARTIALLY_DEDUCTED\'',
    OUTSTANDING_DEBT: 'ledger_status = \'OUTSTANDING_DEBT\'',
  };
  if (statusConditions[farmerStatus]) pageConditions.push(statusConditions[farmerStatus]);
  values.push(Number(limit) + 1);
  return {
    text: `WITH farmer_ledger AS (
      SELECT f.id AS farmer_id, f.farmer_number, f.name AS farmer_name, f.phone,
        COALESCE(manual.manual_count, 0)::integer AS manual_deduction_count,
        COALESCE(manual.manual_amount, 0)::numeric(18,2) AS manual_deduction_amount,
        COALESCE(configured.configured_count, 0)::integer AS configured_deduction_count,
        COALESCE(configured.configured_amount, 0)::numeric(18,2) AS configured_deduction_amount,
        COALESCE(configured.configured_recovered, 0)::numeric(18,2) AS configured_recovered_amount,
        COALESCE(configured.configured_outstanding, 0)::numeric(18,2) AS configured_outstanding_amount,
        COALESCE(debt.previous_outstanding_amount, 0)::numeric(18,2) AS previous_debt_amount,
        COALESCE(debt.total_outstanding_amount, 0)::numeric(18,2) AS debt_outstanding_amount,
        COALESCE(debt.repaid_in_period, 0)::numeric(18,2) AS debt_repaid_in_period,
        COALESCE(configured.configured_period_start, $2::date) AS period_start,
        COALESCE(configured.configured_period_end, $3::date) AS period_end,
        (CASE WHEN $4::bigint IS NULL THEN COALESCE(manual.manual_amount, 0) + COALESCE(configured.configured_recovered, 0)
          ELSE COALESCE(configured.configured_recovered, 0) END)::numeric(18,2) AS deduction_amount,
        COALESCE(debt.repaid_in_period, 0)::numeric(18,2) AS recovered_amount,
        COALESCE(debt.total_outstanding_amount, 0)::numeric(18,2) AS remaining_balance
      FROM farmers f
      LEFT JOIN deduction_configurations selected_config ON selected_config.id = $4::bigint AND selected_config.owner_user_id = f.owner_user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS manual_count, COALESCE(SUM(d.amount), 0) AS manual_amount
        FROM deductions d
        WHERE d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id
          AND d.configuration_id IS NULL AND d.date BETWEEN $2::date AND $3::date
          AND d.status IN ('Active', 'Cleared')
      ) manual ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS configured_count,
          MIN(i.period_start) AS configured_period_start,
          MIN(i.period_end) AS configured_period_end,
          COALESCE(SUM(i.charge_amount), 0) AS configured_amount,
          COALESCE(SUM(i.recovered_amount), 0) AS configured_recovered,
          COALESCE(SUM(CASE WHEN debt.id IS NULL THEN 0 ELSE GREATEST(debt.opening_balance - COALESCE((
            SELECT SUM(r.amount) FROM farmer_debt_repayments r
            WHERE r.debt_ledger_id = debt.id AND r.owner_user_id = debt.owner_user_id
              AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date <= $3::date
          ), 0), 0) END), 0) AS configured_outstanding
        FROM deduction_batch_items i
        LEFT JOIN farmer_debt_ledgers debt ON debt.id = i.debt_ledger_id AND debt.owner_user_id = i.owner_user_id
        WHERE i.farmer_id = f.id AND i.owner_user_id = f.owner_user_id
          AND ($4::bigint IS NULL OR i.configuration_id = $4)
          AND (i.period_start = $2::date AND i.period_end = $3::date
            OR selected_config.frequency = 'ONE_TIME')
      ) configured ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          (SELECT COALESCE(SUM(GREATEST(d.opening_balance - COALESCE((
             SELECT SUM(r.amount) FROM farmer_debt_repayments r
             WHERE r.debt_ledger_id = d.id AND r.owner_user_id = d.owner_user_id
               AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date <= $3::date
           ), 0), 0)), 0) FROM farmer_debt_ledgers d
           WHERE d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id
             AND d.period_end <= $3::date) AS total_outstanding_amount,
          (SELECT COALESCE(SUM(GREATEST(d.opening_balance - COALESCE((
             SELECT SUM(r.amount) FROM farmer_debt_repayments r
             WHERE r.debt_ledger_id = d.id AND r.owner_user_id = d.owner_user_id
               AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date < $2::date
           ), 0), 0)), 0) FROM farmer_debt_ledgers d
           WHERE d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id
             AND d.period_end < $2::date) AS previous_outstanding_amount,
          (SELECT COALESCE(SUM(GREATEST(d.opening_balance - COALESCE((
             SELECT SUM(r.amount) FROM farmer_debt_repayments r
             WHERE r.debt_ledger_id = d.id AND r.owner_user_id = d.owner_user_id
               AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date <= $3::date
           ), 0), 0)), 0) FROM farmer_debt_ledgers d
           WHERE d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id
             AND NOT EXISTS (SELECT 1 FROM deduction_batch_items linked
               WHERE linked.debt_ledger_id = d.id AND linked.owner_user_id = d.owner_user_id)
             AND d.period_end <= $3::date) AS unlinked_outstanding_amount,
          (SELECT COALESCE(SUM(r.amount), 0) FROM farmer_debt_repayments r
           JOIN farmer_debt_ledgers d ON d.id = r.debt_ledger_id AND d.owner_user_id = r.owner_user_id
           WHERE d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id
             AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN $2::date AND $3::date) AS repaid_in_period
      ) debt ON TRUE
      WHERE ${conditions.join(' AND ')}
    ), classified AS (
      SELECT *, CASE
        WHEN $4::bigint IS NOT NULL AND configured_deduction_count = 0 THEN 'NOT_DEDUCTED'
        WHEN $4::bigint IS NOT NULL AND configured_outstanding_amount > 0 AND configured_recovered_amount > 0 THEN 'PARTIALLY_DEDUCTED'
        WHEN $4::bigint IS NOT NULL AND configured_deduction_count > 0 AND configured_outstanding_amount > 0 THEN 'OUTSTANDING_DEBT'
        WHEN $4::bigint IS NOT NULL AND configured_deduction_count > 0 THEN 'DEDUCTED'
        WHEN configured_deduction_count > 0 AND configured_outstanding_amount > 0 AND configured_recovered_amount > 0 THEN 'PARTIALLY_DEDUCTED'
        WHEN deduction_amount > 0 OR debt_repaid_in_period > 0 THEN 'DEDUCTED'
        WHEN debt_outstanding_amount > 0 THEN 'OUTSTANDING_DEBT'
        ELSE 'NOT_DEDUCTED'
      END AS ledger_status
      FROM farmer_ledger
    ), page AS (
      SELECT * FROM classified
      ${pageConditions.length ? `WHERE ${pageConditions.join(' AND ')}` : ''}
      ORDER BY farmer_id ASC
      LIMIT $${values.length}
    ), summary AS (
      SELECT COUNT(*)::integer AS farmers_listed,
        COUNT(*) FILTER (WHERE deduction_amount > 0 OR debt_repaid_in_period > 0)::integer AS farmers_with_deductions,
        COUNT(*) FILTER (WHERE deduction_amount <= 0 AND debt_repaid_in_period <= 0)::integer AS farmers_without_deductions,
        COALESCE(SUM(deduction_amount), 0)::numeric(18,2) AS total_new_deductions,
        COALESCE(SUM(previous_debt_amount), 0)::numeric(18,2) AS previous_outstanding_debt,
        COALESCE(SUM(debt_repaid_in_period), 0)::numeric(18,2) AS debt_recovered,
        COALESCE(SUM(remaining_balance), 0)::numeric(18,2) AS remaining_debt
      FROM classified
    )
    SELECT page.*, summary.* FROM summary LEFT JOIN page ON TRUE ORDER BY page.farmer_id ASC`,
    values,
  };
};

const listFarmerPeriodLedger = async (filters, runQuery = query) => {
  const ownerUserId = Number(filters.ownerUserId);
  const collectorUserId = filters.collectorUserId !== undefined && filters.collectorUserId !== null ? Number(filters.collectorUserId) : null;
  const scope = await resolveDeductionScope({ ownerUserId, collectorUserId, client: { query: runQuery } });
  const resolvedFilters = { ...filters, ownerUserId: scope.ownerUserId, collectorUserId: scope.collectorUserId };
  const { text, values } = buildFarmerPeriodLedgerQuery(resolvedFilters);
  const { rows } = await runQuery(text, values);
  const pageSize = Number(resolvedFilters.limit || 100);
  const pageRows = rows.filter((row) => row.farmer_id !== null);
  const hasMore = pageRows.length > pageSize;
  const data = (hasMore ? pageRows.slice(0, pageSize) : pageRows).map((row) => ({
    farmerId: Number(row.farmer_id),
    farmerNumber: row.farmer_number === null ? null : Number(row.farmer_number),
    farmerName: row.farmer_name,
    phone: row.phone,
    periodStart: row.period_start instanceof Date ? row.period_start.toISOString().slice(0, 10) : String(row.period_start).slice(0, 10),
    periodEnd: row.period_end instanceof Date ? row.period_end.toISOString().slice(0, 10) : String(row.period_end).slice(0, 10),
    deductionAmount: Number(row.deduction_amount || 0),
    recoveredAmount: Number(row.recovered_amount || 0),
    remainingBalance: Number(row.remaining_balance || 0),
    previousDebt: Number(row.previous_debt_amount || 0),
    configuredDeductionCount: Number(row.configured_deduction_count || 0),
    outstandingDebt: Number(row.debt_outstanding_amount || 0),
    debtRepaidInPeriod: Number(row.debt_repaid_in_period || 0),
    status: row.ledger_status,
  }));
  const summaryRow = rows[0] || {};
  const summary = {
    farmersListed: Number(summaryRow.farmers_listed || 0),
    farmersWithDeductions: Number(summaryRow.farmers_with_deductions || 0),
    farmersWithoutDeductions: Number(summaryRow.farmers_without_deductions || 0),
    totalNewDeductions: Number(summaryRow.total_new_deductions || 0),
    previousOutstandingDebt: Number(summaryRow.previous_outstanding_debt || 0),
    debtRecovered: Number(summaryRow.debt_recovered || 0),
    remainingDebt: Number(summaryRow.remaining_debt || 0),
  };
  const last = data[data.length - 1];
  return { data, hasMore, pageSize, nextCursor: hasMore && last ? String(last.farmerId) : null, summary };
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
  buildFarmerPeriodLedgerQuery,
  mapDeductionConfiguration,
  createDeduction,
  listDeductions,
  listFarmerDeductionGroups,
  listFarmerPeriodLedger,
  listDeductionConfigurations,
  createDeductionConfiguration,
  updateDeductionConfiguration,
  applyDeductionBatch,
  getDeduction,
  updateDeduction,
  deleteDeduction,
};
