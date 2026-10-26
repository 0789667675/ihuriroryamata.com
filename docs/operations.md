# Operations notes

## Public URLs

Verification and email-change links require a canonical public HTTPS origin. Set
`NEXT_PUBLIC_APP_URL` (preferred) or `FRONTEND_URL` in the deployment
environment. In production, the application deliberately refuses to derive
email links from an untrusted request host. System Health reports the configured
origin and marks it as not configured when it is missing or invalid.

## Scheduled jobs

`vercel.json` schedules the subscription email outbox worker once per day:

- `/api/cron/subscription-emails` at `0 6 * * *` (UTC)

The route also accepts `POST` for an external scheduler. Both methods require
`Authorization: Bearer $CRON_SECRET`. Vercel Cron sends that header when the
`CRON_SECRET` environment variable is configured.

Notification evaluation is available at `/api/cron/notifications` and uses the
same bearer-secret protection, but it has no approved schedule yet. Its cadence
is a product decision. System Health reports it as unscheduled until a schedule
is added.

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
- outbox state, including queued, stuck, never-attempted, failed, and oldest
  pending age
- scheduled and recorded execution evidence for each cron job
- notification evaluation completion
- recent payment failures and stale pending payments

`ok` is only true when every checked signal is healthy. Queued email is not
reported as delivered. Provider readiness is not inferred from the absence of
payment failures.
