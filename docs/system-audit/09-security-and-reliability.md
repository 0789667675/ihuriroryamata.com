# 09 — Application Security, Data Privacy, and Reliability Review

## 1. Authentication, Session Management, and Cryptography

| Security Control | Implementation & Evidence | Assessment & Risks |
|---|---|---|
| **Password Hashing** | `bcryptjs` (`^2.4.3`) with salt rounds `10` (`lib/services/auth-service.js:61`, `lib/services/account-service.js:249`, `lib/services/password-reset-service.js:186`). | **SECURE**: Standard bcrypt cost factor; constant-time comparison via `bcrypt.compare`. |
| **Session Token & Cookie (`milk_session`)** | [`lib/security/session.js:1-60`](file:///d:/ihuriroryamata.com/lib/security/session.js): Stateless HMAC-SHA256 signed payload `{ id, role, exp }` (7-day TTL) stored in `httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', path: '/'` cookie. Signature compared via `crypto.timingSafeEqual`. Fails closed (`503 SESSION_SECRET_NOT_CONFIGURED`) if `SESSION_SECRET` is missing or `< 32` chars. | **GOOD WITH CAVEAT**: Stateless token cannot be revoked server-side on logout (`POST /api/auth/logout` only clears the browser cookie), though suspended accounts (`account_status === 'suspended'`) are rejected on every Node API request by `getAuthenticatedUser`. |
| **Password Reset OTP & Cookie (`milk_password_reset`)** | [`lib/services/password-reset-service.js`](file:///d:/ihuriroryamata.com/lib/services/password-reset-service.js) & [`lib/repositories/passwordResetRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/passwordResetRepository.js): 6-digit OTP generated with `crypto.randomInt(0, 1000000)`, hashed with HMAC-SHA256 (`SESSION_SECRET`), 15-minute expiry, max 5 failed attempts (`attempt_count`), exchanged once for a 10-minute `milk_password_reset` cookie (`sameSite: 'strict', path: '/api/auth/password-reset'`). | **SECURE**: Anti-enumeration generic responses, DB-backed rate limits (`auth_rate_limits`), row locking (`FOR UPDATE`), and timing-safe hash comparison. |
| **Email Verification & Email Change Tokens** | [`lib/services/account-service.js`](file:///d:/ihuriroryamata.com/lib/services/account-service.js): 32-byte `crypto.randomBytes(32).toString('hex')`, stored as SHA-256 hash (`token_hash`) in `email_verification_tokens` and `email_change_tokens`. | **SECURE**: Links place tokens in URL hash (`#token=...`) and `components/auth/email-verification.tsx:29-31` immediately scrubs the URL via `window.history.replaceState`. |
| **Cron Endpoint Authentication** | [`app/api/cron/subscription-emails/route.js:7-20`](file:///d:/ihuriroryamata.com/app/api/cron/subscription-emails/route.js#L7-L20) & [`app/api/cron/notifications/route.js:9-22`](file:///d:/ihuriroryamata.com/app/api/cron/notifications/route.js#L9-L22): Verifies `Authorization: Bearer <CRON_SECRET>` using `crypto.timingSafeEqual`. | **SECURE**: Fails closed if `CRON_SECRET` is unset. |

---

## 2. Authorization, Tenant Isolation, and Access-Control Audit

### 2.1 Application-Layer Tenant Isolation (`owner_user_id`)
- Because PostgreSQL Row-Level Security (RLS) is not enabled on any table (`supabase/migrations/README.md:19-22`), tenant isolation depends entirely on repository SQL queries binding `owner_user_id` from the authenticated session (`user.id` or resolved `dairy_user_id` for assigned Collectors).
- **Verified Strengths**:
  - All 17 repositories use parameterized SQL (`$1, $2, ...`) with zero string-interpolated user values.
  - Cross-owner access attempts are systematically rejected across `milkRepository`, `domainRepository`, `deductionRepository`, `farmerSettlementRepository`, `reportRepository`, `notificationRepository`, and `auditRepository`.
- **Confirmed Authorization & Scope Vulnerabilities**:
  1. **Middleware Path Dot Bypass (`Finding F-010` — [`middleware.ts:58`](file:///d:/ihuriroryamata.com/middleware.ts#L58))**:
     - `if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/manifest') || pathname.includes('.')) return NextResponse.next();`
     - Any request URL containing a `.` bypasses Edge middleware authentication and `/admin` role checks. While most Node API routes call `getAuthenticatedUser(request)` as a second line of defense, Edge protection is bypassed.
  2. **Collector Assignment Privilege Escalation (`Finding F-011` — [`app/api/collector-assignments/route.js:33`](file:///d:/ihuriroryamata.com/app/api/collector-assignments/route.js#L33))**:
     - `POST /api/collector-assignments` checks `requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER'])` instead of `['COLLECTION_CENTER']`, and `collectorAssignmentRepository.assignCollector` (`L24-53`) does not verify that `dairyUserId` is a `COLLECTION_CENTER` account. A `COLLECTOR` account can call the API directly to assign other collectors to itself.
  3. **Null Subscription Row Bypass (`Finding F-012` — [`lib/security/subscription-access.js:13`](file:///d:/ihuriroryamata.com/lib/security/subscription-access.js#L13))**:
     - `if (subscription && ['suspended', 'expired'].includes(subscription.effective_status))` only blocks when a `user_subscriptions` row exists. If `subscription` is `null` (which happens if `subscription_policy_settings` lacks row `id = 1` when `createUserWithConnection` runs at `lib/repositories/userRepository.js:28-47`), the user bypasses subscription enforcement indefinitely.
  4. **Cross-Collector Count Probing (`Finding F-025` — [`app/api/farmers/count/route.ts:23-29`](file:///d:/ihuriroryamata.com/app/api/farmers/count/route.ts#L23-L29))**:
     - Does not force `collectorUserId = user.id` when `user.accountType === 'COLLECTOR'`, allowing a Collector to pass another collector's `collectorUserId` or receive `0` when `collectorUserId` is omitted.
  5. **`SUPER_ADMIN_EMAIL` Fallback Discrepancy (`Finding F-025`)**:
     - `lib/config/site.ts:3`, `lib/auth.ts:1`, and `lib/validation/auth.ts:15` fallback `process.env.SUPER_ADMIN_EMAIL` to `'snemeyimana@gmail.com'`, whereas `lib/security/authenticate.js:50` and `lib/services/auth-service.js:52` fallback to `''`.

---

## 3. Data Privacy, Audit Redaction, and Secret Hygiene

1. **Environment & Secret Protection**:
   - `.gitignore` excludes `.env*` (except `.env.example`).
   - Database TLS connection in `lib/postgres.js` enforces `rejectUnauthorized: true` against `lib/supabase-root-ca-2021.js`.
   - `app/api/health/route.ts` and `app/api/admin/config/payments/route.js` expose only boolean readiness flags without leaking database URLs, Supabase project URLs, or LMBTech API credentials.
2. **Audit Log Redaction (`lib/services/audit-service.js:4-25`)**:
   - Recursively redacts any object key matching `/password|token|secret|authorization|cookie|api[_-]?key|credential|private[_-]?key/i` to `'[REDACTED]'` before persisting or returning `audit_logs.details`.
3. **Import Source Document Privacy (`components/imports/*` & `019_import_batches.sql`)**:
   - Uploaded spreadsheets, PDFs, and camera photos are processed in memory and never stored in `localStorage`, `sessionStorage`, or PostgreSQL (`import_batches.summary` stores only row numbers, status codes, and created farmer IDs; verified by `tests/import-Hardening.test.js:172-173`).
4. **Identified Privacy & Error-Handling Risks**:
   - **Internal Error Message Leak (`Finding F-025` — [`app/api/farmers/[id]/route.js:11-14, 49`](file:///d:/ihuriroryamata.com/app/api/farmers/[id]/route.js#L11-L14))**: `PUT /api/farmers/[id]` calls `respondWithError(error, 'Failed to update farmer.', true)` where `includeServerMessage = true` exposes raw `error.message` on HTTP `500` errors.
   - **Root Scratch Script Prints PII (`Finding F-030` — [`debug-farmers.js`](file:///d:/ihuriroryamata.com/debug-farmers.js))**: Tracked root script queries `users` and `farmers` and logs names, emails, and IDs to stdout.

---

## 4. Concurrency, Rate Limiting, and Reliability Analysis

1. **PostgreSQL Advisory Locks & Row Locks**:
   - Used effectively in `assign_farmer_number()` (`021`), `domainRepository.allocateNextFarmerNumber`, `collectorMilkRepository.persistOwnerEntry`, `milkAdjustmentRepository.applyCollectionAdjustment`, `farmerSettlementRepository.createDebtLedgerEntry` / `repayDebt`, `subscriptionRepository.reservePayment` / `settlePayment`, and `jobRunRepository.withJobRun`.
   - **Concurrency Gap (`Finding F-015`)**: `POST /api/farmer-settlements` (`action === 'cash'`, `app/api/farmer-settlements/route.js:123-140`) checks `amount + existingPayments <= payable` outside a transaction and without locking the farmer row (`FOR UPDATE`), allowing concurrent requests with distinct `requestKey`s to over-approve cash payouts.
2. **Rate Limiting**:
   - **DB-Backed (`auth_rate_limits`)**: Used for password reset requests and email verification resend requests (`passwordResetRepository.consumeRateLimit`). Survives serverless cold starts and multi-instance scaling.
   - **In-Memory (`Map`)**: Used for `POST /api/imports/ocr` (`12` req/min/user in `app/api/imports/ocr/route.js:11-26`) and `POST /api/notifications/evaluate` (`60s` throttle per user in `app/api/notifications/evaluate/route.js:5-6`). In a multi-instance serverless deployment (e.g., Vercel), in-memory maps reset per instance.
3. **HTTP Security Headers ([`next.config.mjs:5-19`](file:///d:/ihuriroryamata.com/next.config.mjs#L5-L19))**:
   - Sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js`.
