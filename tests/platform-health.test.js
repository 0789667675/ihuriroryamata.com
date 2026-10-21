const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Health = require('../lib/services/platform-health-service.js');

const resendMailer = { getProvider: () => 'resend' };
const env = {
  DATABASE_URL: 'postgres://configured.example.test/db',
  RESEND_API_KEY: 're_test_only_not_a_real_secret',
  RESEND_FROM: 'Milk System <mail@example.test>',
  CRON_SECRET: 'test-cron-secret',
};

const healthyQuery = ({ emailCounts = { pending: 2, processing: 0, stuck: 0, failed_attempts: 0 }, emailFailures = [], paymentCounts = { failed_recent: 0, stale_pending: 0 }, paymentFailures = [] } = {}) => async (sql) => {
  if (sql === 'SELECT 1') return { rows: [{ ok: 1 }] };
  if (sql.includes('schema_migrations')) {
    return { rows: Health.REQUIRED_MIGRATIONS.map((version) => ({ version })) };
  }
  if (sql.includes('information_schema.columns')) {
    return { rows: Health.REQUIRED_NOTIFICATION_COLUMNS.map((column_name) => ({ column_name })) };
  }
  if (sql.includes('failed_attempts')) return { rows: [emailCounts] };
  if (sql.includes('SELECT event_type')) return { rows: emailFailures };
  if (sql.includes('failed_recent')) return { rows: [paymentCounts] };
  if (sql.includes('SELECT id, amount, currency, status')) return { rows: paymentFailures };
  throw new Error(`Unexpected query in health test: ${sql}`);
};

test('platform health reports real database, migration, email, outbox, payment, and unavailable scheduler evidence separately', async () => {
  const health = await Health.getPlatformHealth({
    runQuery: healthyQuery(),
    mailer: resendMailer,
    env,
    now: new Date('2026-10-21T10:00:00.000Z'),
  });
  assert.equal(health.checkedAt, '2026-10-21T10:00:00.000Z');
  assert.equal(health.ok, true);
  assert.equal(health.degraded, true);
  assert.equal(health.database.status, 'healthy');
  assert.equal(health.migrations.status, 'healthy');
  assert.equal(health.email.status, 'healthy');
  assert.equal(health.email.provider, 'resend');
  assert.equal(health.email.senderDomain, 'example.test');
  assert.equal(health.emailOutbox.status, 'healthy');
  assert.equal(health.emailOutbox.pending, 2);
  assert.equal(health.payments.status, 'healthy');
  assert.equal(health.scheduler.status, 'unavailable');
  assert.equal(health.scheduler.secretConfigured, true);
  assert.equal(health.notificationEvaluation.status, 'unavailable');
  assert.match(JSON.stringify(health.scheduler.routes), /GET\/POST/);
  assert.equal(health.scheduler.jobs.find((job) => job.id === 'subscription_emails').expectedCadence, 'daily');
  assert.equal(health.scheduler.jobs.find((job) => job.id === 'notification_evaluation').expectedCadence, 'not_documented');
});

test('platform health marks failed outbox delivery and recent payments as needs attention', async () => {
  const health = await Health.getPlatformHealth({
    runQuery: healthyQuery({
      emailCounts: { pending: 4, processing: 1, stuck: 1, failed_attempts: 3 },
      emailFailures: [{ event_type: 'payment_confirmation', attempts: 3, last_error: 'RESEND_HTTP_500', updated_at: '2026-10-21T09:00:00.000Z' }],
      paymentCounts: { failed_recent: 2, stale_pending: 1 },
      paymentFailures: [{ id: 9, amount: 5000, currency: 'RWF', status: 'FAILED', updated_at: '2026-10-21T08:00:00.000Z' }],
    }),
    mailer: resendMailer,
    env,
  });
  assert.equal(health.ok, false);
  assert.equal(health.emailOutbox.status, 'warning');
  assert.equal(health.emailOutbox.stuck, 1);
  assert.equal(health.emailOutbox.recentFailures[0].errorCode, 'RESEND_HTTP_500');
  assert.equal(health.payments.status, 'warning');
  assert.equal(health.payments.failedRecent, 2);
  assert.equal(health.payments.stalePending, 1);
  assert.equal(health.payments.recentFailures[0].id, 9);
  assert.doesNotMatch(JSON.stringify(health), /re_test_only_not_a_real_secret/);
});

