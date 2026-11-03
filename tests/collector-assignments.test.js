const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Assignments = require('../lib/services/collector-assignment-service.js');
const AssignmentRepository = require('../lib/repositories/collectorAssignmentRepository.js');
const { isCollectionCenterAuthenticationPath } = require('../lib/security/authenticate.js');

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

const poolFor = (statements, respond) => ({
  connect: async () => ({
    query: async (text, values = []) => {
      statements.push({ text, values });
      return respond(text, values) || { rows: [] };
    },
    release() {},
  }),
});

const activeUsers = () => [
  { id: 77, email: 'center@example.com', account_type: 'COLLECTION_CENTER', account_status: 'active' },
  { id: 42, email: 'collector@example.com', account_type: 'COLLECTOR', account_status: 'active' },
];

test('center filtering rejects a center owned by another collection center', async () => {
  let captured;
  await AssignmentRepository.getAssignments(77, 8, async (text, values) => {
    captured = { text, values };
    return { rows: [] };
  });
  assert.match(captured.text, /\(\$2::bigint IS NULL OR c\.id IS NOT NULL\)/);
  assert.match(captured.text, /LEFT JOIN collection_centers c ON \(c\.id = \$2 AND c\.owner_user_id = ca\.dairy_user_id\)/);
  assert.deepEqual(captured.values, [77, 8]);
});

test('a Collector request records the requester, target center, note, and audit entry', async () => {
  const statements = [];
  const pool = poolFor(statements, (text) => {
    if (text.includes('FROM users WHERE id = ANY')) return { rows: activeUsers() };
    if (text.includes('SELECT id, dairy_user_id FROM collector_assignments')) return { rows: [] };
    if (text.includes('SELECT id FROM collector_assignment_requests')) return { rows: [] };
    if (text.includes('INSERT INTO collector_assignment_requests')) {
      return { rows: [{ id: 9, dairy_user_id: 77, collector_user_id: 42, requested_by: 42, request_note: 'Please add me', status: 'pending' }] };
    }
    return { rows: [] };
  });

  const created = await AssignmentRepository.requestAssignment({
    dairyUserId,
    collectorUserId: 42,
    requestedBy: 42,
    requestNote: 'Please add me',
    poolProvider: () => pool,
  });

  assert.equal(created.id, 9);
  assert.equal(created.status, 'pending');
  const insert = statements.find(({ text }) => text.includes('INSERT INTO audit_logs') && text.includes("'collector_assignment_request'"));
  assert.ok(insert);
  assert.equal(insert.values[0], 9);
  assert.equal(insert.values[1], 'requested');
  assert.deepEqual(insert.values[2], JSON.stringify({ collectorUserId: 42, requestNote: 'Please add me' }));
  assert.equal(insert.values[3], 42);
  assert.equal(insert.values[4], 77);
});

test('duplicate pending Collector requests are rejected without a second row', async () => {
  const statements = [];
  const pool = poolFor(statements, (text) => {
    if (text.includes('FROM users WHERE id = ANY')) return { rows: activeUsers() };
    if (text.includes('SELECT id, dairy_user_id FROM collector_assignments')) return { rows: [] };
    if (text.includes('SELECT id FROM collector_assignment_requests')) return { rows: [{ id: 9 }] };
    return { rows: [] };
  });

  await assert.rejects(() => AssignmentRepository.requestAssignment({
    dairyUserId,
    collectorUserId: 42,
    requestedBy: 42,
    poolProvider: () => pool,
  }), (error) => error.statusCode === 409 && error.code === 'REQUEST_ALREADY_PENDING');
  assert.equal(statements.some(({ text }) => text.includes('INSERT INTO collector_assignment_requests')), false);
});

test('a request to a center that already employs the Collector is rejected', async () => {
  const statements = [];
  const pool = poolFor(statements, (text) => {
    if (text.includes('FROM users WHERE id = ANY')) return { rows: activeUsers() };
    if (text.includes('SELECT id, dairy_user_id FROM collector_assignments')) return { rows: [{ id: 12, dairy_user_id: 77 }] };
    return { rows: [] };
  });

  await assert.rejects(() => AssignmentRepository.requestAssignment({
    dairyUserId,
    collectorUserId: 42,
    requestedBy: 42,
    poolProvider: () => pool,
  }), (error) => error.statusCode === 409 && error.code === 'COLLECTOR_ALREADY_ASSIGNED');
  assert.equal(statements.some(({ text }) => text.includes('INSERT INTO collector_assignment_requests')), false);
});

