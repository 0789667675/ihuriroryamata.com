# 01 — Project Structure & Source-Code Inventory

## 1. High-Level Repository Layout

```text
D:\ihuriroryamata.com
├── app/                          # Next.js 14 App Router pages, layouts, global CSS, and 78 API routes
│   ├── (auth)/                   # Public authentication route group (/login, /register, /forgot-password, /verify-email*)
│   ├── (dashboard)/              # Authenticated dashboard route group (/dashboard)
│   ├── api/                      # 78 Node.js API route handlers (auth, admin, farmers, milk, ifishi, ukwezi, etc.)
│   ├── globals.css               # Authoritative 1,736-line Dairy Blue CSS stylesheet
│   ├── layout.tsx                # Root HTML shell (<html lang="rw">, Plus Jakarta Sans & JetBrains Mono fonts)
│   ├── page.tsx                  # Public landing route (/) rendering <Welcome />
│   ├── welcome.tsx               # Public bilingual marketing & pricing landing page component (325 lines)
│   └── workspace.tsx             # Monolithic 4,418-line Client Component powering auth screens + all 17 workspace tabs
├── components/                   # Shared UI, auth, layout, and bulk-import client components
│   ├── auth/                     # EmailVerificationPage client component
│   ├── imports/                  # FarmerBulkImportModal (1,128 lines), MilkNotebookImportModal (721 lines), import-ui
│   ├── layout/                   # Unused dashboard-shell.tsx scaffolding
│   ├── ui/                       # Modal, AnimatedCounter, ScrollReveal, TypingDisplay + 5 unused Tailwind primitives
│   └── brand-lockup.tsx          # Official Ihuriro ry'Amata logo + title lockup
├── docs/                         # Project operational docs + this 15-part system-audit suite
├── hooks/                        # usePublicLanguage hook (rw/en state + window.localStorage sync)
├── lib/                          # Backend services, repositories, security, imports, i18n, and domain utilities
│   ├── config/                   # site.ts (canonical URL, metadata, SUPER_ADMIN_EMAIL)
│   ├── i18n/                     # public-copy.ts (1,876 lines), import-copy.ts (433 lines), date-format.js
│   ├── imports/                  # Semantic column mapping, farmer field config, fuzzy matching, OCR/CSV/PDF/XLSX parsers
│   ├── repositories/             # 17 PostgreSQL data-access repositories using lib/postgres.js
│   ├── security/                 # Session HMAC signing/verification, authenticate.js, subscription-access.js
│   ├── services/                 # 28 business-logic, accounting, PDF, email, OCR, and payment services
│   ├── utils/                    # accounting-period.js (Africa/Kigali),farmer-settlement-access.js, notification-taxonomy.js
│   ├── validation/               # auth.ts input validation
│   ├── db.ts                     # Health-check helper for DATABASE_URL presence
│   ├── farmer-delivery.js        # Permanent farmer number formatting (#001) & delivery reconciliation math
│   ├── milk-reconciliation.js    # Collector Owner Ifishi vs Farmer milk difference math
│   ├── postgres.js               # Authoritative pg.Pool singleton with Supabase Root CA TLS verification
│   ├── supabase-root-ca-2021.js  # PEM certificate for Supabase PostgreSQL TLS
│   ├── supabase.ts               # Health-check helper for NEXT_PUBLIC_SUPABASE_URL (getSupabaseClient is unused)
│   └── workspace-navigation.js   # Role-based tab allowlists and URL ?tab= resolution
├── pages/                        # Legacy Pages Router _document.js (conflicts with app/layout.tsx lang attribute)
├── public/                       # Static assets (logo.png, cow-illustration.svg, sw.js, manifest.webmanifest)
├── scripts/                      # CLI utilities (db-check.js, query-users.js, verify-login-user.js)
├── server/                       # Unused TypeScript re-export wrappers (domain/auth.ts, repositories/user-repository.ts, services/auth-service.ts)
├── supabase/
│   └── migrations/               # 22 ordered SQL migrations (001_initial_schema.sql .. 022_farmer_field_configuration.sql) + README.md
├── tests/                        # 50 Node test files (tests/*.test.js, tests/unit/*.test.js) + 2 Playwright E2E specs (tests/e2e/*.spec.ts)
├── types/                        # TypeScript interfaces for auth/user entities (types/auth.ts)
├── utils/supabase/               # Unused @supabase/ssr client/server/middleware scaffolding
├── middleware.ts                 # Active Next.js Edge middleware enforcing milk_session HMAC & route protection
├── next.config.mjs               # Next.js config (typedRoutes: false, security headers, /sw.js headers)
├── package.json                  # Package manifest and scripts (dev, build, start, test, test:e2e)
├── playwright.config.ts          # Playwright E2E configuration (Chromium, port 3100)
├── tsconfig.json                 # TypeScript compiler configuration
└── vercel.json                   # Vercel cron schedule for /api/cron/subscription-emails (0 6 * * *)
```

