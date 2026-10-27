const { query, getPool } = require('../postgres.js');
const { parseFarmerNumber } = require('../farmer-delivery.js');

const farmerFields = `
  id, name, owner_user_id, location, phone,
  farmer_number::integer AS "farmerNumber",
  national_id AS "nationalId", account_number AS "accountNumber",
  cow_type AS "cowType", collection_center AS "collectionCenter",
  collector_user_id AS "collectorUserId", created_at, updated_at
`;

const centerFields = `
  id, name, owner_user_id,
  price_per_liter AS "pricePerLiter",
  transport_rate_per_liter AS "transportRatePerLiter",
  morning_start, morning_end, evening_start, evening_end,
  created_at, updated_at
`;

const writeAudit = async (client, { entityType, entityId, action, details, actorId, ownerUserId }) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [entityType, entityId, action, JSON.stringify(details || {}), actorId, ownerUserId]
  );
};

const getAccount = async (ownerUserId, client = { query }) => {
  const { rows } = await client.query(
    'SELECT id, email, role, account_type, account_status FROM users WHERE id = $1',
    [ownerUserId]
  );
  return rows[0] || null;
};

const getOwnedCenterByName = async (name, ownerUserId, client = { query }) => {
  const { rows } = await client.query(
    `SELECT ${centerFields} FROM collection_centers
     WHERE owner_user_id = $1 AND LOWER(BTRIM(name)) = LOWER(BTRIM($2))
     ORDER BY id ASC LIMIT 1`,
    [ownerUserId, name]
  );
  return rows[0] || null;
};

const getCollectorAccessibleCenter = async (id, collectorUserId, client = { query }) => {
  const { rows } = await client.query(
    `SELECT ${centerFields} FROM collection_centers
     WHERE id = $1 AND (
       owner_user_id = $2 OR EXISTS (
         SELECT 1 FROM collector_assignments ca
         WHERE ca.dairy_user_id = collection_centers.owner_user_id
           AND ca.collector_user_id = $2 AND ca.revoked_at IS NULL
       )
     ) LIMIT 1`,
    [id, collectorUserId]
  );
  return rows[0] || null;
};

const getCollectorAccessibleCenterByName = async (name, collectorUserId, client = { query }) => {
  const { rows } = await client.query(
    `SELECT ${centerFields} FROM collection_centers
     WHERE LOWER(BTRIM(name)) = LOWER(BTRIM($1)) AND (
       owner_user_id = $2 OR EXISTS (
         SELECT 1 FROM collector_assignments ca
         WHERE ca.dairy_user_id = collection_centers.owner_user_id
           AND ca.collector_user_id = $2 AND ca.revoked_at IS NULL
       )
     ) ORDER BY id ASC LIMIT 1`,
    [name, collectorUserId]
  );
  return rows[0] || null;
};

const getDefaultCenter = async (ownerUserId, client = { query }) => {
  const { rows } = await client.query(
    `SELECT ${centerFields} FROM collection_centers
     WHERE owner_user_id = $1 ORDER BY name ASC, id ASC LIMIT 1`,
    [ownerUserId]
  );
  return rows[0] || null;
};

const resolveCollectorScope = async ({ collectorUserId, ownerUserId = null, client = { query } }) => {
  const id = Number(collectorUserId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ownerUserId: ownerUserId === null || ownerUserId === undefined ? null : Number(ownerUserId), collectorUserId: null, dairyUserId: null };
  }
  const { rows } = await client.query(
    `SELECT dairy_user_id FROM collector_assignments WHERE collector_user_id = $1 AND revoked_at IS NULL ORDER BY dairy_user_id ASC LIMIT 1`,
    [id]
  );
  const dairyUserId = rows[0] ? Number(rows[0].dairy_user_id) : null;
  return {
    ownerUserId: dairyUserId !== null ? Number(dairyUserId) : (ownerUserId === null || ownerUserId === undefined ? null : Number(ownerUserId)),
    collectorUserId: id,
    dairyUserId,
  };
};

