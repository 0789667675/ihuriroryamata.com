# 10 — Automated Tests, Local Validation, and Verification Matrix

## 1. Local Static Checks & Test Execution Summary

During Phase Zero / Stage 4 of this audit, the following non-destructive static checks and automated test suites were executed locally in `D:\ihuriroryamata.com` on Node.js `v26.4.0`:

| Command Executed | Purpose | Exit Code | Result Summary | Duration |
|---|---|---|---|---|
| `npx tsc --noEmit` | TypeScript compiler static type check across `.ts` and `.tsx` files (`app/`, `components/`, `hooks/`, `lib/`, `types/`, `tests/e2e/`) | **`0` (PASS)** | **0 type errors** | ~4.1s |
| `npm test` (`node --test`) | Node.js built-in test runner across all 50 `.test.js` files (`tests/*.test.js` and `tests/unit/*.test.js`) | **`1` (1 FAIL)** | **555 total tests: 553 passed, 1 failed, 1 skipped** | `22,975.93 ms` (~23.0s) |
| `node scripts/db-check.js` | Database connectivity check script (without `--env-file`) | `1` | Failed with `DATABASE_NOT_CONFIGURED` because `scripts/db-check.js` does not load `.env.local` (`Finding F-031`) | ~0.2s |
| `node --env-file=.env.local scripts/db-check.js` | Database connectivity check script (with `.env.local` loaded) | `1` | Failed with `ENOTFOUND` inside the isolated terminal sandbox (outbound DNS to remote Supabase host is blocked by sandbox isolation) | ~0.4s |

---

## 2. Root-Cause Analysis of Failing & Skipped Tests