---

## 2. Core Module Traceability Matrix

The table below traces the primary architectural modules following the required format:  
**File → Responsibility → Dependencies → Callers → Data Affected → Tests → Known Risks**

| File | Responsibility | Dependencies | Callers | Data Affected | Tests | Known Risks |
|---|---|---|---|---|---|---|
| [`middleware.ts`](file:///d:/ihuriroryamata.com/middleware.ts) | Edge request gatekeeper: verifies `milk_session` HMAC-SHA256 cookie via Web Crypto, redirects unauthenticated page visits to `/login?next=...`, blocks unauthenticated `/api/*` with `401`, and restricts `/admin/*` & `/api/admin/*` to `super_admin`. | Web Crypto API (`crypto.subtle`), `process.env.SESSION_SECRET` | Next.js Edge runtime on all requests matching `/(.*)` | Cookie `milk_session` (read-only) | `tests/auth-security.test.js`, `tests/job-runs.test.js` | **F-010**: `pathname.includes('.')` (`L58`) bypasses middleware auth for any URL path containing a dot. Does not query DB for account suspension or subscription expiry. |
| [`app/workspace.tsx`](file:///d:/ihuriroryamata.com/app/workspace.tsx) | Monolithic 4,418-line Client Component rendering `/login`, `/register`, `/forgot-password`, and all 17 authenticated workspace views (`dashboard`, `farmers`, `centers`, `milk`, `deductions`, `settlements`, `ukwezi`, `reports`, `billing`, `notifications`, `settings`, and 5 `super_admin` tabs), plus offline `localStorage` milk queue (`milk_offline_queue_v1`). | `hooks/use-public-language.ts`, `lib/workspace-navigation.js`, `lib/farmer-delivery.js`, `lib/milk-reconciliation.js`, `components/imports/*`, `components/ui/*` | `app/(auth)/login/page.tsx`, `register/page.tsx`, `forgot-password/page.tsx`, `app/(dashboard)/dashboard/page.tsx` | Browser `localStorage` (`milk_public_language`, `milk_offline_queue_v1`, `milk_active_center_*`) and `/api/**` endpoints | `tests/auth-ui.test.js`, `tests/reports-ui.test.js`, `tests/workspace-hierarchy.test.js`, `tests/workspace-navigation.test.js`, `tests/e2e/*.spec.ts` | **F-028**: 4,418-line single file combining ~150 state/ref hooks, auth UI, customer UI, and admin UI; ~20 hardcoded English strings; raw `JSON.stringify` rendered in Admin System Health (`L4210, L4227`). |
| [`lib/postgres.js`](file:///d:/ihuriroryamata.com/lib/postgres.js) | Singleton `pg.Pool` (`max: 10`) configured with `process.env.DATABASE_URL` and pinned Supabase Root 2021 CA (`rejectUnauthorized: true`). | `pg`, `lib/supabase-root-ca-2021.js` | All 17 files in `lib/repositories/*.js`, `app/api/health/route.ts`, `app/api/farmer-settlements/route.js`, `lib/services/platform-health-service.js` | All 33 PostgreSQL tables | `tests/migration-smoke.test.js`, `tests/notifications-db.integration.test.js` | Throws `DATABASE_NOT_CONFIGURED` if `DATABASE_URL` is unset. Single pool shared across Node API routes. |
| [`lib/security/authenticate.js`](file:///d:/ihuriroryamata.com/lib/security/authenticate.js) | Server-side request authenticator: verifies `milk_session` cookie, loads user from `userRepository`, normalizes `super_admin` role, blocks `suspended` accounts, enforces account-type guards (`requireAccountType`, `requireRole`), and enforces `requireActiveSubscription` unless route is recovery-whitelisted. | `lib/security/session.js`, `lib/repositories/userRepository.js`, `lib/security/subscription-access.js` | Almost all authenticated `/api/**` route handlers and Server Component auth pages | Reads `users`, `user_subscriptions` | `tests/auth-security.test.js`, `tests/subscription-access.test.js` | **F-012**: If `user_subscriptions` has no row for a user (`null`), `requireActiveSubscription` passes. **F-025**: `/api/auth/change-password` is not recovery-whitelisted. |
| [`lib/repositories/domainRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/domainRepository.js) | Repository for `farmers`, `collection_centers`, `collection_center_prices`, `farmer_field_configurations`, and `import_batches` (batch farmer creation with per-row savepoints and sequential `farmer_number` allocation). | `lib/postgres.js`, `lib/farmer-delivery.js` | `lib/services/farmer-service.js`, `lib/services/collection-center-service.js`, `app/api/farmers/count/route.ts`, `app/api/farmers/field-config/route.js` | `farmers`, `collection_centers`, `collection_center_prices`, `import_batches`, `farmer_field_configurations`, `audit_logs` | `tests/farmers-centers.test.js`, `tests/farmer-delivery-traceability.test.js`, `tests/import-services.test.js` | **F-017**: `deleteFarmer` (`L616-628`) omits checking `farmer_settlement_records` & `farmer_debt_ledgers` (`ON DELETE CASCADE`). **F-026**: `createFarmersBatch` (`L450-518`) runs N+1 queries per row. |
| [`lib/repositories/milkRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/milkRepository.js) | Repository for daily farmer milk deliveries (`milk_records` where `is_owner_milk = FALSE`), `collection_sessions`, daily collection rosters, delivery history, `Ifishi y'Abacunda`, and individual record voiding. | `lib/postgres.js`, `lib/farmer-delivery.js`, `lib/utils/accounting-period.js` | `lib/services/milk-service.js` | `milk_records`, `collection_sessions`, `audit_logs` | `tests/milk-collection.test.js`, `tests/farmer-delivery-traceability.test.js`, `tests/abacunda-ifishi.test.js` | **F-023**: `upsertMilkRecord` (conflict branch `L230-238`) and `updateMilkRecord` (`L288-298`) do not update `transport_rate_per_liter`. `getDairyDailyCollection` (`L820`) hardcodes `transportRate: 0`. |
| [`lib/repositories/milkAdjustmentRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/milkAdjustmentRepository.js) | Transactional center/date/session milk loss adjustment engine (`partial_loss` and `cancelled`). | `lib/postgres.js` | `lib/services/milk-adjustment-service.js`, `lib/services/milk-loss-service.js` | `milk_collection_adjustments`, `milk_records`, `audit_logs` | `tests/milk-loss.test.js`, `tests/milk-collection.test.js` | **F-008**: Does not exclude `status = 'cancelled'` rows (`L23-33`), un-voiding individually cancelled farmer records when a center-wide partial loss is applied. **F-026**: Runs 2 UPDATEs per row in a loop (`L52-103`). |
| [`lib/repositories/collectorMilkRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/collectorMilkRepository.js) | Repository for Collector Owner Ifishi milk (`milk_records` where `is_owner_milk = TRUE` and `farmer_id IS NULL`) and `collector_milk_prices`. | `lib/postgres.js` | `lib/services/collector-milk-service.js`, `lib/services/owner-ifishi-service.js` | `milk_records` (`is_owner_milk=TRUE`), `collector_milk_prices`, `audit_logs` | `tests/collector-milk.test.js`, `tests/owner-ifishi.test.js` | **F-023**: `voidDaily` (`L237-248`) does not set `valid_amount = 0`. `farmerLoss` subquery (`L3-8`) misses losses on linked Dairy farmers. |
| [`lib/services/monthly-report-service.js`](file:///d:/ihuriroryamata.com/lib/services/monthly-report-service.js) | Core accounting engine for `Ukwezi` half-month and monthly reports: computes farmer gross/transport/deductions/net, collector balance sheet (`calculateCollectorBalanceSheet`), and period settlement reconciliation (`buildPeriodSettlementReconciliation`). | `lib/repositories/reportRepository.js`, `lib/repositories/farmerSettlementRepository.js`, `lib/repositories/auditRepository.js`, `lib/utils/accounting-period.js`, `lib/milk-reconciliation.js` | `app/api/reports/summary/route.js`, `app/api/ukwezi/pdf/route.js`, `app/api/ifishi/pdf/route.js` | Reads `milk_records`, `farmers`, `deductions`, `farmer_settlement_records`, `farmer_debt_ledgers`; writes `audit_logs` | `tests/monthly-report.test.js`, `tests/reports-page.test.js`, `tests/ukwezi-pdf.test.js` | **F-014**: `buildDairyCollectorSettlementRows` (`L242-260`) is defined but never called in `getSummary` (`L339-353`). **F-016**: Negative farmer `netAmount` causes false `unexplainedDiscrepancy` (`L488-552`). |
| [`lib/services/subscription-service.js`](file:///d:/ihuriroryamata.com/lib/services/subscription-service.js) | Manages customer subscriptions, 15-day initial access window, collector tier usage evaluation, LMBTech MTN MoMo payment initiation, callback reconciliation, and reminder/expiration email jobs. | `lib/repositories/subscriptionRepository.js`, `lib/repositories/platformConfigRepository.js`, `lib/services/payment-provider.js`, `lib/services/email-service.js`, `lib/services/notification-service.js` | `app/api/subscription/**`, `app/api/admin/payments/**`, `app/api/cron/subscription-emails/route.js` | `user_subscriptions`, `subscription_payments`, `subscription_email_events`, `notifications`, `audit_logs` | `tests/subscriptions-payments.test.js`, `tests/subscription-access.test.js`, `tests/subscription-time.test.js` | **F-007**: `subscriptionRepository.buildFarmerMilkUsageQuery` (`L412-430`) returns `0` for standalone Collectors. **F-021**: Billing-exempt users are not excluded in `scheduleSubscriptionEmailEvents`. **F-022**: Failed callbacks without `transactionId` throw `409`. |
| [`components/imports/farmer-bulk-import.tsx`](file:///d:/ihuriroryamata.com/components/imports/farmer-bulk-import.tsx) | 4-step interactive Farmer Bulk Import wizard (Source -> Column Mapping -> Field Config -> Row Review & Chunked Save). | `lib/imports/semantic-mapping.js`, `lib/imports/text-parsing.js`, `lib/imports/farmer-field-config.js`, `lib/imports/farmer-matching.js`, `lib/imports/client-files.ts`, `lib/i18n/import-copy.ts` | `app/workspace.tsx` (`renderFarmers`) | Calls `/api/imports/extract`, `/api/imports/ocr`, `/api/farmers/field-config`, `/api/farmers/import` | Only static regex checks in `tests/import-Hardening.test.js` | **F-005**: `detectHeader` rejects Kinyarwanda headers before `interpretColumns`. **F-006**: `saveAttempted` locks failed rows from editing/retrying. **F-018**: `detectColumnMisalignment` runs when `rows = []`. **F-019**: Uninterpolated `{count}` in `t('excludedCount')`. |
| [`components/imports/milk-notebook-import.tsx`](file:///d:/ihuriroryamata.com/components/imports/milk-notebook-import.tsx) | 4-step Handwritten Milk Notebook Scanner wizard (Photo & Session -> Review & Farmer Matching -> Confirm -> Summary). | `lib/imports/notebook.js`, `lib/imports/farmer-matching.js`, `lib/imports/client-files.ts`, `lib/i18n/import-copy.ts` | `app/workspace.tsx` (`renderMilk`) | Calls `/api/imports/ocr`, `/api/milk/import` | `tests/import-notebook.test.js`, `tests/import-Hardening.test.js` | **F-019**: Kinyarwanda copy labels Morning as `"Ijoro"` ("Night"). **F-027**: Uses browser local date instead of `Africa/Kigali` and lacks `import_batches` idempotency. |

---

## 3. Entry Points Inventory

1. **Web Application Entry Points**:
   - `app/layout.tsx`: Root App Router layout loading Google Fonts (`Plus Jakarta Sans`, `JetBrains Mono`) and `app/globals.css`.
   - `app/page.tsx` → `app/welcome.tsx`: Public landing page (`/`).
   - `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`, `app/(auth)/forgot-password/page.tsx` → `app/workspace.tsx`: Authentication entry points.
   - `app/(auth)/verify-email/page.tsx`, `app/(auth)/verify-email-change/page.tsx` → `components/auth/email-verification.tsx`: Email token consumption pages.
   - `app/(dashboard)/dashboard/page.tsx` → `app/workspace.tsx`: Main authenticated application shell (`/dashboard?tab=...`).
   - `public/sw.js` & `public/manifest.webmanifest`: PWA Service Worker and web manifest.
2. **Backend API & Scheduled Entry Points**:
   - `middleware.ts`: Edge request interceptor.
   - `app/api/**/route.{js,ts}`: 78 HTTP route handlers (see `04-api-and-backend.md`).
   - `app/api/cron/subscription-emails/route.js`: Scheduled daily at `06:00 UTC` via `vercel.json`.
   - `app/api/cron/notifications/route.js`: Cron endpoint for operational alert evaluation (**not** listed in `vercel.json` and currently crashes due to **F-004**).
3. **CLI & Test Entry Points**:
   - `npm test` (`node --test`): Runs 50 test files in `tests/*.test.js` and `tests/unit/*.test.js`.
   - `npm run test:e2e` (`playwright test`): Runs 2 Playwright specs in `tests/e2e/*.spec.ts`.
   - `scripts/db-check.js`, `scripts/query-users.js`, `scripts/verify-login-user.js`: Manual developer CLI scripts.

---

## 4. Unused, Dead, Duplicate, and Orphaned Files Register

Every file listed below was verified by searching for imports/references across the entire repository (`app/`, `components/`, `lib/`, `hooks/`, `pages/`, `scripts/`, `tests/`):

### 4.1 Tracked Backup, Snapshot, and Scratch Files (Should Be Removed)
| File / Directory | Lines / Size | Evidence of Obsolescence |
|---|---|---|
| [`workspace.txt`](file:///d:/ihuriroryamata.com/workspace.txt) | 1,929 lines | Old plaintext snapshot of an earlier version of `app/workspace.tsx`. Zero references in code or tests. |
| [`middleware.ts.BEFORE-AUTH-MOCK-FIX-2026-10-07`](file:///d:/ihuriroryamata.com/middleware.ts.BEFORE-AUTH-MOCK-FIX-2026-10-07) | 12 lines | Backup of old Supabase SSR middleware (`utils/supabase/middleware.ts`). Replaced by HMAC-based `middleware.ts`. |
| [`app/api/admin/accounts/summary/route.js.bak`](file:///d:/ihuriroryamata.com/app/api/admin/accounts/summary/route.js.bak) | 28 lines | Byte-for-byte duplicate backup of `app/api/admin/accounts/summary/route.js`. |
| [`lib/services/platform-admin-service.js.bak`](file:///d:/ihuriroryamata.com/lib/services/platform-admin-service.js.bak) | 184 lines | Backup of an older version of `lib/services/platform-admin-service.js`. |
| [`debug-farmers.js`](file:///d:/ihuriroryamata.com/debug-farmers.js) | 18 lines | One-off scratch script in root directory that reads `.env.local` and runs `SELECT id, name, email, role, account_type FROM users` and `SELECT id, name, owner_user_id, collector_user_id, collection_center FROM farmers` (**prints user/farmer PII to stdout if run**). |
| `.next-build-verify/` & `.next-ui-verify/` | Build dirs | Leftover Next.js build verification directories in repository root (unignored in `.gitignore`). |

### 4.2 Unused Scaffolding & Duplicate Architectural Layers
| File(s) | Purpose | Verification Evidence |
|---|---|---|
| [`utils/supabase/client.ts`](file:///d:/ihuriroryamata.com/utils/supabase/client.ts), [`utils/supabase/server.ts`](file:///d:/ihuriroryamata.com/utils/supabase/server.ts), [`utils/supabase/middleware.ts`](file:///d:/ihuriroryamata.com/utils/supabase/middleware.ts) | `@supabase/ssr` client helpers | **Zero active imports** anywhere in the repository (`middleware.ts.BEFORE-AUTH-MOCK-FIX-2026-10-07` was the only caller). The app uses custom HMAC cookies (`lib/security/session.js`) and `pg` (`lib/postgres.js`). |
| [`lib/supabase.ts`](file:///d:/ihuriroryamata.com/lib/supabase.ts) (`getSupabaseClient`, `L8-20`) | `@supabase/supabase-js` client factory | `getSupabaseStatus()` (`L22-27`) is called by `app/api/health/route.ts:49`, but `getSupabaseClient()` (`L8-20`) has **zero callers**. |
| [`server/domain/auth.ts`](file:///d:/ihuriroryamata.com/server/domain/auth.ts), [`server/repositories/user-repository.ts`](file:///d:/ihuriroryamata.com/server/repositories/user-repository.ts), [`server/services/auth-service.ts`](file:///d:/ihuriroryamata.com/server/services/auth-service.ts) | TypeScript re-export layer over `lib/services/auth-service.js` and `lib/repositories/userRepository.js` | **Zero runtime imports** in `app/`, `components/`, or `lib/`. Checked only for file existence by `tests/architecture-foundation.test.js:15-19`. |
| [`components/layout/dashboard-shell.tsx`](file:///d:/ihuriroryamata.com/components/layout/dashboard-shell.tsx), [`components/ui/badge.tsx`](file:///d:/ihuriroryamata.com/components/ui/badge.tsx), [`components/ui/button.tsx`](file:///d:/ihuriroryamata.com/components/ui/button.tsx), [`components/ui/card.tsx`](file:///d:/ihuriroryamata.com/components/ui/card.tsx), [`components/ui/input.tsx`](file:///d:/ihuriroryamata.com/components/ui/input.tsx), [`components/ui/skeleton.tsx`](file:///d:/ihuriroryamata.com/components/ui/skeleton.tsx) | Generic UI primitives styled with Tailwind CSS utility classes (`bg-[#1681ab]`, `rounded-md`, etc.) | **Zero runtime imports** in `app/` or `components/imports/`. Checked only for file existence in `tests/architecture-foundation.test.js:20-26`. Moreover, **Tailwind CSS is not installed** in `package.json`, so their classes would not render styles if imported. |
| [`pages/_document.js`](file:///d:/ihuriroryamata.com/pages/_document.js) | Legacy Next.js Pages Router document | Unused by App Router routes (`app/`), sets `<Html lang="en">` (conflicting with `app/layout.tsx` `<html lang="rw">`) and uses uncompiled Tailwind classes `bg-gray-50 text-gray-900 antialiased`. |

---

## 5. Oversized Files & Mixed-Responsibility Hotspots

1. **[`app/workspace.tsx`](file:///d:/ihuriroryamata.com/app/workspace.tsx) (4,418 lines)**:
   - Mixes public authentication forms (`/login`, `/register`, `/forgot-password`), offline IndexedDB/`localStorage` queue synchronization, global search, notification polling, and 17 distinct role-based screens inside a single React component function with ~150 `useState` and `useRef` hooks.
2. **[`lib/i18n/public-copy.ts`](file:///d:/ihuriroryamata.com/lib/i18n/public-copy.ts) (1,876 lines)** & **[`app/globals.css`](file:///d:/ihuriroryamata.com/app/globals.css) (1,736 lines)**:
   - Well-structured, but each holds all application copy or styles in a single monolithic file.
3. **[`components/imports/farmer-bulk-import.tsx`](file:///d:/ihuriroryamata.com/components/imports/farmer-bulk-import.tsx) (1,128 lines)**:
   - Combines file/paste/photo ingestion, semantic header resolution, field config toggling, duplicate reconciliation, row editing, and chunked API saving in one client component.
4. **[`lib/repositories/milkRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/milkRepository.js) (983 lines)** & **[`lib/repositories/domainRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/domainRepository.js) (846 lines)**:
   - Combine multi-role scope resolution (`COLLECTOR` vs `COLLECTION_CENTER`), cursor encoding/decoding, SQL query construction, and transactional audit logging.
5. **[`app/api/farmer-settlements/route.js`](file:///d:/ihuriroryamata.com/app/api/farmer-settlements/route.js) (187 lines)**:
   - Mixes HTTP route handling, business rule checks (SACCO eligibility and payable ceiling calculation), and raw SQL queries (`SELECT COALESCE(SUM(amount), 0) FROM farmer_settlement_records ...` at lines 126–132) directly inside the route handler instead of delegating to `farmer-settlement-service.js` and `farmerSettlementRepository.js`.
