const test = require('node:test');
const assert = require('node:assert/strict');

const postgres = require('../lib/postgres.js');
const fakeDatabase = { settlements: new Map(), audits: [], failAudit: false, snapshot: null };
const fakePool = {
  connect: async () => ({
    query: async (statement, values = []) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      if (sql === 'BEGIN') {
        fakeDatabase.snapshot = { settlements: new Map([...fakeDatabase.settlements].map(([key, row]) => [key, { ...row }])), audits: [...fakeDatabase.audits] };
        return { rows: [] };
      }
      if (sql === 'COMMIT') { fakeDatabase.snapshot = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') {
        if (fakeDatabase.snapshot) {
          fakeDatabase.settlements = fakeDatabase.snapshot.settlements;
          fakeDatabase.audits = fakeDatabase.snapshot.audits;
        }
        fakeDatabase.snapshot = null;
        return { rows: [] };
      }
      if (sql.startsWith('SELECT id FROM farmers')) return { rows: [{ id: values[0] }] };
      if (sql.startsWith('INSERT INTO farmer_settlement_records')) {
        const [farmerId, ownerUserId, paymentMethod, paymentType, amount, settledAmount, remainingAmount, status, approvalStatus, approvedBy, approvedAt, actualPaymentDate, periodType, periodStart, periodEnd, reason, notes, paymentReference] = values;
        const key = `${ownerUserId}:${farmerId}:${paymentType}:${paymentReference}`;
        if (fakeDatabase.settlements.has(key)) return { rows: [] };
        const row = { id: fakeDatabase.settlements.size + 1, farmer_id: farmerId, owner_user_id: ownerUserId, payment_method: paymentMethod, payment_type: paymentType, amount, settled_amount: settledAmount, remaining_amount: remainingAmount, status, approval_status: approvalStatus, approved_by: approvedBy, approved_at: approvedAt, actual_payment_at: actualPaymentDate, period_type: periodType, period_start: periodStart, period_end: periodEnd, reason, notes, payment_reference: paymentReference };
        fakeDatabase.settlements.set(key, row);
        return { rows: [row] };
      }
      if (sql.startsWith('SELECT * FROM farmer_settlement_records')) {
        const [ownerUserId, farmerId, paymentType, paymentReference] = values;
        const row = fakeDatabase.settlements.get(`${ownerUserId}:${farmerId}:${paymentType}:${paymentReference}`);
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        if (fakeDatabase.failAudit) { fakeDatabase.failAudit = false; throw new Error('simulated audit database failure'); }
        fakeDatabase.audits.push(values);
        return { rows: [] };
      }
      throw new Error(`Unexpected fake database statement: ${sql}`);
    },
    release: () => undefined,
  }),
};
postgres.getPool = () => fakePool;
const farmerSettlementRepository = require('../lib/repositories/farmerSettlementRepository.js');

const originalDatabaseUrl = process.env.DATABASE_URL;

test('financial write paths reject when database is not configured', async () => {
  delete process.env.DATABASE_URL;

  await assert.rejects(
    () => farmerSettlementRepository.createSettlementRecord({
      farmerId: 9,
      ownerUserId: 2,
      amount: 1250,
      paymentMethod: 'CASH',
      paymentType: 'CASH',
      paymentDate: '2026-10-14',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      reason: 'NO_SACCO_ACCOUNT',
      notes: 'Owner-approved cash settlement.',
      approvedBy: 2,
      paymentReference: 'cash-9-2026-10-01',
    }),
    /DATABASE_URL|configured/i
  );

  await assert.rejects(
    () => farmerSettlementRepository.createDebtLedgerEntry({
      farmerId: 9,
      ownerUserId: 2,
      openingBalance: 500,
      remainingBalance: 500,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      reason: 'DEBT',
      createdBy: 2,
    }),
    /DATABASE_URL|configured/i
  );

  await assert.rejects(
    () => farmerSettlementRepository.confirmSettlementRecord({
      settlementId: 4,
      collectorUserId: 8,
      confirmedAt: '2026-10-14T00:00:00.000Z',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    }),
    /DATABASE_URL|configured/i
  );

  await assert.rejects(
    () => farmerSettlementRepository.repayDebt({
      debtId: 5,
      ownerUserId: 2,
      amount: 100,
      actorId: 2,
      requestKey: 'missing-database-test',
    }),
    /DATABASE_URL|configured/i
  );
});

test('cash settlement retries are idempotent and audit failure rolls back the write', async () => {
  process.env.DATABASE_URL = 'postgres://test.invalid/database';
  const payload = {
    farmerId: 19,
    ownerUserId: 7,
    amount: 725.5,
    paymentMethod: 'CASH',
    paymentType: 'CASH',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'APPROVED',
    approvalStatus: 'APPROVED',
    approvedBy: 7,
    paymentReference: 'cash-7-idempotent-test',
  };
  const first = await farmerSettlementRepository.createSettlementRecord(payload);
  const duplicate = await farmerSettlementRepository.createSettlementRecord(payload);
  assert.equal(first.id, duplicate.id);
  assert.equal(fakeDatabase.settlements.size, 1);
  assert.equal(fakeDatabase.audits.length, 1);

  fakeDatabase.failAudit = true;
  await assert.rejects(() => farmerSettlementRepository.createSettlementRecord({
    ...payload,
    farmerId: 20,
    paymentReference: 'cash-7-rollback-test',
  }), /simulated audit database failure/);
  assert.equal(fakeDatabase.settlements.size, 1);
});

test.after(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});
