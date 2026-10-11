# Milk System: Capabilities and Gaps

**Status date:** 2026-10-11
**Scope:** Current Next.js application at the repository root. This report describes repository evidence; it is not a production deployment or live-provider certification.

## Executive Summary

The application implements the core workflows for dairy collectors and collection centers: farmer records, daily milk collection, pricing, deductions, period settlements, reports, alerts, subscriptions, and platform administration. Tenant ownership is enforced in server-side services and covered by automated tests. The planned public release is Collector-only in production; Collection Center code and data remain available for local development and future releases.

The repository now builds and its automated suite passes. The LMBTech MTN MoMo path has been aligned with the provider PDF, including authoritative server pricing, account-saved phone, pending-state reconciliation, verified callbacks, and transactional idempotency. Live production readiness remains unverified until the additive migration and deployment environment are configured and a real provider transaction/callback succeeds. No populated browser end-to-end suite or in-app notification scheduler was found.

## Capabilities Present

### Accounts and Access

- Collector account registration/login in production; Collection Center registration/login remains available outside production. Production registration, login, and authenticated-user resolution deny Collection Center accounts without deleting their accounts or data. Signed sessions, profile updates, password changes, password reset, and verified email changes remain available to supported accounts.
- Separate platform Super Admin access for account administration, subscription actions, plans, pricing configuration, and platform settings.
- Account ownership and collector-to-center assignment scoping on server-side data operations; tests cover cross-account isolation and role restrictions.
- English and Kinyarwanda interface copy.

### Dairy Operations

- Create and manage collection centers, collection windows, milk prices, and transport rates.
- Create, search, filter, page through, edit, and delete farmer records; link collectors to a collection center and assign farmers to collectors.
- Record daily farmer milk in morning/evening sessions, view daily totals, and update existing day records.
- Record collector-level actual milk, view collector history, maintain effective-dated collector prices, and void entries with a reason.
- Record and review farmer deductions.
- Use the Ifishi monthly farmer ledger for daily entries and persisted monthly history.
- Queue farmer milk writes in browser storage while offline and retry them when connectivity returns. This is limited offline support, not full offline operation.

### Reporting and Alerts

- Generate period summaries for daily, monthly, and half-month Ukwezi periods, including volumes, gross amounts, transport, deductions, farmer net amounts, and collector settlement reconciliation.
- Download Ukwezi reports as PDF.
- Persist and list notifications, count unread items, mark notifications read, and deduplicate generated alerts. Rules include missed collection, repeated zero-volume records, and unusually low collection against recent history.
- Audit administrative and selected operational actions.

### Subscription and Platform Management

- Calculate Collector usage-tier pricing and Collection Center subscription pricing, track usage and subscription state, and display payment attempts.
- Integrate MTN MoMo/LMBTech initiation, callback and status reconciliation. Customer billing supports monthly, 6-month, and yearly terms; subscription state changes only after provider status confirmation. Automated tests use mocked provider responses; no live transaction was performed.
- Provide platform account search/actions, subscription-plan management, payment configuration, and audit-log views.

### Web App Shell

- Responsive dashboard UI and a web app manifest/service worker.
- The service worker caches the app shell and same-origin GET assets; API requests are excluded from its cache.

## Missing, Incomplete, or Not Verified

### Release Readiness

- **Build and types:** the production build and standalone TypeScript check pass; this does not establish database migration or production-environment readiness.
- **Credential hygiene:** the hard-coded database credential was removed from `scripts/db-check.js`; the local example now contains placeholders and is no longer loaded by `next.config.mjs`. The existing ignored local environment still has legacy LMBTech variable names; if those values are valid, rotate them and configure the canonical names in private deployment settings.
- **Provider verification:** callback processing treats callback contents as untrusted and checks documented reference, transaction ID, status, amount, MTN method, and saved payer phone against authenticated LMBTech status before settlement. The PDF does not specify a callback signing secret. A live transaction and publicly reachable deployed callback have not been tested.

### Operational Readiness

