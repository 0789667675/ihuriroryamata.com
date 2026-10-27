# 12 — Developer Runbook & Local Operations Guide

## 1. Local Environment Prerequisites

- **Operating System**: Windows 10/11, macOS, or Linux (workspace path: `D:\ihuriroryamata.com`).
- **Node.js & npm**: Node.js `>= 20.x` (verified on `v26.4.0`) and npm `>= 10.x` (verified on `11.17.0`).
- **Database**: Supabase PostgreSQL instance with TLS 1.2+ (trusted via `lib/supabase-root-ca-2021.js`).

---

## 2. Environment Variables Reference (`.env.local`)

Copy `.env.example` to `.env.local` and configure the following variables (never commit `.env.local`):

| Variable Name | Required? | Purpose & Consuming Modules |
|---|---|---|
| `DATABASE_URL` | **Required** | Primary PostgreSQL connection string (`postgresql://...`) consumed by `lib/postgres.js` and `lib/db.ts`. |
| `DIRECT_URL` | Optional | Direct (non-pooled) Supabase connection URL for administrative/migration tasks. |
| `SESSION_SECRET` | **Required** | Secret (`>= 32` characters) used by `lib/security/session.js`, `middleware.ts`, and `lib/services/password-reset-service.js` to HMAC-sign `milk_session` cookies and reset OTP codes. |
| `SUPER_ADMIN_EMAIL` | **Required** | Authoritative email address promoted to `super_admin` on registration/login (`lib/security/authenticate.js`, `lib/services/auth-service.js`). |
| `APP_ENV` | Recommended | Environment label (`development`, `staging`, `production`). |
| `NEXT_PUBLIC_APP_NAME` | Optional | Public brand name (`Milk System`). |
| `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | Required in prod | Canonical base URL for email verification links (`lib/services/account-service.js`) and SEO metadata (`lib/config/site.ts`). |
| `RESEND_API_KEY` & `RESEND_FROM` | Optional locally / Required for email | Resend API credentials (`lib/services/email-service.js`). Note: `RESEND_FROM` must not use `onboarding@resend.dev` in production. (Alternative SMTP variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`). |
| `REPLY_TO` | Optional | Reply-to address for outgoing emails. |
| `LMBTECH_LIVE_PAYMENTS_ENABLED` | Required for live MoMo | Must be `'true'` to enable live MTN Mobile Money collection (`lib/services/payment-provider.js`). |
| `LMBTECH_API_KEY` & `LMBTECH_API_SECRET` | Required for live MoMo | LMBTech Basic Auth credentials (aliases `LMBTECH_PUBLIC_KEY` / `LMBTECH_SECRET_KEY` also supported). |
| `LMBTECH_CALLBACK_URL` | Required for live MoMo | Public HTTPS webhook URL pointing to `/api/subscription/payments/callback` (rejects `localhost` and `http://`). |
| `GOOGLE_VISION_API_KEY` (or `GOOGLE_VISION_SERVICE_ACCOUNT_JSON` / `BASE64` / `GOOGLE_APPLICATION_CREDENTIALS`) | Optional (for Photo OCR) | Google Cloud Vision `DOCUMENT_TEXT_DETECTION` credentials consumed by `lib/services/ocr-service.js`. If unset, `/api/imports/ocr` returns `{ enabled: false }` honestly. |
| `CRON_SECRET` | Required for Cron | Bearer secret (`>= 16` chars) authenticating `/api/cron/subscription-emails` and `/api/cron/notifications`. |
| `SUBSCRIPTION_REMINDER_DAYS` | Optional | Comma-separated day offsets before subscription deadline to queue reminder emails (e.g. `7,3,1`; consumed by `/api/cron/subscription-emails`). |
| `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Checked by `/api/health` (`lib/supabase.ts`). |

---

## 3. Running, Building, and Testing Locally

### 3.1 Start the Local Development Server
```powershell
npm run dev
```
Opens Next.js on `http://localhost:3000`.

