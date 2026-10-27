# 00 — Executive Summary: IHURIRO RY'AMATA (Milk System) Codebase Audit

**Product:** IHURIRO RY'AMATA (Milk System)  
**Company:** Milk System Technologies Ltd.  
**Repository:** `D:\ihuriroryamata.com` (`main` branch, commit `3e905ba`)  
**Audit Date:** 2026-10-27  
**Auditor Role:** Principal Full-Stack Architect, Database Auditor, QA Engineer, UI/UX & Accessibility Reviewer, Application Security Reviewer  

---

## 1. Purpose and Scope of This Audit

This technical audit establishes a verified, evidence-backed system map, domain and accounting review, UI/UX and accessibility inventory, import pipeline assessment, security and reliability evaluation, and prioritized engineering roadmap for **IHURIRO RY'AMATA (Milk System)**.

All findings in this documentation suite (`docs/system-audit/00` through `docs/system-audit/14`) are derived directly from source code inspection, SQL migration analysis (`001`–`022`), static type verification (`npx tsc --noEmit`), and automated test execution (`npm test` across 555 test cases). No application code, database records, or tracked repository files were modified during this audit.

---

## 2. System Overview

**IHURIRO RY'AMATA** is a Kinyarwanda-first (`rw`) and English (`en`) dairy operations, traceability, and accounting platform built for Rwandan milk collectors (**Abacunda** / `COLLECTOR`), milk collection centers (**Ikigo cy'ikusanyirizo** / `COLLECTION_CENTER`), and platform administrators (`super_admin`).

### Core Capabilities Implemented in Code
1. **Multi-Role Account & Tenant Model**:
   - **Collector (`COLLECTOR`)**: Manages owned collection sites (`collection_centers`), registers farmers (`Aborozi`), records morning (`Igitondo`) and evening (`Umugoroba`) milk deliveries (`Amata`), records collector-level Owner Ifishi deliveries (`is_owner_milk = TRUE`), records farmer deductions (`Avansi`, `Umwenda`, `Other`), reconciles half-month `Ukwezi` statements (Days `1–15` and `16–end`), approves non-SACCO cash settlements, confirms farmer payouts, and tracks carried-forward farmer debt ledgers (`farmer_debt_ledgers`).
   - **Collection Center (`COLLECTION_CENTER`)**: Configures its dairy center (`Ikigo`), links/revokes Collector accounts (`collector_assignments`), registers/assigns farmers to linked Collectors, monitors daily aggregated collector deliveries (`Ifishi y'Abacunda`), and generates center-scoped `Ukwezi` reports and PDFs.
   - **Super Admin (`super_admin`)**: Governs customer accounts, suspensions, billing exemptions, collector volume-tier pricing (`subscription_plans`), collection-center flat monthly pricing (`collection_center_subscription_config`), initial access / grace-period policies (`subscription_policy_settings`), LMBTech MTN Mobile Money payment reconciliation, platform-wide audit logs, and system health diagnostics.
2. **Intelligent Farmer & Milk Notebook Import Pipeline**:
   - Supports pasted text, CSV/TXT, Excel (`.xlsx`/`.xls`), text-based PDFs, and Google Cloud Vision OCR photo scanning (`DOCUMENT_TEXT_DETECTION`) for both farmer directories (`components/imports/farmer-bulk-import.tsx`) and handwritten milk notebooks (`components/imports/milk-notebook-import.tsx`).
   - Includes a semantic Kinyarwanda/English/French column mapper (`lib/imports/semantic-mapping.js`), per-owner field configuration (`farmer_field_configurations`), fuzzy/exact duplicate detection (`lib/imports/farmer-matching.js`), and chunked transactional batch saving (`import_batches`).
3. **Operational Alerting & Subscription Billing**:
   - Evaluates session-aware missed deliveries, volume drops, spikes, and collector-vs-farmer reconciliation gaps (`lib/services/operational-alert-rules.js`).
   - Enforces a configurable initial access window (default 15 days in `Africa/Kigali`), monthly tier/flat subscriptions paid via LMBTech MTN MoMo (`lib/services/payment-provider.js`), and transactional email outbox delivery via Resend/SMTP (`subscription_email_events`).

---

## 3. Baseline Verification Table (Phase Zero)

