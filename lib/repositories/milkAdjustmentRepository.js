const { getPool } = require('../postgres.js');

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const decimalHundredths = (value) => {
  const fixed = Number(value || 0).toFixed(2);
  const [whole, fraction] = fixed.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
};

const calculateLossAmounts = (originalLitres, lossPercentage) => {
  const originalHundredths = decimalHundredths(originalLitres);
  const percentageHundredths = decimalHundredths(lossPercentage);
  const lossProduct = originalHundredths * percentageHundredths;
  const calculatedLossLitres = Number(lossProduct) / 1000000;
  if (percentageHundredths >= 10000n) {
    return { calculatedLossLitres, appliedLossLitres: Number(originalHundredths) / 100 };
  }
  const roundedHalfLitres = ((lossProduct + 250000n) / 500000n) * 50n;
  const appliedHundredths = roundedHalfLitres > originalHundredths ? originalHundredths : roundedHalfLitres;
  return { calculatedLossLitres, appliedLossLitres: Number(appliedHundredths) / 100 };
};

const calculateSessionLosses = ({ morningOriginal, eveningOriginal, period, lossPercentage, currentMorning, currentEvening }) => {
  if (period === 'all') {
    const originalDay = round2(morningOriginal + eveningOriginal);
    const dayLoss = calculateLossAmounts(originalDay, lossPercentage);
    if (lossPercentage >= 100) {
      return {
        validMorning: 0,
        validEvening: 0,
        calculatedLossLitres: dayLoss.calculatedLossLitres,
        appliedLossLitres: originalDay,
      };
    }
    const appliedHundredths = decimalHundredths(dayLoss.appliedLossLitres);
    const totalHalfUnits = appliedHundredths / 50n;
    const morningHundredths = decimalHundredths(morningOriginal);
    const eveningHundredths = decimalHundredths(eveningOriginal);
    const totalHundredths = morningHundredths + eveningHundredths;
    const morningCapacity = morningHundredths / 50n;
    const eveningCapacity = eveningHundredths / 50n;
    if (appliedHundredths % 50n === 0n && totalHalfUnits <= morningCapacity + eveningCapacity) {
      let morningHalfUnits = (totalHalfUnits * morningHundredths + totalHundredths / 2n) / totalHundredths;
      if (morningHalfUnits > morningCapacity) morningHalfUnits = morningCapacity;
      let eveningHalfUnits = totalHalfUnits - morningHalfUnits;
      if (eveningHalfUnits > eveningCapacity) {
        eveningHalfUnits = eveningCapacity;
        morningHalfUnits = totalHalfUnits - eveningHalfUnits;
      }
      return {
        validMorning: round2(morningOriginal - Number(morningHalfUnits * 50n) / 100),
        validEvening: round2(eveningOriginal - Number(eveningHalfUnits * 50n) / 100),
        calculatedLossLitres: dayLoss.calculatedLossLitres,
        appliedLossLitres: dayLoss.appliedLossLitres,
      };
    }
    let morningApplied = originalDay > 0
      ? Math.min(morningOriginal, round2(dayLoss.appliedLossLitres * (morningOriginal / originalDay)))
      : 0;
    let eveningApplied = round2(dayLoss.appliedLossLitres - morningApplied);
    if (eveningApplied > eveningOriginal) {
      morningApplied = round2(Math.min(morningOriginal, morningApplied + eveningApplied - eveningOriginal));
      eveningApplied = round2(dayLoss.appliedLossLitres - morningApplied);
    }
    if (morningApplied > morningOriginal) {
      eveningApplied = round2(Math.min(eveningOriginal, eveningApplied + morningApplied - morningOriginal));
      morningApplied = round2(dayLoss.appliedLossLitres - eveningApplied);
    }
    return {
      validMorning: round2(morningOriginal - morningApplied),
      validEvening: round2(eveningOriginal - eveningApplied),
      calculatedLossLitres: dayLoss.calculatedLossLitres,
      appliedLossLitres: dayLoss.appliedLossLitres,
    };
  }

  const isMorning = period === 'morning';
  const original = isMorning ? morningOriginal : eveningOriginal;
  const loss = calculateLossAmounts(original, lossPercentage);
  return {
    validMorning: isMorning ? round2(morningOriginal - loss.appliedLossLitres) : currentMorning,
    validEvening: isMorning ? currentEvening : round2(eveningOriginal - loss.appliedLossLitres),
    calculatedLossLitres: loss.calculatedLossLitres,
    appliedLossLitres: loss.appliedLossLitres,
  };
};

