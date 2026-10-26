const fs = require('node:fs');
const path = require('node:path');

const { query } = require('../postgres.js');
const emailService = require('./email-service.js');
const paymentProvider = require('./payment-provider.js');

const REQUIRED_MIGRATIONS = [
  '001', '002', '003', '004', '005', '006', '007',
  '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018', '019', '020',
];

const REQUIRED_NOTIFICATION_COLUMNS = [
  'status', 'resolution_code', 'resolution_note', 'resolved_by', 'resolved_at', 'updated_at',
];

const EMAIL_OUTBOX_COUNTS_SQL = `SELECT
  COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending,
  COUNT(*) FILTER (WHERE status = 'processing')::integer AS processing,
  COUNT(*) FILTER (WHERE status = 'processing' AND lease_until < NOW())::integer AS stuck,
  COUNT(*) FILTER (WHERE status = 'pending' AND attempts = 0)::integer AS never_attempted,
  COUNT(*) FILTER (WHERE last_error IS NOT NULL)::integer AS failed_attempts,
  MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_pending_at
  FROM subscription_email_events`;

const EMAIL_OUTBOX_FAILURES_SQL = `SELECT id, event_type, attempts, last_error, updated_at
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

const JOB_RUNS_SQL = `SELECT job_id, status, started_at, finished_at, summary, error_code, failed_recent
  FROM (
    SELECT DISTINCT ON (job_id)
      job_id, status, started_at, finished_at, summary, error_code,
      (
        SELECT COUNT(*)::integer
        FROM platform_job_runs failed
        WHERE failed.job_id = latest.job_id
          AND failed.status = 'failed'
          AND failed.started_at >= NOW() - INTERVAL '7 days'
      ) AS failed_recent
    FROM platform_job_runs latest
    ORDER BY job_id, started_at DESC
  ) latest_runs
  ORDER BY job_id`;

const JOB_DEFINITIONS = [
  {
    id: 'subscription_emails',
    path: '/api/cron/subscription-emails',
    route: 'GET/POST /api/cron/subscription-emails',
    expectedCadence: 'daily',
    cadenceHours: 36,
    scheduleRequired: true,
  },
  {
    id: 'notification_evaluation',
    path: '/api/cron/notifications',
    route: 'GET/POST /api/cron/notifications',
    expectedCadence: 'not_documented',
    cadenceHours: null,
    scheduleRequired: false,
  },
];

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

const ageHours = (value, now) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round(((now.getTime() - timestamp) / 3600000) * 10) / 10);
};

const readVercelSchedulerConfig = ({ readFile = fs.readFileSync, cwd = process.cwd() } = {}) => {
  try {
    const parsed = JSON.parse(readFile(path.join(cwd, 'vercel.json'), 'utf8'));
    const crons = Array.isArray(parsed.crons)
      ? parsed.crons.map((cron) => ({ path: String(cron.path || ''), schedule: String(cron.schedule || '') })).filter((cron) => cron.path && cron.schedule)
      : [];
    return { configured: true, crons, detail: 'vercel.json was found.' };
  } catch {
    return { configured: false, crons: [], detail: 'vercel.json was not found or could not be read.' };
  }
};

const getAppUrlStatus = (env = process.env) => {
  const configured = String(env.NEXT_PUBLIC_APP_URL || env.FRONTEND_URL || '').trim();
  if (!configured) {
    return {
      status: 'not_configured',
      configured: false,
      url: null,
      detail: 'NEXT_PUBLIC_APP_URL or FRONTEND_URL is required for verification and email-change links.',
    };
  }
  try {
    const url = new URL(configured);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && local)) {
      throw new Error('A public HTTPS URL is required.');
    }
    return {
      status: 'healthy',
      configured: true,
      url: url.origin,
      detail: 'Public application URL is configured for email links.',
    };
  } catch {
    return {
      status: 'not_configured',
      configured: true,
      url: null,
      detail: 'The configured public application URL is not a valid HTTPS URL.',
    };
  }
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

const getPaymentProviderStatus = (env = process.env) => {
  try {
    const status = paymentProvider.getLmbtechPublicStatus(env);
    return {
      provider: status.provider,
      displayName: status.displayName,
      realPaymentsEnabled: Boolean(status.realPaymentsEnabled),
      credentialsConfigured: Boolean(status.credentialsConfigured),
      apiConfigured: Boolean(status.apiConfigured),
      callbackConfigured: Boolean(status.callbackConfigured),
      ready: Boolean(status.ready),
    };
  } catch {
    return {
      provider: 'mtn_momo',
      displayName: 'MTN MoMo Rwanda',
      realPaymentsEnabled: false,
      credentialsConfigured: false,
      apiConfigured: false,
      callbackConfigured: false,
      ready: false,
    };
  }
};

const getPlatformHealth = async ({
  runQuery = query,
  mailer = emailService,
  env = process.env,
  now = new Date(),
  databaseConfigured = Boolean(env.DATABASE_URL),
  readSchedulerConfig = readVercelSchedulerConfig,
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
    neverAttempted: 0,
    failedAttempts: 0,
    oldestPendingAt: null,
    oldestPendingAgeHours: null,
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
        id: row.id === null || row.id === undefined ? null : Number(row.id),
        eventType: row.event_type ? String(row.event_type) : null,
        attempts: safeCount(row.attempts),
        errorCode: safeErrorCode(row.last_error),
        updatedAt: row.updated_at || null,
      }));
      const stuck = safeCount(counts.stuck);
      const failedAttempts = safeCount(counts.failed_attempts);
      const neverAttempted = safeCount(counts.never_attempted);
      const pending = safeCount(counts.pending);
      const oldestPendingAt = counts.oldest_pending_at || null;
      const oldestPendingAgeHours = ageHours(oldestPendingAt, now);
      const stalePending = oldestPendingAgeHours !== null && oldestPendingAgeHours > 24;
      const queued = pending > 0 || safeCount(counts.processing) > 0;
      emailOutbox = {
        status: stuck > 0 || failedAttempts > 0 || stalePending || queued ? 'warning' : 'healthy',
        pending,
        processing: safeCount(counts.processing),
        stuck,
        neverAttempted,
        failedAttempts,
        oldestPendingAt,
        oldestPendingAgeHours,
        recentFailures,
        detail: stuck > 0 || failedAttempts > 0 || stalePending
          ? 'Email delivery has stuck, failed, or stale pending attempts.'
          : queued
            ? 'Emails are queued; the scheduler and delivery worker still need to run. Queued does not mean delivered.'
            : 'No queued, stuck, or failed email attempts were found.',
      };
    } catch {
      emailOutbox = {
        ...emailOutbox,
        status: 'unavailable',
        detail: 'The email outbox is not available. Check migration 009.',
      };
    }
  }

  const provider = getPaymentProviderStatus(env);
  let payments = {
    status: provider.ready ? 'healthy' : 'not_configured',
    failedRecent: 0,
    stalePending: 0,
    recentFailures: [],
    provider,
    detail: provider.ready
      ? 'Payment provider configuration is ready. No payment failures were read yet.'
      : 'Real payments are not ready: enable LMBTECH_ALLOW_REAL_PAYMENTS and configure credentials, API URL, and callback URL.',
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
        ...payments,
        status: failedRecent > 0 || stalePending > 0 ? 'warning' : (provider.ready ? 'healthy' : 'not_configured'),
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
          : provider.ready
            ? 'No recent failed or stale pending payments were found.'
            : 'No recent payment failures were found, but real payments are not configured.',
      };
    } catch {
      payments = {
        ...payments,
        status: 'unavailable',
        detail: 'Payment diagnostics could not be read.',
      };
    }
  }

  const schedulerConfig = readSchedulerConfig();
  const secretConfigured = Boolean(env.CRON_SECRET);
  let runHistoryAvailable = false;
  let runRows = [];
  if (database.connected) {
    try {
      const result = await runQuery(JOB_RUNS_SQL);
      runRows = result.rows || [];
      runHistoryAvailable = true;
    } catch {
      runHistoryAvailable = false;
    }
  }
  const runsByJob = new Map(runRows.map((row) => [String(row.job_id), row]));
  const jobs = JOB_DEFINITIONS.map((definition) => {
    const last = runsByJob.get(definition.id) || null;
    const lastTrigger = last?.summary?.trigger ? String(last.summary.trigger) : null;
    const scheduled = lastTrigger === 'vercel_cron'
      || schedulerConfig.crons.some((cron) => cron.path === definition.path);
    const lastRunAt = last?.started_at || null;
    const lastRunAgeHours = ageHours(lastRunAt, now);
    const stale = definition.cadenceHours !== null && lastRunAgeHours !== null && lastRunAgeHours > definition.cadenceHours;
    let status;
    let detail;
    if (!secretConfigured) {
      status = 'not_configured';
      detail = 'CRON_SECRET is not configured, so the route rejects scheduler requests.';
    } else if (!runHistoryAvailable) {
      status = 'warning';
      detail = 'Execution history is unavailable. Apply migration 020 to record scheduled runs.';
    } else if (!last) {
      status = 'warning';
      detail = 'No execution has been recorded for this job.';
    } else if (last.status === 'failed') {
      status = 'warning';
      detail = `The last recorded run failed${last.error_code ? ` (${safeErrorCode(last.error_code)})` : ''}.`;
    } else if (last.status === 'running') {
      status = 'warning';
      detail = 'The last recorded run is still marked as running.';
    } else if (stale) {
      status = 'warning';
      detail = `The last recorded successful run is older than the ${definition.expectedCadence} cadence.`;
    } else if (definition.scheduleRequired && !scheduled) {
      status = 'warning';
      detail = 'No matching schedule is configured in vercel.json.';
    } else if (!definition.scheduleRequired && !scheduled) {
      status = 'warning';
      detail = 'No approved schedule is configured for this job; its cadence is not documented.';
    } else {
      status = 'healthy';
      detail = 'A recent successful execution was recorded and a schedule is configured.';
    }
    return {
      ...definition,
      scheduled,
      status,
      lastRunAt,
      lastRunAgeHours,
      lastResult: last?.status ? String(last.status) : null,
      lastTrigger,
      lastErrorCode: safeErrorCode(last?.error_code),
      failedRecent: safeCount(last?.failed_recent),
      detail,
    };
  });
  const schedulerHealthy = jobs.every((job) => job.status === 'healthy');
  const scheduler = {
    status: !secretConfigured ? 'not_configured' : (!runHistoryAvailable || !schedulerHealthy ? 'warning' : 'healthy'),
    secretConfigured,
    configured: schedulerConfig.configured,
    scheduleConfigured: jobs.some((job) => job.scheduled),
    scheduleSource: schedulerConfig.detail,
    runHistoryAvailable,
    routes: JOB_DEFINITIONS.map((job) => job.route),
    jobs,
    detail: !secretConfigured
      ? 'CRON_SECRET is not configured. Scheduled routes will reject requests.'
      : !runHistoryAvailable
        ? 'Scheduler secret is configured, but execution history is unavailable. Apply migration 020 and verify the external scheduler.'
        : schedulerHealthy
          ? 'All scheduled jobs have a configured schedule and a recent successful execution record.'
          : 'One or more scheduled jobs lack a configured schedule or recent successful execution evidence.',
  };

  const notificationJob = jobs.find((job) => job.id === 'notification_evaluation');
  const notificationEvaluation = {
    status: notificationJob.status === 'healthy' ? 'healthy' : (runHistoryAvailable ? 'warning' : 'unavailable'),
    lastRunAt: notificationJob.lastRunAt,
    lastRunAgeHours: notificationJob.lastRunAgeHours,
    lastResult: notificationJob.lastResult,
    lastErrorCode: notificationJob.lastErrorCode,
    failedRecent: notificationJob.failedRecent,
    detail: notificationJob.detail,
  };

  const appUrl = getAppUrlStatus(env);
  const email = getEmailStatus({ mailer, env });
  const ok = database.status === 'healthy'
    && migrations.status === 'healthy'
    && email.status === 'healthy'
    && appUrl.status === 'healthy'
    && emailOutbox.status === 'healthy'
    && payments.status === 'healthy'
    && scheduler.status === 'healthy'
    && notificationEvaluation.status === 'healthy';
  const degraded = scheduler.status !== 'healthy' || notificationEvaluation.status !== 'healthy';

  return {
    ok,
    degraded,
    checkedAt: now.toISOString(),
    database,
    migrations,
    appUrl,
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
  JOB_DEFINITIONS,
  getEmailStatus,
  getAppUrlStatus,
  readVercelSchedulerConfig,
  getPlatformHealth,
};