test('approving a request links the Collector once, records the approver, and keeps history', async () => {
  const statements = [];
  const pool = poolFor(statements, (text) => {
    if (text.includes('FROM collector_assignment_requests WHERE id = $1')) {
      return { rows: [{ id: 9, dairy_user_id: 77, collector_user_id: 42, requested_by: 42, status: 'pending' }] };
    }
    if (text.includes('FROM users WHERE id = ANY')) return { rows: activeUsers() };
    if (text.includes('SELECT id, dairy_user_id FROM collector_assignments')) return { rows: [] };
    if (text.includes('INSERT INTO collector_assignments')) {
      return { rows: [{ id: 18, dairy_user_id: 77, collector_user_id: 42, created_at: '2026-11-03T10:00:00.000Z' }] };
    }
    if (text.includes("SET status = 'approved'")) {
      return { rows: [{ id: 9, dairy_user_id: 77, collector_user_id: 42, requested_by: 42, status: 'approved', decided_by: 77, approved_assignment_id: 18 }] };
    }
    if (text.includes("SET status = 'cancelled'")) return { rows: [] };
    return { rows: [] };
  });

  const result = await AssignmentRepository.decideRequest({
    requestId: 9,
    dairyUserId: 77,
    actorId: 77,
    decision: 'approve',
    decisionNote: 'Welcome',
    poolProvider: () => pool,
  });

  assert.equal(result.assignment.id, 18);
  assert.equal(result.request.status, 'approved');
  assert.equal(result.request.decided_by, 77);
  const assignmentInsert = statements.find(({ text }) => text.includes('INSERT INTO collector_assignments'));
  assert.deepEqual(assignmentInsert.values, [77, 42, 77]);
  const requestAudit = statements.find(({ text }) => text.includes("'collector_assignment_request'") && text.includes('$2'));
  assert.equal(statements.some(({ text }) => text.includes("'approved'") && text.includes('collector_assignment_request')), true);
  assert.equal(statements.some(({ text }) => text.includes('DELETE FROM collector_assignments')), false);
});

test('rejecting a request records the rejecter and never creates an assignment', async () => {
  const statements = [];
  const pool = poolFor(statements, (text) => {
    if (text.includes('FROM collector_assignment_requests WHERE id = $1')) {
      return { rows: [{ id: 9, dairy_user_id: 77, collector_user_id: 42, requested_by: 42, status: 'pending' }] };
    }
    if (text.includes('FROM users WHERE id = ANY')) return { rows: activeUsers() };
    if (text.includes("SET status = 'rejected'")) {
      return { rows: [{ id: 9, dairy_user_id: 77, collector_user_id: 42, status: 'rejected', decided_by: 77, decision_note: 'Not eligible' }] };
    }
    return { rows: [] };
  });

  const result = await AssignmentRepository.decideRequest({
    requestId: 9,
    dairyUserId: 77,
    actorId: 77,
    decision: 'reject',
    decisionNote: 'Not eligible',
    poolProvider: () => pool,
  });

  assert.equal(result.assignment, null);
  assert.equal(result.request.status, 'rejected');
  assert.equal(statements.some(({ text }) => text.includes('INSERT INTO collector_assignments')), false);
  assert.equal(statements.some(({ text }) => text.includes('collector_assignment_request') && text.includes("'rejected'")), true);
});

test('suspending closes the active assignment with a distinct audit action', async () => {
  const statements = [];
  const pool = poolFor(statements, (text) => {
    if (text.includes('SELECT id FROM collector_assignments')) return { rows: [{ id: 18 }] };
    return { rows: [{ id: 18 }] };
  });

  assert.equal(await AssignmentRepository.suspendAssignment({ dairyUserId, collectorUserId: 42, actorId: dairyUserId, poolProvider: () => pool }), true);
  const audit = statements.find(({ text }) => text.includes("'collector_assignment'") && text.includes('$2'));
  assert.equal(audit.values[1], 'suspended');
  assert.equal(statements.some(({ text }) => text.includes('UPDATE collector_assignments SET revoked_at')), true);
  assert.equal(statements.some(({ text }) => text.includes('DELETE FROM collector_assignments')), false);
});