const buildEligibleRecordsQuery = ({ ownerUserId, collectionCenterId, date, period, forUpdate = false }) => ({
  text: `SELECT mr.*, f.name AS farmer_name
       FROM milk_records mr
       JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
       JOIN collection_centers c
         ON LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
        AND c.id = $1 AND c.owner_user_id = mr.owner_user_id
       WHERE mr.owner_user_id = $2 AND mr.date = $3 AND mr.is_owner_milk = FALSE
         AND CASE WHEN $4 = 'morning' THEN COALESCE(mr.original_volume_morning, mr.volume_morning, 0) > 0
                  WHEN $4 = 'evening' THEN COALESCE(mr.original_volume_evening, mr.volume_evening, 0) > 0
                  ELSE COALESCE(mr.original_volume_morning, mr.volume_morning, 0)
                     + COALESCE(mr.original_volume_evening, mr.volume_evening, 0) > 0 END
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs al
           WHERE al.entity_type = 'milk_record' AND al.entity_id = mr.id
             AND al.owner_user_id = mr.owner_user_id AND al.action IN ('voided', 'corrected')
         )
         AND (mr.status IS NULL OR mr.status <> 'cancelled' OR EXISTS (
           SELECT 1 FROM milk_collection_adjustments mca
           WHERE mca.owner_user_id = mr.owner_user_id AND mca.collection_center_id = $1
             AND mca.collection_date = mr.date AND mca.adjustment_type = 'cancelled'
         ))
       ${forUpdate ? 'FOR UPDATE OF mr' : ''}`,
  values: [collectionCenterId, ownerUserId, date, period],
});

const getAdjustmentScope = (adjustments, period) => {
  const overlapping = adjustments.find((adjustment) => Number(adjustment.loss_percentage) > 0
    && adjustment.period !== period
    && (adjustment.period === 'all' || period === 'all'));
  if (overlapping) {
    throw Object.assign(new Error('Reverse the overlapping milk loss before applying this scope.'), {
      statusCode: 409,
      code: 'MILK_LOSS_SCOPE_OVERLAP',
    });
  }
};

const accountingPeriodForDate = (date) => {
  const day = Number(date.slice(8, 10));
  const monthStart = date.slice(0, 8);
  return {
    startDate: `${monthStart}${day <= 15 ? '01' : '16'}`,
    endDate: day <= 15
      ? `${monthStart}15`
      : new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10),
  };
};

const lossPreviewForRecord = (row, period, lossPercentage) => {
  const morningOriginal = Number(row.original_volume_morning ?? row.volume_morning ?? 0);
  const eveningOriginal = Number(row.original_volume_evening ?? row.volume_evening ?? 0);
  const originalDay = round2(morningOriginal + eveningOriginal);
  const originalAmount = Number(row.original_amount ?? row.amount ?? 0);
  const currentMorning = Number(row.valid_volume_morning ?? morningOriginal);
  const currentEvening = Number(row.valid_volume_evening ?? eveningOriginal);
  const projected = calculateSessionLosses({
    morningOriginal, eveningOriginal, period, lossPercentage, currentMorning, currentEvening,
  });
  const projectedMorning = projected.validMorning;
  const projectedEvening = projected.validEvening;
  const originalScope = period === 'morning' ? morningOriginal : period === 'evening' ? eveningOriginal : originalDay;
  const projectedScope = period === 'morning' ? projectedMorning : period === 'evening' ? projectedEvening
    : round2(projectedMorning + projectedEvening);
  const currentDay = round2(currentMorning + currentEvening);
  const currentAmount = Number(row.valid_amount ?? row.amount ?? 0);
  const projectedAmount = originalDay > 0 ? round2(originalAmount * ((projectedMorning + projectedEvening) / originalDay)) : 0;
  return {
    farmerId: Number(row.farmer_id),
    farmerName: row.farmer_name || `#${row.farmer_id}`,
    originalLitres: originalScope,
    calculatedLossLitres: Number(projected.calculatedLossLitres.toFixed(6)),
    appliedLossLitres: round2(originalScope - projectedScope),
    remainingValidLitres: projectedScope,
    currentValidLitres: period === 'morning' ? currentMorning : period === 'evening' ? currentEvening : currentDay,
    currentMilkValue: currentAmount,
    projectedMilkValue: projectedAmount,
    milkValueChange: round2(currentAmount - projectedAmount),
  };
};

