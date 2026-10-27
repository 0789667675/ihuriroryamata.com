# 14 — Open Product Questions and Audit Limitations

## 1. Open Product & Business Questions (Requiring Owner / Stakeholder Alignment)

The following questions represent genuine business-policy or product-design decisions surfaced by the audit where the desired domain rule should be confirmed before modifying schema or accounting behavior:

### 1.1 Multi-Tenant Farmer Identity Sharing (`Finding F-017`)
- **Current Behavior**: Migration [`002_farmers_collection_centers.sql:11-14`](file:///d:/ihuriroryamata.com/supabase/migrations/002_farmers_collection_centers.sql#L11-L14) defines `uq_farmers_national_id` and `uq_farmers_account_number` globally across the entire `farmers` table (without `owner_user_id`).
- **Question**: Can the same physical farmer deliver milk to two different independent Collectors or Collection Centers on the platform (or be re-registered by a new Collector after switching cooperatives)?
  - **Recommended Default**: Scope uniqueness to `(owner_user_id, national_id)` and `(owner_user_id, account_number)` via forward migration `023` so independent tenants do not block one another or leak whether a National ID/account number is registered under another tenant.

### 1.2 Assigned Collector Permissions on Dairy-Owned Farmers (`Finding F-013`)
- **Current Behavior**: When a Collector (`COLLECTOR`) is linked to a Collection Center (`COLLECTION_CENTER`) via `collector_assignments`, the Collector can record daily milk (`POST /api/milk`) and save monthly Farmer Ifishi templates (`PUT /api/milk/template`) for dairy-owned farmers assigned to them (`farmers.owner_user_id = dairy.id, collector_user_id = collector.id`). However, `GET /api/milk/template`, `GET/PUT/DELETE /api/milk/[id]`, and `POST/GET /api/deductions` currently filter strictly by `owner_user_id = collector.id` and reject dairy-assigned farmers with `404`.
- **Question**: Should an assigned Collector be permitted to:
  1. Read the Farmer Ifishi monthly grid (`GET /api/milk/template`) and edit/void individual daily milk entries (`/api/milk/[id]`) for their assigned dairy farmers? (**Recommended: Yes**, to match `POST /api/milk` and `PUT /api/milk/template`.)
  2. Record farmer deductions (`Advance`, `Umwenda`, `Other`) against dairy-assigned farmers, or are deductions restricted to standalone Collector-owned farmers?

### 1.3 Revoking a Collector Assignment (`collector_assignments` — `Finding F-011`)
- **Current Behavior**: When a Collection Center revokes a Collector (`collectorAssignmentRepository.revokeAssignment`, `lib/repositories/collectorAssignmentRepository.js:83-110`), `collector_assignments.revoked_at` is set to `NOW()`, while `farmers.collector_user_id` on the Dairy's farmers remains populated with the revoked Collector's ID so historical attribution is preserved.
- **Question**: Should revoking a Collector keep `farmers.collector_user_id` populated (relying on `WHERE ca.revoked_at IS NULL` joins to revoke active access) or should the Dairy be prompted to reassign those farmers to another active Collector?

### 1.4 Negative Farmer Net Payable Handling at Period Close (`Finding F-016`)
- **Current Behavior**: When a farmer's active deductions (`Advance`, `Umwenda`, `Other`) and transport charges in a half-month period exceed their gross milk value ($N_i < 0$), `monthly-report-service.js` reports a negative `netAmount` and flags an `unexplainedDiscrepancy`.
- **Question**: When $N_i < 0$ at the end of a half-month `Ukwezi` period, should the system automatically offer a one-click action in `Settlements` (`Ubwishyu`) to carry forward $|N_i|$ into `farmer_debt_ledgers` for the next half-month period?

### 1.5 Scheduled Operational Alert Evaluation in Production (`Finding F-004`)
- **Current Behavior**: [`vercel.json`](file:///d:/ihuriroryamata.com/vercel.json) schedules `/api/cron/subscription-emails` daily at `06:00 UTC`, while `/api/cron/notifications` is not listed in `vercel.json` (and `platform-health-service.js` explicitly notes that operational alert evaluation runs lazily via `POST /api/notifications/evaluate` when users open the workspace).
- **Question**: Once `F-004` (`UserRepository.getActiveUsers()`) is fixed in `/api/cron/notifications`, should `/api/cron/notifications` also be added to `vercel.json`, or remain an on-demand / external-cron endpoint to stay within Vercel Hobby/Pro cron limits?

---

## 2. Environment & Audit Limitations

In accordance with Operating Rule 15, the following environment constraints encountered during this audit are documented transparently:

1. **Terminal Sandbox Network Isolation (`ENOTFOUND` on Outbound Supabase DNS)**:
   - Commands executed inside the local terminal sandbox (`BypassSandbox: false`) have full read/write access to `D:\ihuriroryamata.com` but no outbound internet/DNS access.
   - Consequently, running `node --env-file=.env.local scripts/db-check.js` inside the sandbox returned `ENOTFOUND` when resolving the remote Supabase PostgreSQL host, and the two `DATABASE_URL`-gated real-DB test files (`tests/migration-smoke.test.js` live introspection branch and `tests/notifications-db.integration.test.js`) could not query the live remote Supabase database from inside the sandbox.
   - All 22 SQL migration files (`001`–`022`), all 17 repositories, and all 553 passing unit/contract tests were verified locally against the repository source code.
2. **External Third-Party API Credentials (`RESEND_FROM`, Google Cloud Vision, LMBTech Live MoMo)**:
   - `.env.local` contains a placeholder fragment in `RESEND_FROM` (`isPlaceholder: true`).
   - Live outbound calls to Resend email delivery, Google Cloud Vision OCR (`DOCUMENT_TEXT_DETECTION`), and LMBTech MTN Mobile Money collection were not triggered during the audit to avoid side effects, external charges, or sending real emails/MoMo prompts. Their adapter contracts, payload schemas, error handling, and webhook verification logic were audited via source inspection and unit test execution (`tests/email-service.test.js`, `tests/import-Hardening.test.js`, `tests/subscriptions-payments.test.js`).
3. **Preservation of Existing Build Artifacts**:
   - Per Operating Rules 3 and 13, `npm run build` (`next build`) was not executed during discovery so that existing `.next`, `.next-build-verify`, and `.next-ui-verify` directories remained untouched; static compilation safety was verified non-destructively via `npx tsc --noEmit` (exit code `0`).
