const { query, getPool } = require('../postgres.js');
const { getByDate } = require('./collectorMilkRepository.js');
const { getOwnedCenterByName, getCenter, resolveCollectorScope } = require('./domainRepository.js');

const formatDate = (value) => {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (part) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const mapMilkRow = (row) => row ? ({
  ...row,
  date: formatDate(row.date),
  farmerId: row.farmer_id,
  ownerUserId: row.owner_user_id,
  collectionSessionId: row.collection_session_id,
  volumeMorning: Number(row.volume_morning || 0),
  volumeEvening: Number(row.volume_evening || 0),
  volume: Number(row.volume_liters || 0),
  pricePerLiter: Number(row.price_per_liter || 0),
  amount: Number(row.amount || 0),
  originalVolumeLiters: Number(row.original_volume_liters ?? row.volume_liters ?? 0),
  originalAmount: Number(row.original_amount ?? row.amount ?? 0),
  validVolumeLiters: Number(row.valid_volume_liters ?? row.volume_liters ?? 0),
  validAmount: Number(row.valid_amount ?? row.amount ?? 0),
  lostVolumeLiters: Number(row.lost_volume_liters || 0),
  adjustmentReason: row.adjustment_reason || null,
  adjustedBy: row.adjusted_by ?? null,
  adjustedAt: row.adjusted_at ?? null,
}) : null;

const getCollectorFarmerScope = async ({ collectorUserId, farmerId, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT ca.dairy_user_id AS "ownerUserId"
     FROM collector_assignments ca
     JOIN farmers f ON f.owner_user_id = ca.dairy_user_id AND f.collector_user_id = ca.collector_user_id
     JOIN users u ON u.id = ca.collector_user_id AND u.account_type = 'COLLECTOR'
     WHERE ca.collector_user_id = $1 AND f.id = $2 LIMIT 1`,
    [Number(collectorUserId), Number(farmerId)]
  );
  if (rows[0]) return rows[0];
  const owned = await runQuery(
    `SELECT f.owner_user_id AS "ownerUserId"
     FROM farmers f JOIN users u ON u.id = f.owner_user_id
     WHERE f.id = $2 AND f.owner_user_id = $1 AND u.account_type = 'COLLECTOR' LIMIT 1`,
    [Number(collectorUserId), Number(farmerId)]
  );
  return owned.rows[0] || null;
};

const getMilkContext = async ({ ownerUserId, farmerId, date, client = { query } }) => {
  const { rows: farmers } = await client.query(
    `SELECT id, name, owner_user_id, location, collection_center AS "collectionCenter"
     FROM farmers WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [farmerId, ownerUserId]
  );
  const farmer = farmers[0];
  if (!farmer) return null;

  const centerName = farmer.collectionCenter || farmer.location;
  if (!centerName) return { farmer, center: null, pricePerLiter: null };
  const center = await getOwnedCenterByName(centerName, ownerUserId, client);
  if (!center) return { farmer, center: null, pricePerLiter: null };

  const { rows: prices } = await client.query(
    `SELECT price_per_liter AS "pricePerLiter"
     FROM collection_center_prices
     WHERE collection_center_id = $1 AND owner_user_id = $2 AND effective_date <= $3
     ORDER BY effective_date DESC, id DESC LIMIT 1`,
    [center.id, ownerUserId, date]
  );
  return {
    farmer,
    center,
    pricePerLiter: prices[0]?.pricePerLiter ?? center.pricePerLiter,
  };
};

const createSession = async (client, { ownerUserId, collectorUserId = ownerUserId, date, period, collectionCenterId }) => {
  const { rows } = await client.query(
    `INSERT INTO collection_sessions
       (owner_user_id, collector_user_id, collection_date, period, collection_center_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (owner_user_id, collection_date, period, collection_center_id)
     DO UPDATE SET collector_user_id = EXCLUDED.collector_user_id, updated_at = NOW()
     RETURNING id, owner_user_id, collector_user_id, collection_date, period, collection_center_id, status`,
    [ownerUserId, collectorUserId, date, period, collectionCenterId]
  );
  return rows[0];
};

const auditMilkValues = (record) => ({
  farmerId: record.farmer_id,
  date: String(record.date).slice(0, 10),
  volumeMorning: Number(record.volume_morning),
  volumeEvening: Number(record.volume_evening),
  volume: Number(record.volume_liters),
  pricePerLiter: Number(record.price_per_liter),
  amount: Number(record.amount),
  status: record.status,
});

const saveAudit = async (client, { ownerUserId, actorId, record, action, before = null }) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('milk_record', $1, $2, $3::jsonb, $4, $5)`,
    [record.id, action, JSON.stringify({
      before: before ? auditMilkValues(before) : null,
      after: auditMilkValues(record),
    }), actorId, ownerUserId]
  );
};

const upsertMilkRecord = async (input) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.collectorUserId) {
      const { rows: assignments } = await client.query(
        `SELECT 1 FROM collector_assignments ca
         JOIN farmers f ON f.owner_user_id = ca.dairy_user_id AND f.collector_user_id = ca.collector_user_id
         WHERE ca.dairy_user_id = $1 AND ca.collector_user_id = $2 AND f.id = $3 LIMIT 1`,
        [input.ownerUserId, input.collectorUserId, input.farmerId]
      );
      if (!assignments[0]) {
        const { rows: ownedFarmers } = await client.query(
          `SELECT 1 FROM farmers f JOIN users u ON u.id = f.owner_user_id
           WHERE f.id = $1 AND f.owner_user_id = $2 AND u.id = $3 AND u.account_type = 'COLLECTOR' LIMIT 1`,
          [input.farmerId, input.ownerUserId, input.collectorUserId]
        );
        if (!ownedFarmers[0]) throw Object.assign(new Error('Farmer is not assigned to this collector.'), { statusCode: 403 });
      }
    }
    const context = await getMilkContext({
      ownerUserId: input.ownerUserId,
      farmerId: input.farmerId,
      date: input.date,
      client,
    });
    if (!context || !context.center) {
      const error = new Error('Farmer is not available under the current owner and collection center.');
      error.code = 'FARMER_OR_CENTER_NOT_FOUND';
      throw error;
    }
    if (Number(context.center.id) !== input.collectionCenterId) {
      const error = new Error('Collection center changed during milk recording. Retry the request.');
      error.code = 'COLLECTION_CENTER_CHANGED';
      throw error;
    }

    const session = await createSession(client, {
      ownerUserId: input.ownerUserId,
      collectorUserId: input.collectorUserId || input.ownerUserId,
      date: input.date,
      period: input.period,
      collectionCenterId: input.collectionCenterId,
    });
    const date = new Date(`${input.date}T00:00:00.000Z`);
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    const day = date.getUTCDate();
    const insert = await client.query(
      `INSERT INTO milk_records
       (farmer_id, owner_user_id, collection_session_id, date, month, year, day,
        volume_liters, volume_morning, volume_evening, price_per_liter, amount,
        status, valid_volume_liters, valid_volume_morning, valid_volume_evening,
        valid_amount, lost_volume_liters)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        'valid', $8, $9, $10, $12, 0)
       ON CONFLICT (farmer_id, month, year, day) DO NOTHING
       RETURNING *`,
      [input.farmerId, input.ownerUserId, session.id, input.date, month, year, day,
        input.volume, input.volumeMorning, input.volumeEvening, input.pricePerLiter, input.amount]
    );

    if (insert.rows[0]) {
      const record = mapMilkRow(insert.rows[0]);
      await saveAudit(client, { ownerUserId: input.ownerUserId, actorId: input.actorId, record: insert.rows[0], action: 'created' });
      await client.query('COMMIT');
      return { record, created: true, updated: false, duplicate: false };
    }

    const { rows: existingRows } = await client.query(
      `SELECT * FROM milk_records
       WHERE farmer_id = $1 AND date = $2 AND owner_user_id = $3
       LIMIT 1 FOR UPDATE`,
      [input.farmerId, input.date, input.ownerUserId]
    );
    const existing = existingRows[0];
    if (!existing) {
      const error = new Error('A milk record already exists for this farmer and date.');
      error.code = 'MILK_RECORD_CONFLICT';
      throw error;
    }
    if (existing.status === 'cancelled' || existing.status === 'adjusted') {
      throw Object.assign(new Error('This milk record is voided or adjusted and cannot be replaced through daily entry. Use the correction workflow.'), { statusCode: 409, code: 'MILK_RECORD_ADJUSTED' });
    }
    const identical = Number(existing.volume_morning) === input.volumeMorning
      && Number(existing.volume_evening) === input.volumeEvening
      && Number(existing.price_per_liter) === input.pricePerLiter
      && Number(existing.amount) === input.amount;
    if (identical) {
      await client.query('COMMIT');
      return { record: mapMilkRow(existing), created: false, updated: false, duplicate: true };
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE milk_records SET collection_session_id = $1, volume_liters = $2,
       volume_morning = $3, volume_evening = $4, price_per_liter = $5, amount = $6,
       valid_volume_liters = $2, valid_volume_morning = $3, valid_volume_evening = $4,
       valid_amount = $6, lost_volume_liters = 0, status = 'valid', loss_percentage = NULL,
       adjustment_reason = NULL, adjusted_by = NULL, adjusted_at = NULL, updated_at = NOW()
       WHERE id = $7 AND owner_user_id = $8 RETURNING *`,
      [session.id, input.volume, input.volumeMorning, input.volumeEvening, input.pricePerLiter, input.amount, existing.id, input.ownerUserId]
    );
    await saveAudit(client, { ownerUserId: input.ownerUserId, actorId: input.actorId, record: updatedRows[0], action: 'updated', before: existing });
    await client.query('COMMIT');
    return { record: mapMilkRow(updatedRows[0]), created: false, updated: true, duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getMilkRecord = async (id, ownerUserId) => {
  const { rows } = await query(
    `SELECT * FROM milk_records WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [id, ownerUserId]
  );
  return mapMilkRow(rows[0]);
};

const updateMilkRecord = async ({ id, ownerUserId, actorId, date, collectionCenterId, volumeMorning, volumeEvening, volume, pricePerLiter, amount }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      'SELECT * FROM milk_records WHERE id = $1 AND owner_user_id = $2 LIMIT 1 FOR UPDATE',
      [id, ownerUserId]
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    if (existing.status === 'cancelled' || existing.status === 'adjusted') {
      throw Object.assign(new Error('This milk record is voided or adjusted and cannot be edited through daily entry.'), { statusCode: 409, code: 'MILK_RECORD_ADJUSTED' });
    }
    const context = await getMilkContext({ ownerUserId, farmerId: existing.farmer_id, date, client });
    if (!context || !context.center || Number(context.center.id) !== collectionCenterId) {
      const error = new Error('Farmer must belong to a configured collection center before updating milk.');
      error.statusCode = 400;
      throw error;
    }
    const dateValue = new Date(`${date}T00:00:00.000Z`);
    const session = await createSession(client, {
      ownerUserId,
      date,
      period: 'daily',
      collectionCenterId,
    });
    const { rows } = await client.query(
      `UPDATE milk_records SET collection_session_id = $1, date = $2,
       month = $3, year = $4, day = $5, volume_liters = $6, volume_morning = $7,
       volume_evening = $8, price_per_liter = $9, amount = $10,
       valid_volume_liters = $6, valid_volume_morning = $7, valid_volume_evening = $8,
       valid_amount = $10, lost_volume_liters = 0, status = 'valid', loss_percentage = NULL,
       adjustment_reason = NULL, adjusted_by = NULL, adjusted_at = NULL, updated_at = NOW()
       WHERE id = $11 AND owner_user_id = $12 RETURNING *`,
      [session.id, date, dateValue.getUTCMonth() + 1, dateValue.getUTCFullYear(), dateValue.getUTCDate(),
        volume, volumeMorning, volumeEvening, pricePerLiter, amount, id, ownerUserId]
    );
    await saveAudit(client, { ownerUserId, actorId, record: rows[0], action: 'updated', before: existing });
    await client.query('COMMIT');
    return mapMilkRow(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const resolveMilkRecordScope = async ({ ownerUserId, collectorUserId = null, runQuery = query }) => {
  if (collectorUserId === null || collectorUserId === undefined || collectorUserId === '') {
    return { ownerUserId: Number(ownerUserId), collectorUserId: null };
  }
  const collectorId = Number(collectorUserId);
  if (!Number.isSafeInteger(collectorId) || collectorId <= 0 || collectorId !== Number(ownerUserId)) {
    throw Object.assign(new Error('Collector scope must match the authenticated account.'), { statusCode: 403 });
  }
  const scope = await resolveCollectorScope({ collectorUserId: collectorId, ownerUserId: Number(ownerUserId), client: { query: runQuery } });
  return {
    ownerUserId: Number(scope.dairyUserId || ownerUserId),
    collectorUserId: scope.dairyUserId ? collectorId : null,
  };
};

const listMilkRecords = async ({ ownerUserId, collectorUserId = null, search, farmerId, center, startDate, endDate, cursor, limit }) => {
  const scope = await resolveMilkRecordScope({ ownerUserId, collectorUserId });
  const values = [scope.ownerUserId];
  const conditions = ['mr.owner_user_id = $1', 'f.owner_user_id = mr.owner_user_id'];
  if (farmerId) {
    values.push(farmerId);
    conditions.push(`mr.farmer_id = $${values.length}`);
  }
  if (scope.collectorUserId) {
    values.push(scope.collectorUserId);
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  if (center) {
    values.push(center);
    conditions.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (startDate) {
    values.push(startDate);
    conditions.push(`mr.date >= $${values.length}`);
  }
  if (endDate) {
    values.push(endDate);
    conditions.push(`mr.date <= $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(f.name ILIKE $${values.length} OR f.phone ILIKE $${values.length} OR f.national_id ILIKE $${values.length})`);
  }
  if (cursor) {
    const [cursorDate, cursorId] = cursor.split(':');
    values.push(cursorDate, Number(cursorId));
    conditions.push(`(mr.date, mr.id) < ($${values.length - 1}::date, $${values.length}::bigint)`);
  }
  values.push(limit + 1);
  const { rows } = await query(
    `SELECT mr.*, f.name AS farmer_name,
       COALESCE(NULLIF(f.collection_center, ''), f.location) AS collection_center
     FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY mr.date DESC, mr.id DESC LIMIT $${values.length}`,
    values
  );
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows).map(mapMilkRow);
  const last = data[data.length - 1];
  return {
    data,
    pageSize: limit,
    hasMore,
    nextCursor: hasMore && last ? `${String(last.date).slice(0, 10)}:${last.id}` : null,
  };
};

const getAbacundaIfishiHistory = async ({ dairyUserId, collectorUserId, centerId, startDate, endDate, runQuery = query }) => {
  const { rows } = await runQuery(
    `SELECT mr.date,
       SUM(CASE WHEN mr.status = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_morning, mr.volume_morning, 0) END) AS morning_liters,
       SUM(CASE WHEN mr.status = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_evening, mr.volume_evening, 0) END) AS evening_liters,
       SUM(COALESCE(mr.original_volume_liters, mr.volume_liters, 0)) AS original_liters,
       SUM(CASE WHEN mr.status = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END) AS valid_liters,
       SUM(CASE WHEN mr.status = 'cancelled' THEN COALESCE(mr.original_volume_liters, mr.volume_liters, 0) ELSE COALESCE(mr.lost_volume_liters, 0) END) AS lost_liters,
       CASE WHEN BOOL_OR(mr.status = 'cancelled') THEN 'cancelled'
         WHEN SUM(COALESCE(mr.lost_volume_liters, 0)) > 0 THEN 'adjusted' ELSE 'valid' END AS status,
       STRING_AGG(DISTINCT mr.adjustment_reason, '; ') FILTER (WHERE mr.adjustment_reason IS NOT NULL) AS reason
     FROM milk_records mr
     JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
     JOIN collector_assignments ca ON ca.dairy_user_id = mr.owner_user_id AND ca.collector_user_id = f.collector_user_id
     JOIN collection_centers c ON c.owner_user_id = f.owner_user_id
       AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
     WHERE ca.dairy_user_id = $1 AND ca.collector_user_id = $2 AND c.id = $3
       AND mr.date BETWEEN $4 AND $5 AND mr.is_owner_milk = FALSE
     GROUP BY mr.date ORDER BY mr.date DESC`,
    [Number(dairyUserId), Number(collectorUserId), Number(centerId), startDate, endDate]
  );
  return rows.map((row) => ({
    date: formatDate(row.date),
    morningLiters: Number(row.morning_liters || 0),
    eveningLiters: Number(row.evening_liters || 0),
    originalLiters: Number(row.original_liters || 0),
    validLiters: Number(row.valid_liters || 0),
    lostLiters: Number(row.lost_liters || 0),
    status: row.status || 'valid',
    reason: row.reason || null,
  }));
};

const getDailyCollection = async (
  { ownerUserId, collectorUserId = null, date, centerId, centerName, cursor, limit = 50 },
  runQuery = query,
  getCollectorMilk = getByDate
) => {
  let effectiveOwnerUserId = Number(ownerUserId);
  let assignedCollectorUserId = null;
  let center = null;
  if (collectorUserId) {
    const collectorId = Number(collectorUserId);
    const { rows: assignments } = await runQuery(
      'SELECT dairy_user_id FROM collector_assignments WHERE collector_user_id = $1 ORDER BY dairy_user_id ASC LIMIT 1',
      [collectorId]
    );
    if (!assignments[0]) {
      if (Number(ownerUserId) !== collectorId) {
        throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
      }
    } else {
      const dairyUserId = Number(assignments[0].dairy_user_id);
      if (Number(ownerUserId) !== collectorId && Number(ownerUserId) !== dairyUserId) {
        throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
      }
      const client = { query: runQuery };
      if (centerId) center = await getCenter(Number(centerId), collectorId, client);
      if (!center && centerName) center = await getOwnedCenterByName(centerName, collectorId, client);
      if (center) {
        effectiveOwnerUserId = collectorId;
      } else {
        effectiveOwnerUserId = dairyUserId;
        assignedCollectorUserId = collectorId;
      }
    }
  }

  if (!center) {
    const client = { query: runQuery };
    center = centerId
      ? await getCenter(Number(centerId), effectiveOwnerUserId, client)
      : centerName
        ? await getOwnedCenterByName(centerName, effectiveOwnerUserId, client)
        : null;
  }
  if ((centerId || centerName) && !center) return null;

  const baseFilters = ['f.owner_user_id = $2'];
  const baseValues = [date, effectiveOwnerUserId];
  if (assignedCollectorUserId) {
    baseValues.push(assignedCollectorUserId);
    baseFilters.push(`f.collector_user_id = $${baseValues.length}`);
  }
  if (center) {
    baseValues.push(center.name);
    baseFilters.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${baseValues.length}))`);
  }

  const centerFilters = ['f.owner_user_id = $1'];
  const centerValues = [effectiveOwnerUserId];
  if (assignedCollectorUserId) {
    centerValues.push(assignedCollectorUserId);
    centerFilters.push(`f.collector_user_id = $${centerValues.length}`);
  }
  if (center) {
    centerValues.push(center.name);
    centerFilters.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${centerValues.length}))`);
  }
  const { rows: centerRows } = await runQuery(
    `SELECT DISTINCT COALESCE(NULLIF(f.collection_center, ''), f.location) AS name
     FROM farmers f WHERE ${centerFilters.join(' AND ')} ORDER BY name ASC`,
    centerValues
  );
  const centers = centerRows.map((row) => row.name).filter(Boolean);
  const summaryResult = await runQuery(
    `SELECT COUNT(f.id)::integer AS "totalFarmers",
       COUNT(f.id) FILTER (WHERE mr.id IS NOT NULL AND COALESCE(mr.status, 'valid') <> 'cancelled'
         AND COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) > 0)::integer AS "presentCount",
       COALESCE(SUM(CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_morning, mr.volume_morning, 0) END), 0) AS "totalMorning",
       COALESCE(SUM(CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_evening, mr.volume_evening, 0) END), 0) AS "totalEvening",
       COALESCE(SUM(CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END), 0) AS "totalVolume",
       COALESCE(SUM(CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_amount, mr.amount, 0) END), 0) AS "totalAmount"
     FROM farmers f
     LEFT JOIN milk_records mr ON mr.farmer_id = f.id AND mr.owner_user_id = f.owner_user_id AND mr.date = $1
     WHERE ${baseFilters.join(' AND ')}`,
    baseValues
  );
  const summaryRow = summaryResult.rows[0] || {};

  const values = [...baseValues];
  let cursorClause = '';
  if (cursor) {
    values.push(Number(cursor));
    cursorClause = `AND f.id < $${values.length}`;
  }
  values.push(limit + 1);
  const { rows } = await runQuery(
    `SELECT f.id AS "farmerId", f.name AS "farmerName", f.national_id AS "nationalId",
       f.phone, f.account_number AS "accountNumber", f.cow_type AS "cowType",
       COALESCE(NULLIF(f.collection_center, ''), f.location) AS "collectionCenter",
       mr.id AS "recordId", COALESCE(mr.date, $1::date) AS date, mr.status,
       CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_morning, mr.volume_morning, 0) END AS "volumeMorning",
       CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_evening, mr.volume_evening, 0) END AS "volumeEvening",
       CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END AS "totalVolume",
       CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_amount, mr.amount, 0) END AS amount,
      mr.original_volume_liters AS "originalVolume", mr.lost_volume_liters AS "lostVolume",
      mr.adjustment_reason AS "adjustmentReason", mr.adjusted_by AS "adjustedBy", mr.adjusted_at AS "adjustedAt",
       mr.valid_volume_liters AS "validVolume", mr.original_volume_morning AS "originalMorning",
       mr.original_volume_evening AS "originalEvening", mr.valid_volume_morning AS "validMorning",
       mr.valid_volume_evening AS "validEvening"
     FROM farmers f
     LEFT JOIN milk_records mr ON mr.farmer_id = f.id AND mr.owner_user_id = f.owner_user_id AND mr.date = $1
     WHERE ${baseFilters.join(' AND ')} ${cursorClause}
     ORDER BY f.id DESC LIMIT $${values.length}`,
    values
  );
  const hasMore = rows.length > limit;
  const farmers = hasMore ? rows.slice(0, limit) : rows;
  const { rows: prices } = center ? await runQuery(
    `SELECT price_per_liter AS "pricePerLiter" FROM collection_center_prices
     WHERE collection_center_id = $1 AND owner_user_id = $2 AND effective_date <= $3
     ORDER BY effective_date DESC, id DESC LIMIT 1`,
    [center.id, effectiveOwnerUserId, date]
  ) : { rows: [] };
  const collectorMilk = await getCollectorMilk({ ownerUserId: collectorUserId ? Number(collectorUserId) : Number(ownerUserId), date });
  const totalFarmers = Number(summaryRow.totalFarmers || 0);
  return {
    center: center?.name || (centers.length === 1 ? centers[0] : centers.length > 1 ? 'Multiple centers' : null),
    centers,
    date,
    summary: {
      totalFarmers,
      presentCount: Number(summaryRow.presentCount || 0),
      missedCount: totalFarmers - Number(summaryRow.presentCount || 0),
      totalMorning: Number(Number(summaryRow.totalMorning || 0).toFixed(2)),
      totalEvening: Number(Number(summaryRow.totalEvening || 0).toFixed(2)),
      totalVolume: Number(Number(summaryRow.totalVolume || 0).toFixed(2)),
      totalAmount: Number(Number(summaryRow.totalAmount || 0).toFixed(2)),
      pricePerLiter: Number(prices[0]?.pricePerLiter ?? center?.pricePerLiter ?? 0),
      transportRate: Number(center?.transportRatePerLiter || 0),
    },
    pricePerLiter: Number(prices[0]?.pricePerLiter ?? center?.pricePerLiter ?? 0),
    transportRate: Number(center?.transportRatePerLiter || 0),
    farmers,
    farmerPagination: {
      pageSize: limit,
      hasMore,
      nextCursor: hasMore ? String(farmers[farmers.length - 1].farmerId) : null,
    },
    collectorMilk,
  };
};

const buildDairyDailyCollectionQuery = ({ dairyUserId, date, centerId, cursor = null, limit = 50 }) => ({
  text: `WITH selected_center AS (
       SELECT id, name FROM collection_centers WHERE id = $3 AND owner_user_id = $1
     ), center_farmers AS (
       SELECT f.id AS "farmerId", f.name AS "farmerName", f.national_id AS "nationalId",
         f.phone, f.account_number AS "accountNumber",
         COALESCE(NULLIF(f.collection_center, ''), f.location) AS "collectionCenter",
         mr.id AS "recordId", mr.status,
         CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_morning, mr.volume_morning, 0) END AS "volumeMorning",
         CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_evening, mr.volume_evening, 0) END AS "volumeEvening",
         CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END AS "totalVolume",
         CASE WHEN COALESCE(mr.status, 'valid') = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_amount, mr.amount, 0) END AS amount
       FROM farmers f
       JOIN selected_center c ON c.owner_user_id = f.owner_user_id
         AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
       LEFT JOIN milk_records mr ON mr.farmer_id = f.id AND mr.owner_user_id = f.owner_user_id
         AND mr.date = $2 AND mr.is_owner_milk = FALSE
       WHERE f.owner_user_id = $1
     ), summary AS (
       SELECT COUNT(*)::integer AS "totalFarmers",
         COUNT(*) FILTER (WHERE "recordId" IS NOT NULL AND COALESCE(status, 'valid') <> 'cancelled' AND "totalVolume" > 0)::integer AS "presentCount",
         COALESCE(SUM("volumeMorning"), 0) AS "totalMorning",
         COALESCE(SUM("volumeEvening"), 0) AS "totalEvening",
         COALESCE(SUM("totalVolume"), 0) AS "totalVolume",
         COALESCE(SUM(amount), 0) AS "totalAmount"
       FROM center_farmers
     ), page AS (
       SELECT * FROM center_farmers
       WHERE ($4::bigint IS NULL OR "farmerId" < $4)
       ORDER BY "farmerId" DESC LIMIT $5
     )
     SELECT page.*, summary.* FROM summary LEFT JOIN page ON TRUE ORDER BY page."farmerId" DESC`,
  values: [Number(dairyUserId), date, Number(centerId), cursor === null || cursor === undefined || cursor === '' ? null : Number(cursor), Number(limit) + 1],
});

const getDairyDailyCollection = async ({ dairyUserId, date, centerId, cursor = null, limit = 50, runQuery = query }) => {
  const { rows: centers } = await runQuery(
    `SELECT id, name, price_per_liter AS "pricePerLiter", transport_rate_per_liter AS "transportRatePerLiter"
     FROM collection_centers WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [Number(centerId), Number(dairyUserId)]
  );
  if (!centers[0]) return null;
  const { text, values } = buildDairyDailyCollectionQuery({ dairyUserId, date, centerId, cursor, limit });
  const { rows } = await runQuery(text, values);
  const pageRows = rows.filter((row) => row.farmerId !== null && row.farmerId !== undefined);
  const hasMore = pageRows.length > limit;
  const data = (hasMore ? pageRows.slice(0, limit) : pageRows).map((row) => ({
    ...row,
    farmerId: Number(row.farmerId),
    totalFarmers: Number(row.totalFarmers || 0),
    presentCount: Number(row.presentCount || 0),
    volumeMorning: Number(row.volumeMorning || 0),
    volumeEvening: Number(row.volumeEvening || 0),
    totalVolume: Number(row.totalVolume || 0),
    amount: Number(row.amount || 0),
  }));
  const totals = rows[0] || {};
  return {
    center: centers[0],
    farmers: data,
    summary: {
      totalFarmers: Number(totals.totalFarmers || 0),
      presentCount: Number(totals.presentCount || 0),
      totalMorning: Number(totals.totalMorning || 0),
      totalEvening: Number(totals.totalEvening || 0),
      totalVolume: Number(totals.totalVolume || 0),
      totalAmount: Number(totals.totalAmount || 0),
      pricePerLiter: Number(centers[0].pricePerLiter || 0),
      transportRate: 0,
    },
    pagination: { pageSize: limit, hasMore, nextCursor: hasMore && data.length ? String(data[data.length - 1].farmerId) : null },
  };
};

