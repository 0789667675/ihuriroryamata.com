const test = require('node:test');
const assert = require('node:assert/strict');

const postgres = require('../lib/postgres.js');
const state = { debts: [], repayments: [], audits: [], closures: [], snapshot: null };
const clone = (value) => JSON.parse(JSON.stringify(value));
const fakePool = {
  connect: async () => ({
    query: async (statement, values = []) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      if (sql === 'BEGIN') {
        state.snapshot = {
          debts: clone(state.debts),
          repayments: clone(state.repayments),
          audits: clone(state.audits),
          closures: clone(state.closures),
        };
        return { rows: [] };
      }
      if (sql === 'COMMIT') { state.snapshot = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') {
        if (state.snapshot) Object.assign(state, state.snapshot, { snapshot: null });
        return { rows: [] };
      }
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (sql.startsWith('SELECT * FROM farmer_settlement_period_closures')) {
        const row = state.closures.find((close) => close.owner_user_id === values[0]
          && close.collector_user_id === values[1] && close.period_start === values[2]
          && close.period_end === values[3]);
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('SELECT f.id FROM farmers')) {
        return { rows: Number(values[0]) === 11 && Number(values[1]) === 7 && Number(values[2]) === 8 ? [{ id: values[0] }] : [] };
      }
      if (sql.startsWith('SELECT d.*, COALESCE(')) {
        const debts = state.debts.filter((debt) => debt.owner_user_id === values[0]
          && debt.collector_user_id === values[1] && debt.period_end < values[2]
          && ['OPEN', 'PARTIALLY_SETTLED'].includes(debt.status)
          && ['DEDUCTION', 'DEBT'].includes(debt.source) && debt.remaining_balance > 0)
          .map((debt) => ({
            ...debt,
            tracked_repayments: state.repayments.filter((repayment) => repayment.debtId === debt.id)
              .reduce((sum, repayment) => sum + repayment.amount, 0),
          }))
          .sort((left, right) => left.period_end.localeCompare(right.period_end) || left.id - right.id);
        return { rows: debts };
      }
      if (sql.startsWith('SELECT farmer_id, COALESCE(SUM(')) return { rows: [] };
      if (sql.startsWith('SELECT d.farmer_id, COALESCE(SUM(r.amount)')) return { rows: [] };
      if (sql.startsWith('UPDATE farmer_debt_ledgers SET remaining_balance')) {
        const debt = state.debts.find((row) => row.id === values[3] && row.owner_user_id === values[4] && row.remaining_balance === values[5]);
        if (!debt) return { rows: [] };
        debt.remaining_balance = values[0];
        debt.total_repaid += values[1];
        debt.status = values[2];
        return { rows: [debt] };
      }
      if (sql.startsWith('INSERT INTO farmer_debt_repayments')) {
        const [debtId, ownerUserId, actorId, requestKey, amount, balanceAfter, periodStart, periodEnd] = values;
        const repayment = { id: state.repayments.length + 1, debtId, ownerUserId, actorId, requestKey, amount, balanceAfter, reason: 'UKWEZI_PERIOD_CLOSE', periodStart, periodEnd };
        state.repayments.push(repayment);
        return { rows: [{ id: repayment.id }] };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        state.audits.push(values);
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO farmer_settlement_period_closures')) {
        const [ownerUserId, collectorUserId, periodStart, periodEnd, snapshotHash, totalRecovered, closedBy] = values;
        const closure = {
          owner_user_id: ownerUserId, collector_user_id: collectorUserId,
          period_start: periodStart, period_end: periodEnd, snapshot_hash: snapshotHash,
          total_recovered: totalRecovered, closed_by: closedBy,
        };
        state.closures.push(closure);
        return { rows: [closure] };
      }
      throw new Error(`Unexpected SQL in period-close test: ${sql}`);
    },
    release: () => undefined,
  }),
};

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalGetPool = postgres.getPool;
postgres.getPool = () => fakePool;
const repository = require('../lib/repositories/farmerSettlementRepository.js');

const close = (periodStart, periodEnd, netAmount) => repository.closeUkweziPeriod({
  ownerUserId: 7,
  collectorUserId: 8,
  actorId: 8,
  periodStart,
  periodEnd,
  farmers: [{ farmerId: 11, netAmount }],
});

test.beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://test.invalid/database';
  state.debts = [{
    id: 21, farmer_id: 11, owner_user_id: 7, collector_user_id: 8,
    source: 'DEDUCTION', period_start: '2026-10-01', period_end: '2026-10-15',
    opening_balance: 15000, remaining_balance: 15000, total_repaid: 0, status: 'OPEN',
  }];
  state.repayments = [];
  state.audits = [];
  state.closures = [];
});

test('period close carries a partial recovery forward and then recovers only the remainder', async () => {
  const first = await close('2026-10-16', '2026-10-31', 10000);
  assert.equal(first.totalRecovered, 10000);
  assert.equal(state.debts[0].remaining_balance, 5000);
  assert.equal(state.repayments[0].periodStart, '2026-10-16');

  const second = await close('2026-11-01', '2026-11-15', 20000);
  assert.equal(second.totalRecovered, 5000);
  assert.equal(state.debts[0].remaining_balance, 0);
  assert.equal(state.repayments.length, 2);
  assert.equal(20000 - second.totalRecovered, 15000);
});

test('period close is idempotent and a changed historical snapshot requires an audited adjustment', async () => {
  const first = await close('2026-10-16', '2026-10-31', 10000);
  const repeated = await close('2026-10-16', '2026-10-31', 10000);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.totalRecovered, first.totalRecovered);
  assert.equal(state.repayments.length, 1);
  assert.equal(state.audits.length, 2);

  await assert.rejects(
    () => close('2026-10-16', '2026-10-31', 12000),
    (error) => error.statusCode === 409 && error.code === 'PERIOD_CLOSE_CORRECTION_REQUIRED'
  );
  assert.equal(state.repayments.length, 1);
  assert.equal(state.audits.length, 2);
  assert.equal(state.debts[0].remaining_balance, 5000);
});

test('period close never recovers from negative earnings or unsupported ledgers', async () => {
  state.debts[0].source = 'UNSUPPORTED';
  const negative = await close('2026-10-16', '2026-10-31', -710260);
  assert.equal(negative.totalRecovered, 0);
  assert.equal(state.debts[0].remaining_balance, 15000);
  assert.equal(state.repayments.length, 0);
});

test('period close blocks a ledger with unallocated legacy repayments', async () => {
  state.debts[0].total_repaid = 500;
  state.debts[0].remaining_balance = 14500;
  await assert.rejects(
    () => close('2026-10-16', '2026-10-31', 10000),
    (error) => error.statusCode === 409 && error.code === 'DEBT_HISTORY_INCOMPLETE'
  );
  assert.equal(state.debts[0].remaining_balance, 14500);
  assert.equal(state.repayments.length, 0);
  assert.equal(state.closures.length, 0);
});

test.after(() => {
  postgres.getPool = originalGetPool;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});