const resolveFarmerContext = async ({ ownerUserId, requestedCenter, collectionCenterId, collectorUserId, requireCollectorCenter = false, client = { query } }) => {
  const account = await getAccount(ownerUserId, client);
  if (!account || account.account_status === 'suspended') {
    const error = new Error('Account is unavailable.');
    error.code = 'ACCOUNT_UNAVAILABLE';
    throw error;
  }

  let center = null;
  const centerIdValue = collectionCenterId === undefined || collectionCenterId === null || collectionCenterId === '' ? null : Number(collectionCenterId);
  if (centerIdValue !== null) {
    if (!Number.isSafeInteger(centerIdValue) || centerIdValue <= 0) {
      const error = new Error('A valid collection center is required.');
      error.code = 'INVALID_COLLECTION_CENTER';
      throw error;
    }
    center = await getCenter(centerIdValue, ownerUserId, client);
    if (!center) {
      const error = new Error('Collection center belongs to a different user or is not configured.');
      error.code = 'COLLECTION_CENTER_ORGANIZATION_MISMATCH';
      throw error;
    }
  } else if (account.account_type === 'COLLECTION_CENTER') {
    center = await getDefaultCenter(ownerUserId, client);
  } else if (requestedCenter) {
    center = await getOwnedCenterByName(requestedCenter, ownerUserId, client);
    if (!center) {
      const error = new Error('Collection center belongs to a different user or is not configured.');
      error.code = 'COLLECTION_CENTER_ORGANIZATION_MISMATCH';
      throw error;
    }
  }

  if (requireCollectorCenter && account.account_type === 'COLLECTOR' && !center) {
    throw Object.assign(new Error('Choose an Ikigo for this farmer.'), {
      statusCode: 400,
      code: 'COLLECTION_CENTER_REQUIRED',
    });
  }

  if (account.account_type === 'COLLECTION_CENTER' && collectorUserId !== undefined && collectorUserId !== null && collectorUserId !== '') {
    const id = Number(collectorUserId);
    const { rows: collectors } = await client.query(
      `SELECT u.id, u.account_type, u.account_status
       FROM users u
       JOIN collector_assignments ca ON ca.collector_user_id = u.id
      WHERE u.id = $1 AND ca.dairy_user_id = $2 AND ca.revoked_at IS NULL`,
      [id, ownerUserId]
    );
    const linked = collectors[0];
    if (!linked || linked.account_type !== 'COLLECTOR' || linked.account_status === 'suspended') {
      const error = new Error('That collector is not linked to this collection center. Assign the collector first.');
      error.code = 'COLLECTOR_NOT_ASSIGNED_TO_DAIRY';
      throw error;
    }
    collectorUserId = id;
  }

  return {
    collectionCenter: center?.name || (account.account_type === 'COLLECTION_CENTER' ? null : requestedCenter || null),
    collectorUserId: account.account_type === 'COLLECTION_CENTER' ? (collectorUserId || null) : null,
  };
};

