const { query } = require('../postgres.js');
const emailService = require('./email-service.js');

const REQUIRED_MIGRATIONS = [
  '001', '002', '003', '004', '005', '006', '007',
  '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018',
];

const REQUIRED_NOTIFICATION_COLUMNS = [
  'status', 'resolution_code', 'resolution_note', 'resolved_by', 'resolved_at', 'updated_at',
];

const EMAIL_OUTBOX_COUNTS_SQL = `SELECT
  COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending,
  COUNT(*) FILTER (WHERE status = 'processing')::integer AS processing,
  COUNT(*) FILTER (WHERE status = 'processing' AND lease_until < NOW())::integer AS stuck,
  COUNT(*) FILTER (WHERE last_error IS NOT NULL)::integer AS failed_attempts
  FROM subscription_email_events`;

const EMAIL_OUTBOX_FAILURES_SQL = `SELECT event_type, attempts, last_error, updated_at
  FROM subscription_email_events
  WHERE last_error IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 5`;

const PAYMENT_COUNTS_SQL = `SELECT
  COUNT(*) FILTER (
    WHERE status = 'FAILED'
      AND updated_at >= NOW() - INTERVAL '7 days'
  )::integer AS failed_recent,
  COUNT(*) FILTER (
    WHERE status = 'PENDING'
      AND created_at < NOW() - INTERVAL '24 hours'
  )::integer AS stale_pending
  FROM subscription_payments
  WHERE provider = 'mtn_momo'`;

const PAYMENT_FAILURES_SQL = `SELECT id, amount, currency, status, updated_at
  FROM subscription_payments
  WHERE provider = 'mtn_momo'
    AND status = 'FAILED'
    AND updated_at >= NOW() - INTERVAL '7 days'
  ORDER BY updated_at DESC
  LIMIT 5`;

const safeCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
};

const safeErrorCode = (value) => {
  const code = String(value || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
  return code || null;
};

const senderEmail = (value) => {
  const match = String(value || '').match(/([^<>\s]+@[^<>\s]+\.[^<>\s]+)/);
  return match ? match[1] : null;
};

const getEmailStatus = ({ mailer = emailService, env = process.env } = {}) => {
  let provider;
  try {
    provider = mailer.getProvider();
  } catch (error) {
    return {
      status: 'not_configured',
      configured: false,
      provider: null,
      senderDomain: null,
      detail: error?.code === 'EMAIL_NOT_CONFIGURED'
        ? 'Email delivery is not configured.'
        : 'The email provider configuration could not be read.',
    };
  }

  const sender = senderEmail(provider === 'smtp' ? env.EMAIL_FROM : (env.RESEND_FROM || env.EMAIL_FROM));
  const resendReady = provider === 'resend' && Boolean(env.RESEND_API_KEY) && Boolean(sender);
  const smtpReady = provider === 'smtp'
    && Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && sender);
  if (!resendReady && !smtpReady) {
    return {
      status: 'not_configured',
      configured: false,
      provider: provider || null,
      senderDomain: sender ? sender.split('@')[1] : null,
      detail: 'The selected email provider is missing credentials or a sender address.',
    };
  }

  return {
    status: 'healthy',
    configured: true,
    provider,
    senderDomain: sender.split('@')[1],
    detail: 'Provider and sender are configured. Sender-domain verification and inbox delivery are not checked by this health probe.',
  };
};

const databaseUnavailable = (detail) => ({
  status: 'unavailable',
  connected: false,
  detail,
});

