const { query, getPool } = require('../postgres.js');

const handlesSettlementAudit = true;

const requireDatabaseForWrite = (operationName = 'Settlement write') => {
  if (!process.env.DATABASE_URL) {
    const error = new Error(`Supabase PostgreSQL DATABASE_URL is not configured for ${operationName}.`);
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
};

const roundAmount = (value) => Number(Number(value || 0).toFixed(2));

const normalizeRecord = (record) => ({
  ...record,
  amount: roundAmount(record.amount),
  settledAmount: roundAmount(record.settledAmount || 0),
  remainingAmount: roundAmount(record.remainingAmount || record.amount || 0),
  paidAmount: roundAmount(record.paidAmount || 0),
  status: String(record.status || 'PENDING'),
  approvalStatus: String(record.approvalStatus || 'PENDING'),
  paymentType: String(record.paymentType || record.payment_type || 'SACCO'),
  paymentMethod: String(record.paymentMethod || record.payment_method || 'SACCO'),
  periodType: String(record.periodType || record.period_type || 'monthly'),
  periodStart: record.periodStart || record.period_start || null,
  periodEnd: record.periodEnd || record.period_end || null,
  approvedBy: record.approvedBy ?? record.approved_by ?? null,
  approvedAt: record.approvedAt || record.approved_at || null,
  actualPaymentDate: record.actualPaymentDate || record.actual_payment_at || null,
  confirmedBy: record.confirmedBy ?? record.confirmed_by ?? null,
  confirmedAt: record.confirmedAt || record.confirmed_at || null,
  createdAt: record.createdAt || record.created_at || null,
  updatedAt: record.updatedAt || record.updated_at || null,
});

const createAuditLog = async ({ ownerUserId, actorId, entityType, entityId, action, details }) => {
  requireDatabaseForWrite('audit logging');
  const { rows } = await query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING *`,
    [entityType, entityId, action, JSON.stringify(details || {}), actorId || null, ownerUserId || null]
  );
  return rows[0];
};

const createSettlementRecord = async (record) => {
  requireDatabaseForWrite('settlement record creation');
  const payload = normalizeRecord({
    ...record,
    status: record.status || 'PENDING',
    approvalStatus: record.approvalStatus || 'PENDING',
    amount: roundAmount(record.amount),
  });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const farmer = await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 FOR KEY SHARE', [payload.farmerId, payload.ownerUserId]);
    if (!farmer.rows[0]) throw Object.assign(new Error('Farmer does not belong to this owner.'), { statusCode: 404 });
    const { rows } = await client.query(
    `INSERT INTO farmer_settlement_records (
      farmer_id, owner_user_id, payment_method, payment_type, amount, settled_amount,
      remaining_amount, status, approval_status, approved_by, approved_at,
      actual_payment_at, period_type, period_start, period_end, reason, notes,
      payment_reference, audit_context
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19::jsonb
    ) ON CONFLICT (owner_user_id, farmer_id, payment_type, payment_reference)
      WHERE payment_reference IS NOT NULL DO NOTHING RETURNING *`,
    [
      payload.farmerId,
      payload.ownerUserId,
      payload.paymentMethod,
      payload.paymentType,
      payload.amount,
      roundAmount(payload.settledAmount || 0),
      roundAmount(payload.remainingAmount || payload.amount),
      payload.status,
      payload.approvalStatus,
      payload.approvedBy,
      payload.approvedAt,
      payload.actualPaymentDate,
      payload.periodType,
      payload.periodStart,
      payload.periodEnd,
      payload.reason,
      payload.notes,
      payload.paymentReference,
      JSON.stringify(payload.auditContext || {}),
      ]
    );
    let saved = rows[0];
    if (!saved && payload.paymentReference) {
      const existing = await client.query(
        `SELECT * FROM farmer_settlement_records
         WHERE owner_user_id = $1 AND farmer_id = $2 AND payment_type = $3 AND payment_reference = $4 LIMIT 1`,
        [payload.ownerUserId, payload.farmerId, payload.paymentType, payload.paymentReference]
      );
      saved = existing.rows[0];
    }
    if (!saved) throw new Error('Settlement record was not persisted.');
    if (rows[0]) await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('farmer_settlement_record', $1, 'cash_payment_approved', $2::jsonb, $3, $4)`,
      [saved.id, JSON.stringify({ farmerId: payload.farmerId, amount: payload.amount, paymentMethod: payload.paymentMethod, periodStart: payload.periodStart, periodEnd: payload.periodEnd }), payload.approvedBy, payload.ownerUserId]
    );
    await client.query('COMMIT');
    return normalizeRecord(saved);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getSettlementRecord = async ({ settlementId, farmerId = null, ownerUserId = null }) => {
  requireDatabaseForWrite('settlement lookup');

  const { rows } = await query(
    `SELECT * FROM farmer_settlement_records WHERE id = $1 ${farmerId ? 'AND farmer_id = $2' : ''} ${ownerUserId ? 'AND owner_user_id = $3' : ''} LIMIT 1`,
    [settlementId, ...(farmerId ? [farmerId] : []), ...(ownerUserId ? [ownerUserId] : [])]
  );
  return rows[0] ? normalizeRecord(rows[0]) : null;
};

const confirmSettlementRecord = async ({ settlementId, collectorUserId, confirmedAt, periodStart, periodEnd, farmerId, ownerUserId }) => {
  requireDatabaseForWrite('settlement confirmation');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE farmer_settlement_records
      SET status = 'CONFIRMED', confirmed_by = $1, confirmed_at = $2, actual_payment_at = $2, settled_amount = amount,
           remaining_amount = 0, updated_at = NOW()
       WHERE id = $3 AND period_start = $4::date AND period_end = $5::date
         AND farmer_id = $6 AND owner_user_id = $7 AND status = 'APPROVED'
         AND EXISTS (
           SELECT 1 FROM farmers f
           JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
             AND ca.collector_user_id = $1 AND ca.revoked_at IS NULL
           WHERE f.id = farmer_settlement_records.farmer_id
             AND f.owner_user_id = farmer_settlement_records.owner_user_id
             AND f.collector_user_id = $1
         ) RETURNING *`,
      [collectorUserId, confirmedAt, settlementId, periodStart, periodEnd, farmerId, ownerUserId]
    );
    if (rows[0]) await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('farmer_settlement_record', $1, 'collector_confirmed_payment', $2::jsonb, $3, $4)`,
      [rows[0].id, JSON.stringify({ farmerId: rows[0].farmer_id, collectorUserId, periodStart, periodEnd, confirmedAt }), collectorUserId, rows[0].owner_user_id]
    );
    await client.query('COMMIT');
    return rows[0] ? normalizeRecord(rows[0]) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const createDebtLedgerEntry = async (entry) => {
  requireDatabaseForWrite('debt ledger creation');
  const payload = {
    ...entry,
    openingBalance: roundAmount(entry.openingBalance),
    remainingBalance: roundAmount(entry.remainingBalance ?? entry.openingBalance),
    totalRepaid: roundAmount(entry.totalRepaid || 0),
    status: String(entry.status || 'OPEN'),
    periodStart: entry.periodStart || entry.period_start || null,
    periodEnd: entry.periodEnd || entry.period_end || null,
    reason: entry.reason || 'DEBT',
    source: entry.source || 'DEBT',
    requestKey: entry.requestKey || null,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (payload.requestKey) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`debt:${payload.ownerUserId}:${payload.requestKey}`]);
      const duplicate = await client.query('SELECT * FROM farmer_debt_ledgers WHERE owner_user_id = $1 AND request_key = $2 LIMIT 1', [payload.ownerUserId, payload.requestKey]);
      if (duplicate.rows[0]) {
        await client.query('COMMIT');
        return duplicate.rows[0];
      }
    }
    const farmer = await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 FOR KEY SHARE', [payload.farmerId, payload.ownerUserId]);
    if (!farmer.rows[0]) throw Object.assign(new Error('Farmer does not belong to this owner.'), { statusCode: 404 });
    const { rows } = await client.query(
    `INSERT INTO farmer_debt_ledgers (
      farmer_id, owner_user_id, opening_balance, remaining_balance, total_repaid,
      status, period_start, period_end, reason, source, notes, created_by, audit_context, request_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14) RETURNING *`,
    [
      payload.farmerId,
      payload.ownerUserId,
      payload.openingBalance,
      payload.remainingBalance,
      payload.totalRepaid,
      payload.status,
      payload.periodStart,
      payload.periodEnd,
      payload.reason,
      payload.source,
      payload.notes || null,
      payload.createdBy || null,
      JSON.stringify(payload.auditContext || {}),
      payload.requestKey,
    ]
    );
    if (!rows[0]) throw new Error('Debt ledger was not persisted.');
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('farmer_debt_ledger', $1, 'created', $2::jsonb, $3, $4)`,
      [rows[0].id, JSON.stringify({ farmerId: payload.farmerId, openingBalance: payload.openingBalance, periodStart: payload.periodStart, periodEnd: payload.periodEnd }), payload.createdBy, payload.ownerUserId]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const repayDebt = async ({ debtId, ownerUserId, amount, actorId, requestKey, reason }) => {
  requireDatabaseForWrite('debt repayment');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`repayment:${ownerUserId}:${requestKey}`]);
    const prior = await client.query(
      'SELECT * FROM farmer_debt_repayments WHERE owner_user_id = $1 AND request_key = $2 LIMIT 1',
      [ownerUserId, requestKey]
    );
    if (prior.rows[0]) {
      await client.query('COMMIT');
      return { repayment: prior.rows[0], duplicate: true };
    }
    const locked = await client.query(
      `SELECT * FROM farmer_debt_ledgers WHERE id = $1 AND owner_user_id = $2 FOR UPDATE`,
      [debtId, ownerUserId]
    );
    const debt = locked.rows[0];
    if (!debt) throw Object.assign(new Error('Debt ledger not found for this owner.'), { statusCode: 404 });
    const appliedAmount = roundAmount(Math.min(Number(amount), Number(debt.remaining_balance)));
    if (appliedAmount <= 0) throw Object.assign(new Error('Debt has no outstanding balance.'), { statusCode: 409 });
    const balanceAfter = roundAmount(Number(debt.remaining_balance) - appliedAmount);
    const totalRepaid = roundAmount(Number(debt.total_repaid) + appliedAmount);
    const status = balanceAfter > 0 ? 'PARTIALLY_SETTLED' : 'SETTLED';
    const updated = await client.query(
      `UPDATE farmer_debt_ledgers SET remaining_balance = $1, total_repaid = $2, status = $3, updated_at = NOW()
       WHERE id = $4 AND owner_user_id = $5 RETURNING *`,
      [balanceAfter, totalRepaid, status, debtId, ownerUserId]
    );
    const inserted = await client.query(
      `INSERT INTO farmer_debt_repayments (debt_ledger_id, owner_user_id, actor_id, request_key, amount, balance_after, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [debtId, ownerUserId, actorId, requestKey, appliedAmount, balanceAfter, reason || 'PARTIAL_RECOVERY']
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('farmer_debt_ledger', $1, 'repayment', $2::jsonb, $3, $4)`,
      [debtId, JSON.stringify({ repaymentId: inserted.rows[0].id, amount: appliedAmount, balanceAfter, requestKey, reason }), actorId, ownerUserId]
    );
    await client.query('COMMIT');
    return { repayment: inserted.rows[0], debt: updated.rows[0], duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateDebtLedger = async (debt) => {
  requireDatabaseForWrite('debt ledger update');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE farmer_debt_ledgers
       SET remaining_balance = $1, total_repaid = $2, status = $3, updated_at = NOW(), audit_context = COALESCE(audit_context, '{}'::jsonb) || $4::jsonb
       WHERE id = $5 AND owner_user_id = $6 RETURNING *`,
      [roundAmount(debt.remainingBalance), roundAmount(debt.totalRepaid || 0), debt.status, JSON.stringify(debt.auditContext || {}), debt.id, debt.ownerUserId]
    );
    if (!rows[0]) throw Object.assign(new Error('Debt ledger not found for this owner.'), { statusCode: 404 });
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('farmer_debt_ledger', $1, 'repayment', $2::jsonb, $3, $4)`,
      [rows[0].id, JSON.stringify(debt.auditContext || {}), debt.auditContext?.actorId || null, debt.ownerUserId]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getPeriodFinancials = async ({ ownerUserId, rangeStart, rangeEnd, collectorUserId = null, runQuery = query }) => {
  if (!process.env.DATABASE_URL) {
    const error = new Error('Supabase PostgreSQL DATABASE_URL is not configured for settlement report reads.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  const values = [ownerUserId, rangeStart, rangeEnd];
  const farmerFilter = collectorUserId ? ' AND f.collector_user_id = $4' : '';
  if (collectorUserId) values.push(Number(collectorUserId));
  const settlements = await runQuery(
    `SELECT s.*, f.name AS farmer_name, f.account_number AS farmer_account_number
     FROM farmer_settlement_records s
     JOIN farmers f ON f.id = s.farmer_id AND f.owner_user_id = s.owner_user_id
     WHERE s.owner_user_id = $1 AND s.period_start = $2::date AND s.period_end = $3::date${farmerFilter}
     ORDER BY s.farmer_id, s.created_at, s.id`,
    values
  );
  const repayments = await runQuery(
    `SELECT r.*, f.name AS farmer_name
     FROM farmer_debt_repayments r
     JOIN farmer_debt_ledgers d ON d.id = r.debt_ledger_id AND d.owner_user_id = r.owner_user_id
     JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
     WHERE r.owner_user_id = $1
       AND (r.created_at AT TIME ZONE 'Africa/Kigali')::date BETWEEN $2::date AND $3::date${farmerFilter}
     ORDER BY d.farmer_id, r.created_at, r.id`,
    values
  );
  const debtValues = [ownerUserId, rangeEnd];
  const debtFarmerFilter = collectorUserId ? ' AND f.collector_user_id = $3' : '';
  if (collectorUserId) debtValues.push(Number(collectorUserId));
  const debts = await runQuery(
    `SELECT d.id, d.farmer_id, d.opening_balance, d.remaining_balance, d.total_repaid, d.status,
       d.period_start, d.period_end, d.created_at,
      COALESCE(SUM(r.amount) FILTER (WHERE (r.created_at AT TIME ZONE 'Africa/Kigali')::date <= $2::date), 0) AS repaid_through_end,
       COALESCE(SUM(r.amount), 0) AS tracked_repayments,
       GREATEST(d.total_repaid - COALESCE(SUM(r.amount), 0), 0) AS legacy_unallocated_repayments
     FROM farmer_debt_ledgers d
     JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
     LEFT JOIN farmer_debt_repayments r ON r.debt_ledger_id = d.id AND r.owner_user_id = d.owner_user_id
    WHERE d.owner_user_id = $1 AND (d.created_at AT TIME ZONE 'Africa/Kigali')::date <= $2::date${debtFarmerFilter}
     GROUP BY d.id, d.farmer_id
     ORDER BY d.farmer_id, d.id`,
      debtValues
  );
  return { settlements: settlements.rows, repayments: repayments.rows, debts: debts.rows };
};

module.exports = {
  handlesSettlementAudit,
  createAuditLog,
  createSettlementRecord,
  getSettlementRecord,
  confirmSettlementRecord,
  createDebtLedgerEntry,
  repayDebt,
  updateDebtLedger,
  getPeriodFinancials,
  normalizeRecord,
};