const buildFarmerListQuery = ({ ownerUserId, search, center, cursor, limit, collectorUserId = null, linkedOwnerUserId = null, sortBy = 'id', sortDirection = 'desc' }) => {
  const values = [ownerUserId];
  const sortColumns = { name: 'name', nationalId: 'national_id', collectionCenter: 'collection_center' };
  const sortColumn = sortColumns[sortBy];
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  const sortExpression = sortColumn ? `LOWER(BTRIM(COALESCE(${sortColumn}, '')))` : 'id';
  const filters = linkedOwnerUserId
    ? ['(owner_user_id = $1 OR (owner_user_id = $2 AND collector_user_id = $3))']
    : ['owner_user_id = $1'];
  if (linkedOwnerUserId) {
    values.push(Number(linkedOwnerUserId), Number(collectorUserId));
  } else if (collectorUserId) {
    values.push(Number(collectorUserId));
    filters.push(`collector_user_id = $${values.length}`);
  }
  if (center) {
    values.push(center);
    filters.push(`LOWER(BTRIM(collection_center)) = LOWER(BTRIM($${values.length}))`);
  }
  if (search) {
    const searchConditions = [];
    const numericFarmerNumber = parseFarmerNumber(search);
    if (numericFarmerNumber !== null) {
      values.push(numericFarmerNumber);
      searchConditions.push(`farmer_number = $${values.length}`);
    }
    values.push(`%${search}%`);
    const slot = `$${values.length}`;
    searchConditions.push(`(name ILIKE ${slot} OR phone ILIKE ${slot} OR national_id ILIKE ${slot} OR account_number ILIKE ${slot} OR location ILIKE ${slot} OR farmer_number::text ILIKE ${slot})`);
    filters.push(`(${searchConditions.join(' OR ')})`);
  }
  if (cursor && sortColumn) {
    values.push(String(cursor.value).trim().toLowerCase(), Number(cursor.id));
    const valueSlot = `$${values.length - 1}`;
    const idSlot = `$${values.length}`;
    const operator = sortDirection === 'asc' ? '>' : '<';
    filters.push(`(${sortExpression} ${operator} ${valueSlot} OR (${sortExpression} = ${valueSlot} AND id > ${idSlot}))`);
  } else if (cursor) {
    values.push(cursor);
    filters.push(`id ${sortDirection === 'asc' ? '>' : '<'} $${values.length}`);
  }

  values.push(limit + 1);
  return {
    text: `SELECT ${farmerFields} FROM farmers WHERE ${filters.join(' AND ')} ORDER BY ${sortExpression} ${direction}${sortColumn ? ', id ASC' : ''} LIMIT $${values.length}`,
    values,
  };
};

/**
 * Count farmers over the same authorized scope used by listFarmers.
 * Used to report an honest "existing farmers" count during import instead of
 * a capped client-side loaded length.
 */
const countFarmers = async ({ ownerUserId, collectorUserId, center, search }, runQuery = query) => {
  if (!Number.isInteger(Number(ownerUserId)) || Number(ownerUserId) <= 0) throw new Error('Not authenticated.');
  const effectiveOwnerUserId = Number(ownerUserId);
  let linkedOwnerUserId = null;
  let collectorUserIdResolved = null;
  const filters = ['owner_user_id = $1'];
  const values = [effectiveOwnerUserId];

  const normalizedCollector = normalizeCollectorScopeParam(collectorUserId);
  if (normalizedCollector !== null) {
    const scope = await resolveCollectorScope({ collectorUserId: normalizedCollector, ownerUserId: effectiveOwnerUserId, client: { query: runQuery } });
    if (!scope.dairyUserId) {
      if (normalizedCollector !== effectiveOwnerUserId) {
        throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
      }
    } else if (scope.dairyUserId !== effectiveOwnerUserId && normalizedCollector !== effectiveOwnerUserId) {
      throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
    } else if (normalizedCollector === effectiveOwnerUserId) {
      linkedOwnerUserId = Number(scope.dairyUserId);
      collectorUserIdResolved = normalizedCollector;
    } else {
      collectorUserIdResolved = normalizedCollector;
    }
  }

  if (linkedOwnerUserId) {
    filters[0] = '(owner_user_id = $1 OR (owner_user_id = $2 AND collector_user_id = $3))';
    values.push(Number(linkedOwnerUserId), Number(collectorUserIdResolved));
  } else if (collectorUserIdResolved) {
    filters.push(`collector_user_id = $${values.length + 1}`);
    values.push(collectorUserIdResolved);
  }
  if (center) {
    values.push(center);
    filters.push(`LOWER(BTRIM(collection_center)) = LOWER(BTRIM($${values.length}))`);
  }
  if (search) {
    values.push(`%${search}%`);
    const slot = `$${values.length}`;
    filters.push(`(name ILIKE ${slot} OR phone ILIKE ${slot} OR national_id ILIKE ${slot} OR account_number ILIKE ${slot} OR location ILIKE ${slot})`);
  }

  const { rows } = await runQuery(
    `SELECT COUNT(*)::int AS count FROM farmers WHERE ${filters.join(' AND ')}`,
    values,
  );
  return Number(rows[0]?.count || 0);
};

