const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Audit = require('../lib/services/audit-service.js');
const AuditRepository = require('../lib/repositories/auditRepository.js');

const ownerUserId = 42;

test('audit details redact sensitive fields recursively', () => {
  assert.deepEqual(Audit.sanitize({
    email: 'user@example.com',
    password: 'hidden',
    apiKey: 'hidden',
    api_key: 'hidden',
    clientSecret: 'hidden',
    nested: { sessionId: 'hidden', privateKey: 'hidden', action: 'login' },
  }), {
    email: 'user@example.com',
    password: '[REDACTED]',
    apiKey: '[REDACTED]',
    api_key: '[REDACTED]',
    clientSecret: '[REDACTED]',
    nested: { sessionId: '[REDACTED]', privateKey: '[REDACTED]', action: 'login' },
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
  assert.deepEqual(result, expected);
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

test('platform audit SQL is platform-wide, includes system-generated rows, and keeps filters parameterized', () => {
  const filter = AuditRepository.buildPlatformAuditFilter({
    entityType: 'user_account',
    action: 'customer_suspended',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert.deepEqual(filter.clauses, [
    'al.entity_type = $1',
    'al.action = $2',
    'al.created_at >= $3::timestamptz',
    'al.created_at <= $4::timestamptz',
  ]);
  assert.deepEqual(filter.values, ['user_account', 'customer_suspended', '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z']);
  assert.doesNotMatch(filter.clauses.join(' '), /changed_by|owner_user_id = \$/);
  assert.deepEqual(AuditRepository.buildPlatformAuditFilter({}), { clauses: [], values: [] });
});

test('platform audit forwards filters and pagination while preserving system rows and redacting secrets', async () => {
  let received;
  const result = await Audit.listPlatformAuditLogs({
    actorId: 1,
    page: '3',
    limit: '25',
    entityType: 'user_account',
    action: 'customer_suspended',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    repository: {
      listPlatformAuditLogs: async (input) => {
        received = input;
        return {
          items: [
            { id: 10, changed_by: null, actor_name: null, owner_user_id: 42, details: { password: 'hidden', nested: { sessionId: 'hidden' }, action: 'login' } },
            { id: 9, changed_by: 7, actor_name: 'Admin', owner_user_id: 42, details: 'not-json' },
          ],
          total: 2,
          page: 3,
          limit: 25,
        };
      },
    },
  });
  assert.equal(received.actorId, 1);
  assert.equal(received.page, 3);
  assert.equal(received.limit, 25);
  assert.equal(received.entityType, 'user_account');
  assert.equal(received.action, 'customer_suspended');
  assert.equal(received.startDate, '2026-10-01');
  assert.equal(received.endDate, '2026-10-31');
  assert.equal(result.items[0].changed_by, null);
  assert.equal(result.items[0].details.password, '[REDACTED]');
  assert.equal(result.items[0].details.nested.sessionId, '[REDACTED]');
  assert.equal(result.items[0].details.action, 'login');
  assert.equal(result.items[1].details, 'not-json');
});

test('normal owner audit remains owner-scoped and the platform route is Super Admin only', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'audit-logs', 'route.js'), 'utf8');
  assert.match(route, /if \(!user\)/);
  assert.match(route, /user\.role !== 'super_admin'/);
  assert.match(route, /listPlatformAuditLogs/);
  const filter = AuditRepository.buildAuditFilter({ ownerUserId, entityType: 'farmer' });
  assert.match(filter.clauses[0], /al\.owner_user_id = \$1/);
  assert.equal(filter.values[0], ownerUserId);
});
