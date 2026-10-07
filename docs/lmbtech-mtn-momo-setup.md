# LMBTech MTN MoMo Setup

This integration follows `docs/api_documentation_234435.pdf`. It uses the documented Basic authentication pair and the MTN MoMo collection/status endpoints. The documented API does not specify a separate callback signing secret; the application does not require one. As an application-level verification control, final callback states are checked against LMBTech by the stored payment reference before a subscription can change.

## Server Configuration

Set these variables in the server-side deployment environment, never in browser-exposed `NEXT_PUBLIC_` variables:

- `LMBTECH_BASE_URL=https://pay.lmbtech.rw/pay/config/api`
- `LMBTECH_APP_KEY=<LMBTech App Key>`
- `LMBTECH_SECRET_KEY=<LMBTech Secret Key>`
- `LMBTECH_CALLBACK_URL=https://<deployed-domain>/api/subscription/payments/callback`
- `LMBTECH_ALLOW_REAL_PAYMENTS=false` until production configuration has been checked

The callback URL must use the deployed public HTTPS origin. Do not use a localhost URL. The application rejects non-HTTPS, localhost, and literal-IP callback hosts. No deployment hostname is assumed here.

Do not copy real keys into `.env.example`, source code, tests, docs, or logs. Use private local environment files or your deployment secret manager. The example file contains placeholders only and is not loaded by `next.config.mjs`.

## Database

Apply `supabase/migrations/008_lmbtech_payment_reconciliation.sql` through the existing Supabase migration process before deploying this code. It adds the provider transaction ID and updates active Collector tiers while retaining historical plan rows for in-flight payments. Do not apply migrations manually to production without following the deployment's normal migration procedure.

## Flow and Verification

1. The server derives the price from the authenticated account, its usage tier or Collection Center plan, and the requested billing period. Supported periods are monthly, 6 months at a 10% discount, and yearly at a 12% discount.
2. The payer phone comes only from the authenticated account profile and must be a valid Rwanda mobile number.
3. Initiation sends the documented `MTN_MOMO_RWA` fields to the API endpoint. An accepted or pending initiation remains `PENDING`.
4. The callback is resolved by its exact stored `reference_id`. The documented `transaction_id`, amount, method, and payer phone are checked. The server then queries LMBTech status by that same reference.
5. Only a provider-confirmed success with matching reference, amount, method, and transaction ID can activate or extend the matching owner's subscription. The database locks the payment and subscription so duplicate callbacks cannot settle twice.
6. Customers can refresh pending status from their own payment history. Super Admins can view provider-backed payment history and reconcile pending records.

Automated tests mock provider responses; they do not prove that keys work or that a deployed callback is publicly reachable. Do not describe payments as live-tested until a real, authorized LMBTech test transaction and callback have completed successfully.
