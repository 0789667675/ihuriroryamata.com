const test = require('node:test');
const assert = require('node:assert/strict');

const Audit = require('../lib/services/audit-service.js');
const AuditRepository = require('../lib/repositories/auditRepository.js');

const ownerUserId = 42;

test('audit details redact sensitive fields recursively', () => {
  assert.deepEqual(Audit.sanitize({ email: 'user@example.com', password: 'hidden', nested: { sessionId: 'hidden', action: 'login' } }), {
    email: 'user@example.com',
    password: '[REDACTED]',
    nested: { sessionId: '[REDACTED]', action: 'login' },
  });
});

test('audit log listing validates bounded pages and derives owner from request identity', async () => {
  let received;
  const expected = { items: [], total: 0, page: 2, limit: 25 };
  const result = await Audit.listAuditLogs({
    ownerUserId,
    page: '2',
    limit: '25',
    entityType: 'farmer',
    startDate: '2026-10-01',
    repository: { listAuditLogs: async (input) => { received = input; return expected; } },
  });
  assert.equal(result, expected);
  assert.equal(received.ownerUserId, ownerUserId);
  assert.equal(received.page, 2);
  assert.equal(received.entityType, 'farmer');
  await assert.rejects(() => Audit.listAuditLogs({ ownerUserId, limit: 101, repository: {} }), /between 1 and 100/i);
  await assert.rejects(() => Audit.listAuditLogs({ ownerUserId, startDate: '2026-02-30', repository: {} }), /Invalid date range/i);
});

test('audit SQL always filters owner and parameterizes filters with bounded pagination', () => {
  const filter = AuditRepository.buildAuditFilter({
    ownerUserId,
    entityType: 'farmer',
    action: 'updated',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert.match(filter.clauses[0], /al\.owner_user_id = \$1/);
  assert.deepEqual(filter.values, [42, 'farmer', 'updated', '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z']);
});

test('platform audit SQL finds actions by the Super Admin across target-owner rows', () => {
  const filter = AuditRepository.buildPlatformAuditFilter({
    actorId: 1,
    entityType: 'user_account',
    action: 'customer_suspended',
  });
  assert.match(filter.clauses[0], /al\.changed_by = \$1 OR al\.owner_user_id = \$1/);
  assert.deepEqual(filter.values, [1, 'user_account', 'customer_suspended']);
});
