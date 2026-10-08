const test = require('node:test');
const assert = require('node:assert/strict');

const Assignments = require('../lib/services/collector-assignment-service.js');
const AssignmentRepository = require('../lib/repositories/collectorAssignmentRepository.js');

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

test('revoking an assignment preserves its history and farmer ownership links', async () => {
  const statements = [];
  const pool = {
    connect: async () => ({
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (text.includes('SELECT id FROM collector_assignments')) return { rows: [{ id: 18 }] };
        return { rows: [{ id: 18 }] };
      },
      release() {},
    }),
  };

  assert.equal(await AssignmentRepository.revokeAssignment({ dairyUserId, collectorUserId: 42, actorId: dairyUserId, poolProvider: () => pool }), true);
  assert.ok(statements.some(({ text }) => text.includes('UPDATE collector_assignments SET revoked_at')));
  assert.equal(statements.some(({ text }) => text.includes('DELETE FROM collector_assignments')), false);
  assert.equal(statements.some(({ text }) => text.includes('UPDATE farmers SET collector_user_id = NULL')), false);
});
