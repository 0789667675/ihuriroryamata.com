const { getPool } = require('../postgres.js');

const fail = (message, statusCode = 400, code = 'INVALID_MILK_MATRIX') =>
  Object.assign(new Error(message), { statusCode, code });

const round2 = (value) => Number(value.toFixed(2));

const normalizeVolume = (value, label) => {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'number' && typeof value !== 'string') throw fail(`${label} must be a non-negative number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999999.99) {
    throw fail(`${label} must be a valid non-negative number.`);
  }
  return round2(parsed);
};

const normalizeBatch = (user, input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Invalid payload.');
  const year = Number(input.year);
  const month = Number(input.month);
  const periodType = input.periodType;
  const centerId = Number(input.collectionCenterId ?? input.centerId);
  if (!Number.isSafeInteger(year) || year < 2020 || year > 2050) throw fail('A valid year (2020-2050) is required.');
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) throw fail('A valid month (1-12) is required.');
  if (!['first-half', 'second-half'].includes(periodType)) throw fail('A valid half-month period is required.');
  if (!Number.isSafeInteger(centerId) || centerId <= 0) throw fail('A valid collection center is required.');
  if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > 2000) {
    throw fail('At least one and no more than 2000 farmer entries are required.');
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = periodType === 'second-half' ? 16 : 1;
  const endDay = periodType === 'second-half' ? lastDay : 15;
  const farmerIds = new Set();
  const recordKeys = new Set();
  const entries = [];

  for (const entry of input.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw fail('Each farmer entry must be an object.');
    const farmerId = Number(entry.farmerId ?? entry.id);
    if (!Number.isSafeInteger(farmerId) || farmerId <= 0 || farmerIds.has(farmerId)) {
      throw fail('Each farmer must appear once with a valid id.');
    }
    farmerIds.add(farmerId);
    if (!entry.days || typeof entry.days !== 'object' || Array.isArray(entry.days)) throw fail('Farmer days must be an object.');

    for (const [dayKey, dayData] of Object.entries(entry.days)) {
      const day = Number(dayKey);
      if (!/^\d{1,2}$/.test(dayKey) || !Number.isSafeInteger(day) || day < startDay || day > endDay) {
        throw fail('A submitted day is outside the selected period.');
      }
      if (!dayData || typeof dayData !== 'object' || Array.isArray(dayData)) throw fail('Each day entry must be an object.');
      const recordDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const key = `${farmerId}:${recordDate}`;
      if (recordKeys.has(key)) throw fail('A farmer-day entry was submitted more than once.');
      recordKeys.add(key);
      entries.push({
        farmerId,
        day,
        date: recordDate,
        morning: normalizeVolume(dayData.morning, 'Morning volume'),
        evening: normalizeVolume(dayData.evening, 'Evening volume'),
      });
    }
  }

  if (entries.length === 0 || entries.length > 32000) throw fail('At least one and no more than 32000 farmer-days are required.');
  return {
    year,
    month,
    periodType,
    centerId,
    startDay,
    endDay,
    farmerIds: [...farmerIds],
    entries: entries.map((entry) => ({
      ...entry,
      volume: round2(entry.morning + entry.evening),
    })),
  };
};

const saveMilkMatrixBatch = async ({ user, input, poolProvider = getPool }) => {
  if (!user || !['COLLECTOR', 'COLLECTION_CENTER'].includes(user.accountType)) {
    throw fail('This account type cannot save a milk matrix.', 403, 'ACCOUNT_TYPE_FORBIDDEN');
  }
  const batch = normalizeBatch(user, input);
  const pool = poolProvider();
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const { rows: centerRows } = await client.query(
      `SELECT id, name, owner_user_id, price_per_liter, transport_rate_per_liter
       FROM public.collection_centers
       WHERE id = $1 AND owner_user_id IS NOT NULL AND (
         owner_user_id = $2 OR ($3 = 'COLLECTOR' AND EXISTS (
           SELECT 1 FROM public.collector_assignments ca
           WHERE ca.collector_user_id = $2 AND ca.dairy_user_id = collection_centers.owner_user_id
             AND ca.revoked_at IS NULL
         ))
       )
       LIMIT 1 FOR SHARE`,
      [batch.centerId, Number(user.id), user.accountType]
    );
    const center = centerRows[0];
    if (!center) throw fail('Collection center was not found or is outside your authorized scope.', 404, 'COLLECTION_CENTER_NOT_FOUND');
    const ownerUserId = Number(center.owner_user_id);
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw fail('Collection center owner is unavailable.', 409, 'COLLECTION_CENTER_OWNER_MISSING');

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`milk-matrix:${ownerUserId}:${batch.centerId}:${batch.year}:${batch.month}:${batch.periodType}`]
    );

    const { rows: farmerRows } = await client.query(
      `SELECT f.id
       FROM public.farmers f
       WHERE f.id = ANY($1::bigint[]) AND f.owner_user_id = $2
         AND LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($5))
         AND (
           $3 = 'COLLECTION_CENTER' OR f.owner_user_id = $4 OR EXISTS (
             SELECT 1 FROM public.collector_assignments ca
             JOIN public.users u ON u.id = ca.collector_user_id AND u.account_type = 'COLLECTOR'
             WHERE ca.dairy_user_id = f.owner_user_id AND ca.collector_user_id = $4
               AND ca.revoked_at IS NULL AND f.collector_user_id = $4
           )
         )
       FOR SHARE OF f`,
      [batch.farmerIds, ownerUserId, user.accountType, Number(user.id), center.name]
    );
    if (farmerRows.length !== batch.farmerIds.length) {
      throw fail('One or more farmers are outside this center or account scope.', 403, 'FARMER_SCOPE_FORBIDDEN');
    }

    const { rows: existingRows } = await client.query(
      `SELECT mr.id, mr.farmer_id, mr.owner_user_id, mr.date::text AS record_date,
        mr.status, mr.lost_volume_liters, mr.adjustment_reason, mr.adjusted_at,
        mr.volume_liters, mr.volume_morning, mr.volume_evening,
        mr.valid_volume_liters, mr.valid_volume_morning, mr.valid_volume_evening,
        mr.amount, mr.valid_amount, mr.original_volume_liters, mr.original_volume_morning,
        mr.original_volume_evening, mr.original_amount, mr.price_per_liter, mr.transport_rate_per_liter
       FROM unnest($1::bigint[], $2::date[]) AS requested(farmer_id, record_date)
       JOIN public.milk_records mr
         ON mr.farmer_id = requested.farmer_id AND mr.date = requested.record_date
       FOR UPDATE OF mr`,
      [batch.entries.map((entry) => entry.farmerId), batch.entries.map((entry) => entry.date)]
    );
    const existingByKey = new Map();
    for (const row of existingRows) {
      const key = `${Number(row.farmer_id)}:${row.record_date}`;
      if (Number(row.owner_user_id) !== ownerUserId) {
        throw fail('A farmer-day record exists outside this owner scope.', 409, 'MILK_RECORD_OWNER_CONFLICT');
      }
      if (row.status !== 'valid' || Number(row.lost_volume_liters || 0) > 0 || row.adjustment_reason || row.adjusted_at) {
        throw fail('A loss-adjusted or voided record cannot be changed through Save All.', 409, 'MILK_RECORD_ADJUSTED');
      }
      existingByKey.set(key, row);
    }

    const rowsToWrite = batch.entries.filter((entry) => {
      const existing = existingByKey.get(`${entry.farmerId}:${entry.date}`);
      if (!existing) return true;
      const amount = round2(entry.volume * Number(existing.price_per_liter));
      return Number(existing.volume_morning) !== entry.morning
        || Number(existing.volume_evening) !== entry.evening
        || Number(existing.volume_liters) !== entry.volume
        || Number(existing.valid_volume_morning ?? existing.volume_morning) !== entry.morning
        || Number(existing.valid_volume_evening ?? existing.volume_evening) !== entry.evening
        || Number(existing.valid_volume_liters ?? existing.volume_liters) !== entry.volume
        || Number(existing.amount) !== amount
        || Number(existing.valid_amount ?? existing.amount) !== amount
        || Number(existing.original_volume_morning ?? existing.volume_morning) !== entry.morning
        || Number(existing.original_volume_evening ?? existing.volume_evening) !== entry.evening
        || Number(existing.original_volume_liters ?? existing.volume_liters) !== entry.volume
        || Number(existing.original_amount ?? existing.amount) !== amount;
    });

    if (rowsToWrite.length > 0) {
      const newRows = rowsToWrite.filter((entry) => !existingByKey.has(`${entry.farmerId}:${entry.date}`));
      const datesNeedingSessions = [...new Set(rowsToWrite.map((entry) => entry.date))];
      const datesNeedingPrices = [...new Set(newRows.map((entry) => entry.date))];
      const priceByDate = new Map();

      if (datesNeedingPrices.length > 0) {
        const { rows: priceRows } = await client.query(
          `SELECT requested.record_date::text AS record_date,
             COALESCE(effective.price_per_liter, center.price_per_liter) AS price_per_liter
           FROM unnest($3::date[]) AS requested(record_date)
           JOIN public.collection_centers center ON center.id = $1 AND center.owner_user_id = $2
           LEFT JOIN LATERAL (
             SELECT prices.price_per_liter
             FROM public.collection_center_prices prices
             WHERE prices.collection_center_id = center.id AND prices.owner_user_id = center.owner_user_id
               AND prices.effective_date <= requested.record_date
             ORDER BY prices.effective_date DESC, prices.id DESC
             LIMIT 1
           ) effective ON TRUE`,
          [batch.centerId, ownerUserId, datesNeedingPrices]
        );
        for (const row of priceRows) priceByDate.set(row.record_date, Number(row.price_per_liter || 0));
      }

      const { rows: sessions } = await client.query(
        `INSERT INTO public.collection_sessions
           (owner_user_id, collector_user_id, collection_date, period, collection_center_id)
         SELECT $1, $2, requested.collection_date, 'daily', $3
         FROM unnest($4::date[]) AS requested(collection_date)
         ON CONFLICT (owner_user_id, collection_date, period, collection_center_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING id, collection_date::text AS collection_date`,
        [ownerUserId, Number(user.id), batch.centerId, datesNeedingSessions]
      );
      const sessionByDate = new Map(sessions.map((row) => [row.collection_date, Number(row.id)]));

      const records = rowsToWrite.map((entry) => {
        const existing = existingByKey.get(`${entry.farmerId}:${entry.date}`);
        const pricePerLiter = existing
          ? Number(existing.price_per_liter)
          : priceByDate.get(entry.date);
        if (pricePerLiter === undefined || !Number.isFinite(pricePerLiter)) {
          throw fail('A historical milk price could not be resolved.', 409, 'MILK_PRICE_UNAVAILABLE');
        }
        const transportRate = existing
          ? existing.transport_rate_per_liter
          : center.transport_rate_per_liter;
        return {
          ...entry,
          sessionId: sessionByDate.get(entry.date),
          pricePerLiter,
          transportRate,
          amount: round2(entry.volume * pricePerLiter),
        };
      });
      if (records.some((record) => !record.sessionId)) throw fail('A collection session could not be resolved.', 409, 'MILK_SESSION_UNAVAILABLE');

      const { rows: savedRows } = await client.query(
        `INSERT INTO public.milk_records AS current_record
           (farmer_id, owner_user_id, collection_session_id, date, month, year, day,
            volume_liters, volume_morning, volume_evening, price_per_liter, amount,
            status, original_volume_liters, original_volume_morning, original_volume_evening,
            original_amount, valid_volume_liters, valid_volume_morning, valid_volume_evening,
            valid_amount, lost_volume_liters, transport_rate_per_liter)
         SELECT batch.farmer_id, $11, batch.session_id, batch.record_date, $12, $13, batch.day,
            batch.volume, batch.morning, batch.evening, batch.price_per_liter, batch.amount,
            'valid', batch.volume, batch.morning, batch.evening, batch.amount,
            batch.volume, batch.morning, batch.evening, batch.amount, 0, batch.transport_rate
         FROM unnest(
           $1::bigint[], $2::date[], $3::integer[], $4::numeric[], $5::numeric[],
           $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::bigint[]
         ) AS batch(farmer_id, record_date, day, morning, evening, volume, price_per_liter, amount, transport_rate, session_id)
         ON CONFLICT (farmer_id, month, year, day) DO UPDATE SET
           collection_session_id = EXCLUDED.collection_session_id,
           date = EXCLUDED.date,
           volume_liters = EXCLUDED.volume_liters,
           volume_morning = EXCLUDED.volume_morning,
           volume_evening = EXCLUDED.volume_evening,
           amount = EXCLUDED.volume_liters * current_record.price_per_liter,
           original_volume_liters = EXCLUDED.volume_liters,
           original_volume_morning = EXCLUDED.volume_morning,
           original_volume_evening = EXCLUDED.volume_evening,
           original_amount = EXCLUDED.volume_liters * current_record.price_per_liter,
           valid_volume_liters = EXCLUDED.volume_liters,
           valid_volume_morning = EXCLUDED.volume_morning,
           valid_volume_evening = EXCLUDED.volume_evening,
           valid_amount = EXCLUDED.volume_liters * current_record.price_per_liter,
           updated_at = NOW()
         WHERE current_record.owner_user_id = EXCLUDED.owner_user_id
           AND current_record.status = 'valid' AND current_record.lost_volume_liters = 0
         RETURNING id`,
        [
          records.map((record) => record.farmerId),
          records.map((record) => record.date),
          records.map((record) => record.day),
          records.map((record) => record.morning),
          records.map((record) => record.evening),
          records.map((record) => record.volume),
          records.map((record) => record.pricePerLiter),
          records.map((record) => record.amount),
          records.map((record) => record.transportRate),
          records.map((record) => record.sessionId),
          ownerUserId,
          batch.month,
          batch.year,
        ]
      );
      if (savedRows.length !== records.length) {
        throw fail('Some records changed concurrently or are not editable. Retry after refreshing the notebook.', 409, 'MILK_MATRIX_CONFLICT');
      }

      await client.query(
        `INSERT INTO public.audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('milk_matrix_batch', $1, 'batch_matrix_save', $2::jsonb, $3, $4)`,
        [batch.centerId, JSON.stringify({
          year: batch.year,
          month: batch.month,
          periodType: batch.periodType,
          savedCount: batch.entries.length,
          changedCount: records.length,
          grandVolume: round2(batch.entries.reduce((sum, entry) => sum + entry.volume, 0)),
        }), Number(user.id), ownerUserId]
      );
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return {
      success: true,
      savedCount: batch.entries.length,
      changedCount: rowsToWrite.length,
      totalVolume: round2(batch.entries.reduce((sum, entry) => sum + entry.volume, 0)),
      year: batch.year,
      month: batch.month,
      periodType: batch.periodType,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { normalizeBatch, saveMilkMatrixBatch };