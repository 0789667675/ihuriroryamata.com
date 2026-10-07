const { query, getPool } = require('../postgres.js');

const farmerLoss = `(
  SELECT COALESCE(SUM(mr.lost_volume_liters), 0)
  FROM milk_records mr
  WHERE mr.owner_user_id = cm.owner_user_id AND mr.date = cm.date
    AND mr.farmer_id IS NOT NULL AND mr.is_owner_milk = FALSE
)`;

const formatCollectionDate = (value) => {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (part) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const mapRow = (row) => ({
  id: row.id,
  ownerUserId: Number(row.owner_user_id),
  date: formatCollectionDate(row.collection_date ?? row.date),
  volumeLiters: Number(row.volume_liters || 0),
  pricePerLiter: Number(row.price_per_liter || 0),
  status: row.status || 'valid',
  validVolumeLiters: Number(row.valid_volume_liters ?? row.volume_liters ?? 0),
  farmerLostLiters: Number(row.farmer_lost_liters || 0),
  effectiveVolumeLiters: row.status === 'cancelled' ? 0 : Number(Math.max(
    0,
    Number(row.valid_volume_liters ?? row.volume_liters ?? 0) - Number(row.farmer_lost_liters || 0)
  ).toFixed(2)),
  voidedBy: row.voided_by ?? null,
  voidedAt: row.voided_at ?? null,
  voidReason: row.void_reason ?? null,
});

const getByDate = async ({ ownerUserId, date }) => {
  const { rows } = await query(
    `SELECT cm.*, cm.date AS collection_date, ${farmerLoss} AS farmer_lost_liters
     FROM milk_records cm
     WHERE cm.owner_user_id = $1 AND cm.date = $2 AND cm.is_owner_milk = TRUE LIMIT 1`,
    [ownerUserId, date]
  );
  return rows.map(mapRow);
};

const getForPeriod = async ({ ownerUserId, startDate, endDate }) => {
  const { rows } = await query(
    `SELECT cm.*, cm.date AS collection_date, ${farmerLoss} AS farmer_lost_liters
     FROM milk_records cm
     WHERE cm.owner_user_id = $1 AND cm.date BETWEEN $2 AND $3 AND cm.is_owner_milk = TRUE
     ORDER BY cm.date ASC`,
    [ownerUserId, startDate, endDate]
  );
  return rows.map(mapRow);
};

const getOwnerIfishiHistory = async ({ ownerUserId, startDate, endDate, runQuery = query }) => {
  const { rows } = await runQuery(
    `WITH farmer_daily AS (
       SELECT mr.date, SUM(CASE WHEN mr.status = 'cancelled' THEN 0
         ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END) AS assigned_farmer_liters,
         SUM(CASE WHEN mr.status = 'cancelled' THEN COALESCE(mr.original_volume_liters, mr.volume_liters, 0)
           ELSE COALESCE(mr.lost_volume_liters, 0) END) AS assigned_farmer_lost_liters
       FROM milk_records mr
       JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
       WHERE mr.owner_user_id IN (
           SELECT $1::bigint
           UNION
           SELECT ca.dairy_user_id FROM collector_assignments ca WHERE ca.collector_user_id = $1
         )
         AND (mr.owner_user_id = $1 OR f.collector_user_id = $1)
         AND mr.date BETWEEN $2 AND $3 AND mr.is_owner_milk = FALSE
       GROUP BY mr.date
     ), owner_daily AS (
       SELECT mr.id, mr.owner_user_id, mr.date, mr.volume_liters, mr.valid_volume_liters,
         mr.original_volume_liters, mr.lost_volume_liters, mr.status,
         mr.adjustment_reason, mr.adjusted_at
       FROM milk_records mr
       WHERE mr.owner_user_id = $1 AND mr.is_owner_milk = TRUE AND mr.date BETWEEN $2 AND $3
     )
     SELECT COALESCE(o.date, f.date) AS date, o.id, o.owner_user_id,
       COALESCE(o.volume_liters, 0) AS volume_liters,
       CASE WHEN o.status = 'cancelled' THEN 0 ELSE GREATEST(0,
         COALESCE(o.valid_volume_liters, o.volume_liters, 0) - COALESCE(f.assigned_farmer_lost_liters, 0)) END AS valid_volume_liters,
       COALESCE(o.original_volume_liters, o.volume_liters, 0) AS original_volume_liters,
       COALESCE(o.lost_volume_liters, 0) + COALESCE(f.assigned_farmer_lost_liters, 0) AS lost_volume_liters,
       COALESCE(o.status, 'missing') AS status, o.adjustment_reason, o.adjusted_at,
       COALESCE(f.assigned_farmer_liters, 0) AS assigned_farmer_liters
     FROM owner_daily o FULL OUTER JOIN farmer_daily f ON f.date = o.date
     ORDER BY COALESCE(o.date, f.date) DESC`,
    [Number(ownerUserId), startDate, endDate]
  );
  return rows.map((row) => ({
    id: row.id === null ? null : Number(row.id),
    ownerUserId: row.owner_user_id === null ? Number(ownerUserId) : Number(row.owner_user_id),
    date: formatCollectionDate(row.date),
    volumeLiters: Number(row.volume_liters || 0),
    originalVolumeLiters: Number(row.original_volume_liters || 0),
    validVolumeLiters: Number(row.valid_volume_liters || 0),
    lostVolumeLiters: Number(row.lost_volume_liters || 0),
    assignedFarmerLiters: Number(row.assigned_farmer_liters || 0),
    status: row.status || 'missing',
    adjustmentReason: row.adjustment_reason || null,
    adjustedAt: row.adjusted_at || null,
  }));
};

const persistOwnerEntry = async ({ ownerUserId, actorId = ownerUserId, date, volumeLiters, pricePerLiter, mode, id = null, pool = getPool() }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`collector-milk:${ownerUserId}:${date}`]);
    const lookup = mode === 'correct'
      ? await client.query('SELECT * FROM milk_records WHERE id = $1 AND owner_user_id = $2 AND is_owner_milk = TRUE LIMIT 1 FOR UPDATE', [id, ownerUserId])
      : await client.query('SELECT * FROM milk_records WHERE owner_user_id = $1 AND date = $2 AND is_owner_milk = TRUE LIMIT 1 FOR UPDATE', [ownerUserId, date]);
    const existingRows = lookup.rows;
    const existing = existingRows[0];
    if (mode === 'correct' && !existing) {
      await client.query('ROLLBACK');
      return null;
    }
    if (mode === 'create' && existing) {
      throw Object.assign(new Error('An owner milk entry already exists for this date.'), { statusCode: 409, code: 'OWNER_MILK_ENTRY_EXISTS' });
    }
    if (existing?.status === 'cancelled') {
      throw Object.assign(new Error('This collector milk record is voided and cannot be replaced.'), { statusCode: 409, code: 'MILK_RECORD_VOIDED' });
    }
    if (mode === 'correct' && existing.status !== 'valid') {
      throw Object.assign(new Error('Only valid owner milk entries can be corrected.'), { statusCode: 409, code: 'OWNER_MILK_ENTRY_NOT_CORRECTABLE' });
    }
    let rows;
    if (existing) {
      ({ rows } = await client.query(
        `UPDATE milk_records SET date = $1, month = $2, year = $3, day = $4,
         volume_liters = $5, volume_morning = $5, volume_evening = 0,
         price_per_liter = $6, amount = $5 * $6, original_volume_liters = $5,
         original_volume_morning = $5, original_volume_evening = 0,
         lost_volume_liters = 0, valid_volume_liters = $5, valid_volume_morning = $5,
         valid_volume_evening = 0, original_amount = $5 * $6, valid_amount = $5 * $6,
         status = 'valid', loss_percentage = NULL, adjustment_reason = NULL,
         adjusted_by = NULL, adjusted_at = NULL, updated_at = NOW()
         WHERE id = $7 AND owner_user_id = $8 AND is_owner_milk = TRUE RETURNING *`,
        [date, Number(date.slice(5, 7)), Number(date.slice(0, 4)), Number(date.slice(8, 10)), volumeLiters, pricePerLiter, existing.id, ownerUserId]
      ));
    } else {
      ({ rows } = await client.query(
        `INSERT INTO milk_records
         (farmer_id, owner_user_id, date, month, year, day, volume_liters,
          volume_morning, volume_evening, price_per_liter, amount, status,
          original_volume_liters, lost_volume_liters, valid_volume_liters,
          original_amount, valid_amount, original_volume_morning, original_volume_evening,
          valid_volume_morning, valid_volume_evening, is_owner_milk)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $6, 0, $7, $6 * $7, 'valid',
          $6, 0, $6, $6 * $7, $6 * $7, $6, 0, $6, 0, TRUE) RETURNING *`,
        [ownerUserId, date, Number(date.slice(5, 7)), Number(date.slice(0, 4)), Number(date.slice(8, 10)), volumeLiters, pricePerLiter]
      ));
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('milk_record', $1, $2, $3::jsonb, $4, $5)`,
        [rows[0].id, mode === 'correct' ? 'owner_ifishi_corrected' : 'owner_ifishi_created', JSON.stringify({ date, volumeLiters }), actorId, ownerUserId]
      );
    }
    if (existing) {
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('milk_record', $1, $2, $3::jsonb, $4, $5)`,
        [existing.id, mode === 'correct' ? 'owner_ifishi_corrected' : 'owner_ifishi_updated', JSON.stringify({ before: { date: String(existing.date).slice(0, 10), volumeLiters: Number(existing.volume_liters) }, after: { date, volumeLiters } }), actorId, ownerUserId]
      );
    }
    const record = mapRow({ ...rows[0], collection_date: rows[0].date, farmer_lost_liters: 0 });
    await client.query('COMMIT');
    return record;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      error.statusCode = 409;
      error.code = 'OWNER_MILK_ENTRY_EXISTS';
      error.message = 'An owner milk entry already exists for this date.';
    }
    throw error;
  } finally {
    client.release();
  }
};