- The repository contains migrations `001`-`013`. The configured remote database ledger reports only `001`-`006`, while read-only schema checks found objects from later migrations already present and `subscription_email_events` from `009` absent. The target environment (staging vs production) is not identified. Reconcile ledger and schema before applying any migration.
- Read-only prechecks found two active Collection Center accounts, one owner/date overlap relevant to the `010` Owner Ifishi backfill, zero duplicate active Collector assignments for `011`, and five valid-volume records without a transport-rate snapshot for `013`.
- Migration `008` updates the existing `USAGE_10001_20000_MONTHLY` price from the observed `15,000` RWF to `17,000` RWF. `008`/`012` require explicit price approval. Migration `009` is required by the successful-payment transaction's email-outbox insert and is missing from the configured schema.
- Migrations `010`-`013` have partial schema footprints despite being absent from the ledger. Back up and inspect existing objects/data, reconcile the Owner Ifishi overlap without deleting rows, and use the approved migration process. No migration was applied during this audit. Some transformations have no safe automatic rollback; validate backup/restore rather than assuming rollback SQL is sufficient.
- A consolidated production setup, migration, rollback, backup/restore, and incident runbook is still required.
- Required production configuration needs a verified Supabase/PostgreSQL connection, a strong `SESSION_SECRET`, email delivery configuration, public application origin, Super Admin identity, and (if billing is enabled) `LMBTECH_APP_KEY`, `LMBTECH_SECRET_KEY`, `LMBTECH_BASE_URL`, `LMBTECH_CALLBACK_URL`, and `LMBTECH_ALLOW_REAL_PAYMENTS` in server-side secret/config storage.
- Password-reset and account-email delivery depend on a configured email provider; successful delivery in a production environment was not tested.
- No in-app cron or scheduled task for notification evaluation was found. The authenticated evaluation endpoint must be triggered by an external scheduler or called manually for alerts to be generated on time.
- Health checking reports database connectivity, but no production monitoring, alerting, restore drill, or live service-level verification is represented by the repository tests.

### Test and Product Coverage

- Automated tests cover service, repository-query, validation, ownership, and business-rule behavior; provider requests are mocked. See the current verification output for the latest test count.
- `tests/e2e/README.md` and `tests/integration/README.md` are placeholders; there are no populated browser end-to-end or live database/provider integration suites in those folders.
- The tests do not establish that the deployed database has all migrations applied, email reaches users, MoMo callbacks work with the real provider, or the complete workflows work in supported browsers/devices.
- Offline queuing currently covers farmer milk writes to `/api/milk`; collector milk entry and other mutations are not queued. Sync is triggered by app connectivity handling, not a background sync worker, and conflicts still require operational handling.
- Notification generation has service-level tests, but production scheduling and delivery timing remain deployment responsibilities.

## Verification Performed

- `npx tsc --noEmit`: **passed**.
- These historical counts are not current verification evidence. Run the current suite, TypeScript check, and production build before release; provider tests are mocked and no live transaction is implied.

## Recommended Next Actions

1. Identify the configured remote database environment and reconcile its schema with migration history. Review the `007`-`013` prechecks, especially plan prices, the Owner Ifishi overlap, missing email outbox, and historical transport snapshots; obtain explicit authorization before applying migrations.
2. Confirm the two existing Collection Center accounts' compatibility plan before the production Collector-only gate is enabled.
3. Configure server-side payment credentials and the deployed HTTPS callback URL, then verify provider readiness without initiating a charge.
4. Add a deployment-owned scheduler for notification evaluation and document its cadence, timezone, and retry behavior.
5. Add browser E2E and staged-database integration coverage for Collector workflows.

## Evidence Pointers

- [Dashboard workflows](../app/workspace.tsx)
- [API routes](../app/api)
- [Ownership and session security](../lib/security)
- [Database migrations](../supabase/migrations)
- [Payment provider integration](../lib/services/payment-provider.js)
- [Subscription callback handling](../lib/services/subscription-service.js)
- [Notification evaluation](../lib/services/notification-service.js)
- [Offline write queue](../lib/offline-queue.ts)
- [Automated tests](../tests)
- [Database check script](../scripts/db-check.js)
- [Next.js configuration](../next.config.mjs)