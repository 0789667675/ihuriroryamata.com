const { getPool } = require('../postgres.js');
const { resolveCollectorScope } = require('./domainRepository.js');

const mergeError = (message, code, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

const writeAudit = async (client, { ownerUserId, actorId, entityId, action, details }) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('farmer_merge', $1, $2, $3::jsonb, $4, $5)`,
    [entityId, action, JSON.stringify(details), actorId, ownerUserId]
  );
};

const resolveScope = async ({ ownerUserId, collectorUserId, client }) => {
  const scope = await resolveCollectorScope({ collectorUserId, ownerUserId, client });
  return {
    ownerUserId: Number(scope.ownerUserId),
    collectorUserId: scope.dairyUserId ? Number(collectorUserId) : null,
  };
};

const loadFarmers = async ({ sourceFarmerId, targetFarmerId, ownerUserId, collectorUserId, client, lock = false }) => {
  const collectorFilter = collectorUserId === null ? '' : ' AND collector_user_id = $3';
  const values = collectorUserId === null
    ? [[sourceFarmerId, targetFarmerId], ownerUserId]
    : [[sourceFarmerId, targetFarmerId], ownerUserId, collectorUserId];
  const { rows } = await client.query(
    `SELECT id, name, owner_user_id, farmer_number, collection_center, location, collector_user_id
     FROM farmers WHERE id = ANY($1::bigint[]) AND owner_user_id = $2${collectorFilter}
     ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    values
  );
  const source = rows.find((farmer) => Number(farmer.id) === Number(sourceFarmerId)) || null;
  const target = rows.find((farmer) => Number(farmer.id) === Number(targetFarmerId)) || null;
  if (!source || !target) throw mergeError('Both farmers must exist under the same owner and active Collector scope.', 'FARMER_MERGE_NOT_FOUND', 404);
  if (Number(source.id) === Number(target.id)) throw mergeError('Choose two different farmer profiles.', 'FARMER_MERGE_SAME_FARMER', 400);
  const centerKey = (farmer) => String(farmer.collection_center || farmer.location || '').trim().toLowerCase();
  if (centerKey(source) !== centerKey(target) || Number(source.collector_user_id || 0) !== Number(target.collector_user_id || 0)) {
    throw mergeError('Farmers must share the same collection center and Collector scope before merging.', 'FARMER_MERGE_SCOPE_MISMATCH');
  }
  return { source, target };
};

