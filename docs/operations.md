# Operations notes

## Public URLs

Verification and email-change links require a canonical public HTTPS origin. Set
`NEXT_PUBLIC_APP_URL` (preferred) or `FRONTEND_URL` in the deployment
environment. In production, the application deliberately refuses to derive
email links from an untrusted request host. System Health reports the configured
origin and marks it as not configured when it is missing or invalid.

## Scheduled jobs

`vercel.json` schedules three jobs (UTC):

- `/api/cron/subscription-emails` daily at `0 6 * * *` for expiry, reminder, and usage-tier event creation.
- `/api/cron/subscription-email-outbox` every 15 minutes for retryable email delivery.
- `/api/cron/notifications` every 15 minutes for operational notification evaluation.

All routes accept `POST` for an external scheduler. Both methods require
`Authorization: Bearer $CRON_SECRET`. Vercel Cron sends that header when the
`CRON_SECRET` environment variable is configured.

Notification evaluation uses each center's configured session start/end times
and Kigali local time; the 15-minute polling interval does not encode collection
session times. System Health warns when a job has no recent successful run or
when its configured cadence is missed. Vercel plans that do not support
sub-daily Cron schedules must use an external scheduler with the same bearer
secret and cadence.

Every invocation that acquires the per-job PostgreSQL advisory lock writes a row
to `platform_job_runs` after migration `020_platform_job_runs.sql` is applied.
Overlapping invocations are skipped. If the migration has not been applied, the
job still runs under the lock, but execution history is unavailable and System
Health reports that honestly.

## System Health

The protected Super Admin health endpoint separates:

- configuration (database, migrations, email provider, public URL, payment
  provider, cron secret, `vercel.json`)
- connectivity (`SELECT 1`)
- outbox state, including queued, stuck, never-attempted, failed, accepted
  provider message IDs, and oldest pending age
- scheduled and recorded execution evidence for each cron job
- notification evaluation completion
- recent payment failures and stale pending payments

`ok` is only true when every checked signal is healthy. Queued email is not
reported as delivered. Provider readiness is not inferred from the absence of
payment failures.
