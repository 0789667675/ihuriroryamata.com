const { query, getPool } = require('../postgres.js');
const { queueBusinessEventEmail } = require('./subscriptionRepository.js');
const { getAccountingDate } = require('../utils/accounting-period.js');
const { IGIPANDE_CHARGE_AMOUNT, buildIgipandeReference, getAdditionalIgipandeEarnings, isIgipandePeriod, allocateIgipandeRecovery } = require('../utils/igipande-contribution.js');

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
    const farmer = payload.collectorUserId
      ? await client.query(
        `SELECT f.id FROM farmers f
         JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
           AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
         WHERE f.id = $1 AND f.owner_user_id = $2 AND f.collector_user_id = $3
         FOR KEY SHARE OF f, ca`,
        [payload.farmerId, payload.ownerUserId, Number(payload.collectorUserId)]
      )
      : await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 FOR KEY SHARE', [payload.farmerId, payload.ownerUserId]);
    if (!farmer.rows[0]) throw Object.assign(new Error('Farmer does not belong to this owner.'), { statusCode: 404 });
    if (payload.maxPayable !== undefined && payload.maxPayable !== null) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`cash:${payload.ownerUserId}:${payload.farmerId}:${payload.periodStart}:${payload.periodEnd}`]
      );
      if (payload.paymentReference) {
        const duplicate = await client.query(
          `SELECT * FROM farmer_settlement_records
           WHERE owner_user_id = $1 AND farmer_id = $2 AND payment_type = $3 AND payment_reference = $4
           FOR UPDATE`,
          [payload.ownerUserId, payload.farmerId, payload.paymentType, payload.paymentReference]
        );
        if (duplicate.rows[0]) {
          const existing = normalizeRecord(duplicate.rows[0]);
          if (existing.amount !== payload.amount || existing.periodStart !== payload.periodStart || existing.periodEnd !== payload.periodEnd) {
            throw Object.assign(new Error('The request key was already used for a different cash settlement.'), { statusCode: 409 });
          }
          await client.query('COMMIT');
          return existing;
        }
      }
      const { rows: existingPayments } = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS amount FROM farmer_settlement_records
         WHERE owner_user_id = $1 AND farmer_id = $2 AND payment_type = 'CASH'
           AND period_start = $3::date AND period_end = $4::date
           AND status IN ('APPROVED', 'CONFIRMED')`,
        [payload.ownerUserId, payload.farmerId, payload.periodStart, payload.periodEnd]
      );
      if (payload.amount + Number(existingPayments[0]?.amount || 0) > Number(payload.maxPayable)) {
        throw Object.assign(new Error('Cash amount exceeds the farmer’s remaining payable balance.'), { statusCode: 400 });
      }
    }
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
    if (rows[0] && payload.paymentType === 'CASH' && payload.status === 'APPROVED') {
      await queueBusinessEventEmail({
        client,
        ownerUserId: payload.ownerUserId,
        eventType: 'cash_payout_approved',
        reference: saved.id,
        farmerId: payload.farmerId,
        amount: payload.amount,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
      });
    }
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
  const values = [settlementId];
  const clauses = ['id = $1'];
  if (farmerId) {
    values.push(farmerId);
    clauses.push(`farmer_id = $${values.length}`);
  }
  if (ownerUserId) {
    values.push(ownerUserId);
    clauses.push(`owner_user_id = $${values.length}`);
  }
  const { rows } = await query(
    `SELECT * FROM farmer_settlement_records WHERE ${clauses.join(' AND ')} LIMIT 1`,
    values
  );
  return rows[0] ? normalizeRecord(rows[0]) : null;
};

const getSettlementByReference = async ({ farmerId, ownerUserId, paymentType = 'CASH', paymentReference }) => {
  requireDatabaseForWrite('settlement lookup');
  const { rows } = await query(
    `SELECT * FROM farmer_settlement_records
     WHERE owner_user_id = $1 AND farmer_id = $2 AND payment_type = $3 AND payment_reference = $4
     LIMIT 1`,
    [ownerUserId, farmerId, paymentType, paymentReference]
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
    if (rows[0]) {
      await queueBusinessEventEmail({
        client,
        ownerUserId: rows[0].owner_user_id,
        eventType: 'settlement_confirmed',
        reference: rows[0].id,
        farmerId: rows[0].farmer_id,
        amount: rows[0].amount,
        periodStart,
        periodEnd,
      });
    }
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
    const farmer = payload.collectorUserId
      ? await client.query(
        `SELECT f.id FROM farmers f
         JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
           AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
         WHERE f.id = $1 AND f.owner_user_id = $2 AND f.collector_user_id = $3
         FOR KEY SHARE OF f, ca`,
        [payload.farmerId, payload.ownerUserId, Number(payload.collectorUserId)]
      )
      : await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 FOR KEY SHARE', [payload.farmerId, payload.ownerUserId]);
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
    await queueBusinessEventEmail({
      client,
      ownerUserId: payload.ownerUserId,
      eventType: 'debt_created',
      reference: payload.requestKey || rows[0].id,
      farmerId: payload.farmerId,
      amount: payload.openingBalance,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
    });
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const repayDebt = async ({ debtId, ownerUserId, amount, actorId, requestKey, reason, collectorUserId = null }) => {
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
    const locked = collectorUserId
      ? await client.query(
        `SELECT d.* FROM farmer_debt_ledgers d
         JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
         JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
           AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
         WHERE d.id = $1 AND d.owner_user_id = $2 AND f.collector_user_id = $3
         FOR UPDATE OF d, ca`,
        [debtId, ownerUserId, Number(collectorUserId)]
      )
      : await client.query(
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
    await queueBusinessEventEmail({
      client,
      ownerUserId,
      eventType: 'debt_repaid',
      reference: requestKey,
      farmerId: debt.farmer_id,
      amount: appliedAmount,
    });
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

const ensureIgipandePeriod = async ({ ownerUserId, rangeStart, rangeEnd, farmers = [], collectorUserId = null }) => {
  if (!isIgipandePeriod(rangeStart, rangeEnd) || rangeStart > getAccountingDate()) return new Map();
  const results = new Map();

  for (const farmer of farmers) {
    const farmerId = Number(farmer.farmerId);
    if (!Number.isSafeInteger(farmerId) || farmerId <= 0) continue;
    const availableEarnings = Math.max(0, roundAmount(farmer.availableEarnings || 0));
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`igipande:${ownerUserId}:${farmerId}:${rangeStart}`]);
      const farmerQuery = collectorUserId
        ? await client.query(
          `SELECT f.id FROM farmers f
           JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
             AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
           WHERE f.id = $1 AND f.owner_user_id = $2 AND f.collector_user_id = $3
           FOR KEY SHARE OF f, ca`,
          [farmerId, ownerUserId, Number(collectorUserId)]
        )
        : await client.query('SELECT id FROM farmers WHERE id = $1 AND owner_user_id = $2 FOR KEY SHARE', [farmerId, ownerUserId]);
      if (!farmerQuery.rows[0]) {
        await client.query('COMMIT');
        continue;
      }

      await client.query(
        `INSERT INTO farmer_igipande_contributions (
          farmer_id, owner_user_id, period_start, period_end, charge_amount,
          recovered_amount, outstanding_amount, status, reference
        ) VALUES ($1, $2, $3::date, $4::date, $5, 0, $5, 'UNPAID', $6)
        ON CONFLICT (owner_user_id, farmer_id, period_start) DO NOTHING`,
        [farmerId, ownerUserId, rangeStart, rangeEnd, IGIPANDE_CHARGE_AMOUNT, buildIgipandeReference(farmerId, rangeStart, rangeEnd)]
      );

      const insertedRun = await client.query(
        `INSERT INTO farmer_igipande_period_runs (
          farmer_id, owner_user_id, period_start, period_end, available_earnings, recovered_amount
        ) VALUES ($1, $2, $3::date, $4::date, $5, 0)
        ON CONFLICT (owner_user_id, farmer_id, period_start) DO NOTHING RETURNING id, available_earnings, recovered_amount`,
        [farmerId, ownerUserId, rangeStart, rangeEnd, availableEarnings]
      );
      const periodRun = insertedRun.rows[0] || (await client.query(
        `SELECT id, available_earnings, recovered_amount FROM farmer_igipande_period_runs
         WHERE owner_user_id = $1 AND farmer_id = $2 AND period_start = $3::date FOR UPDATE`,
        [ownerUserId, farmerId, rangeStart]
      )).rows[0];
      const additionalEarnings = getAdditionalIgipandeEarnings({
        availableEarnings,
        previouslyAvailableEarnings: insertedRun.rows[0] ? 0 : Number(periodRun.available_earnings || 0),
      });
      if (additionalEarnings > 0) {
        await client.query(
          'UPDATE farmer_igipande_period_runs SET available_earnings = $1 WHERE id = $2',
          [availableEarnings, periodRun.id]
        );
        const { rows: openContributions } = await client.query(
          `SELECT id, period_start AS "periodStart", outstanding_amount AS "outstandingBalance"
           FROM farmer_igipande_contributions
           WHERE owner_user_id = $1 AND farmer_id = $2 AND period_start <= $3::date AND outstanding_amount > 0
           ORDER BY period_start ASC, id ASC FOR UPDATE`,
          [ownerUserId, farmerId, rangeStart]
        );
        const allocation = allocateIgipandeRecovery({ availableEarnings: additionalEarnings, contributions: openContributions });
        for (const recovery of allocation.recoveries) {
          const updated = await client.query(
            `UPDATE farmer_igipande_contributions
             SET recovered_amount = recovered_amount + $1,
               outstanding_amount = outstanding_amount - $1,
               status = CASE WHEN outstanding_amount - $1 = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
               updated_at = NOW()
             WHERE id = $2 AND owner_user_id = $3
             RETURNING outstanding_amount`,
            [recovery.amount, recovery.contributionId, ownerUserId]
          );
          await client.query(
            `INSERT INTO farmer_igipande_recoveries (
              run_id, contribution_id, farmer_id, owner_user_id, amount, balance_after
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (run_id, contribution_id) DO UPDATE SET
              amount = farmer_igipande_recoveries.amount + EXCLUDED.amount,
              balance_after = EXCLUDED.balance_after`,
            [periodRun.id, recovery.contributionId, farmerId, ownerUserId, recovery.amount, updated.rows[0].outstanding_amount]
          );
        }
        await client.query(
          'UPDATE farmer_igipande_period_runs SET recovered_amount = recovered_amount + $1 WHERE id = $2',
          [allocation.recoveredAmount, periodRun.id]
        );
      }

      const { rows } = await client.query(
        `SELECT c.id, c.period_start AS "periodStart", c.period_end AS "periodEnd",
           c.charge_amount AS "chargeAmount", COALESCE(contribution_repayments.recovered, 0) AS "contributionRecoveredAmount",
           c.charge_amount - COALESCE(contribution_repayments.recovered, 0) AS "contributionOutstandingBalance",
           CASE WHEN c.charge_amount - COALESCE(contribution_repayments.recovered, 0) = 0 THEN 'PAID'
             WHEN COALESCE(contribution_repayments.recovered, 0) > 0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END AS status,
           COALESCE(run.recovered_amount, 0) AS "periodRecoveredAmount",
           COALESCE((SELECT SUM(balance.charge_amount - COALESCE((
             SELECT SUM(repayment.amount) FROM farmer_igipande_recoveries repayment
             JOIN farmer_igipande_period_runs repayment_run ON repayment_run.id = repayment.run_id
             WHERE repayment.contribution_id = balance.id AND repayment_run.period_start <= $3::date
           ), 0)) FROM farmer_igipande_contributions balance
             WHERE balance.owner_user_id = c.owner_user_id AND balance.farmer_id = c.farmer_id
               AND balance.period_start <= $3::date), 0) AS "outstandingBalance"
         FROM farmer_igipande_contributions c
         LEFT JOIN farmer_igipande_period_runs run ON run.owner_user_id = c.owner_user_id
           AND run.farmer_id = c.farmer_id AND run.period_start = $3::date
         LEFT JOIN LATERAL (
           SELECT SUM(repayment.amount) AS recovered
           FROM farmer_igipande_recoveries repayment
           JOIN farmer_igipande_period_runs repayment_run ON repayment_run.id = repayment.run_id
           WHERE repayment.contribution_id = c.id AND repayment_run.period_start <= $3::date
         ) contribution_repayments ON TRUE
         WHERE c.owner_user_id = $1 AND c.farmer_id = $2 AND c.period_start = $3::date`,
        [ownerUserId, farmerId, rangeStart]
      );
      await client.query('COMMIT');
      if (rows[0]) results.set(farmerId, {
        ...rows[0],
        chargeAmount: Number(rows[0].chargeAmount),
        contributionRecoveredAmount: Number(rows[0].contributionRecoveredAmount),
        contributionOutstandingBalance: Number(rows[0].contributionOutstandingBalance),
        periodRecoveredAmount: Number(rows[0].periodRecoveredAmount),
        outstandingBalance: Number(rows[0].outstandingBalance),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return results;
};

module.exports = {
  handlesSettlementAudit,
  createAuditLog,
  createSettlementRecord,
  getSettlementRecord,
  getSettlementByReference,
  confirmSettlementRecord,
  createDebtLedgerEntry,
  repayDebt,
  updateDebtLedger,
  getPeriodFinancials,
  ensureIgipandePeriod,
  normalizeRecord,
};
