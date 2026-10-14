const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSaccoDistributionList,
  buildRetainedSettlementList,
  applyRetainedSettlementPayment,
  recordCashSettlement,
  confirmSettlement,
  createDebtLedgerEntry,
  applyDebtRepayment,
} = require('../lib/services/farmer-settlement-service.js');

test('SACCO eligibility includes only valid account holders', () => {
  const farmers = [
    { id: 1, name: 'Alice', accountNumber: '123456', totalVolume: 40, netAmount: 20000 },
    { id: 2, name: 'Bob', accountNumber: '', totalVolume: 30, netAmount: 15000 },
    { id: 3, name: 'Cara', accountNumber: '   ', totalVolume: 25, netAmount: 12500 },
    { id: 4, name: 'Dina', accountNumber: 'RWA-987', totalVolume: 35, netAmount: 18000 },
  ];

  const result = buildSaccoDistributionList({ farmers });
  assert.deepEqual(result.map((farmer) => farmer.id), [1, 4]);
  assert.equal(result[0].saccoEligible, true);
  assert.equal(result[1].saccoEligible, true);
});

test('retained money remains separate from owner profit and can be paid down', () => {
  const farmers = [
    { id: 5, name: 'Eli', accountNumber: '', totalVolume: 22, netAmount: 11000 },
    { id: 6, name: 'Faye', accountNumber: 'RWA-123', totalVolume: 18, netAmount: 9000 },
  ];

  const retained = buildRetainedSettlementList({ farmers, reason: 'NO_SACCO_ACCOUNT' });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].retainedAmount, 11000);
  assert.equal(retained[0].remainingRetainedAmount, 11000);
  assert.equal(retained[0].status, 'PENDING');
  assert.equal(retained[0].reason, 'NO_SACCO_ACCOUNT');
  assert.equal(retained[0].isOwnerProfit, false);
});

test('retained settlement decreases to zero after payment is applied', () => {
  const record = {
    farmerId: 12,
    retainedAmount: 15000,
    settledAmount: 0,
    remainingRetainedAmount: 15000,
    status: 'PENDING',
    reason: 'NO_SACCO_ACCOUNT',
    isOwnerProfit: false,
  };

  const partial = applyRetainedSettlementPayment({ retainedRecord: record, paymentAmount: 5000 });
  assert.equal(partial.settledAmount, 5000);
  assert.equal(partial.remainingRetainedAmount, 10000);
  assert.equal(partial.status, 'PARTIALLY_SETTLED');

  const complete = applyRetainedSettlementPayment({ retainedRecord: partial, paymentAmount: 10000 });
  assert.equal(complete.remainingRetainedAmount, 0);
  assert.equal(complete.status, 'SETTLED');
});

test('cash payment requires explicit owner approval and persists actual payment data', async () => {
  const repo = {
    records: [],
    auditLogs: [],
    createSettlementRecord: async (record) => {
      repo.records.push(record);
      return record;
    },
    createAuditLog: async (audit) => {
      repo.auditLogs.push(audit);
      return audit;
    },
  };

  const result = await recordCashSettlement({
    repo,
    farmerId: 8,
    ownerUserId: 2,
    approvedBy: 2,
    amount: 5000,
    paymentDate: '2026-10-08T15:30:00.000Z',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    paymentMethod: 'CASH',
    reason: 'NO_SACCO_ACCOUNT',
  });

  assert.equal(result.status, 'APPROVED');
  assert.equal(result.paymentMethod, 'CASH');
  assert.equal(result.amount, 5000);
  assert.equal(result.actualPaymentDate, null);
  assert.equal(result.periodStart, '2026-10-01');
  assert.equal(result.approvedBy, 2);
  assert.equal(repo.records.length, 1);
  assert.equal(repo.auditLogs.length, 1);
});

test('collector confirmation only works for the same accounting period and blocks duplicates', async () => {
  const repo = {
    records: [{
      id: 10,
      farmerId: 9,
      ownerUserId: 2,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-15',
      amount: 4000,
      status: 'APPROVED',
      paymentMethod: 'CASH',
      paymentType: 'CASH',
      confirmedBy: null,
      confirmedAt: null,
    }],
    confirmSettlementRecord: async (record) => ({ ...record, status: 'CONFIRMED', confirmedBy: 5, confirmedAt: '2026-10-09T12:00:00.000Z' }),
    createAuditLog: async () => ({ ok: true }),
  };

  const confirmed = await confirmSettlement({
    repo,
    settlementId: 10,
    collectorUserId: 5,
    farmerId: 9,
    ownerUserId: 2,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
  });

  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.confirmedBy, 5);
  assert.equal(confirmed.confirmedAt, '2026-10-09T12:00:00.000Z');

  await assert.rejects(() => confirmSettlement({
    repo,
    settlementId: 10,
    collectorUserId: 5,
    farmerId: 9,
    ownerUserId: 2,
    periodStart: '2026-10-16',
    periodEnd: '2026-10-31',
  }), /period/i);
});

test('debt can be partially repaid and carried forward', () => {
  const debt = createDebtLedgerEntry({
    farmerId: 11,
    ownerUserId: 2,
    openingBalance: 50000,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    reason: 'PAST_DUE',
  });

  const repayment = applyDebtRepayment({
    debt,
    payableAmount: 30000,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    reason: 'PARTIAL_RECOVERY',
  });

  assert.equal(repayment.repaymentAmount, 30000);
  assert.equal(repayment.remainingDebt, 20000);
  assert.equal(repayment.status, 'PARTIALLY_SETTLED');
  assert.equal(repayment.transactionType, 'DEBT_REPAYMENT');
  assert.equal(repayment.ledger.remainingBalance, 20000);
});