const upsertDaily = (input) => persistOwnerEntry({ ...input, mode: 'upsert' });
const createOwnerEntry = (input) => persistOwnerEntry({ ...input, mode: 'create' });
const correctOwnerEntry = (input) => persistOwnerEntry({ ...input, mode: 'correct' });

const voidDaily = async ({ ownerUserId, date, reason, voidedBy }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT cm.*, cm.date AS collection_date, cm.adjusted_by AS voided_by,
         cm.adjustment_reason AS void_reason, ${farmerLoss} AS farmer_lost_liters
       FROM milk_records cm
       WHERE cm.owner_user_id = $1 AND cm.date = $2 AND cm.is_owner_milk = TRUE
       LIMIT 1 FOR UPDATE OF cm`,
      [ownerUserId, date]
    );
    if (!rows[0]) {
      const error = new Error('No collector milk entry found for this date.');
      error.code = 'MILK_DAY_NOT_FOUND';
      throw error;
    }
    const current = rows[0];
    if (current.status === 'cancelled') {
      await client.query('COMMIT');
      return { entry: mapRow(current), alreadyVoided: true, validVolumeLiters: 0, voided: true };
    }
    const { rows: updated } = await client.query(
      `UPDATE milk_records
       SET original_volume_liters = COALESCE(original_volume_liters, volume_liters),
         original_volume_morning = COALESCE(original_volume_morning, volume_morning),
         original_volume_evening = COALESCE(original_volume_evening, volume_evening),
         valid_volume_liters = 0, valid_volume_morning = 0, valid_volume_evening = 0,
         lost_volume_liters = COALESCE(original_volume_liters, volume_liters),
         status = 'cancelled', loss_percentage = 100, adjusted_by = $1,
         adjusted_at = NOW(), adjustment_reason = $2, updated_at = NOW()
       WHERE id = $3 AND owner_user_id = $4 AND is_owner_milk = TRUE RETURNING *`,
      [voidedBy, reason, current.id, ownerUserId]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
      VALUES ('milk_record', $1, 'owner_ifishi_voided', $2::jsonb, $3, $4)`,
      [current.id, JSON.stringify({ date, originalVolume: current.volume_liters, reason }), voidedBy, ownerUserId]
    );
    await client.query('COMMIT');
    return { entry: mapRow({ ...updated[0], collection_date: updated[0].date, farmer_lost_liters: current.farmer_lost_liters }), alreadyVoided: false, validVolumeLiters: 0, voided: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getPriceAtDate = async ({ ownerUserId, date }) => {
  const { rows } = await query(
    `SELECT id, owner_user_id, price_per_liter, effective_date
     FROM collector_milk_prices WHERE owner_user_id = $1 AND effective_date <= $2
     ORDER BY effective_date DESC, id DESC LIMIT 1`,
    [ownerUserId, date]
  );
  return rows[0] ? {
    id: rows[0].id,
    ownerUserId: Number(rows[0].owner_user_id),
    pricePerLiter: Number(rows[0].price_per_liter),
    effectiveDate: String(rows[0].effective_date).slice(0, 10),
  } : null;
};

const getPrices = async (ownerUserId) => {
  const { rows } = await query(
    `SELECT id, owner_user_id, price_per_liter, effective_date
     FROM collector_milk_prices WHERE owner_user_id = $1
     ORDER BY effective_date DESC, id DESC`,
    [ownerUserId]
  );
  return rows.map((row) => ({
    id: row.id,
    ownerUserId: Number(row.owner_user_id),
    pricePerLiter: Number(row.price_per_liter),
    effectiveDate: String(row.effective_date).slice(0, 10),
  }));
};

const addPrice = async ({ ownerUserId, actorId, pricePerLiter, effectiveDate }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO collector_milk_prices (owner_user_id, price_per_liter, effective_date)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_user_id, effective_date) DO UPDATE SET price_per_liter = EXCLUDED.price_per_liter, updated_at = NOW()
       RETURNING id, owner_user_id, price_per_liter, effective_date`,
      [ownerUserId, pricePerLiter, effectiveDate]
    );
    const price = rows[0];
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('collector_milk_price', $1, 'added', $2::jsonb, $3, $4)`,
      [price.id, JSON.stringify({ pricePerLiter, effectiveDate }), actorId, ownerUserId]
    );
    await client.query('COMMIT');
    return {
      id: price.id,
      ownerUserId: Number(price.owner_user_id),
      pricePerLiter: Number(price.price_per_liter),
      effectiveDate: String(price.effective_date).slice(0, 10),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  mapRow,
  getByDate,
  getForPeriod,
  getOwnerIfishiHistory,
  upsertDaily,
  createOwnerEntry,
  correctOwnerEntry,
  voidDaily,
  getPriceAtDate,
  getPrices,
  addPrice,
};