test('platform health never labels incomplete email configuration as healthy', async () => {
  const health = await Health.getPlatformHealth({
    runQuery: healthyQuery(),
    mailer: { getProvider: () => 'resend' },
    env: { DATABASE_URL: env.DATABASE_URL, RESEND_FROM: env.RESEND_FROM, CRON_SECRET: env.CRON_SECRET },
  });
  assert.equal(health.email.status, 'not_configured');
  assert.equal(health.email.configured, false);
  assert.equal(health.ok, false);
  assert.doesNotMatch(JSON.stringify(health), /re_/);
});

test('platform health reads the SMTP sender from EMAIL_FROM rather than the Resend sender', () => {
  const smtpMailer = { getProvider: () => 'smtp' };
  const smtpConfig = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-pass',
  };
  const missingSender = Health.getEmailStatus({
    mailer: smtpMailer,
    env: { ...smtpConfig, RESEND_FROM: 'Resend <resend@example.test>' },
  });
  assert.equal(missingSender.status, 'not_configured');

  const configured = Health.getEmailStatus({
    mailer: smtpMailer,
    env: { ...smtpConfig, EMAIL_FROM: 'SMTP <smtp@example.test>', RESEND_FROM: 'Resend <resend@example.test>' },
  });
  assert.equal(configured.status, 'healthy');
  assert.equal(configured.senderDomain, 'example.test');
});

test('platform health does not return ok when outbox evidence is unavailable', async () => {
  const baseQuery = healthyQuery();
  const health = await Health.getPlatformHealth({
    runQuery: async (sql, values) => {
      if (sql.includes('subscription_email_events')) throw new Error('outbox unavailable');
      return baseQuery(sql, values);
    },
    mailer: resendMailer,
    env,
  });
  assert.equal(health.ok, false);
  assert.equal(health.emailOutbox.status, 'unavailable');
  assert.equal(health.payments.status, 'healthy');
});

test('platform health handles an unconfigured database without throwing or inventing healthy checks', async () => {
  let queried = false;
  const health = await Health.getPlatformHealth({
    runQuery: async () => { queried = true; throw new Error('must not run'); },
    mailer: resendMailer,
    env: { RESEND_API_KEY: 'test', RESEND_FROM: 'Milk <mail@example.test>' },
    databaseConfigured: false,
  });
  assert.equal(queried, false);
  assert.equal(health.ok, false);
  assert.equal(health.database.status, 'unavailable');
  assert.equal(health.migrations.status, 'unavailable');
  assert.equal(health.emailOutbox.status, 'unavailable');
  assert.equal(health.payments.status, 'unavailable');
  assert.equal(health.email.status, 'healthy');
});

test('the detailed health endpoint is Super Admin only and the public liveness response omits the project URL', () => {
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'system-health', 'route.js'), 'utf8');
  const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'health', 'route.ts'), 'utf8');
  assert.match(adminRoute, /getAuthenticatedUser\(request\)/);
  assert.match(adminRoute, /user\.role !== 'super_admin'/);
  assert.match(adminRoute, /getPlatformHealth/);
  assert.match(publicRoute, /supabase: \{ configured: supabase\.configured \}/);
  assert.doesNotMatch(publicRoute, /supabase: getSupabaseStatus\(\)/);
  assert.doesNotMatch(publicRoute, /provider: 'Supabase PostgreSQL'/);
  assert.doesNotMatch(publicRoute, /\.\.\.getDatabaseStatus\(\)/);
});
