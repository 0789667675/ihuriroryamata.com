const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const isolatedUrl = process.env.MILK_SYSTEM_TEST_DATABASE_URL || '';
const safeUrl = (() => {
  if (!isolatedUrl) return false;
  try {
    const url = new URL(isolatedUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && decodeURIComponent(url.pathname.slice(1)) === 'milk_system_agent_test';
  } catch {
    return false;
  }
})();

if (isolatedUrl && !safeUrl) {
  throw new Error('Refusing farmer deletion integration tests unless MILK_SYSTEM_TEST_DATABASE_URL targets loopback database milk_system_agent_test.');
}

test('permanent farmer deletion archives payment evidence, removes owned active history, and recalculates adjustments', {
  skip: !safeUrl && 'Set MILK_SYSTEM_TEST_DATABASE_URL to the isolated local milk_system_agent_test database.',
}, async () => {
  const pool = new Pool({ connectionString: isolatedUrl, ssl: false, max: 2 });
  const Domain = require('../lib/repositories/domainRepository.js');
  let ownerId = null;
  let unrelatedFarmerId = null;

  try {
    const identity = await pool.query('SELECT current_database() AS database, inet_server_addr()::text AS address');
    assert.equal(identity.rows[0].database, 'milk_system_agent_test');
    assert.match(identity.rows[0].address, /^127\.0\.0\.1\//);

    const suffix = crypto.randomUUID();
    const users = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Synthetic deletion owner', `farmer-delete-${suffix}@example.test`, 'not-a-real-login-hash']
    );
    ownerId = Number(users.rows[0].id);
    const centers = await pool.query(
      `INSERT INTO collection_centers (name, owner_user_id, price_per_liter, transport_rate_per_liter)
       VALUES ($1, $2, 400, 20) RETURNING id`,
      [`Synthetic center ${suffix}`, ownerId]
    );
    const centerId = Number(centers.rows[0].id);
    const farmers = await pool.query(
      `INSERT INTO farmers (name, owner_user_id, collection_center)
       VALUES ($1, $2, $3) RETURNING id`,
      [`Synthetic deletion farmer ${suffix}`, ownerId, `Synthetic center ${suffix}`]
    );
    const farmerId = Number(farmers.rows[0].id);
    const unrelated = await pool.query(
      `INSERT INTO farmers (name, owner_user_id, collection_center)
       VALUES ($1, $2, $3) RETURNING id`,
      [`Synthetic unrelated farmer ${suffix}`, ownerId, `Synthetic center ${suffix}`]
    );
    unrelatedFarmerId = Number(unrelated.rows[0].id);

    await pool.query(
      `INSERT INTO milk_records
       (farmer_id, owner_user_id, date, month, year, day, volume_liters, volume_morning, volume_evening,
        price_per_liter, amount, status, original_volume_liters, valid_volume_liters, lost_volume_liters,
        original_amount, valid_amount, original_volume_morning, original_volume_evening,
        valid_volume_morning, valid_volume_evening, adjusted_by, adjusted_at)
       VALUES ($1, $2, '2026-11-03', 11, 2026, 3, 10, 10, 0, 400, 4000, 'adjusted', 10, 9, 1,
        4000, 3600, 10, 0, 9, 0, $3, NOW())`,
      [farmerId, ownerId, ownerId]
    );
    await pool.query(
      `INSERT INTO deductions (farmer_id, owner_user_id, amount, type, status, reason, date)
       VALUES ($1, $2, 100, 'Other', 'Active', 'Synthetic test', '2026-11-03')`,
      [farmerId, ownerId]
    );
    const debts = await pool.query(
      `INSERT INTO farmer_debt_ledgers (farmer_id, owner_user_id, opening_balance, remaining_balance, period_start, period_end, reason, created_by)
       VALUES ($1, $2, 50, 25, '2026-11-01', '2026-11-15', 'Synthetic test', $2) RETURNING id`,
      [farmerId, ownerId]
    );
    await pool.query(
      `INSERT INTO farmer_debt_repayments (debt_ledger_id, owner_user_id, actor_id, request_key, amount, balance_after, reason)
       VALUES ($1, $2, $2, $3, 25, 25, 'Synthetic partial recovery')`,
      [debts.rows[0].id, ownerId, `repayment-${suffix}`]
    );
    await pool.query(
      `INSERT INTO farmer_payments (farmer_id, owner_user_id, period_start, period_end, amount, paid_amount, status)
       VALUES ($1, $2, '2026-11-01', '2026-11-15', 1000, 500, 'Partially paid')`,
      [farmerId, ownerId]
    );
    await pool.query(
      `INSERT INTO farmer_settlement_records
       (farmer_id, owner_user_id, payment_method, payment_type, amount, settled_amount, remaining_amount, status,
        approval_status, period_start, period_end, actual_payment_at, payment_reference)
       VALUES ($1, $2, 'CASH', 'CASH', 500, 500, 0, 'CONFIRMED', 'APPROVED', '2026-11-01', '2026-11-15', NOW(), $3)`,
      [farmerId, ownerId, `cash-${suffix}`]
    );
    await pool.query(
      `INSERT INTO notifications (notification_type, title, message, farmer_id, owner_user_id, dedupe_key)
       VALUES ('farmer_absent', 'Synthetic', 'Synthetic test', $1, $2, $3)`,
      [farmerId, ownerId, `notice-${suffix}`]
    );
    await pool.query(
      `INSERT INTO milk_collection_adjustments
       (owner_user_id, collection_center_id, collection_date, period, adjustment_type, loss_percentage,
        original_volume_liters, lost_volume_liters, valid_volume_liters, reason, adjusted_by)
       VALUES ($1, $2, '2026-11-03', 'all', 'partial_loss', 10, 10, 1, 9, 'Synthetic test', $1)`,
      [ownerId, centerId]
    );

    const client = await pool.connect();
    let impact;
    try {
      impact = await Domain.getFarmerDeletionImpact(farmerId, ownerId, client);
    } finally {
      client.release();
    }
    assert.equal(impact.counts.milkRecords, 1);
    assert.equal(impact.counts.milkLosses, 1);
    assert.equal(impact.counts.milkCorrections, 1);
    assert.equal(impact.counts.deductions, 1);
    assert.equal(impact.counts.debtLedgers, 1);
    assert.equal(impact.counts.debtRepayments, 1);
    assert.equal(impact.counts.settledRecordsWithExternalEvidence, 1);
    assert.deepEqual(impact.affectedPeriods, [{ start: '2026-11-01', end: '2026-11-15' }]);

    await assert.rejects(
      () => Domain.deleteFarmer({ id: farmerId, ownerUserId: ownerId, actorId: ownerId, reason: 'Synthetic reason', confirmationName: 'wrong', poolProvider: () => pool }),
      (error) => error.code === 'FARMER_DELETE_CONFIRMATION_MISMATCH'
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM farmers WHERE id = $1 AND owner_user_id = $2', [farmerId, ownerId])).rows[0].count), 1);

    const result = await Domain.deleteFarmer({
      id: farmerId,
      ownerUserId: ownerId,
      actorId: ownerId,
      reason: 'Mistaken synthetic profile',
      confirmationName: `Synthetic deletion farmer ${suffix}`,
      poolProvider: () => pool,
    });
    assert.equal(result.relatedCounts.milkRecords, 1);
    assert.equal(result.adjustmentRecalculation.length, 1);
    assert.equal(result.adjustmentRecalculation[0].removed, true);

    const [farmer, childCounts, archive, audit, adjustment, unrelatedFarmer] = await Promise.all([
      pool.query('SELECT COUNT(*)::integer AS count FROM farmers WHERE id = $1', [farmerId]),
      pool.query(`SELECT
        (SELECT COUNT(*) FROM milk_records WHERE farmer_id = $1)::integer AS milk,
        (SELECT COUNT(*) FROM deductions WHERE farmer_id = $1)::integer AS deductions,
        (SELECT COUNT(*) FROM farmer_debt_ledgers WHERE farmer_id = $1)::integer AS debts,
        (SELECT COUNT(*) FROM farmer_settlement_records WHERE farmer_id = $1)::integer AS settlements`, [farmerId]),
      pool.query('SELECT farmer_snapshot, reason, related_counts, settled_payment_evidence FROM farmer_deletion_archives WHERE id = $1 AND owner_user_id = $2', [result.archiveId, ownerId]),
      pool.query(`SELECT COUNT(*)::integer AS count FROM audit_logs WHERE entity_type = 'farmer_deletion' AND entity_id = $1 AND owner_user_id = $2`, [farmerId, ownerId]),
      pool.query('SELECT COUNT(*)::integer AS count FROM milk_collection_adjustments WHERE owner_user_id = $1 AND collection_center_id = $2 AND collection_date = $3', [ownerId, centerId, '2026-11-03']),
      pool.query('SELECT COUNT(*)::integer AS count FROM farmers WHERE id = $1 AND owner_user_id = $2', [unrelatedFarmerId, ownerId]),
    ]);
    assert.equal(farmer.rows[0].count, 0);
    assert.deepEqual(childCounts.rows[0], { milk: 0, deductions: 0, debts: 0, settlements: 0 });
    assert.equal(archive.rows[0].reason, 'Mistaken synthetic profile');
    assert.equal(archive.rows[0].settled_payment_evidence.settlements.length, 1);
    assert.equal(audit.rows[0].count, 1);
    assert.equal(adjustment.rows[0].count, 0);
    assert.equal(unrelatedFarmer.rows[0].count, 1);
  } finally {
    if (ownerId) await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    await pool.end();
  }
});

test('farmer merge requires explicit same-day delivery resolution and transfers distinct history transactionally', {
  skip: !safeUrl && 'Set MILK_SYSTEM_TEST_DATABASE_URL to the isolated local milk_system_agent_test database.',
}, async () => {
  const pool = new Pool({ connectionString: isolatedUrl, ssl: false, max: 2 });
  const FarmerMerge = require('../lib/repositories/farmerMergeRepository.js');
  let ownerId = null;

  try {
    const identity = await pool.query('SELECT current_database() AS database, inet_server_addr()::text AS address');
    assert.equal(identity.rows[0].database, 'milk_system_agent_test');
    assert.match(identity.rows[0].address, /^127\.0\.0\.1\//);

    const suffix = crypto.randomUUID();
    const { rows: owners } = await pool.query('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id', ['Synthetic merge owner', `farmer-merge-${suffix}@example.test`, 'not-a-real-login-hash']);
    ownerId = Number(owners[0].id);
    const centerName = `Synthetic merge center ${suffix}`;
    const { rows: centers } = await pool.query('INSERT INTO collection_centers (name,owner_user_id,price_per_liter) VALUES ($1,$2,400) RETURNING id', [centerName, ownerId]);
    const centerId = Number(centers[0].id);
    const { rows: farmers } = await pool.query(
      'INSERT INTO farmers (name,owner_user_id,collection_center) VALUES ($1,$3,$4),($2,$3,$4) RETURNING id,name',
      [`Synthetic duplicate ${suffix}`, `Synthetic canonical ${suffix}`, ownerId, centerName]
    );
    const source = farmers.find((farmer) => farmer.name.startsWith('Synthetic duplicate'));
    const target = farmers.find((farmer) => farmer.name.startsWith('Synthetic canonical'));
    const sourceId = Number(source.id);
    const targetId = Number(target.id);

    const insertMilk = async (farmerId, date, liters) => pool.query(
      `INSERT INTO milk_records
       (farmer_id,owner_user_id,date,month,year,day,volume_liters,volume_morning,price_per_liter,amount,status,
        original_volume_liters,valid_volume_liters,lost_volume_liters,original_amount,valid_amount,
        original_volume_morning,valid_volume_morning,original_volume_evening,valid_volume_evening)
      VALUES ($1,$2,$3,11,2026,EXTRACT(DAY FROM $3::date)::integer,$4::numeric,$4::numeric,400,$4::numeric*400,'valid',$4::numeric,$4::numeric,0,$4::numeric*400,$4::numeric*400,$4::numeric,$4::numeric,0,0)`,
      [farmerId, ownerId, date, liters]
    );
    await insertMilk(sourceId, '2026-11-03', 10);
    await insertMilk(targetId, '2026-11-03', 4);
    await insertMilk(sourceId, '2026-11-04', 2);
    await insertMilk(targetId, '2026-11-04', 3);
    await insertMilk(sourceId, '2026-11-06', 1);
    await pool.query(
      `INSERT INTO milk_collection_adjustments
       (owner_user_id,collection_center_id,collection_date,period,adjustment_type,loss_percentage,original_volume_liters,lost_volume_liters,valid_volume_liters,reason,adjusted_by)
       VALUES ($1,$2,'2026-11-03','all','partial_loss',10,14,0,14,'Synthetic merge', $1)`,
      [ownerId, centerId]
    );
    await pool.query("INSERT INTO deductions (farmer_id,owner_user_id,amount,type,status,reason,date) VALUES ($1,$2,50,'Other','Active','Synthetic merge','2026-11-03')", [sourceId, ownerId]);
    const { rows: debts } = await pool.query("INSERT INTO farmer_debt_ledgers (farmer_id,owner_user_id,opening_balance,remaining_balance,period_start,period_end,reason) VALUES ($1,$2,30,30,'2026-11-01','2026-11-15','Synthetic merge') RETURNING id", [sourceId, ownerId]);
    await pool.query("INSERT INTO farmer_debt_repayments (debt_ledger_id,owner_user_id,actor_id,request_key,amount,balance_after,reason) VALUES ($1,$2,$2,$3,5,25,'Synthetic merge')", [debts[0].id, ownerId, `merge-repay-${suffix}`]);
    await pool.query("INSERT INTO farmer_settlement_records (farmer_id,owner_user_id,payment_method,payment_type,amount,period_start,period_end,payment_reference) VALUES ($1,$2,'CASH','CASH',100,'2026-11-01','2026-11-15',$3)", [sourceId, ownerId, `merge-settlement-${suffix}`]);

    const preview = await FarmerMerge.getFarmerMergePreview({ sourceFarmerId: sourceId, targetFarmerId: targetId, ownerUserId: ownerId, poolProvider: () => pool });
    assert.equal(preview.milkConflicts.length, 2);
    assert.equal(preview.milkConflicts[0].date, '2026-11-03');
    await assert.rejects(
      () => FarmerMerge.mergeFarmers({ sourceFarmerId: sourceId, targetFarmerId: targetId, ownerUserId: ownerId, actorId: ownerId, reason: 'Synthetic duplicate', poolProvider: () => pool }),
      (error) => error.code === 'FARMER_MERGE_MILK_RESOLUTION_REQUIRED'
    );
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM farmers WHERE id=$1', [sourceId])).rows[0].count), 1);

    const result = await FarmerMerge.mergeFarmers({
      sourceFarmerId: sourceId,
      targetFarmerId: targetId,
      ownerUserId: ownerId,
      actorId: ownerId,
      reason: 'Confirmed duplicate profile',
      resolutions: [
        { sourceRecordId: preview.milkConflicts[0].sourceRecordId, targetRecordId: preview.milkConflicts[0].targetRecordId, action: 'keep_target' },
        { sourceRecordId: preview.milkConflicts[1].sourceRecordId, targetRecordId: preview.milkConflicts[1].targetRecordId, action: 'combine' },
      ],
      poolProvider: () => pool,
    });
    assert.equal(result.duplicateRecordsRemoved, 2);
    assert.equal(result.distinctRecordsCombined, 1);
    assert.equal(result.adjustmentRecalculation.length, 1);
    assert.equal(result.adjustmentRecalculation[0].originalVolume, 4);
    assert.equal(result.adjustmentRecalculation[0].validVolume, 4);
    assert.equal(result.moved.milkRecords, 1);
    assert.equal(result.moved.deductions, 1);
    assert.equal(result.moved.debts, 1);
    const [sourceRows, targetRows, milkRows, mergedMilkRows, deductionRows, debtRows, repaymentRows, settlementRows, auditRows] = await Promise.all([
      pool.query('SELECT COUNT(*)::integer AS count FROM farmers WHERE id=$1', [sourceId]),
      pool.query('SELECT COUNT(*)::integer AS count FROM farmers WHERE id=$1 AND owner_user_id=$2', [targetId, ownerId]),
      pool.query('SELECT COUNT(*)::integer AS count, SUM(volume_liters)::numeric AS liters FROM milk_records WHERE farmer_id=$1 AND owner_user_id=$2', [targetId, ownerId]),
      pool.query(
        `SELECT date::text, volume_liters, volume_morning, volume_evening, original_volume_liters,
          valid_volume_liters, lost_volume_liters, amount, original_amount, valid_amount, price_per_liter
         FROM milk_records WHERE farmer_id=$1 AND owner_user_id=$2 ORDER BY date`,
        [targetId, ownerId]
      ),
      pool.query('SELECT COUNT(*)::integer AS count FROM deductions WHERE farmer_id=$1 AND owner_user_id=$2', [targetId, ownerId]),
      pool.query('SELECT COUNT(*)::integer AS count FROM farmer_debt_ledgers WHERE farmer_id=$1 AND owner_user_id=$2', [targetId, ownerId]),
      pool.query('SELECT COUNT(*)::integer AS count FROM farmer_debt_repayments WHERE debt_ledger_id=$1', [debts[0].id]),
      pool.query('SELECT COUNT(*)::integer AS count FROM farmer_settlement_records WHERE farmer_id=$1 AND owner_user_id=$2', [targetId, ownerId]),
      pool.query("SELECT COUNT(*)::integer AS count FROM audit_logs WHERE entity_type='farmer_merge' AND owner_user_id=$1", [ownerId]),
    ]);
    assert.equal(sourceRows.rows[0].count, 0);
    assert.equal(targetRows.rows[0].count, 1);
    assert.equal(milkRows.rows[0].count, 3);
    assert.equal(Number(milkRows.rows[0].liters), 10);
    assert.deepEqual(mergedMilkRows.rows.map((row) => [
      row.date,
      Number(row.volume_liters),
      Number(row.volume_morning),
      Number(row.volume_evening),
      Number(row.original_volume_liters),
      Number(row.valid_volume_liters),
      Number(row.lost_volume_liters),
      Number(row.amount),
      Number(row.original_amount),
      Number(row.valid_amount),
      Number(row.price_per_liter),
    ]), [
      ['2026-11-03', 4, 4, 0, 4, 4, 0, 1600, 1600, 1600, 400],
      ['2026-11-04', 5, 5, 0, 5, 5, 0, 2000, 2000, 2000, 400],
      ['2026-11-06', 1, 1, 0, 1, 1, 0, 400, 400, 400, 400],
    ]);
    assert.equal(deductionRows.rows[0].count, 1);
    assert.equal(debtRows.rows[0].count, 1);
    assert.equal(repaymentRows.rows[0].count, 1);
    assert.equal(settlementRows.rows[0].count, 1);
    assert.equal(auditRows.rows[0].count, 5);
  } finally {
    if (ownerId) await pool.query('DELETE FROM users WHERE id=$1', [ownerId]);
    await pool.end();
  }
});