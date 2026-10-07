const { query, getPool } = require('../postgres.js');

const farmerFields = `
  id, name, owner_user_id, location, phone,
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
           AND ca.collector_user_id = $2
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
           AND ca.collector_user_id = $2
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
    `SELECT dairy_user_id FROM collector_assignments WHERE collector_user_id = $1 ORDER BY dairy_user_id ASC LIMIT 1`,
    [id]
  );
  const dairyUserId = rows[0] ? Number(rows[0].dairy_user_id) : null;
  return {
    ownerUserId: dairyUserId !== null ? Number(dairyUserId) : (ownerUserId === null || ownerUserId === undefined ? null : Number(ownerUserId)),
    collectorUserId: id,
    dairyUserId,
  };
};

const resolveFarmerContext = async ({ ownerUserId, requestedCenter, collectionCenterId, collectorUserId, client = { query } }) => {
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
    center = account.account_type === 'COLLECTOR'
      ? await getCollectorAccessibleCenter(centerIdValue, ownerUserId, client)
      : await getCenter(centerIdValue, ownerUserId, client);
    if (!center) {
      const error = new Error('Collection center belongs to a different user or is not configured.');
      error.code = 'COLLECTION_CENTER_ORGANIZATION_MISMATCH';
      throw error;
    }
  } else if (account.account_type === 'COLLECTION_CENTER') {
    center = await getDefaultCenter(ownerUserId, client);
  } else if (requestedCenter) {
    center = account.account_type === 'COLLECTOR'
      ? await getCollectorAccessibleCenterByName(requestedCenter, ownerUserId, client)
      : await getOwnedCenterByName(requestedCenter, ownerUserId, client);
    if (!center) {
      const error = new Error('Collection center belongs to a different user or is not configured.');
      error.code = 'COLLECTION_CENTER_ORGANIZATION_MISMATCH';
      throw error;
    }
  }

  if (account.account_type === 'COLLECTION_CENTER' && collectorUserId !== undefined && collectorUserId !== null && collectorUserId !== '') {
    const id = Number(collectorUserId);
    const { rows: collectors } = await client.query(
      `SELECT u.id, u.account_type, u.account_status
       FROM users u
       JOIN collector_assignments ca ON ca.collector_user_id = u.id
       WHERE u.id = $1 AND ca.dairy_user_id = $2`,
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

const buildFarmerListQuery = ({ ownerUserId, search, center, cursor, limit, collectorUserId = null, linkedOwnerUserId = null }) => {
  const values = [ownerUserId];
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
    values.push(`%${search}%`);
    const slot = `$${values.length}`;
    filters.push(`(name ILIKE ${slot} OR phone ILIKE ${slot} OR national_id ILIKE ${slot} OR account_number ILIKE ${slot} OR location ILIKE ${slot})`);
  }
  if (cursor) {
    values.push(cursor);
    filters.push(`id < $${values.length}`);
  }

  values.push(limit + 1);
  return {
    text: `SELECT ${farmerFields} FROM farmers WHERE ${filters.join(' AND ')} ORDER BY id DESC LIMIT $${values.length}`,
    values,
  };
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
  });
  const { rows } = await runQuery(text, values);
  const limit = filters.limit;
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    pageSize: limit,
    nextCursor: hasMore ? String(data[data.length - 1].id) : null,
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
    const requestedCenter = input.collectionCenter || input.collection_center || input.location || null;
    const context = await resolveFarmerContext({
      ownerUserId,
      requestedCenter,
      collectionCenterId: input.collectionCenterId ?? input.collection_center_id ?? null,
      collectorUserId: input.collectorUserId,
      client,
    });
    const { rows } = await client.query(
      `INSERT INTO farmers (name, phone, national_id, account_number, location, collection_center, cow_type, owner_user_id, collector_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${farmerFields}`,
      [input.name.trim(), input.phone || null, input.nationalId || null, input.accountNumber || null, input.location.trim(), context.collectionCenter, input.cowType || null, ownerUserId, context.collectorUserId]
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

const updateFarmer = async ({ id, input, ownerUserId, actorId }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await getFarmer(id, ownerUserId, client);
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    const account = await getAccount(ownerUserId, client);
    const requestedCenter = input.collectionCenter || input.collection_center || input.location || existing.collectionCenter;
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

const deleteFarmer = async ({ id, ownerUserId, actorId }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await getFarmer(id, ownerUserId, client);
    if (!existing) {
      await client.query('ROLLBACK');
      return false;
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
         AND ca.collector_user_id = $1
     )
     ORDER BY name ASC, id ASC`,
    [collectorUserId]
  );
  return rows;
};

const createCenter = async ({ ownerUserId, actorId, input }) => {
  const pool = getPool();
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

const updateCenter = async ({ id, ownerUserId, actorId, input }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await getCenter(id, ownerUserId, client);
    if (!before) {
      await client.query('ROLLBACK');
      return null;
    }
    const fields = {
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

module.exports = {
  getAccount,
  getOwnedCenterByName,
  getCollectorAccessibleCenter,
  getDefaultCenter,
  resolveFarmerContext,
  resolveCollectorScope,
  buildFarmerListQuery,
  listFarmers,
  getFarmer,
  createFarmer,
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
