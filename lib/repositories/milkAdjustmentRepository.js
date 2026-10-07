const { getPool } = require('../postgres.js');

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const applyCollectionAdjustment = async ({ ownerUserId, collectionCenterId, date, period, lossPercentage, reason, adjustedBy }) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`milk-adjustment:${ownerUserId}:${collectionCenterId}:${date}:${period}`]
    );

    const { rows: adjustments } = await client.query(
      `SELECT * FROM milk_collection_adjustments
       WHERE owner_user_id = $1 AND collection_center_id = $2 AND collection_date = $3 AND period = $4
       LIMIT 1 FOR UPDATE`,
      [ownerUserId, collectionCenterId, date, period]
    );
    const previousAdjustment = adjustments[0] || null;

    const { rows } = await client.query(
      `SELECT mr.*
       FROM milk_records mr
       JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
       JOIN collection_centers c
         ON LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
        AND c.id = $1 AND c.owner_user_id = mr.owner_user_id
       WHERE mr.owner_user_id = $2 AND mr.date = $3
       FOR UPDATE OF mr`,
      [collectionCenterId, ownerUserId, date]
    );
    if (!rows.length) {
      const error = new Error('No milk records found for this collection center and date.');
      error.code = 'MILK_DAY_NOT_FOUND';
      throw error;
    }

    const isCorrection = Boolean(previousAdjustment);
    if (!isCorrection && lossPercentage === 0) {
      const error = new Error('Loss percentage must be greater than 0 for a new adjustment.');
      error.code = 'INVALID_MILK_ADJUSTMENT';
      throw error;
    }

    let originalVolume = 0;
    let validVolume = 0;
    let originalAmount = 0;
    let validAmount = 0;

    for (const row of rows) {
      const morningOriginal = Number(row.original_volume_morning ?? row.volume_morning ?? 0);
      const eveningOriginal = Number(row.original_volume_evening ?? row.volume_evening ?? 0);
      const dayOriginal = round2(morningOriginal + eveningOriginal);
      const amountOriginal = Number(row.original_amount ?? row.amount ?? 0);

      await client.query(
        `UPDATE milk_records SET
           original_volume_liters = COALESCE(original_volume_liters, volume_liters),
           original_amount = COALESCE(original_amount, amount),
           original_volume_morning = COALESCE(original_volume_morning, volume_morning),
           original_volume_evening = COALESCE(original_volume_evening, volume_evening)
         WHERE id = $1 AND owner_user_id = $2`,
        [row.id, ownerUserId]
      );

      const factor = 1 - (lossPercentage / 100);
      let validMorning;
      let validEvening;
      if (period === 'all') {
        validMorning = round2(morningOriginal * factor);
        validEvening = round2(eveningOriginal * factor);
      } else if (period === 'morning') {
        validMorning = round2(morningOriginal * factor);
        validEvening = Number(row.valid_volume_evening ?? eveningOriginal);
      } else {
        validMorning = Number(row.valid_volume_morning ?? morningOriginal);
        validEvening = round2(eveningOriginal * factor);
      }

      const effectiveDay = round2(validMorning + validEvening);
      const lost = round2(dayOriginal - effectiveDay);
      const amountForDay = dayOriginal > 0 ? round2(amountOriginal * (effectiveDay / dayOriginal)) : 0;
      const status = period === 'all' && lossPercentage === 100
        ? 'cancelled'
        : lost === 0 ? 'valid' : 'adjusted';
      originalVolume += dayOriginal;
      validVolume += effectiveDay;
      originalAmount += amountOriginal;
      validAmount += amountForDay;

      await client.query(
        `UPDATE milk_records SET
           valid_volume_morning = $1, valid_volume_evening = $2,
           valid_volume_liters = $3, valid_amount = $4,
           lost_volume_liters = $5, status = $6, loss_percentage = $7,
           adjustment_reason = $8, adjusted_by = $9, adjusted_at = NOW(), updated_at = NOW()
         WHERE id = $10 AND owner_user_id = $11`,
        [validMorning, validEvening, effectiveDay, amountForDay, lost, status, lossPercentage,
          reason, adjustedBy, row.id, ownerUserId]
      );
    }

    originalVolume = round2(originalVolume);
    validVolume = round2(validVolume);
    originalAmount = round2(originalAmount);
    validAmount = round2(validAmount);
    const lostVolume = round2(originalVolume - validVolume);
    const adjustmentType = period === 'all' && lossPercentage === 100 ? 'cancelled' : 'partial_loss';
    let adjustment;

    if (previousAdjustment) {
      const { rows: updated } = await client.query(
        `UPDATE milk_collection_adjustments SET adjustment_type = $1, loss_percentage = $2,
         original_volume_liters = $3, lost_volume_liters = $4, valid_volume_liters = $5,
         reason = $6, adjusted_by = $7
         WHERE id = $8 RETURNING *`,
        [adjustmentType, lossPercentage, originalVolume, lostVolume, validVolume, reason, adjustedBy, previousAdjustment.id]
      );
      adjustment = updated[0];
    } else {
      if (period === 'all') {
        await client.query(
          `DELETE FROM milk_collection_adjustments
           WHERE owner_user_id = $1 AND collection_center_id = $2 AND collection_date = $3
             AND period IN ('morning', 'evening')`,
          [ownerUserId, collectionCenterId, date]
        );
      }
      const { rows: inserted } = await client.query(
        `INSERT INTO milk_collection_adjustments
         (owner_user_id, collection_center_id, collection_date, period, adjustment_type,
          loss_percentage, original_volume_liters, lost_volume_liters, valid_volume_liters, reason, adjusted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [ownerUserId, collectionCenterId, date, period, adjustmentType, lossPercentage,
          originalVolume, lostVolume, validVolume, reason, adjustedBy]
      );
      adjustment = inserted[0];
    }

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('milk_collection_adjustment', $1, $2, $3::jsonb, $4, $5)`,
      [adjustment.id, previousAdjustment ? 'corrected' : adjustmentType,
        JSON.stringify({ collectionCenterId, date, period, lossPercentage, reason,
          originalVolume, lostVolume, validVolume, affectedRecords: rows.length }), adjustedBy, ownerUserId]
    );

    await client.query('COMMIT');
    return {
      adjustment,
      repeated: false,
      corrected: isCorrection,
      previousAdjustment: previousAdjustment ? {
        id: previousAdjustment.id,
        period: previousAdjustment.period,
        loss_percentage: previousAdjustment.loss_percentage,
        original_volume_liters: previousAdjustment.original_volume_liters,
        lost_volume_liters: previousAdjustment.lost_volume_liters,
        valid_volume_liters: previousAdjustment.valid_volume_liters,
        reason: previousAdjustment.reason,
        adjusted_by: previousAdjustment.adjusted_by,
        created_at: previousAdjustment.created_at,
      } : null,
      originalAmount,
      validAmount,
      affectedRecords: rows.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getCollectionAdjustment = async ({ ownerUserId, collectionCenterId, date, period = 'all' }) => {
  const { rows } = await getPool().query(
    `SELECT * FROM milk_collection_adjustments
     WHERE owner_user_id = $1 AND collection_center_id = $2 AND collection_date = $3 AND period = $4
     LIMIT 1`,
    [ownerUserId, collectionCenterId, date, period]
  );
  return rows[0] || null;
};

module.exports = { applyCollectionAdjustment, getCollectionAdjustment, round2 };