const normalizeCollectorScopeParam = (collectorUserId) => {
  if (collectorUserId === undefined || collectorUserId === null || collectorUserId === '') return null;
  const id = Number(collectorUserId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
};

const listFarmers = async (filters, runQuery = query) => {
  const collectorUserId = filters.collectorUserId ? Number(filters.collectorUserId) : null;
  let ownerUserId = Number(filters.ownerUserId);
  let linkedOwnerUserId = null;
  if (collectorUserId) {
    const scope = await resolveCollectorScope({ collectorUserId, ownerUserId, client: { query: runQuery } });
    if (!scope.dairyUserId) {
      if (collectorUserId !== Number(filters.ownerUserId)) {
        throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
      }
    } else if (scope.dairyUserId !== Number(filters.ownerUserId) && collectorUserId !== Number(filters.ownerUserId)) {
      throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
    } else if (collectorUserId === Number(filters.ownerUserId)) {
      linkedOwnerUserId = Number(scope.dairyUserId);
    } else {
      ownerUserId = Number(scope.ownerUserId);
    }
  }
  const { text, values } = buildFarmerListQuery({
    ...filters,
    ownerUserId,
    collectorUserId: linkedOwnerUserId ? collectorUserId : (collectorUserId === Number(filters.ownerUserId) ? null : collectorUserId),
    linkedOwnerUserId,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
  });
  const { rows } = await runQuery(text, values);
  const limit = filters.limit;
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = data[data.length - 1];
  const sortKey = filters.sortBy === 'name' || filters.sortBy === 'nationalId' || filters.sortBy === 'collectionCenter'
    ? filters.sortBy
    : null;
  const nextCursor = hasMore && lastRow
    ? sortKey
      ? `s1.${Buffer.from(JSON.stringify({ sortBy: filters.sortBy, sortDirection: filters.sortDirection, value: String(lastRow[sortKey] || ''), id: Number(lastRow.id) }), 'utf8').toString('base64url')}`
      : String(lastRow.id)
    : null;
  return {
    data,
    pageSize: limit,
    nextCursor,
    hasMore,
  };
};

const getFarmer = async (id, ownerUserId, client = { query }) => {
  const { rows } = await client.query(
    `SELECT ${farmerFields} FROM farmers WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [id, ownerUserId]
  );
  return rows[0] || null;
};

const createFarmer = async ({ input, ownerUserId, actorId, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestedCenter = input.collectionCenter || input.collection_center || null;
    const context = await resolveFarmerContext({
      ownerUserId,
      requestedCenter,
      collectionCenterId: input.collectionCenterId ?? input.collection_center_id ?? null,
      collectorUserId: input.collectorUserId,
      requireCollectorCenter: true,
      client,
    });
    const { rows } = await client.query(
      `INSERT INTO farmers (name, phone, national_id, account_number, location, collection_center, cow_type, owner_user_id, collector_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${farmerFields}`,
      [input.name.trim(), input.phone || null, input.nationalId || null, input.accountNumber || null, null, context.collectionCenter, input.cowType || null, ownerUserId, context.collectorUserId]
    );
    const farmer = rows[0];
    await writeAudit(client, {
      entityType: 'farmer', entityId: farmer.id, action: 'created', actorId, ownerUserId,
      details: farmerSummary(farmer),
    });
    await client.query('COMMIT');
    return farmer;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const mapImportRowError = (error) => {
  if (error?.code === '23505') {
    const constraint = String(error.constraint || '');
    if (constraint.includes('national_id')) {
      return { errorCode: 'DUPLICATE_NATIONAL_ID', message: 'This national ID is already in use.' };
    }
    if (constraint.includes('account_number')) {
      return { errorCode: 'DUPLICATE_ACCOUNT_NUMBER', message: 'This account number is already in use.' };
    }
    if (constraint.includes('farmers_owner_name')) {
      return { errorCode: 'DUPLICATE_NAME', message: 'A farmer with this name already exists for this account.' };
    }
    return { errorCode: 'DUPLICATE_FARMER', message: 'A farmer with these details already exists.' };
  }
  if (error?.code === '23503') {
    return { errorCode: 'CENTER_OR_COLLECTOR_UNAVAILABLE', message: 'The selected center or collector is no longer available.' };
  }
  if (error?.code === '23502' || error?.code === '23514' || error?.code === '22P02') {
    return { errorCode: 'INVALID_ROW', message: 'This row contains an invalid value.' };
  }
  if (error?.code === 'COLLECTION_CENTER_REQUIRED') {
    return { errorCode: 'COLLECTION_CENTER_REQUIRED', message: 'Choose a collection center for this farmer.' };
  }
  if (error?.code === 'COLLECTION_CENTER_ORGANIZATION_MISMATCH') {
    return { errorCode: 'CENTER_NOT_ALLOWED', message: 'That collection center does not belong to this account.' };
  }
  if (error?.code === 'COLLECTOR_NOT_ASSIGNED_TO_DAIRY') {
    return { errorCode: 'COLLECTOR_NOT_ASSIGNED', message: 'That collector is no longer linked to this account.' };
  }
  if (error?.code === 'ACCOUNT_UNAVAILABLE') {
    return { errorCode: 'ACCOUNT_UNAVAILABLE', message: 'This account is not available.' };
  }
  if (String(error?.code || '').startsWith('08')) {
    return { errorCode: 'DATABASE_UNAVAILABLE', message: 'The database was unavailable while saving this row.' };
  }
  return { errorCode: error?.code || 'IMPORT_ROW_FAILED', message: 'This farmer could not be created.' };
};

/**
 * Create a reviewed batch of farmers in one transaction. Every row gets its own
 * savepoint so a duplicate or invalid row cannot block valid rows. The import
 * ledger row is written in the same transaction, making retries idempotent.
 */
const createFarmersBatch = async ({ rows, ownerUserId, actorId, batchKey, dryRun = false, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batchInsert = await client.query(
      `INSERT INTO import_batches (owner_user_id, batch_key, kind, status, summary)
       VALUES ($1, $2, 'farmers', 'processing', '{}'::jsonb)
       ON CONFLICT (owner_user_id, batch_key) DO NOTHING
       RETURNING id`,
      [Number(ownerUserId), batchKey]
    );

    if (!batchInsert.rows[0]) {
      const { rows: existingRows } = await client.query(
        `SELECT id, status, summary FROM import_batches
         WHERE owner_user_id = $1 AND batch_key = $2 LIMIT 1`,
        [Number(ownerUserId), batchKey]
      );
      const existing = existingRows[0];
      if (!existing) throw Object.assign(new Error('The import batch could not be reserved.'), { statusCode: 409, code: 'IMPORT_BATCH_CONFLICT' });
      if (existing.status !== 'completed') {
        throw Object.assign(new Error('This import is already being processed. Wait a moment and retry.'), {
          statusCode: 409,
          code: 'IMPORT_BATCH_IN_PROGRESS',
        });
      }
      await client.query('COMMIT');
      return {
        batchId: existing.id,
        idempotent: true,
        dryRun: false,
        ...(existing.summary || {}),
      };
    }

    const batchId = batchInsert.rows[0].id;
    const results = [];
    let createdCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      const rowNumber = Number(row.rowNumber);
      if (row.error) {
        failedCount += 1;
        results.push({
          rowNumber,
          status: 'failed',
          errorCode: row.errorCode || 'VALIDATION_ERROR',
          message: row.message || 'This row is invalid.',
        });
        continue;
      }
      await client.query('SAVEPOINT import_row');
      try {
        const input = row.input;
        const context = await resolveFarmerContext({
          ownerUserId: Number(ownerUserId),
          requestedCenter: input.collectionCenter || input.collection_center || null,
          collectionCenterId: input.collectionCenterId ?? input.collection_center_id ?? null,
          collectorUserId: input.collectorUserId,
          requireCollectorCenter: true,
          client,
        });
        const { rows: farmerRows } = await client.query(
          `INSERT INTO farmers (name, phone, national_id, account_number, location, collection_center, cow_type, owner_user_id, collector_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name`,
          [
            input.name.trim(),
            input.phone || null,
            input.nationalId || null,
            input.accountNumber || null,
            null,
            context.collectionCenter,
            input.cowType || null,
            Number(ownerUserId),
            context.collectorUserId,
          ]
        );
        const created = farmerRows[0];
        await writeAudit(client, {
          entityType: 'farmer',
          entityId: created.id,
          action: 'created',
          actorId: Number(actorId),
          ownerUserId: Number(ownerUserId),
          details: {
            name: created.name,
            phone: input.phone || null,
            nationalId: input.nationalId || null,
            accountNumber: input.accountNumber || null,
            cowType: input.cowType || null,
            collectionCenter: context.collectionCenter,
            collectorUserId: context.collectorUserId ?? null,
            source: 'bulk_import',
            importBatchId: batchId,
          },
        });
        await client.query('RELEASE SAVEPOINT import_row');
        createdCount += 1;
        results.push({ rowNumber, status: 'created', farmerId: created.id });
      } catch (rowError) {
        await client.query('ROLLBACK TO SAVEPOINT import_row');
        await client.query('RELEASE SAVEPOINT import_row');
        failedCount += 1;
        const mapped = mapImportRowError(rowError);
        results.push({ rowNumber, status: 'failed', ...mapped });
      }
    }

    const summary = {
      total: rows.length,
      created: createdCount,
      failed: failedCount,
      rows: results,
    };
    await client.query(
      `UPDATE import_batches SET status = 'completed', summary = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(summary), batchId]
    );

    if (dryRun) {
      await client.query('ROLLBACK');
      return { batchId: null, idempotent: false, dryRun: true, ...summary };
    }
    await client.query('COMMIT');
    return { batchId, idempotent: false, dryRun: false, ...summary };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};


const farmerSummary = (farmer) => ({
  name: farmer.name,
  location: farmer.location,
  phone: farmer.phone,
  nationalId: farmer.nationalId,
  accountNumber: farmer.accountNumber,
  cowType: farmer.cowType,
  collectionCenter: farmer.collectionCenter,
  collectorUserId: farmer.collectorUserId ?? null,
});

const updateFarmer = async ({ id, input, ownerUserId, actorId, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await getFarmer(id, ownerUserId, client);
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    const account = await getAccount(ownerUserId, client);
    const hasSiteSelection = Object.prototype.hasOwnProperty.call(input, 'collectionCenterId')
      || Object.prototype.hasOwnProperty.call(input, 'collection_center_id');
    const requestedCenter = hasSiteSelection
      ? input.collectionCenter || input.collection_center || null
      : input.collectionCenter || input.collection_center || existing.collectionCenter || null;
    const context = await resolveFarmerContext({
      ownerUserId,
      requestedCenter: account.account_type === 'COLLECTION_CENTER' ? null : requestedCenter,
      collectionCenterId: input.collectionCenterId ?? input.collection_center_id ?? null,
      collectorUserId: input.collectorUserId,
      client,
    });
    const { rows } = await client.query(
      `UPDATE farmers SET name = $1, location = $2, phone = $3, national_id = $4,
       account_number = $5, cow_type = $6, collection_center = $7,
       collector_user_id = CASE WHEN $8::boolean THEN $9 ELSE collector_user_id END,
       updated_at = NOW()
       WHERE id = $10 AND owner_user_id = $11 RETURNING ${farmerFields}`,
      [input.name, input.location, input.phone, input.nationalId, input.accountNumber, input.cowType, context.collectionCenter, input.collectorUserId !== undefined, context.collectorUserId, id, ownerUserId]
    );
    const updated = rows[0] || null;
    if (updated) {
      await writeAudit(client, {
        entityType: 'farmer', entityId: id, action: 'updated', actorId, ownerUserId,
        details: { before: farmerSummary(existing), after: farmerSummary(updated) },
      });
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

const deleteFarmer = async ({ id, ownerUserId, actorId, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await getFarmer(id, ownerUserId, client);
    if (!existing) {
      await client.query('ROLLBACK');
      return false;
    }
    const { rows: historyRows } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM milk_records WHERE farmer_id = $1 AND owner_user_id = $2)
         OR EXISTS (SELECT 1 FROM deductions WHERE farmer_id = $1 AND owner_user_id = $2)
         OR EXISTS (SELECT 1 FROM farmer_payments WHERE farmer_id = $1 AND owner_user_id = $2)
       AS has_historical_records`,
      [id, ownerUserId]
    );
    if (historyRows[0]?.has_historical_records) {
      throw Object.assign(new Error('This farmer has historical business records and cannot be deleted.'), {
        statusCode: 409,
        code: 'FARMER_HAS_HISTORY',
      });
    }
    await writeAudit(client, {
      entityType: 'farmer', entityId: id, action: 'deleted', actorId, ownerUserId,
      details: farmerSummary(existing),
    });
    await client.query('DELETE FROM farmers WHERE id = $1 AND owner_user_id = $2', [id, ownerUserId]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const listCenters = async (ownerUserId) => {
  const { rows } = await query(
    `SELECT ${centerFields} FROM collection_centers WHERE owner_user_id = $1 ORDER BY name ASC, id ASC`,
    [ownerUserId]
  );
  return rows;
};

const listCollectorCenters = async (collectorUserId, runQuery = query) => {
  const { rows } = await runQuery(
    `SELECT ${centerFields} FROM collection_centers
     WHERE owner_user_id = $1 OR EXISTS (
       SELECT 1 FROM collector_assignments ca
       WHERE ca.dairy_user_id = collection_centers.owner_user_id
         AND ca.collector_user_id = $1 AND ca.revoked_at IS NULL
     )
     ORDER BY name ASC, id ASC`,
    [collectorUserId]
  );
  return rows;
};

const createCenter = async ({ ownerUserId, actorId, input, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO collection_centers (name, owner_user_id, price_per_liter, transport_rate_per_liter,
       morning_start, morning_end, evening_start, evening_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${centerFields}`,
      [input.name, ownerUserId, input.pricePerLiter, input.transportRatePerLiter, input.morningStart, input.morningEnd, input.eveningStart, input.eveningEnd]
    );
    const center = rows[0];
    await writeAudit(client, {
      entityType: 'collection_center', entityId: center.id, action: 'created', actorId, ownerUserId,
      details: { name: center.name },
    });
    await client.query('COMMIT');
    return center;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getCenter = async (id, ownerUserId, client = { query }) => {
  const { rows } = await client.query(
    `SELECT ${centerFields} FROM collection_centers WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [id, ownerUserId]
  );
  return rows[0] || null;
};

const updateCenter = async ({ id, ownerUserId, actorId, input, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await getCenter(id, ownerUserId, client);
    if (!before) {
      await client.query('ROLLBACK');
      return null;
    }
    const fields = {
      name: 'name',
      pricePerLiter: 'price_per_liter',
      transportRatePerLiter: 'transport_rate_per_liter',
      morningStart: 'morning_start',
      morningEnd: 'morning_end',
      eveningStart: 'evening_start',
      eveningEnd: 'evening_end',
    };
    const assignments = [];
    const values = [];
    for (const [key, column] of Object.entries(fields)) {
      if (input[key] !== undefined) {
        values.push(input[key]);
        assignments.push(`${column} = $${values.length}`);
      }
    }
    values.push(id, ownerUserId);
    const { rows } = await client.query(
      `UPDATE collection_centers SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND owner_user_id = $${values.length} RETURNING ${centerFields}`,
      values
    );
    const center = rows[0] || null;
    if (center) {
      if (input.name !== undefined && before.name !== center.name) {
        await client.query(
          `UPDATE farmers SET collection_center = $1, updated_at = NOW()
           WHERE owner_user_id = $2 AND LOWER(BTRIM(collection_center)) = LOWER(BTRIM($3))`,
          [center.name, ownerUserId, before.name]
        );
      }
      await writeAudit(client, {
        entityType: 'collection_center', entityId: id, action: 'updated', actorId, ownerUserId,
        details: input,
      });
    }
    await client.query('COMMIT');
    return center;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const addCenterPrice = async ({ ownerUserId, actorId, input }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const center = await getCenter(input.collectionCenterId, ownerUserId, client);
    if (!center) return await client.query('ROLLBACK').then(() => null);
    const { rows } = await client.query(
      `INSERT INTO collection_center_prices (collection_center_id, price_per_liter, effective_date, owner_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id, collection_center_id AS "collectionCenterId", price_per_liter AS "pricePerLiter", effective_date AS "effectiveDate"`,
      [center.id, input.pricePerLiter, input.effectiveDate, ownerUserId]
    );
    const price = rows[0];
    await writeAudit(client, {
      entityType: 'collection_center_price', entityId: price.id, action: 'added', actorId, ownerUserId,
      details: { center: center.name, pricePerLiter: input.pricePerLiter, effectiveDate: input.effectiveDate },
    });
    await client.query('COMMIT');
    return price;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const listCenterPrices = async (ownerUserId) => {
  const { rows } = await query(
    `SELECT p.id, p.collection_center_id AS "collectionCenterId", p.price_per_liter AS "pricePerLiter",
       p.effective_date AS "effectiveDate", p.owner_user_id AS "ownerUserId", c.name AS "collectionCenterName"
     FROM collection_center_prices p
     JOIN collection_centers c ON c.id = p.collection_center_id AND c.owner_user_id = p.owner_user_id
     WHERE p.owner_user_id = $1 ORDER BY p.effective_date DESC, p.id DESC`,
    [ownerUserId]
  );
  return rows;
};

const listFarmerFieldConfigurations = async (ownerUserId, runQuery = query) => {
  if (!Number.isInteger(Number(ownerUserId)) || Number(ownerUserId) <= 0) throw new Error('Not authenticated.');
  const { rows } = await runQuery(
    `SELECT field_key, enabled, required, sort_order
     FROM public.farmer_field_configurations
     WHERE owner_user_id = $1
     ORDER BY sort_order ASC, field_key ASC`,
    [Number(ownerUserId)],
  );
  return rows;
};

const upsertFarmerFieldConfiguration = async ({ ownerUserId, fieldKey, enabled, required, sortOrder }, runQuery = query) => {
  if (!Number.isInteger(Number(ownerUserId)) || Number(ownerUserId) <= 0) throw new Error('Not authenticated.');
  const { rows } = await runQuery(
    `INSERT INTO public.farmer_field_configurations (owner_user_id, field_key, enabled, required, sort_order, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (owner_user_id, field_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, required = EXCLUDED.required, sort_order = EXCLUDED.sort_order, updated_at = NOW()
     RETURNING field_key, enabled, required, sort_order`,
    [Number(ownerUserId), fieldKey, Boolean(enabled), Boolean(required), Number(sortOrder || 0)],
  );
  return rows[0] || null;
};

module.exports = {
  getAccount,
  countFarmers,
  listFarmerFieldConfigurations,
  upsertFarmerFieldConfiguration,
  getOwnedCenterByName,
  getCollectorAccessibleCenter,
  getDefaultCenter,
  resolveFarmerContext,
  resolveCollectorScope,
  buildFarmerListQuery,
  listFarmers,
  getFarmer,
  createFarmer,
  createFarmersBatch,
  updateFarmer,
  deleteFarmer,
  listCenters,
  listCollectorCenters,
  createCenter,
  getCenter,
  updateCenter,
  addCenterPrice,
  listCenterPrices,
};