const getMilkTemplate = async ({ farmerId, ownerUserId, month, year, runQuery = query }) => {
  const { rows: farmers } = await runQuery(
    'SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
    [farmerId, ownerUserId]
  );
  if (!farmers[0]) return null;
  const { rows } = await runQuery(
    `SELECT id, farmer_id, owner_user_id, month, year, day, date,
       volume_liters, volume_morning, volume_evening
     FROM milk_records WHERE farmer_id = $1 AND owner_user_id = $2 AND month = $3 AND year = $4
     ORDER BY day ASC`,
    [farmerId, ownerUserId, month, year]
  );
  return rows;
};

const voidMilkRecord = async ({ id, ownerUserId, actorId, reason }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM milk_records WHERE id = $1 AND owner_user_id = $2 LIMIT 1 FOR UPDATE',
      [id, ownerUserId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const existing = rows[0];
    if (existing.status === 'cancelled') {
      await client.query('COMMIT');
      return { record: mapMilkRow(existing), alreadyVoided: true };
    }
    const { rows: voidedRows } = await client.query(
      `UPDATE milk_records SET
         original_volume_liters = COALESCE(original_volume_liters, volume_liters),
         original_amount = COALESCE(original_amount, amount),
         original_volume_morning = COALESCE(original_volume_morning, volume_morning),
         original_volume_evening = COALESCE(original_volume_evening, volume_evening),
         valid_volume_liters = 0, valid_volume_morning = 0, valid_volume_evening = 0,
         valid_amount = 0, lost_volume_liters = COALESCE(original_volume_liters, volume_liters),
         status = 'cancelled', loss_percentage = 100, adjustment_reason = $1,
         adjusted_by = $2, adjusted_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND owner_user_id = $4 RETURNING *`,
      [reason, actorId, id, ownerUserId]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('milk_record', $1, 'voided', $2::jsonb, $3, $4)`,
      [id, JSON.stringify({
        reason,
        date: String(existing.date).slice(0, 10),
        farmerId: existing.farmer_id,
        previousStatus: existing.status,
        previousLostVolume: Number(existing.lost_volume_liters || 0),
        previousAdjustmentReason: existing.adjustment_reason || null,
        originalVolume: Number(existing.original_volume_liters ?? existing.volume_liters ?? 0),
        originalAmount: Number(existing.original_amount ?? existing.amount ?? 0),
      }), actorId, ownerUserId]
    );
    await client.query('COMMIT');
    return { record: mapMilkRow(voidedRows[0]), alreadyVoided: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  mapMilkRow,
  getCollectorFarmerScope,
  getMilkContext,
  createSession,
  upsertMilkRecord,
  getMilkRecord,
  resolveMilkRecordScope,
  updateMilkRecord,
  listMilkRecords,
  getAbacundaIfishiHistory,
  getDailyCollection,
  buildDairyDailyCollectionQuery,
  getDairyDailyCollection,
  getMilkTemplate,
  voidMilkRecord,
};