### 3.2 Run Static TypeScript Verification
```powershell
npx tsc --noEmit
```

### 3.3 Run the Node.js Automated Test Suite (50 Files / 555 Tests)
```powershell
npm test
```
To run a single test file:
```powershell
node --test tests/milk-collection.test.js
```
To run the real-PostgreSQL integration tests (`tests/migration-smoke.test.js` and `tests/notifications-db.integration.test.js`) with `.env.local` loaded:
```powershell
node --env-file=.env.local --test tests/migration-smoke.test.js tests/notifications-db.integration.test.js
```

### 3.4 Run Playwright E2E Browser Tests
```powershell
npm run test:e2e
```
Runs `tests/e2e/farmer-delivery-traceability.spec.ts` and `tests/e2e/workspace-modal.spec.ts` against Chromium on port `3100` (`playwright.config.ts`).

### 3.5 Check Database Connectivity
> [!NOTE]
> Until `Finding F-031` is applied (`package.json` lacks `"db:check"` and `scripts/db-check.js` does not auto-load `.env.local`), run `scripts/db-check.js` with Node's `--env-file` flag:
```powershell
node --env-file=.env.local scripts/db-check.js
```

---

## 4. Database Migrations & Schema Management

1. **Migration Files Location**: `supabase/migrations/001_initial_schema.sql` through `022_farmer_field_configuration.sql`.
2. **Authoring Rules ([`supabase/migrations/README.md`](file:///d:/ihuriroryamata.com/supabase/migrations/README.md))**:
   - Never modify an already-numbered migration file (`001`–`022`). Always create a new forward migration (`023_*.sql`).
   - Every migration that creates a `public` table **must** include explicit `GRANT` statements in the same file (`GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated; GRANT ALL ON public.<table> TO service_role;` or `service_role` only for internal tables) and **must not** grant access to `anon` or disable RLS.
   - Run `node --test tests/migration-grants.test.js` after adding any migration to verify compliance.
   - Update `REQUIRED_MIGRATIONS` in both `app/api/health/route.ts` and `lib/services/platform-health-service.js` (`Finding F-020`).

---

## 5. Common Troubleshooting Guide

| Symptom / Error Code | Cause | Resolution |
|---|---|---|
| `503 SESSION_SECRET_NOT_CONFIGURED` | `SESSION_SECRET` is missing or shorter than 32 characters in `.env.local`. | Set a 64-character hex string in `SESSION_SECRET` and restart `npm run dev`. |
| `503 DATABASE_NOT_CONFIGURED` | `DATABASE_URL` is unset in `process.env`. | Ensure `.env.local` defines `DATABASE_URL`; if running a standalone Node script (`scripts/db-check.js`), pass `--env-file=.env.local`. |
| `402 SUBSCRIPTION_REQUIRED` | Customer account's 15-day initial access window or paid monthly period has elapsed (`now >= payment_due_at`). | Sign in as Super Admin (`SUPER_ADMIN_EMAIL`) → `Accounts` tab to grant an audited billing exemption or reconcile payment, or complete MoMo payment on the `Billing` tab. |
| `500` on revoking a collector, editing/deleting a deduction, or editing/voiding a milk record by ID | Missing `requireActiveSubscription` / `requireAccountType` imports in route handlers (`F-001`, `F-002`, `F-003`). | Apply Wave 1 hotfixes from `11-findings-and-prioritized-roadmap.md`. |
| Kinyarwanda farmer table import shows `"Column 1" .. "Column 5"` and puts header row in Row #1 | Legacy `detectHeader` in `lib/imports/text-parsing.js` rejects Kinyarwanda headers before `semantic-mapping.js` runs (`F-005`). | Apply `F-005` fix in `lib/imports/text-parsing.js` and `components/imports/farmer-bulk-import.tsx`. |