| Area | Current State | Evidence | Limitations |
|---|---|---|---|
| **Repository** | Clean Git working tree on `main...origin/main` at commit `3e905ba` ("Redesign farmer import into a semantic, user-controlled pipeline"). Contains 4 tracked backup/snapshot files (`workspace.txt`, `middleware.ts.BEFORE-AUTH-MOCK-FIX-2026-10-07`, 2 `.bak` files) and 2 local build verify dirs (`.next-build-verify`, `.next-ui-verify`). | `git status --short --branch`; `git log -n 15 --oneline` | None. |
| **Framework** | Next.js `14.2.35` (App Router) with React `18.3.1`, TypeScript `5.6.2` (`strict: false`), Node.js `v26.4.0`, npm `11.17.0`. | `package.json:1-38`, `next.config.mjs:1-22`, `tsconfig.json:1-36` | Legacy `pages/_document.js` coexists with App Router `app/layout.tsx`. |
| **Dependencies** | Runtime: `next`, `react`, `react-dom`, `pg` (`^8.12.0`), `bcryptjs`, `lucide-react`, `pdfkit`, `pdfjs-dist`, `xlsx`, `@supabase/supabase-js`, `@supabase/ssr`. Dev: `@playwright/test` (`^1.59.1`), `typescript`. | `package.json:12-36` | Tailwind CSS is **not** installed, though several unused scaffolding components in `components/ui/*` use Tailwind class strings. |
| **Local Startup** | Configured via `npm run dev` (`next dev`). `.env.local` is present and defines 20 environment variables (`DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `SUPER_ADMIN_EMAIL`, `RESEND_API_KEY`, `LMBTECH_*`, `CRON_SECRET`, etc.). | `package.json:6`, `.env.local` (key names & lengths verified without reading secret values) | `RESEND_FROM` in `.env.local` still contains a placeholder fragment (`length: 46, isPlaceholder: true`). |
| **Database Connection** | Primary data access uses `lib/postgres.js` (`pg.Pool` with `DATABASE_URL` and `lib/supabase-root-ca-2021.js`). 22 SQL migrations (`001`–`022`) define 33 tables. | `lib/postgres.js:1-28`, `supabase/migrations/001`–`022` | `package.json` lacks the documented `"db:check"` script; `scripts/db-check.js` does not load `.env.local`; sandbox environment blocks outbound DNS (`ENOTFOUND`) to remote Supabase host. |
| **Automated Tests** | **50 Node test files** (`555` tests executed via `npm test`: **553 passed, 1 failed, 1 skipped** in `22.98s`) + **2 Playwright E2E spec files** (`tests/e2e/*.spec.ts`). | `npm test` execution output; `tests/job-runs.test.js:59` (`FAIL`); `tests/notifications-db.integration.test.js:9` (`SKIP`) | `tests/job-runs.test.js:76` fails due to a parameter index mismatch (`values[1]` vs `values[2]`). Real-DB smoke tests (`migration-smoke.test.js`, `notifications-db.integration.test.js`) require live `DATABASE_URL` network reachability. |
| **Build & Static Check** | TypeScript static typecheck (`npx tsc --noEmit`) **passed with 0 errors** (exit code `0`). Prior local build artifacts exist in `.next`, `.next-build-verify`, and `.next-ui-verify`. | `npx tsc --noEmit` execution; `tsconfig.json` | Production `next build` was not re-run during discovery to preserve existing `.next` artifacts per Operating Rule 3/13. |
| **UI Inspection** | Full source-level inspection completed across `app/welcome.tsx`, `app/workspace.tsx` (4,418 lines), `components/imports/*`, `components/ui/*`, `app/globals.css` (1,736 lines), and `lib/i18n/*`. | `app/workspace.tsx:1-4418`, `app/globals.css:1-1736`, `tests/e2e/*.spec.ts` | Interactive live browser session was not launched against remote Supabase DB; UI states were verified via code inspection, static UI tests, and E2E spec analysis. |
| **Documentation** | 6 docs in `docs/` + `supabase/migrations/README.md` inspected. Operational runbooks for password reset, LMBTech MoMo, and imports are mostly accurate, but `docs/system-capabilities-and-gaps.md` has drifted behind migrations `017`–`022`. | `docs/*.md`, `supabase/migrations/README.md` | `docs/system-capabilities-and-gaps.md` (dated 2026-10-14) predates migrations `017`–`022`, public Collection Center registration enablement, `vercel.json`, and Playwright E2E tests. |

---

## 4. Key Architectural Strengths

1. **Strong Server-Side Ownership Isolation Pattern**: Almost all 17 repositories in `lib/repositories/*.js` parameterize SQL queries and explicitly bind `owner_user_id` derived from the server-verified `milk_session` cookie rather than trusting client-supplied owner IDs.
2. **Historical Price & Loss Auditability**: Milk deliveries snapshot `price_per_liter` and `transport_rate_per_liter` at entry time (`lib/repositories/milkRepository.js:145-241`), preserve `original_volume_liters` and `original_amount` during center-wide loss adjustments (`lib/repositories/milkAdjustmentRepository.js:5-168`), and refuse to substitute current prices when historical price snapshots are missing (`lib/services/monthly-report-service.js`).
3. **Hardened Mobile Money Callback Verification**: `lib/services/subscription-service.js:559-646` (`handleProviderCallback`) never trusts raw webhook payloads; it queries LMBTech's status endpoint directly and verifies amount, currency (`RWF`), payment method (`MTN_MOMO_RWA`), phone number, and provider transaction ID inside a row-locked PostgreSQL transaction (`FOR UPDATE`).
4. **Kigali Timezone Determinism**: Accounting periods (`lib/utils/accounting-period.js`) and localized date formatting (`lib/i18n/date-format.js`) anchor calculations to `Africa/Kigali` with explicit Kinyarwanda month/weekday lookup tables rather than relying on server UTC or inconsistent browser ICU locales.

---

## 5. Summary of Critical & High-Priority Findings (`P0`–`P3`)

Across the audit, **31 consolidated findings (`F-001` through `F-031`)** were identified and documented with exact file/line evidence, root causes, minimal safe fixes, and regression test specifications in [`11-findings-and-prioritized-roadmap.md`](file:///d:/ihuriroryamata.com/docs/system-audit/11-findings-and-prioritized-roadmap.md):

| Priority | Count | Summary of Key Issues |
|---|---|---|
| **P0 (Critical Blockers)** | **8** | **4 guaranteed runtime crashes (`500`)**: missing `requireActiveSubscription`/`requireAccountType` imports in `app/api/milk/[id]/route.js`, `app/api/deductions/[id]/route.js`, and `app/api/collector-assignments/[collectorUserId]/route.js`; `UserRepository.repository.getActiveUsers()` `TypeError` in `app/api/cron/notifications/route.js`.<br>**2 critical Farmer Import blockers**: `detectHeader` in `lib/imports/text-parsing.js` rejects Kinyarwanda headers (`NO \| AMAZINA YOMBI Y'UMWOROZI \| ...`) before `semantic-mapping.js` runs; `saveAttempted` in `farmer-bulk-import.tsx` locks out editing/retrying failed rows.<br>**2 critical accounting bugs**: standalone Collector subscription milk usage always computes `0 L` when only farmer milk is recorded (`subscriptionRepository.js:412-430`); center-level milk loss adjustments overwrite individually voided (`cancelled`) farmer records back to `adjusted` (`milkAdjustmentRepository.js:23-33`). |
| **P1 (High Priority)** | **11** | Failing unit test in `tests/job-runs.test.js:76`; `middleware.ts:58` dot-path auth bypass; `POST /api/collector-assignments` allowing `COLLECTOR` accounts to act as dairies; missing subscription row bypassing `requireActiveSubscription`; broken assigned-collector ownership scope in `milk/[id]`, `milk/template`, `ifishi/pdf`, and `deductions`; uncalled `buildDairyCollectorSettlementRows` leaving Collection Center Ukwezi PDFs without collector rows; cash settlement race condition & `getSettlementRecord` SQL placeholder bug; negative farmer net payable false discrepancy; global `national_id`/`account_number` unique indexes across tenants & unguarded cascade delete of settlements/debts in `deleteFarmer`; `detectColumnMisalignment` running on `rows = []` and server ignoring `farmer_field_configurations`; severe Kinyarwanda mistranslations in `import-copy.ts` (`"Ijoro"` = Night for Morning, `"Amafaranga"` = Money for Actions) and uninterpolated `{count}` placeholder. |
| **P2 (Medium Priority)** | **9** | Health probes missing migration `021`/`022`; billing-exempt accounts receiving expiration transitions/emails in cron job; LMBTech failed callbacks rejected when `transactionId` is null; `transport_rate_per_liter` omitted on milk record updates & `valid_amount` left non-zero on Owner Ifishi void; `state=action` notification filter checking `'high'` instead of `'critical'`; `SUPER_ADMIN_EMAIL` fallback inconsistency & `/api/farmers/count` cross-collector probing; N+1 SQL loops in farmer batch import and center loss adjustments; server CSV parser splitting on semicolons inside comma-delimited files; 4,418-line `app/workspace.tsx` monolith and raw JSON in Admin System Health UI. |
| **P3 (Low Priority)** | **3** | Duplicate indexes & missing `plan_id` FKs in migrations plus 5 unused legacy tables; tracked backup/snapshot files (`workspace.txt`, `.bak` files) and dead Supabase SSR/Tailwind scaffolding; missing `"db:check"` script in `package.json`, `.env.local` loading gap in `scripts/db-check.js`, and documentation drift in `docs/system-capabilities-and-gaps.md`. |

---

## 6. Index of Audit Deliverables (`docs/system-audit/`)

1. [`00-executive-summary.md`](file:///d:/ihuriroryamata.com/docs/system-audit/00-executive-summary.md) — Executive summary, baseline verification table, and findings overview.
2. [`01-project-structure.md`](file:///d:/ihuriroryamata.com/docs/system-audit/01-project-structure.md) — Complete directory and module inventory, entry points, responsibilities, and dead/duplicate code register.
3. [`02-system-architecture.md`](file:///d:/ihuriroryamata.com/docs/system-audit/02-system-architecture.md) — End-to-end runtime architecture and 5 verified Mermaid diagrams.
4. [`03-routes-and-ui-inventory.md`](file:///d:/ihuriroryamata.com/docs/system-audit/03-routes-and-ui-inventory.md) — Every public route, auth route, dashboard tab (`?tab=`), modal, drawer, and UI state.
5. [`04-api-and-backend.md`](file:///d:/ihuriroryamata.com/docs/system-audit/04-api-and-backend.md) — Complete catalog of all 78 API route handlers, 28 services, guards, schemas, and side effects.
6. [`05-database-and-data-model.md`](file:///d:/ihuriroryamata.com/docs/system-audit/05-database-and-data-model.md) — Verified 33-table schema across migrations `001`–`022`, constraints, indexes, grants, RLS status, and 17 repositories.
7. [`06-business-rules-and-accounting.md`](file:///d:/ihuriroryamata.com/docs/system-audit/06-business-rules-and-accounting.md) — Exact formulas and rules for milk recording, losses, voids, Owner Ifishi, Ukwezi half-month accounting, SACCO/cash settlements, debt ledgers, and subscriptions.
8. [`07-ui-ux-and-interactivity.md`](file:///d:/ihuriroryamata.com/docs/system-audit/07-ui-ux-and-interactivity.md) — Interactive elements, responsive breakpoints, accessibility (keyboard/ARIA/focus), design tokens, and localization audit.
9. [`08-import-and-registration-audit.md`](file:///d:/ihuriroryamata.com/docs/system-audit/08-import-and-registration-audit.md) — Deep dive into farmer registration, field configuration, semantic column mapping, OCR/PDF/Excel/CSV parsing, duplicate handling, and failed-row recovery.
10. [`09-security-and-reliability.md`](file:///d:/ihuriroryamata.com/docs/system-audit/09-security-and-reliability.md) — Session HMAC security, tenant isolation, middleware, rate limiting, payment webhook security, and concurrency analysis.
11. [`10-tests-and-local-validation.md`](file:///d:/ihuriroryamata.com/docs/system-audit/10-tests-and-local-validation.md) — Inventory of all 52 test files, exact execution output (555 tests), failure root cause, and workflow verification statuses.
12. [`11-findings-and-prioritized-roadmap.md`](file:///d:/ihuriroryamata.com/docs/system-audit/11-findings-and-prioritized-roadmap.md) — Complete `P0`–`P3` findings register (`F-001`–`F-031`) and dependency-ordered remediation roadmap.
13. [`12-developer-runbook.md`](file:///d:/ihuriroryamata.com/docs/system-audit/12-developer-runbook.md) — Practical developer guide for local setup, environment variables, migrations, testing, and troubleshooting.
14. [`13-requirements-and-coverage-matrix.md`](file:///d:/ihuriroryamata.com/docs/system-audit/13-requirements-and-coverage-matrix.md) — End-to-end traceability matrix mapping every product requirement to UI, API, Service, Repository, DB table, tests, and verification status.
15. [`14-open-questions-and-limitations.md`](file:///d:/ihuriroryamata.com/docs/system-audit/14-open-questions-and-limitations.md) — Product/business questions requiring owner decision and environment/sandbox limitations encountered during the audit.