test('direct linking verifies an optional Collector email before persisting', async () => {
  const statements = [];
  const users = activeUsers();
  users[1] = { ...users[1], email: 'collector@example.com' };
  const pool = poolFor(statements, (text) => {
    if (text.includes('FROM users WHERE id = ANY')) return { rows: users };
    return { rows: [] };
  });

  await assert.rejects(() => AssignmentRepository.assignCollector({
    dairyUserId,
    collectorUserId: 42,
    assignedBy: dairyUserId,
    collectorEmail: 'someone-else@example.com',
    poolProvider: () => pool,
  }), (error) => error.statusCode === 409 && error.code === 'COLLECTOR_EMAIL_MISMATCH');
  assert.equal(statements.some(({ text }) => text.includes('INSERT INTO collector_assignments')), false);
});

test('request services derive actor identity from the authenticated account', async () => {
  let captured;
  const getAccount = async (id) => ({ id, account_type: 'COLLECTOR', account_status: 'active' });
  await Assignments.requestAssignment({
    collectorUserId: 42,
    dairyUserId: '77',
    requestNote: 'Please',
    getAccount,
    repository: { requestAssignment: async (input) => { captured = input; return input; } },
  });
  assert.deepEqual(captured, { dairyUserId: 77, collectorUserId: 42, requestedBy: 42, requestNote: 'Please' });

  let decision;
  await Assignments.decideAssignmentRequest({
    requestId: '9',
    dairyUserId: 77,
    actorId: 77,
    decision: 'approve',
    decisionNote: 'Welcome',
    getAccount: async (id) => ({ id, account_type: 'COLLECTION_CENTER', account_status: 'active' }),
    repository: { decideRequest: async (input) => { decision = input; return input; } },
  });
  assert.deepEqual(decision, { requestId: 9, dairyUserId: 77, actorId: 77, decision: 'approve', decisionNote: 'Welcome' });
});

test('a Collection Center cannot submit a Collector membership request', async () => {
  let called = false;
  await assert.rejects(() => Assignments.requestAssignment({
    collectorUserId: 77,
    dairyUserId: 77,
    getAccount: async (id) => ({ id, account_type: 'COLLECTION_CENTER', account_status: 'active' }),
    repository: { requestAssignment: async () => { called = true; } },
  }), (error) => error.statusCode === 403 && /COLLECTOR/.test(error.message));
  assert.equal(called, false);
});

test('collector request routes enforce account types and expose only server-side decisions', () => {
  const requestRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'collector-assignment-requests', 'route.js'), 'utf8');
  const decisionRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'collector-assignment-requests', '[id]', 'route.js'), 'utf8');
  const assignmentRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'collector-assignments', '[collectorUserId]', 'route.js'), 'utf8');
  const assignmentsRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'collector-assignments', 'route.js'), 'utf8');

  assert.match(requestRoute, /requireAccountType\(user, 'COLLECTOR'\)/);
  assert.match(requestRoute, /Assignments\.listDairyRequests/);
  assert.match(requestRoute, /dairyUserId: input\.dairyUserId/);
  assert.match(decisionRoute, /requireAccountType\(user, 'COLLECTION_CENTER'\)/);
  assert.match(decisionRoute, /requireAccountType\(user, 'COLLECTOR'\)/);
  assert.match(decisionRoute, /!\[ 'approve', 'reject' \]|!\['approve', 'reject'\]/);
  assert.match(assignmentRoute, /export async function PATCH/);
  assert.match(assignmentRoute, /action === 'suspend'/);
  assert.match(assignmentRoute, /requireAccountType\(user, 'COLLECTION_CENTER'\)/);
  assert.match(assignmentsRoute, /requireAccountType\(user, 'COLLECTION_CENTER'\)/);
  assert.doesNotMatch(assignmentsRoute, /requireAccountType\(user, \['COLLECTOR'/);
  assert.equal(isCollectionCenterAuthenticationPath('/api/collector-assignment-requests'), true);
  assert.equal(isCollectionCenterAuthenticationPath('/api/collector-assignment-requests/9'), true);
});

test('the request migration is additive, RLS-protected, and prevents duplicate pending pairs', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '025_collector_assignment_requests.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.collector_assignment_requests/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /AS RESTRICTIVE[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*?TO service_role/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_assignment_requests_pending_pair[\s\S]*?WHERE status = 'pending'/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE collector_assignments/i);
});
