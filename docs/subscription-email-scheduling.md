# Subscription Email Scheduling

## Email Providers

`lib/services/email-service.js` selects Resend when `EMAIL_PROVIDER=resend`, SMTP when `EMAIL_PROVIDER=smtp`, and otherwise uses a configured Resend key before complete SMTP settings. Production Resend delivery requires `RESEND_API_KEY` and an approved `RESEND_FROM`; the application does not use a sample sender.

Payment, subscription, and business-event emails use the transactional `subscription_email_events` outbox. Password-reset and security emails use their existing immediate mail paths. Outbox events keep stable event keys and provider idempotency keys; they are marked sent only after the provider returns an accepted message ID, which is stored for audit.

## Job Inventory

The previous production configuration had three jobs:

| Job | Previous purpose and data | Criticality and replacement |
| --- | --- | --- |
| `/api/cron/notifications` (`*/15 * * * *`) | Evaluated operational alerts for all active owners from recent milk deliveries, collection sessions, farmer history, and subscription state. | Not a core business operation. Business-event notices are emitted immediately after authoritative writes. Operational alerts reconcile for the authenticated owner when notifications are read, with up to 30 days of bounded backfill. No scheduled execution is required. |
| `/api/cron/subscription-email-outbox` (`*/15 * * * *`) | Claimed pending or retryable email-outbox rows, delivered them, and recorded provider acceptance or retry state. | Delivery is important, but 15-minute retries are not required on Hobby. Payment, settlement, debt, and account transactions attempt relevant delivery after commit; the daily subscription job retries all due outbox events. The endpoint remains available for manual/external invocation. |
| `/api/cron/subscription-emails` (`0 6 * * *`) | Scanned subscription expiry, configured reminder dates, and usage-tier candidates; queued events and delivered outbox items. | Remains the only Vercel cron. It is idempotent and only handles daily lifecycle notices, usage alerts, and due email retries, never milk recording or accounting. |

Vercel Hobby now runs only `/api/cron/subscription-emails` at `0 6 * * *` UTC. No schedule runs more than once per day. All scheduled routes accept `GET` and `POST` and require `Authorization: Bearer <CRON_SECRET>`. Set `SUBSCRIPTION_REMINDER_DAYS` to approved comma-separated day offsets; it remains blank by default.

Operational notifications are owner-scoped and reconciled on demand for up to 30 days when an authenticated owner loads `/api/notifications`. Milk corrections/voids, settlements, debt changes, verified payment changes, and password/security events create deduplicated in-app notifications immediately after the authoritative business write. Notification reconciliation preserves database deduplication, audit events, priority, translations, and persisted read state.

Subscription enforcement reads the current database timestamps on authenticated requests and applies the effective state using the configured Africa/Kigali lifecycle policy. It does not depend on the daily job mutating a status row. Expired users retain historical/reporting, settlement/debt, billing/payment, and profile/security access while operational writes remain guarded by subscription checks.

If nobody opens the application for several days, the daily job continues to queue expiry/reminder events and process due email retries. Operational alerts are reconciled from current database state when the owner returns, up to the 30-day backfill limit. Events older than that window are not backfilled as operational alerts.

## Deployment Verification

- Confirm the target database has the required outbox and subscription lifecycle migrations; reconcile the live migration ledger before applying anything.
- Configure the chosen email provider and approved sender in server-side deployment settings.
- Confirm `vercel.json` contains only daily-or-less-frequent schedules.
- Configure the daily subscription scan and any approved reminder offsets.
- Verify the cron endpoint using a secret held by the scheduler; never put the secret in source, logs, or browser code.
- Confirm delivery using a controlled test account and provider logs. A queued event or successful HTTP response alone does not prove provider acceptance.