const getPlatformHealth = async ({
  runQuery = query,
  mailer = emailService,
  env = process.env,
  now = new Date(),
  databaseConfigured = Boolean(env.DATABASE_URL),
} = {}) => {
  let database = {
    ...databaseUnavailable(databaseConfigured ? 'Database connection has not been checked.' : 'DATABASE_URL is not configured.'),
    configured: databaseConfigured,
  };
  if (databaseConfigured) {
    try {
      await runQuery('SELECT 1');
      database = { status: 'healthy', configured: true, connected: true, detail: 'Database connection succeeded.' };
    } catch {
      database = { ...databaseUnavailable('Database connection failed.'), configured: true };
    }
  }

  let migrations = {
    status: 'unavailable',
    appliedCount: 0,
    requiredCount: REQUIRED_MIGRATIONS.length,
    missing: [],
    missingColumns: [],
    detail: 'Database migrations have not been checked.',
  };
  if (database.connected) {
    try {
      const [migrationResult, columnResult] = await Promise.all([
        runQuery('SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])', [REQUIRED_MIGRATIONS]),
        runQuery(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = ANY($1::text[])",
          [REQUIRED_NOTIFICATION_COLUMNS]
        ),
      ]);
      const appliedVersions = new Set((migrationResult.rows || []).map((row) => String(row.version)));
      const columnNames = new Set((columnResult.rows || []).map((row) => String(row.column_name)));
      const missing = REQUIRED_MIGRATIONS.filter((version) => !appliedVersions.has(version));
      const missingColumns = REQUIRED_NOTIFICATION_COLUMNS.filter((column) => !columnNames.has(column));
      migrations = {
        status: missing.length === 0 && missingColumns.length === 0 ? 'healthy' : 'warning',
        appliedCount: REQUIRED_MIGRATIONS.length - missing.length,
        requiredCount: REQUIRED_MIGRATIONS.length,
        missing,
        missingColumns,
        detail: missing.length === 0 && missingColumns.length === 0
          ? 'Required migrations and notification columns are present.'
          : 'Required migrations or notification columns are missing.',
      };
    } catch {
      migrations = {
        ...migrations,
        status: 'unavailable',
        detail: 'Migration state could not be read.',
      };
    }
  }

  let emailOutbox = {
    status: 'unavailable',
    pending: 0,
    processing: 0,
    stuck: 0,
    failedAttempts: 0,
    recentFailures: [],
    detail: 'Email outbox state could not be read.',
  };
  if (database.connected) {
    try {
      const [countsResult, failuresResult] = await Promise.all([
        runQuery(EMAIL_OUTBOX_COUNTS_SQL),
        runQuery(EMAIL_OUTBOX_FAILURES_SQL),
      ]);
      const counts = countsResult.rows?.[0] || {};
      const recentFailures = (failuresResult.rows || []).map((row) => ({
        eventType: row.event_type ? String(row.event_type) : null,
        attempts: safeCount(row.attempts),
        errorCode: safeErrorCode(row.last_error),
        updatedAt: row.updated_at || null,
      }));
      const stuck = safeCount(counts.stuck);
      const failedAttempts = safeCount(counts.failed_attempts);
      emailOutbox = {
        status: stuck > 0 || failedAttempts > 0 ? 'warning' : 'healthy',
        pending: safeCount(counts.pending),
        processing: safeCount(counts.processing),
        stuck,
        failedAttempts,
        recentFailures,
        detail: stuck > 0 || failedAttempts > 0
          ? 'Email delivery has stuck or failed attempts.'
          : 'No stuck or failed email attempts were found.',
      };
    } catch {
      emailOutbox = {
        ...emailOutbox,
        status: 'unavailable',
        detail: 'The email outbox is not available. Check migration 009.',
      };
    }
  }

  let payments = {
    status: 'unavailable',
    failedRecent: 0,
    stalePending: 0,
    recentFailures: [],
    detail: 'Payment health could not be read.',
  };
  if (database.connected) {
    try {
      const [countsResult, failuresResult] = await Promise.all([
        runQuery(PAYMENT_COUNTS_SQL),
        runQuery(PAYMENT_FAILURES_SQL),
      ]);
      const counts = countsResult.rows?.[0] || {};
      const failedRecent = safeCount(counts.failed_recent);
      const stalePending = safeCount(counts.stale_pending);
      payments = {
        status: failedRecent > 0 || stalePending > 0 ? 'warning' : 'healthy',
        failedRecent,
        stalePending,
        recentFailures: (failuresResult.rows || []).map((row) => ({
          id: row.id === null || row.id === undefined ? null : Number(row.id),
          amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
          currency: row.currency ? String(row.currency) : null,
          status: row.status ? String(row.status) : null,
          updatedAt: row.updated_at || null,
        })),
        detail: failedRecent > 0 || stalePending > 0
          ? 'Recent payment failures or stale pending payments were found.'
          : 'No recent failed or stale pending payments were found.',
      };
    } catch {
      payments = {
        ...payments,
        status: 'unavailable',
        detail: 'Payment diagnostics could not be read.',
      };
    }
  }

  const email = getEmailStatus({ mailer, env });
  const scheduler = {
    status: 'unavailable',
    secretConfigured: Boolean(env.CRON_SECRET),
    routes: ['GET/POST /api/cron/notifications', 'GET/POST /api/cron/subscription-emails'],
    jobs: [
      {
        id: 'subscription_emails',
        route: 'GET/POST /api/cron/subscription-emails',
        expectedCadence: 'daily',
        detail: 'The repository requires an external daily subscription email job.',
      },
      {
        id: 'notification_evaluation',
        route: 'GET/POST /api/cron/notifications',
        expectedCadence: 'not_documented',
        detail: 'The repository does not document a schedule cadence for notification evaluation.',
      },
    ],
    detail: 'No scheduler configuration or execution history is stored by the application. Verify the external scheduler in deployment settings.',
  };
  const notificationEvaluation = {
    status: 'unavailable',
    detail: 'Notification evaluation failures are not persisted as execution records.',
  };

  const ok = database.status === 'healthy'
    && migrations.status === 'healthy'
    && email.status === 'healthy'
    && emailOutbox.status === 'healthy'
    && payments.status === 'healthy';
  const degraded = scheduler.status !== 'healthy' || notificationEvaluation.status !== 'healthy';

  return {
    ok,
    degraded,
    checkedAt: now.toISOString(),
    database,
    migrations,
    email,
    emailOutbox,
    payments,
    scheduler,
    notificationEvaluation,
  };
};

module.exports = {
  REQUIRED_MIGRATIONS,
  REQUIRED_NOTIFICATION_COLUMNS,
  getEmailStatus,
  getPlatformHealth,
};