const applyCollectionAdjustment = async ({ ownerUserId, collectionCenterId, date, period, lossPercentage, reason, adjustedBy, poolProvider = getPool }) => {
  const pool = poolProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`milk-adjustment:${ownerUserId}:${collectionCenterId}:${date}`]
    );

    const { rows: adjustments } = await client.query(
      `SELECT * FROM milk_collection_adjustments
       WHERE owner_user_id = $1 AND collection_center_id = $2 AND collection_date = $3
       FOR UPDATE`,
      [ownerUserId, collectionCenterId, date]
    );
    getAdjustmentScope(adjustments, period);
    const previousAdjustment = adjustments.find((adjustment) => adjustment.period === period) || null;

    const eligibleQuery = buildEligibleRecordsQuery({ ownerUserId, collectionCenterId, date, period, forUpdate: true });
    const { rows } = await client.query(eligibleQuery.text, eligibleQuery.values);
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
    const farmerAdjustments = [];

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

      const sessionLoss = calculateSessionLosses({
        morningOriginal,
        eveningOriginal,
        period,
        lossPercentage,
        currentMorning: Number(row.valid_volume_morning ?? morningOriginal),
        currentEvening: Number(row.valid_volume_evening ?? eveningOriginal),
      });
      const { validMorning, validEvening } = sessionLoss;

      const effectiveDay = round2(validMorning + validEvening);
      const lost = round2(dayOriginal - effectiveDay);
      const amountForDay = dayOriginal > 0 ? round2(amountOriginal * (effectiveDay / dayOriginal)) : 0;
      const status = period === 'all' && lossPercentage === 100
        ? 'cancelled'
        : lost === 0 ? 'valid' : 'adjusted';
      const originalForScope = period === 'morning' ? morningOriginal : period === 'evening' ? eveningOriginal : dayOriginal;
      const validForScope = period === 'morning' ? validMorning : period === 'evening' ? validEvening : effectiveDay;
      const calculatedForScope = sessionLoss.calculatedLossLitres;
      originalVolume += originalForScope;
      validVolume += validForScope;
      originalAmount += amountOriginal;
      validAmount += amountForDay;
      farmerAdjustments.push({
        farmerId: Number(row.farmer_id),
        originalLitres: originalForScope,
        lossPercentage,
        calculatedLossLitres: Number(calculatedForScope.toFixed(6)),
        appliedLossLitres: round2(originalForScope - validForScope),
        remainingValidLitres: validForScope,
      });

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
          originalVolume, lostVolume, validVolume, affectedRecords: rows.length,
          affectedAccountingPeriods: [accountingPeriodForDate(date)], farmerAdjustments }), adjustedBy, ownerUserId]
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

const previewCollectionAdjustment = async ({ ownerUserId, collectionCenterId, date, period, lossPercentage, poolProvider = getPool }) => {
  const pool = poolProvider();
  const { rows: adjustments } = await pool.query(
    `SELECT * FROM milk_collection_adjustments
     WHERE owner_user_id = $1 AND collection_center_id = $2 AND collection_date = $3`,
    [ownerUserId, collectionCenterId, date]
  );
  getAdjustmentScope(adjustments, period);
  const eligibleQuery = buildEligibleRecordsQuery({ ownerUserId, collectionCenterId, date, period });
  const { rows } = await pool.query(eligibleQuery.text, eligibleQuery.values);
  const farmers = rows.map((row) => lossPreviewForRecord(row, period, lossPercentage));
  return {
    farmers,
    affectedRecords: farmers.length,
    originalLitres: round2(farmers.reduce((sum, farmer) => sum + farmer.originalLitres, 0)),
    calculatedLossLitres: Number(farmers.reduce((sum, farmer) => sum + farmer.calculatedLossLitres, 0).toFixed(6)),
    appliedLossLitres: round2(farmers.reduce((sum, farmer) => sum + farmer.appliedLossLitres, 0)),
    remainingValidLitres: round2(farmers.reduce((sum, farmer) => sum + farmer.remainingValidLitres, 0)),
    estimatedFarmerMilkValueChange: round2(farmers.reduce((sum, farmer) => sum + farmer.milkValueChange, 0)),
    estimatedOwnerMilkDifferenceChange: round2(farmers.reduce((sum, farmer) => sum + farmer.milkValueChange, 0)),
    affectedAccountingPeriods: [accountingPeriodForDate(date)],
    ownerMilkExcluded: true,
  };
};

module.exports = { applyCollectionAdjustment, getCollectionAdjustment, previewCollectionAdjustment, round2, calculateLossAmounts, calculateSessionLosses };
