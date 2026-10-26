const test = require('node:test');
const assert = require('node:assert/strict');

const { withJobRun } = require('../lib/repositories/jobRunRepository.js');

const makePool = ({ lock = true, missingTable = false, failRun = false } = {}) => {
  const calls = [];
  const client = {
    query: async (text, values = []) => {
      calls.push({ text, values });
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ acquired: lock }] };
      if (text.includes('INSERT INTO platform_job_runs')) {
        if (missingTable) throw Object.assign(new Error('missing table'), { code: '42P01' });
        return { rows: [{ id: 31 }] };
      }
      if (text.includes('UPDATE platform_job_runs')) return { rows: [] };
      if (text.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      throw new Error(`Unexpected query: ${text}`);
    },
    release: () => calls.push({ text: 'release' }),
  };
  return {
    calls,
    poolProvider: () => ({ connect: async () => client }),
    failRun,
  };
};

test('scheduled jobs run under an advisory lock and persist success evidence', async () => {
  const fixture = makePool();
  const result = await withJobRun({
    jobId: 'subscription_emails',
    run: async () => ({ sent: 2, failed: 0 }),
    poolProvider: fixture.poolProvider,
    now: () => new Date('2026-10-21T06:00:00.000Z'),
  });
  assert.equal(result.sent, 2);
  assert.equal(result.runId, 31);
  assert.equal(result.startedAt, '2026-10-21T06:00:00.000Z');
  assert.ok(fixture.calls.some(({ text, values }) => text.includes('pg_try_advisory_lock') && values[0] === 'subscription_emails'));
  assert.ok(fixture.calls.some(({ text, values }) => text.includes("status = 'succeeded'") && values[1] === 31));
  assert.ok(fixture.calls.some(({ text }) => text.includes('pg_advisory_unlock')));
  assert.equal(fixture.calls.at(-1).text, 'release');
});

test('overlapping scheduled runs skip without executing the job', async () => {
  const fixture = makePool({ lock: false });
  let executed = false;
  const result = await withJobRun({
    jobId: 'notification_evaluation',
    run: async () => { executed = true; return {}; },
    poolProvider: fixture.poolProvider,
  });
  assert.deepEqual(result, { skipped: true, reason: 'already_running' });
  assert.equal(executed, false);
  assert.equal(fixture.calls.some(({ text }) => text.includes('INSERT INTO platform_job_runs')), false);
});

test('jobs still run before migration 020 is applied and failures are recorded when possible', async () => {
  const fixture = makePool({ missingTable: true });
  const result = await withJobRun({
    jobId: 'subscription_emails',
    run: async () => ({ sent: 1 }),
    poolProvider: fixture.poolProvider,
  });
  assert.equal(result.sent, 1);
  assert.equal(result.runId, null);
  assert.ok(fixture.calls.some(({ text }) => text.includes('pg_advisory_unlock')));

  const failure = makePool();
  await assert.rejects(() => withJobRun({
    jobId: 'notification_evaluation',
    run: async () => { throw Object.assign(new Error('boom'), { code: 'JOB_FAILED' }); },
    poolProvider: failure.poolProvider,
  }), /boom/);
  assert.ok(failure.calls.some(({ text, values }) => text.includes("status = 'failed'") && values[0] === 'JOB_FAILED' && values[1] === 31));
  assert.ok(failure.calls.some(({ text }) => text.includes('pg_advisory_unlock')));
});

test('cron routes record job history and middleware allows cron routes to reach secret verification', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  for (const routePath of ['app/api/cron/notifications/route.js', 'app/api/cron/subscription-emails/route.js']) {
    const route = read(routePath);
    assert.match(route, /withJobRun/);
    assert.match(route, /result\.skipped/);
    assert.match(route, /success: true/);
  }
  const middleware = read('middleware.ts');
  assert.match(middleware, /'\/api\/cron'/);
  assert.doesNotMatch(middleware, /AUTH_PAGES = new Set\(\[[^\]]*verify-email/);
});