const recalculateAdjustments = async (client, { adjustmentIds, ownerUserId, actorId, sourceFarmerId, targetFarmerId }) => {
  const { rows: adjustments } = await client.query(
    `SELECT id, collection_center_id, collection_date, period FROM milk_collection_adjustments
     WHERE id = ANY($1::bigint[]) AND owner_user_id = $2 ORDER BY id`,
    [adjustmentIds, ownerUserId]
  );
  const result = [];
  for (const adjustment of adjustments) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::integer AS records,
        COALESCE(SUM(CASE WHEN $3='morning' THEN COALESCE(original_volume_morning,volume_morning)
          WHEN $3='evening' THEN COALESCE(original_volume_evening,volume_evening) ELSE COALESCE(original_volume_liters,volume_liters) END),0)::numeric(14,2)::text AS original_volume,
        COALESCE(SUM(CASE WHEN $3='morning' THEN COALESCE(original_volume_morning,volume_morning)-COALESCE(valid_volume_morning,volume_morning)
          WHEN $3='evening' THEN COALESCE(original_volume_evening,volume_evening)-COALESCE(valid_volume_evening,volume_evening)
          ELSE COALESCE(lost_volume_liters,0) END),0)::numeric(14,2)::text AS lost_volume,
        COALESCE(SUM(CASE WHEN $3='morning' THEN COALESCE(valid_volume_morning,volume_morning)
          WHEN $3='evening' THEN COALESCE(valid_volume_evening,volume_evening) ELSE COALESCE(valid_volume_liters,volume_liters) END),0)::numeric(14,2)::text AS valid_volume
       FROM milk_records mr JOIN farmers f ON f.id=mr.farmer_id AND f.owner_user_id=mr.owner_user_id
       JOIN collection_centers c ON c.owner_user_id=f.owner_user_id
         AND LOWER(BTRIM(c.name))=LOWER(BTRIM(COALESCE(NULLIF(f.collection_center,''),f.location)))
       WHERE mr.owner_user_id=$1 AND c.id=$2 AND mr.date=$4`,
      [ownerUserId, adjustment.collection_center_id, adjustment.period, adjustment.collection_date]
    );
    const totals = rows[0];
    if (!Number(totals.records)) {
      await client.query('DELETE FROM milk_collection_adjustments WHERE id=$1 AND owner_user_id=$2', [adjustment.id, ownerUserId]);
      await writeAudit(client, { ownerUserId, actorId, entityId: adjustment.id, action: 'removed_after_farmer_merge', details: { sourceFarmerId, targetFarmerId, date: adjustment.collection_date, period: adjustment.period } });
      result.push({ adjustmentId: Number(adjustment.id), removed: true });
      continue;
    }
    const originalVolume = Number(totals.original_volume);
    const lostVolume = Number(totals.lost_volume);
    const validVolume = Number(totals.valid_volume);
    const lossPercentage = originalVolume > 0 ? Number((lostVolume / originalVolume * 100).toFixed(2)) : 0;
    await client.query(
      `UPDATE milk_collection_adjustments SET original_volume_liters=$1, lost_volume_liters=$2,
       valid_volume_liters=$3, loss_percentage=$4 WHERE id=$5 AND owner_user_id=$6`,
      [originalVolume, lostVolume, validVolume, lossPercentage, adjustment.id, ownerUserId]
    );
    await writeAudit(client, { ownerUserId, actorId, entityId: adjustment.id, action: 'recalculated_after_farmer_merge', details: { sourceFarmerId, targetFarmerId, recordsRemaining: Number(totals.records), originalVolume, lostVolume, validVolume, lossPercentage } });
    result.push({ adjustmentId: Number(adjustment.id), removed: false, recordsRemaining: Number(totals.records), originalVolume, lostVolume, validVolume });
  }
  return result;
};

const getMergeCounts = async (client, farmerId, ownerUserId) => {
  const tables = {
    milkRecords: 'SELECT COUNT(*)::integer AS count FROM milk_records WHERE farmer_id=$1 AND owner_user_id=$2',
    deductions: 'SELECT COUNT(*)::integer AS count FROM deductions WHERE farmer_id=$1 AND owner_user_id=$2',
    payments: 'SELECT COUNT(*)::integer AS count FROM farmer_payments WHERE farmer_id=$1 AND owner_user_id=$2',
    settlements: 'SELECT COUNT(*)::integer AS count FROM farmer_settlement_records WHERE farmer_id=$1 AND owner_user_id=$2',
    debts: 'SELECT COUNT(*)::integer AS count FROM farmer_debt_ledgers WHERE farmer_id=$1 AND owner_user_id=$2',
    notifications: 'SELECT COUNT(*)::integer AS count FROM notifications WHERE farmer_id=$1 AND owner_user_id=$2',
  };
  const counts = {};
  for (const [key, sql] of Object.entries(tables)) {
    const { rows } = await client.query(sql, [farmerId, ownerUserId]);
    counts[key] = Number(rows[0]?.count || 0);
  }
  const { rows } = await client.query(
    `SELECT COUNT(*)::integer AS count FROM farmer_debt_repayments r
     JOIN farmer_debt_ledgers d ON d.id=r.debt_ledger_id AND d.owner_user_id=r.owner_user_id
     WHERE d.farmer_id=$1 AND d.owner_user_id=$2`,
    [farmerId, ownerUserId]
  );
  counts.debtRepayments = Number(rows[0]?.count || 0);
  return counts;
};

const findMilkConflicts = async (client, sourceFarmerId, targetFarmerId, ownerUserId) => {
  const { rows } = await client.query(
    `SELECT s.id AS source_record_id, t.id AS target_record_id, s.date,
       s.volume_morning AS source_morning, s.volume_evening AS source_evening,
       t.volume_morning AS target_morning, t.volume_evening AS target_evening,
      s.volume_liters AS source_volume, t.volume_liters AS target_volume,
       s.valid_volume_liters AS source_valid, t.valid_volume_liters AS target_valid,
      s.original_volume_liters AS source_original, t.original_volume_liters AS target_original,
      s.lost_volume_liters AS source_lost, t.lost_volume_liters AS target_lost,
      s.amount AS source_amount, t.amount AS target_amount,
      s.valid_amount AS source_valid_amount, t.valid_amount AS target_valid_amount,
      s.original_amount AS source_original_amount, t.original_amount AS target_original_amount,
      s.price_per_liter AS source_price, t.price_per_liter AS target_price,
      s.transport_rate_per_liter AS source_transport_rate, t.transport_rate_per_liter AS target_transport_rate,
      s.original_volume_morning AS source_original_morning, t.original_volume_morning AS target_original_morning,
      s.original_volume_evening AS source_original_evening, t.original_volume_evening AS target_original_evening,
      s.valid_volume_morning AS source_valid_morning, t.valid_volume_morning AS target_valid_morning,
      s.valid_volume_evening AS source_valid_evening, t.valid_volume_evening AS target_valid_evening,
      s.loss_percentage AS source_loss_percentage, t.loss_percentage AS target_loss_percentage,
       s.status AS source_status, t.status AS target_status,
      s.adjustment_reason AS source_reason, t.adjustment_reason AS target_reason,
      s.adjusted_by AS source_adjusted_by, t.adjusted_by AS target_adjusted_by,
      s.adjusted_at AS source_adjusted_at, t.adjusted_at AS target_adjusted_at,
       s.collection_session_id AS source_session, t.collection_session_id AS target_session
     FROM milk_records s JOIN milk_records t ON t.owner_user_id=s.owner_user_id
       AND t.date=s.date AND t.farmer_id=$2
     WHERE s.owner_user_id=$3 AND s.farmer_id=$1
     ORDER BY s.date, s.id, t.id`,
    [sourceFarmerId, targetFarmerId, ownerUserId]
  );
  return rows.map((row) => ({
    sourceRecordId: Number(row.source_record_id),
    targetRecordId: Number(row.target_record_id),
    date: row.date instanceof Date ? row.date.toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' }) : String(row.date).slice(0, 10),
    source: {
      morning: Number(row.source_morning || 0), evening: Number(row.source_evening || 0), valid: Number(row.source_valid ?? 0),
      volume: Number(row.source_volume || 0), original: Number(row.source_original ?? row.source_volume ?? 0), lost: Number(row.source_lost || 0),
      amount: Number(row.source_amount || 0), validAmount: Number(row.source_valid_amount ?? row.source_amount ?? 0),
      originalAmount: Number(row.source_original_amount ?? row.source_amount ?? 0), price: Number(row.source_price || 0), transportRate: Number(row.source_transport_rate || 0),
      originalMorning: Number(row.source_original_morning ?? row.source_morning ?? 0), originalEvening: Number(row.source_original_evening ?? row.source_evening ?? 0),
      validMorning: Number(row.source_valid_morning ?? row.source_morning ?? 0), validEvening: Number(row.source_valid_evening ?? row.source_evening ?? 0),
      lossPercentage: Number(row.source_loss_percentage || 0), reason: row.source_reason, adjustedBy: row.source_adjusted_by, adjustedAt: row.source_adjusted_at, status: row.source_status, sessionId: row.source_session,
    },
    target: {
      morning: Number(row.target_morning || 0), evening: Number(row.target_evening || 0), valid: Number(row.target_valid ?? 0),
      volume: Number(row.target_volume || 0), original: Number(row.target_original ?? row.target_volume ?? 0), lost: Number(row.target_lost || 0),
      amount: Number(row.target_amount || 0), validAmount: Number(row.target_valid_amount ?? row.target_amount ?? 0),
      originalAmount: Number(row.target_original_amount ?? row.target_amount ?? 0), price: Number(row.target_price || 0), transportRate: Number(row.target_transport_rate || 0),
      originalMorning: Number(row.target_original_morning ?? row.target_morning ?? 0), originalEvening: Number(row.target_original_evening ?? row.target_evening ?? 0),
      validMorning: Number(row.target_valid_morning ?? row.target_morning ?? 0), validEvening: Number(row.target_valid_evening ?? row.target_evening ?? 0),
      lossPercentage: Number(row.target_loss_percentage || 0), reason: row.target_reason, adjustedBy: row.target_adjusted_by, adjustedAt: row.target_adjusted_at, status: row.target_status, sessionId: row.target_session,
    },
  }));
};

const getFarmerMergePreview = async ({ sourceFarmerId, targetFarmerId, ownerUserId, collectorUserId = null, poolProvider = getPool }) => {
  const client = await poolProvider().connect();
  try {
    const scope = await resolveScope({ ownerUserId, collectorUserId, client });
    const { source, target } = await loadFarmers({ sourceFarmerId, targetFarmerId, ...scope, client });
    const sourceCounts = await getMergeCounts(client, sourceFarmerId, scope.ownerUserId);
    const targetCounts = await getMergeCounts(client, targetFarmerId, scope.ownerUserId);
    const conflictsResult = await findMilkConflicts(client, sourceFarmerId, targetFarmerId, scope.ownerUserId);
    const settlementConflicts = await client.query(
      `SELECT s.id AS source_id, t.id AS target_id, s.payment_type, s.payment_reference
       FROM farmer_settlement_records s JOIN farmer_settlement_records t
         ON t.owner_user_id=s.owner_user_id AND t.farmer_id=$2 AND t.payment_type=s.payment_type
        AND t.payment_reference=s.payment_reference
       WHERE s.owner_user_id=$3 AND s.farmer_id=$1 AND s.payment_reference IS NOT NULL`,
      [sourceFarmerId, targetFarmerId, scope.ownerUserId]
    );
    return {
      source: { id: Number(source.id), name: source.name, counts: sourceCounts },
      target: { id: Number(target.id), name: target.name, counts: targetCounts },
      milkConflicts: conflictsResult,
      settlementReferenceConflicts: settlementConflicts.rows.map((row) => ({
        sourceId: Number(row.source_id), targetId: Number(row.target_id), paymentType: row.payment_type, paymentReference: row.payment_reference,
      })),
    };
  } finally {
    client.release();
  }
};

const mergeFarmers = async ({ sourceFarmerId, targetFarmerId, ownerUserId, collectorUserId = null, actorId, reason, resolutions = [], poolProvider = getPool }) => {
  if (Number(sourceFarmerId) === Number(targetFarmerId)) throw mergeError('Choose two different farmer profiles.', 'FARMER_MERGE_SAME_FARMER', 400);
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length < 5 || normalizedReason.length > 500) throw mergeError('A merge reason of 5 to 500 characters is required.', 'FARMER_MERGE_REASON_REQUIRED', 400);
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const scope = await resolveScope({ ownerUserId, collectorUserId, client });
    const { source, target } = await loadFarmers({ sourceFarmerId, targetFarmerId, ...scope, client, lock: true });
    const conflicts = await findMilkConflicts(client, sourceFarmerId, targetFarmerId, scope.ownerUserId);
    const settlementConflicts = await client.query(
      `SELECT s.id AS source_id, t.id AS target_id FROM farmer_settlement_records s
       JOIN farmer_settlement_records t ON t.owner_user_id=s.owner_user_id AND t.farmer_id=$2
        AND t.payment_type=s.payment_type AND t.payment_reference=s.payment_reference
       WHERE s.owner_user_id=$3 AND s.farmer_id=$1 AND s.payment_reference IS NOT NULL`,
      [sourceFarmerId, targetFarmerId, scope.ownerUserId]
    );
    if (settlementConflicts.rows.length) throw mergeError('Settlement references collide. Resolve these financial references before merging.', 'FARMER_MERGE_SETTLEMENT_REFERENCE_CONFLICT');
    const resolutionsByKey = new Map((Array.isArray(resolutions) ? resolutions : []).map((item) => {
      const sourceRecordId = Number(item.sourceRecordId);
      const targetRecordId = Number(item.targetRecordId);
      const action = item.action || (Number(item.keepRecordId) === sourceRecordId ? 'keep_source' : 'keep_target');
      return [`${sourceRecordId}:${targetRecordId}`, action];
    }));
    for (const conflict of conflicts) {
      const action = resolutionsByKey.get(`${conflict.sourceRecordId}:${conflict.targetRecordId}`);
      if (!['keep_source', 'keep_target', 'combine'].includes(action)) {
        throw mergeError(`Choose which delivery to keep or combine for ${conflict.date}.`, 'FARMER_MERGE_MILK_RESOLUTION_REQUIRED', 400);
      }
    }
    if (resolutionsByKey.size !== conflicts.length) throw mergeError('The delivery resolution list does not match the current conflicts.', 'FARMER_MERGE_MILK_RESOLUTION_INVALID', 400);

    const { rows: adjustmentRows } = await client.query(
      `SELECT DISTINCT mca.id FROM milk_collection_adjustments mca
       JOIN collection_centers c ON c.id=mca.collection_center_id AND c.owner_user_id=mca.owner_user_id
       JOIN farmers f ON f.owner_user_id=c.owner_user_id
         AND LOWER(BTRIM(COALESCE(NULLIF(f.collection_center,''),f.location)))=LOWER(BTRIM(c.name))
       JOIN milk_records mr ON mr.farmer_id=f.id AND mr.owner_user_id=f.owner_user_id AND mr.date=mca.collection_date
       WHERE f.id=ANY($1::bigint[]) AND f.owner_user_id=$2 AND mca.owner_user_id=$2`,
      [[Number(sourceFarmerId), Number(targetFarmerId)], scope.ownerUserId]
    );
    let duplicateRecordsRemoved = 0;
    let distinctRecordsCombined = 0;
    for (const conflict of conflicts) {
      const action = resolutionsByKey.get(`${conflict.sourceRecordId}:${conflict.targetRecordId}`);
      let keepId;
      let removeId;
      if (action === 'combine') {
        const source = conflict.source;
        const target = conflict.target;
        const originalVolume = source.original + target.original;
        const validVolume = source.valid + target.valid;
        const lostVolume = source.lost + target.lost;
        const originalAmount = source.originalAmount + target.originalAmount;
        const validAmount = source.validAmount + target.validAmount;
        const validMorning = source.validMorning + target.validMorning;
        const validEvening = source.validEvening + target.validEvening;
        const originalMorning = source.originalMorning + target.originalMorning;
        const originalEvening = source.originalEvening + target.originalEvening;
        const pricePerLiter = validVolume > 0 ? validAmount / validVolume : originalVolume > 0 ? originalAmount / originalVolume : 0;
        const transportRate = validVolume > 0
          ? (source.valid * source.transportRate + target.valid * target.transportRate) / validVolume
          : target.transportRate || source.transportRate;
        const status = source.status === 'cancelled' && target.status === 'cancelled'
          ? 'cancelled'
          : source.status !== 'valid' || target.status !== 'valid' || lostVolume > 0 ? 'adjusted' : 'valid';
        const reasons = [target.reason, source.reason].filter(Boolean).map(String);
        const adjustedAt = [source.adjustedAt, target.adjustedAt].filter(Boolean).sort((left, right) => new Date(left) - new Date(right)).at(-1) || null;
        const updated = await client.query(
          `UPDATE milk_records SET volume_liters=$1, volume_morning=$2, volume_evening=$3,
           original_volume_liters=$4, valid_volume_liters=$5, lost_volume_liters=$6,
           amount=$7, original_amount=$8, valid_amount=$9,
           original_volume_morning=$10, original_volume_evening=$11,
           valid_volume_morning=$12, valid_volume_evening=$13,
           price_per_liter=$14, transport_rate_per_liter=CASE WHEN $5::numeric > 0 THEN $15::numeric ELSE transport_rate_per_liter END,
           loss_percentage=CASE WHEN $4::numeric > 0 THEN ($6::numeric / $4::numeric) * 100 ELSE 0 END,
           status=$16::milk_status, adjustment_reason=$17, adjusted_by=COALESCE(adjusted_by,$18),
           adjusted_at=COALESCE($19,adjusted_at), collection_session_id=CASE WHEN collection_session_id=$20 THEN collection_session_id ELSE NULL END,
           updated_at=NOW() WHERE id=$21 AND owner_user_id=$22`,
          [originalVolume, originalMorning, originalEvening, originalVolume, validVolume, lostVolume,
            originalAmount, originalAmount, validAmount, originalMorning, originalEvening, validMorning, validEvening,
            pricePerLiter, transportRate, status, reasons.join(' | ').slice(0, 500) || null,
            source.adjustedBy || target.adjustedBy, adjustedAt,
            source.sessionId === target.sessionId ? source.sessionId : null, conflict.targetRecordId, scope.ownerUserId]
        );
        if (updated.rowCount !== 1) throw mergeError('The canonical milk record changed during merge. Refresh the preview.', 'FARMER_MERGE_CONFLICT_CHANGED');
        keepId = conflict.targetRecordId;
        removeId = conflict.sourceRecordId;
        distinctRecordsCombined += 1;
      } else {
        keepId = action === 'keep_source' ? conflict.sourceRecordId : conflict.targetRecordId;
        removeId = action === 'keep_source' ? conflict.targetRecordId : conflict.sourceRecordId;
      }
      const { rows: removed } = await client.query('DELETE FROM milk_records WHERE id=$1 AND owner_user_id=$2 RETURNING *', [removeId, scope.ownerUserId]);
      if (!removed[0]) throw mergeError('A conflicting milk record changed during merge. Refresh the preview.', 'FARMER_MERGE_CONFLICT_CHANGED');
      await writeAudit(client, {
        ownerUserId: scope.ownerUserId, actorId, entityId: removeId, action: 'duplicate_removed_by_farmer_merge',
        details: { sourceFarmerId: Number(sourceFarmerId), targetFarmerId: Number(targetFarmerId), resolution: action, keptRecordId: keepId, removedRecord: removed[0], reason: normalizedReason },
      });
      duplicateRecordsRemoved += 1;
    }

    const moved = {};
    for (const [key, table] of Object.entries({ milkRecords: 'milk_records', deductions: 'deductions', payments: 'farmer_payments', settlements: 'farmer_settlement_records', debts: 'farmer_debt_ledgers' })) {
      const { rowCount } = await client.query(
        `UPDATE ${table} SET farmer_id=$1 WHERE farmer_id=$2 AND owner_user_id=$3`,
        [Number(targetFarmerId), Number(sourceFarmerId), scope.ownerUserId]
      );
      moved[key] = Number(rowCount || 0);
    }
    const { rows: sourceNotifications } = await client.query(
      `SELECT id, dedupe_key, details FROM notifications WHERE farmer_id=$1 AND owner_user_id=$2 FOR UPDATE`,
      [Number(sourceFarmerId), scope.ownerUserId]
    );
    let notificationsMerged = 0;
    for (const notification of sourceNotifications) {
      const { rows: duplicates } = await client.query(
        `SELECT id FROM notifications WHERE farmer_id=$1 AND owner_user_id=$2 AND dedupe_key=$3 LIMIT 1 FOR UPDATE`,
        [Number(targetFarmerId), scope.ownerUserId, notification.dedupe_key]
      );
      if (duplicates[0]) {
        await client.query('DELETE FROM notifications WHERE id=$1 AND owner_user_id=$2', [notification.id, scope.ownerUserId]);
        await writeAudit(client, {
          ownerUserId: scope.ownerUserId, actorId, entityId: notification.id, action: 'duplicate_notification_merged',
          details: { sourceFarmerId: Number(sourceFarmerId), targetFarmerId: Number(targetFarmerId), retainedNotificationId: Number(duplicates[0].id), reason: normalizedReason },
        });
      } else {
        await client.query('UPDATE notifications SET farmer_id=$1 WHERE id=$2 AND owner_user_id=$3', [Number(targetFarmerId), notification.id, scope.ownerUserId]);
      }
      notificationsMerged += 1;
    }
    moved.notifications = notificationsMerged;

    const adjustmentRecalculation = await recalculateAdjustments(client, {
      adjustmentIds: adjustmentRows.map((row) => Number(row.id)),
      ownerUserId: scope.ownerUserId,
      actorId,
      sourceFarmerId: Number(sourceFarmerId),
      targetFarmerId: Number(targetFarmerId),
    });
    await writeAudit(client, {
      ownerUserId: scope.ownerUserId, actorId, entityId: Number(sourceFarmerId), action: 'merged_into_farmer',
      details: { sourceFarmer: source, targetFarmer: target, reason: normalizedReason, moved, duplicateRecordsRemoved, distinctRecordsCombined, adjustmentRecalculation },
    });
    await writeAudit(client, {
      ownerUserId: scope.ownerUserId, actorId, entityId: Number(targetFarmerId), action: 'received_farmer_merge',
      details: { sourceFarmerId: Number(sourceFarmerId), reason: normalizedReason, moved, duplicateRecordsRemoved, distinctRecordsCombined },
    });
    const { rowCount: deletedSource } = await client.query('DELETE FROM farmers WHERE id=$1 AND owner_user_id=$2', [Number(sourceFarmerId), scope.ownerUserId]);
    if (deletedSource !== 1) throw mergeError('Source farmer could not be removed.', 'FARMER_MERGE_SOURCE_DELETE_FAILED');
    await client.query('COMMIT');
    return { sourceFarmerId: Number(sourceFarmerId), targetFarmerId: Number(targetFarmerId), moved, duplicateRecordsRemoved, distinctRecordsCombined, adjustmentRecalculation };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { getFarmerMergePreview, mergeFarmers };