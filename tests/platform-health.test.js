const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Health = require('../lib/services/platform-health-service.js');

const resendMailer = { getProvider: () => 'resend' };
const env = {
  DATABASE_URL: 'postgres://configured.example.test/db',
  NEXT_PUBLIC_APP_URL: 'https://milk.example.test',
  RESEND_API_KEY: 're_test_only_not_a_real_secret',
  RESEND_FROM: 'Milk System <mail@example.test>',
  CRON_SECRET: 'test-cron-secret',
  LMBTECH_APP_KEY: 'test-app-key',
  LMBTECH_SECRET_KEY: 'test-secret-key',
  LMBTECH_BASE_URL: 'https://payments.example.test/api',
  LMBTECH_CALLBACK_URL: 'https://milk.example.test/api/subscription/payments/callback',
  LMBTECH_ALLOW_REAL_PAYMENTS: 'true',
};

const schedulerConfig = (paths = ['/api/cron/subscription-emails', '/api/cron/notifications']) => () => ({
  configured: true,
  crons: paths.map((jobPath) => ({ path: jobPath, schedule: '0 6 * * *' })),
  detail: 'vercel.json was found.',
});

const healthyQuery = ({
  emailCounts = { pending: 0, processing: 0, stuck: 0, never_attempted: 0, failed_attempts: 0, oldest_pending_at: null },
  emailFailures = [],
  paymentCounts = { failed_recent: 0, stale_pending: 0 },
  paymentFailures = [],
  jobRuns = [
    { job_id: 'notification_evaluation', status: 'succeeded', started_at: '2026-10-21T09:00:00.000Z', finished_at: '2026-10-21T09:00:05.000Z', summary: { evaluated: 2 }, error_code: null, failed_recent: 0 },
    { job_id: 'subscription_emails', status: 'succeeded', started_at: '2026-10-21T08:00:00.000Z', finished_at: '2026-10-21T08:00:05.000Z', summary: { sent: 1 }, error_code: null, failed_recent: 0 },
  ],
} = {}) => async (sql) => {
  if (sql === 'SELECT 1') return { rows: [{ ok: 1 }] };
  if (sql.includes('schema_migrations')) {
    return { rows: Health.REQUIRED_MIGRATIONS.map((version) => ({ version })) };
  }
  if (sql.includes('information_schema.columns')) {
    return { rows: Health.REQUIRED_NOTIFICATION_COLUMNS.map((column_name) => ({ column_name })) };
  }
  if (sql.includes('platform_job_runs')) return { rows: jobRuns };
  if (sql.includes('oldest_pending_at')) return { rows: [emailCounts] };
  if (sql.includes('SELECT id, event_type')) return { rows: emailFailures };
  if (sql.includes('failed_recent') && sql.includes('subscription_payments')) return { rows: [paymentCounts] };
  if (sql.includes('SELECT id, amount, currency, status')) return { rows: paymentFailures };
  throw new Error(`Unexpected query in health test: ${sql}`);
};

test('platform health reports real database, migration, email, outbox, payment, scheduler, and evaluation evidence', async () => {
  const health = await Health.getPlatformHealth({
    runQuery: healthyQuery(),
    mailer: resendMailer,
    env,
    now: new Date('2026-10-21T10:00:00.000Z'),
    readSchedulerConfig: schedulerConfig(),
  });
  assert.equal(health.checkedAt, '2026-10-21T10:00:00.000Z');
  assert.equal(health.ok, true);
  assert.equal(health.degraded, false);
  assert.equal(health.database.status, 'healthy');
  assert.equal(health.migrations.status, 'healthy');
  assert.equal(health.appUrl.status, 'healthy');
  assert.equal(health.appUrl.url, 'https://milk.example.test');
  assert.equal(health.email.status, 'healthy');
  assert.equal(health.email.provider, 'resend');
  assert.equal(health.email.senderDomain, 'example.test');
  assert.equal(health.emailOutbox.status, 'healthy');
  assert.equal(health.payments.status, 'healthy');
  assert.equal(health.payments.provider.ready, true);
  assert.equal(health.scheduler.status, 'healthy');
  assert.equal(health.scheduler.secretConfigured, true);
  assert.equal(health.scheduler.runHistoryAvailable, true);
  assert.equal(health.scheduler.jobs.find((job) => job.id === 'subscription_emails').scheduled, true);
  assert.equal(health.scheduler.jobs.find((job) => job.id === 'subscription_emails').lastResult, 'succeeded');
  assert.equal(health.scheduler.jobs.find((job) => job.id === 'notification_evaluation').expectedCadence, 'not_documented');
  assert.equal(health.notificationEvaluation.status, 'healthy');
  assert.equal(health.notificationEvaluation.lastResult, 'succeeded');
});

