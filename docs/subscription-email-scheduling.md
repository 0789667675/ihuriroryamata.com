# Subscription Email Scheduling

## Email Providers

`lib/services/email-service.js` selects the configured provider in this order:

1. `EMAIL_PROVIDER=resend` selects Resend.
2. `EMAIL_PROVIDER=smtp` explicitly selects SMTP.
3. If the selector is empty, a configured Resend key is preferred; otherwise complete SMTP settings are used.

The current local configuration indicates Resend is intended. Production Resend delivery requires server-side `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and an approved `RESEND_FROM` sender. The application no longer falls back to Resend's sample sender. SMTP remains available only when explicitly selected/configured and is used by the same account and subscription email service.

Existing account emails are password reset and email-change confirmation. Payment confirmation is queued transactionally with successful subscription activation. Subscription reminders, access-suspension notices, and usage-tier alerts use the same outbox. Account approval/registration emails are not currently implemented.

## Job Endpoints

`vercel.json` schedules the subscription event scan daily and runs the existing outbox delivery worker every 15 minutes:

- `https://<deployed-domain>/api/cron/subscription-emails` (`0 6 * * *` UTC) creates expiry, configured reminder, and usage-tier events.
- `https://<deployed-domain>/api/cron/subscription-email-outbox` (`*/15 * * * *` UTC) retries pending email events independently of the daily scan.

Operational notification evaluation is scheduled separately:

- `https://<deployed-domain>/api/cron/notifications` (`*/15 * * * *` UTC)

All endpoints accept `GET` and `POST` and require this header:

`Authorization: Bearer <CRON_SECRET>`

Set `CRON_SECRET` in server-side deployment settings. Set `SUBSCRIPTION_REMINDER_DAYS` to the business-approved comma-separated day offsets before renewal; it remains blank by default. The scan uses `Africa/Kigali` policy deadlines, suspends unpaid initial access at the configured instant, expires ended paid periods, suppresses pre-expiry reminders while a payment is pending, and uses unique event keys to avoid duplicate messages. The 15-minute delivery worker handles backoff retries without repeating the heavier tier-usage scan. Access enforcement also occurs in authenticated API requests and does not depend on the daily event scan running on time.

Usage-tier threshold alerts are queued when server-derived valid milk volume exceeds the selected tier. Their period-and-tier keys prevent duplicate in-app notices and emails for the same threshold. Emails use the same retryable outbox and do not change the customer’s tier or initiate a payment.

Successful payment settlement creates one outbox event in the same transaction as payment/subscription updates. The callback attempts delivery after commit. The scheduled job retries failed delivery with backoff. Provider failures remain pending and are audited; an API success response does not mean an email was delivered.

## Deployment Verification

- Reconcile the target migration ledger/schema, then apply `009_subscription_email_outbox.sql` if absent and `014_configurable_subscription_lifecycle.sql` through the approved migration process. Do not apply migrations based solely on repository order when the live ledger and schema disagree.
- Configure the chosen provider and approved sender in deployment secret storage.
- Confirm the deployment plan supports the two 15-minute Vercel Cron schedules; otherwise configure an external scheduler at the same cadence.
- Configure the daily subscription scan and the approved reminder offsets.
- Verify the endpoint using a secret held by the scheduler; never put the secret in source, logs, or browser code.
- Confirm delivery using a controlled test account and provider logs. No email is considered live-tested merely because an outbox event is marked pending or the HTTP job completed.
