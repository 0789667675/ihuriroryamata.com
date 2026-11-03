# Operations notes

## Public URLs

Verification and email-change links require a canonical public HTTPS origin. Set
`NEXT_PUBLIC_APP_URL` (preferred) or `FRONTEND_URL` in the deployment
environment. In production, the application deliberately refuses to derive
email links from an untrusted request host. System Health reports the configured
origin and marks it as not configured when it is missing or invalid.

## Scheduled jobs

`vercel.json` schedules one job (UTC), compatible with Vercel Hobby:

- `/api/cron/subscription-emails` daily at `0 6 * * *` for expiry, reminder, and usage-tier event creation.

The daily subscription job also delivers due outbox messages and retries failed messages whose backoff has elapsed. Payment, settlement, debt, and account events attempt delivery after their transaction commits. The notification and outbox cron routes remain available for authenticated manual/external invocation, but Vercel does not schedule them.

Scheduled routes accept `GET` from Vercel Cron and `POST` from an external
scheduler; both methods require `Authorization: Bearer $CRON_SECRET`. Vercel
Cron sends that header when the `CRON_SECRET` environment variable is configured.

Notification evaluation uses each center's configured session start/end times
and Kigali local time. Authenticated notification reads reconcile up to 30 days
of eligible alerts for that owner with database deduplication and a short
per-instance throttle. Business events are written immediately by their
originating request. System
Health treats notification reconciliation as request-driven and only requires
the daily subscription schedule.

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
- scheduled and recorded execution evidence for the daily cron job
- request-driven notification reconciliation status
- recent payment failures and stale pending payments

`ok` is only true when every checked signal is healthy. Queued email is not
reported as delivered. Provider readiness is not inferred from the absence of
payment failures.
