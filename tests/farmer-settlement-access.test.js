const test = require('node:test');
const assert = require('node:assert/strict');

const {
  requireOwner,
  requireOwnerAction,
  requireCollector,
  assertOwnerScope,
  assertAssignedCollector,
  parsePositiveId,
  parsePositiveAmount,
  parsePeriod,
} = require('../lib/services/farmer-settlement-access.js');
const { confirmSettlement } = require('../lib/services/farmer-settlement-service.js');

test('only collection-center accounts can use owner actions', () => {
  assert.equal(requireOwner({ id: 4, role: 'user', accountType: 'COLLECTION_CENTER' }).id, 4);
  assert.throws(() => requireOwner({ id: 5, role: 'user', accountType: 'COLLECTOR' }), { statusCode: 403 });
  assert.throws(() => requireOwner({ id: 1, role: 'super_admin', accountType: 'COLLECTION_CENTER' }), { statusCode: 403 });
});

test('collectors cannot approve owner cash or create or repay owner debt', () => {
  const collector = { id: 5, role: 'user', accountType: 'COLLECTOR' };
  for (const action of ['cash', 'debt', 'debt-repayment']) {
    assert.throws(() => requireOwnerAction(collector, action), { statusCode: 403 });
  }
  assert.throws(() => requireOwnerAction({ id: 4, role: 'user', accountType: 'COLLECTION_CENTER' }, 'confirm'), { statusCode: 400 });
});

test('only collector accounts can confirm payments', () => {
  assert.equal(requireCollector({ id: 8, role: 'user', accountType: 'COLLECTOR' }).id, 8);
  assert.throws(() => requireCollector({ id: 4, role: 'user', accountType: 'COLLECTION_CENTER' }), { statusCode: 403 });
  assert.throws(() => requireCollector(null), { statusCode: 403 });
});

test('owner settlement scope rejects cross-owner requests', () => {
  assertOwnerScope({ id: 4 }, 4);
  assert.throws(() => assertOwnerScope({ id: 4 }, 9), { statusCode: 403 });
});

test('only a collector assigned to the settlement farmer can confirm', () => {
  assertAssignedCollector({ id: 8, role: 'user', accountType: 'COLLECTOR' }, 8);
  assert.throws(() => assertAssignedCollector({ id: 8, role: 'user', accountType: 'COLLECTOR' }, null), { statusCode: 404 });
  assert.throws(() => assertAssignedCollector({ id: 8, role: 'user', accountType: 'COLLECTOR' }, 9), { statusCode: 404 });
  assert.throws(() => assertAssignedCollector({ id: 9, role: 'user', accountType: 'COLLECTION_CENTER' }, 9), { statusCode: 403 });
});

test('settlement inputs reject invalid identifiers, amounts, and periods', () => {
  assert.equal(parsePositiveId('12', 'farmerId'), 12);
  assert.equal(parsePositiveAmount('17.25'), 17.25);
  assert.throws(() => parsePositiveId('0', 'farmerId'), /positive integer/i);
  assert.throws(() => parsePositiveAmount('-1'), /positive amount/i);
  assert.throws(() => parsePositiveAmount('1.001'), /two decimal places/i);
  assert.throws(() => parsePeriod('2026-02-30', '2026-03-01'), /valid period/i);
  assert.throws(() => parsePeriod('2026-10-16', '2026-10-01'), /valid period/i);
});

test('a raced or duplicate payment confirmation cannot return success', async () => {
  const repo = {
    getSettlementRecord: async () => ({
      id: 33, farmerId: 9, ownerUserId: 4, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'APPROVED',
    }),
    confirmSettlementRecord: async () => null,
  };
  await assert.rejects(() => confirmSettlement({
    repo, settlementId: 33, collectorUserId: 8, farmerId: 9, ownerUserId: 4,
    periodStart: '2026-10-01', periodEnd: '2026-10-31',
  }), /no longer pending/i);
});
