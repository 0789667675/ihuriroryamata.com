# LMBTech MTN MoMo Setup

This integration follows `docs/api_documentation_234435.pdf`. It uses the documented Basic authentication pair and the MTN MoMo collection/status endpoints. The documented API does not specify a separate callback signing secret; the application does not require one. As an application-level verification control, final callback states are checked against LMBTech by the stored payment reference before a subscription can change.

## Server Configuration

Set these variables in the server-side deployment environment, never in browser-exposed `NEXT_PUBLIC_` variables:

- `LMBTECH_BASE_URL=https://pay.lmbtech.rw/pay/config/api.php` (optional; this is the default)
- `LMBTECH_APP_KEY=<LMBTech App Key>`
- `LMBTECH_SECRET_KEY=<LMBTech Secret Key>`
- `LMBTECH_CALLBACK_URL=https://<deployed-domain>/api/subscription/payments/callback`
- `LMBTECH_ALLOW_REAL_PAYMENTS=false` until production configuration has been checked

The callback URL must use the deployed public HTTPS origin. Do not use a localhost URL. The application rejects non-HTTPS, localhost, and literal-IP callback hosts. No deployment hostname is assumed here.

For compatibility, `LMBTECH_API_KEY` and `LMBTECH_API_SECRET` are accepted as aliases. When both names are configured, `LMBTECH_APP_KEY` and `LMBTECH_SECRET_KEY` take precedence. Keep all four names server-side; never use `NEXT_PUBLIC_` variables for credentials.

Do not copy real keys into `.env.example`, source code, tests, docs, or logs. Use private local environment files or your deployment secret manager. The example file contains placeholders only and is not loaded by `next.config.mjs`.

## Database

Before deployment, have the database owner compare the applied migration ledger with repository migrations `007`–`013`. These migrations affect password-reset controls, payment transaction IDs and plan rows, the email outbox, Owner Ifishi backfill, assignment history, canonical Collector tiers, and transport snapshots. Review target data and resulting plan prices first; apply only through the approved environment migration process. Do not apply migrations manually to production or during local payment verification.

## Flow and Verification

1. The server derives the price from the authenticated account, its selected Collector usage tier or separate Collection Center plan. Subscription charges are monthly only.
2. The payer phone comes only from the authenticated account profile and must be a valid Rwanda mobile number.
3. Initiation sends the documented `MTN_MOMO_RWA` JSON fields to `https://pay.lmbtech.rw/pay/config/api.php` with HTTP Basic authentication. An accepted or pending initiation remains `PENDING`.
4. The callback is resolved by its exact stored `reference_id`; callback fields are treated as untrusted notification data. The server queries LMBTech's documented authenticated status endpoint by that reference and requires the callback claims and stored payment to agree with the provider response before settling.
5. Only a provider-confirmed terminal status with matching reference, amount, method, and transaction ID (where supplied) can change payment state. The database locks the payment and subscription so duplicate callbacks cannot settle twice.
6. Customers can refresh pending status from their own payment history. Super Admins can view provider-backed payment history and reconcile pending records.

Automated tests mock provider responses; they do not prove that keys work or that a deployed callback is publicly reachable. Do not describe payments as live-tested until a real, authorized LMBTech test transaction and callback have completed successfully.
