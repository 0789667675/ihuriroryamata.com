const test = require('node:test');
const assert = require('node:assert/strict');

const Assignments = require('../lib/services/collector-assignment-service.js');

const dairyUserId = 77;

test('only a collection-center account can manage collector assignments', async () => {
  let called = false;
  await assert.rejects(() => Assignments.listAssignments({
    dairyUserId,
    getAccount: async () => ({ id: dairyUserId, account_type: 'COLLECTOR' }),
    repository: { getAssignments: async () => { called = true; return []; } },
  }), (error) => error.statusCode === 403 && /COLLECTION_CENTER/.test(error.message));
  assert.equal(called, false);
});

test('assignments always use authenticated Dairy ownership and actor identity', async () => {
  let captured;
  const repository = {
    getAssignments: async () => [],
    assignCollector: async (input) => { captured = input; return input; },
    revokeAssignment: async (input) => { captured = input; return true; },
  };
  const getAccount = async (id) => ({ id, account_type: 'COLLECTION_CENTER' });
  await Assignments.assignCollector({ dairyUserId, collectorUserId: '42', actorId: dairyUserId, repository, getAccount });
  assert.deepEqual(captured, { dairyUserId: 77, collectorUserId: 42, assignedBy: 77 });
  assert.equal(await Assignments.revokeAssignment({ dairyUserId, collectorUserId: 42, actorId: dairyUserId, repository, getAccount }), true);
  assert.deepEqual(captured, { dairyUserId: 77, collectorUserId: 42, actorId: 77 });
});

test('invalid collector ids are rejected before revoke persistence', async () => {
  let called = false;
  await assert.rejects(() => Assignments.revokeAssignment({
    dairyUserId,
    collectorUserId: 'x',
    getAccount: async (id) => ({ id, account_type: 'COLLECTION_CENTER' }),
    repository: { revokeAssignment: async () => { called = true; } },
  }), /Invalid collector id/i);
  assert.equal(called, false);
});