### 2.1 The Single Failing Test: `tests/job-runs.test.js:59` (`Finding F-009`)
- **Test Name**: `jobs still run before migration 020 is applied and failures are recorded when possible` ([`tests/job-runs.test.js:59-78`](file:///d:/ihuriroryamata.com/tests/job-runs.test.js#L59-L78))
- **Failure Output**:
  ```text
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(failure.calls.some(({ text, values }) => text.includes("status = 'failed'") && values[0] === 'JOB_FAILED' && values[1] === 31))
      at TestContext.<anonymous> (D:\ihuriroryamata.com\tests\job-runs.test.js:76:10)
  ```
- **Exact Root Cause**:
  In [`lib/repositories/jobRunRepository.js:50-55`](file:///d:/ihuriroryamata.com/lib/repositories/jobRunRepository.js#L50-L55), when a job throws an error after inserting `runId = 31`, `withJobRun` executes:
  ```js
  await client.query(
    `UPDATE platform_job_runs
        SET status = 'failed', finished_at = NOW(), error_code = $1, summary = $2::jsonb
      WHERE id = $3`,
    [safeErrorCode(error.code || error.name), JSON.stringify({ trigger }), runId]
  );
  ```
  Here:
  - `values[0]` is `'JOB_FAILED'` (`$1`)
  - `values[1]` is `'{"trigger":"manual"}'` (`$2::jsonb`)
  - `values[2]` is `31` (`$3`, `runId`)
  However, `tests/job-runs.test.js:76` still checks `values[1] === 31` instead of `values[2] === 31`.

### 2.2 Skipped Real-Database Integration Tests
1. **[`tests/notifications-db.integration.test.js:9`](file:///d:/ihuriroryamata.com/tests/notifications-db.integration.test.js#L9)**:
   - Marked `{ skip: !Boolean(process.env.DATABASE_URL) }`. When `npm test` runs (`node --test`), Node does not automatically load `.env.local`, so `process.env.DATABASE_URL` is unset and the test skips cleanly (`# SKIP`).
2. **[`tests/migration-smoke.test.js:77`](file:///d:/ihuriroryamata.com/tests/migration-smoke.test.js#L77)**:
   - Always runs its static migration file sequence and SQL structure assertions (which passed), and conditionally runs live PostgreSQL schema introspection when `process.env.DATABASE_URL` is provided.

---

## 3. Complete Test Suite Architecture (52 Test Files)

| Category | File Count | Files | Testing Mechanism |
|---|---|---|---|
| **Domain, Accounting & Reporting Unit Tests** | 12 | `accounting-period.test.js`, `milk-collection.test.js`, `milk-loss.test.js`, `milk-reconciliation.test.js`, `collector-milk.test.js`, `owner-ifishi.test.js`, `abacunda-ifishi.test.js`, `deductions.test.js`, `farmer-settlement.test.js`, `monthly-report.test.js`, `reports-page.test.js`, `ukwezi-pdf.test.js` | Pure math assertions + injected mock repositories and SQL parameter binding verification (`makePool` / `runQuery`). |
| **Authentication, Security & Access-Control Tests** | 8 | `auth-Registration.test.js`, `auth-security.test.js`, `auth-language.test.js`, `auth-ui.test.js`, `farmer-settlement-access.test.js`, `subscription-access.test.js`, `unit/account-settings.test.js`, `unit/password-reset-service.test.js` | Verifies HMAC sessions, `requireActiveSubscription`, role/account-type isolation, OTP hashing, rate limits, and middleware rules. |
| **Farmers, Centers, Assignments & Search Tests** | 6 | `farmers-centers.test.js`, `farmer-list-query.test.js`, `farmer-delivery-traceability.test.js`, `collector-assignments.test.js`, `global-search.test.js`, `ifishi-search.test.js` | Verifies permanent `#001` numbering, delivery history reconciliation, center scoping, and cursor pagination. |
| **Bulk Import & Semantic Mapping Tests** | 6 | `import-semantic-mapping.test.js`, `import-text-parsing.test.js`, `import-farmer-matching.test.js`, `import-notebook.test.js`, `import-services.test.js`, `import-Hardening.test.js` | Tests `interpretColumns`, `detectColumnMisalignment`, `parseTextRows`, `parseNotebookPage`, `matchFarmer`, `extractSpreadsheet`/`extractPdf`, and OCR validation in isolation. |
| **Subscriptions, LMBTech Payments & Email Tests** | 5 | `subscriptions-payments.test.js`, `subscription-time.test.js`, `payment-notifications.test.js`, `email-service.test.js`, `cron-routes.test.js` | Tests 15-day Kigali deadline math, LMBTech MoMo initiation & callback verification, Resend email rendering, and outbox leasing. |
| **Platform Admin, Config, Health & Job Tests** | 5 | `platform-admin.test.js`, `platform-config.test.js`, `platform-health.test.js`, `job-runs.test.js`, `audit-logs.test.js` | Tests Super Admin account actions, exemptions, contiguous tier config, health probes, and audit log redaction. |
| **Notifications & Operational Alerts Tests** | 3 | `notifications.test.js`, `operational-alerts.test.js`, `notifications-db.integration.test.js` | Tests missed-delivery/drop/spike alert rules, deduplication, resolution state transitions, and locale copy parity. |
| **Migrations, Architecture & UI Static Contract Tests** | 5 | `migration-grants.test.js`, `migration-smoke.test.js`, `architecture-foundation.test.js`, `public-seo.test.js`, `reports-ui.test.js`, `workspace-hierarchy.test.js`, `workspace-navigation.test.js`, `farmer-settlement-route.test.js`, `farmer-settlement-integration.test.js` | SQL grant hygiene, SEO metadata, and static regex checks against `app/workspace.tsx` and API routes. |
| **Playwright End-to-End Browser Specs** | 2 | `tests/e2e/farmer-delivery-traceability.spec.ts`, `tests/e2e/workspace-modal.spec.ts` | Headless Chromium tests with mocked `/api/**` routes verifying Daily Milk delivery filters, history modal, and modal focus/scroll/Escape behavior. |

---

## 4. Why Existing Tests Missed Critical Bugs (`F-001`–`F-008`)

1. **Service-Layer Tests Bypassed Route Handler Imports (`F-001`, `F-002`, `F-003`)**:
   - `tests/milk-collection.test.js`, `tests/deductions.test.js`, and `tests/collector-assignments.test.js` call `MilkService`, `DeductionService`, and `CollectorAssignmentService` directly rather than invoking the `PUT`/`DELETE` HTTP handlers in `app/api/milk/[id]/route.js`, `app/api/deductions/[id]/route.js`, and `app/api/collector-assignments/[collectorUserId]/route.js`. Thus the missing `requireActiveSubscription` and `requireAccountType` imports in those route files were never executed during `npm test`.
2. **Regex Source Check Passed on Broken Property Chain (`F-004`)**:
   - `tests/cron-routes.test.js` and `tests/job-runs.test.js:80-93` only check `app/api/cron/notifications/route.js` with static regexes (`/withJobRun/`, `/CRON_SECRET/`) without executing the route handler, missing `UserRepository.repository.getActiveUsers()` (`TypeError`).
3. **Import Unit Tests Tested `detectHeader` and `interpretColumns` Separately (`F-005`, `F-006`, `F-018`)**:
   - `tests/import-semantic-mapping.test.js` passes Kinyarwanda headers (`['NO', "AMAZINA YOMBI Y'UMWOROZI", ...]`) directly into `interpretColumns(headings)`, never testing `FarmerBulkImportModal.prepareTable` where `detectHeader(clean)` runs first and replaces those exact headers with `["Column 1", ..., "Column 5"]`!
   - Similarly, no component or E2E test renders `FarmerBulkImportModal` or clicks `"Confirm and save"`, missing that `saveAttempted` locks out failed-row editing and that `detectColumnMisalignment` is called when `rows = []`.
4. **Locale Copy Tests Only Inspected `public-copy.ts`, Not `import-copy.ts` (`F-019`)**:
   - `tests/operational-alerts.test.js` and `tests/payment-notifications.test.js` validate `lib/i18n/public-copy.ts`, but no test checks `lib/i18n/import-copy.ts`.
