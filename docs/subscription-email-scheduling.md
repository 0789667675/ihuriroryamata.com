# Subscription Email Scheduling

## Email Providers

`lib/services/email-service.js` selects the configured provider in this order:

1. `EMAIL_PROVIDER=resend` selects Resend.
2. `EMAIL_PROVIDER=smtp` explicitly selects SMTP.
3. If the selector is empty, a configured Resend key is preferred; otherwise complete SMTP settings are used.

The current local configuration indicates Resend is intended. Production Resend delivery requires server-side `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and an approved `RESEND_FROM` sender. The application no longer falls back to Resend's sample sender. SMTP remains available only when explicitly selected/configured and is used by the same account and subscription email service.

Existing account emails are password reset and email-change confirmation. Payment confirmation is queued transactionally with successful subscription activation. Subscription reminders, access-suspension notices, and usage-tier alerts use the same outbox. Account approval/registration emails are not currently implemented.

## Job Endpoint

No deployment scheduler configuration is present in the repository. Configure an external scheduler to call the subscription email job once daily. The route accepts `GET` (compatible with Vercel Cron) and `POST` (for schedulers that only issue POST):

`https://<deployed-domain>/api/cron/subscription-emails`

The notification evaluation endpoint also needs a deployment-owned schedule:

`https://<deployed-domain>/api/cron/notifications`

The repository does not document a cadence for notification evaluation; do not assume one. Both endpoints require this header:

`Authorization: Bearer <CRON_SECRET>`

Set `CRON_SECRET` in server-side deployment settings. Set `SUBSCRIPTION_REMINDER_DAYS` to the business-approved comma-separated day offsets before renewal, only after those offsets are approved by the product owner. It is intentionally blank by default; no reminder intervals are assumed. The job uses `Africa/Kigali` policy deadlines, suspends unpaid initial access at the configured instant, expires ended paid periods, suppresses pre-expiry reminders while a payment is pending, and uses unique event keys to avoid duplicate messages. Access enforcement also occurs in authenticated API requests and does not depend on this daily job running on time.

Usage-tier threshold alerts are queued when server-derived valid milk volume exceeds the selected tier. Their period-and-tier keys prevent duplicate in-app notices and emails for the same threshold. Emails use the same retryable outbox and do not change the customer’s tier or initiate a payment.

Successful payment settlement creates one outbox event in the same transaction as payment/subscription updates. The callback attempts delivery after commit. The scheduled job retries failed delivery with backoff. Provider failures remain pending and are audited; an API success response does not mean an email was delivered.

## Deployment Verification

- Reconcile the target migration ledger/schema, then apply `009_subscription_email_outbox.sql` if absent and `014_configurable_subscription_lifecycle.sql` through the approved migration process. Do not apply migrations based solely on repository order when the live ledger and schema disagree.
- Configure the chosen provider and approved sender in deployment secret storage.
- Configure the daily external scheduler and the approved reminder offsets.
- Verify the endpoint using a secret held by the scheduler; never put the secret in source, logs, or browser code.
- Confirm delivery using a controlled test account and provider logs. No email is considered live-tested merely because an outbox event is marked pending or the HTTP job completed.