test('platform health marks queued, stale, failed outbox and recent payments as needs attention', async () => {
  const health = await Health.getPlatformHealth({
    runQuery: healthyQuery({
      emailCounts: { pending: 4, processing: 1, stuck: 1, never_attempted: 2, failed_attempts: 3, oldest_pending_at: '2026-10-20T04:00:00.000Z' },
      emailFailures: [{ id: 5, event_type: 'payment_confirmation', attempts: 3, last_error: 'RESEND_HTTP_500', updated_at: '2026-10-21T09:00:00.000Z' }],
      paymentCounts: { failed_recent: 2, stale_pending: 1 },
      paymentFailures: [{ id: 9, amount: 5000, currency: 'RWF', status: 'FAILED', updated_at: '2026-10-21T08:00:00.000Z' }],
      jobRuns: [
        { job_id: 'subscription_emails', status: 'failed', started_at: '2026-10-21T09:00:00.000Z', finished_at: null, summary: null, error_code: 'JOB_FAILED', failed_recent: 2 },
      ],
    }),
    mailer: resendMailer,
    env,
    now: new Date('2026-10-21T10:00:00.000Z'),
    readSchedulerConfig: schedulerConfig(),
  });
  assert.equal(health.ok, false);
  assert.equal(health.emailOutbox.status, 'warning');
  assert.equal(health.emailOutbox.pending, 4);
  assert.equal(health.emailOutbox.neverAttempted, 2);
  assert.equal(health.emailOutbox.oldestPendingAgeHours, 30);
  assert.equal(health.emailOutbox.recentFailures[0].errorCode, 'RESEND_HTTP_500');
  assert.equal(health.payments.status, 'warning');
  assert.equal(health.payments.failedRecent, 2);
  assert.equal(health.payments.stalePending, 1);
  assert.equal(health.payments.recentFailures[0].id, 9);
  assert.equal(health.scheduler.status, 'warning');
  assert.equal(health.scheduler.jobs.find((job) => job.id === 'subscription_emails').lastResult, 'failed');
  assert.equal(health.notificationEvaluation.status, 'warning');
  assert.doesNotMatch(JSON.stringify(health), /re_test_only_not_a_real_secret/);
});

test('platform health never labels incomplete email configuration as healthy', async () => {
  const health = await Health.getPlatformHealth({
    runQuery: healthyQuery(),
    mailer: { getProvider: () => 'resend' },
    env: { DATABASE_URL: env.DATABASE_URL, NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL, RESEND_FROM: env.RESEND_FROM, CRON_SECRET: env.CRON_SECRET },
    readSchedulerConfig: schedulerConfig(),
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
    readSchedulerConfig: schedulerConfig(),
  });
  assert.equal(health.ok, false);
  assert.equal(health.emailOutbox.status, 'unavailable');
  assert.equal(health.payments.status, 'healthy');
});

test('platform health reports unavailable run history and an unscheduled notification job honestly', async () => {
  const withoutRuns = await Health.getPlatformHealth({
    runQuery: async (sql, values) => {
      if (sql.includes('platform_job_runs')) throw new Error('relation does not exist');
      return healthyQuery()(sql, values);
    },
    mailer: resendMailer,
    env,
    readSchedulerConfig: schedulerConfig(),
  });
  assert.equal(withoutRuns.scheduler.status, 'warning');
  assert.equal(withoutRuns.scheduler.runHistoryAvailable, false);
  assert.equal(withoutRuns.notificationEvaluation.status, 'unavailable');

  const unscheduled = await Health.getPlatformHealth({
    runQuery: healthyQuery(),
    mailer: resendMailer,
    env,
    readSchedulerConfig: schedulerConfig(['/api/cron/subscription-emails']),
  });
  assert.equal(unscheduled.scheduler.status, 'warning');
  assert.equal(unscheduled.scheduler.jobs.find((job) => job.id === 'notification_evaluation').scheduled, false);
  assert.match(unscheduled.notificationEvaluation.detail, /cadence is not documented/i);
});

test('platform health handles an unconfigured database without throwing or inventing healthy checks', async () => {
  let queried = false;
  const health = await Health.getPlatformHealth({
    runQuery: async () => { queried = true; throw new Error('must not run'); },
    mailer: resendMailer,
    env: { RESEND_API_KEY: 'test', RESEND_FROM: 'Milk <mail@example.test>', NEXT_PUBLIC_APP_URL: 'https://milk.example.test' },
    databaseConfigured: false,
    readSchedulerConfig: schedulerConfig(),
  });
  assert.equal(queried, false);
  assert.equal(health.ok, false);
  assert.equal(health.database.status, 'unavailable');
  assert.equal(health.migrations.status, 'unavailable');
  assert.equal(health.emailOutbox.status, 'unavailable');
  assert.equal(health.payments.status, 'not_configured');
  assert.equal(health.email.status, 'healthy');
  assert.equal(health.scheduler.status, 'not_configured');
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
