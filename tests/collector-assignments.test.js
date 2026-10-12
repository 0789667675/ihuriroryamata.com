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

test('collector assignment list validates sort direction and keeps selected center scope', async () => {
  let received;
  const result = await Assignments.listAssignments({
    dairyUserId,
    centerId: '8',
    sortDirection: 'desc',
    getAccount: async () => ({ id: dairyUserId, account_type: 'COLLECTION_CENTER' }),
    repository: { getAssignments: async (...args) => { received = args; return []; } },
  });
  assert.deepEqual(result, []);
  assert.deepEqual(received, [dairyUserId, 8, 'desc']);
  await assert.rejects(() => Assignments.listAssignments({
    dairyUserId,
    sortDirection: 'random',
    getAccount: async () => ({ id: dairyUserId, account_type: 'COLLECTION_CENTER' }),
    repository: {},
  }), /sortDirection/i);
});

test('collector assignment SQL orders normalized names in both directions with stable IDs and owner center scope', async () => {
  let statement;
  await AssignmentRepository.getAssignments(dairyUserId, 8, 'desc', async (text, values) => {
    statement = { text, values };
    return { rows: [] };
  });
  assert.match(statement.text, /ca\.dairy_user_id = \$1 AND ca\.revoked_at IS NULL/);
  assert.match(statement.text, /c\.id = \$2 AND c\.owner_user_id = ca\.dairy_user_id/);
  assert.match(statement.text, /ORDER BY LOWER\(BTRIM\(u\.name\)\) DESC, u\.id ASC/);
  assert.deepEqual(statement.values, [dairyUserId, 8]);
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
