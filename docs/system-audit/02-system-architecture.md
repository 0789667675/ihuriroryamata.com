# 02 — System Architecture & End-to-End Traceability

## 1. High-Level System Architecture

**IHURIRO RY'AMATA (Milk System)** is a full-stack monolithic Next.js 14 application deployed on Node.js (with Vercel Cron integration) and backed by a Supabase-hosted PostgreSQL database accessed directly via `pg.Pool` (`lib/postgres.js`).

```mermaid
flowchart TB
  subgraph Client["Browser Client (Desktop & Mobile PWA)"]
    Welcome["Public Landing Page<br/>(app/welcome.tsx)"]
    Verify["Email Verification Pages<br/>(components/auth/email-verification.tsx)"]
    Workspace["Workspace SPA Shell<br/>(app/workspace.tsx - 4,418 lines)"]
    ImportModals["Bulk Import Modals<br/>(farmer-bulk-import.tsx / milk-notebook-import.tsx)"]
    OfflineQueue["Offline Milk Queue<br/>(localStorage: milk_offline_queue_v1)"]
    SW["Service Worker<br/>(public/sw.js)"]
  end

  subgraph Edge["Next.js Edge Runtime"]
    MW["Edge Middleware<br/>(middleware.ts)<br/>HMAC-SHA256 milk_session check"]
  end

  subgraph Server["Next.js Node.js Server Runtime"]
    RSC["Server Component Route Shells<br/>(app/page.tsx, app/(auth)/*, app/(dashboard)/*)"]
    API["78 REST API Route Handlers<br/>(app/api/**/route.js|ts)"]
    AuthGuard["Security & Subscription Guard<br/>(lib/security/authenticate.js & subscription-access.js)"]
    Services["28 Domain & Accounting Services<br/>(lib/services/*.js)"]
    ImportEngine["Server Extraction & Semantic Mapping<br/>(lib/imports/*.js - xlsx, pdfjs-dist)"]
    Repos["17 PostgreSQL Repositories<br/>(lib/repositories/*.js)"]
    PgPool["PostgreSQL Connection Pool<br/>(lib/postgres.js + Supabase Root CA)"]
  end

  subgraph External["External Services & Infrastructure"]
    SupabaseDB[("Supabase PostgreSQL<br/>(33 Tables, Migrations 001-022)")]
    Resend["Resend / SMTP Email Provider<br/>(lib/services/email-service.js)"]
    LMBTech["LMBTech MTN MoMo Gateway<br/>(lib/services/payment-provider.js)"]
    Vision["Google Cloud Vision OCR API<br/>(lib/services/ocr-service.js)"]
    VercelCron["Vercel Cron Scheduler<br/>(vercel.json -> /api/cron/*)"]
  end

  Welcome -->|GET /api/subscription/plans| MW
  Verify -->|POST /api/auth/email-verification/verify| MW
  Workspace -->|Fetch JSON + Cookie milk_session| MW
  ImportModals -->|POST /api/imports/*, /api/farmers/import| MW
  OfflineQueue -->|Auto-sync on online event| Workspace

  MW -->|Page Request| RSC
  MW -->|API Request| API
  VercelCron -->|Bearer CRON_SECRET| API

  RSC -->|getAuthenticatedUserFromCookieStore| AuthGuard
  API --> AuthGuard
  API --> ImportEngine
  AuthGuard --> Services
  Services --> Repos
  Repos --> PgPool
  PgPool -->|TLS 1.2+ Verified CA| SupabaseDB

  Services -->|Transactional & Reminder Emails| Resend
  Services -->|MoMo Collection & Status Lookup| LMBTech
  LMBTech -->|POST /api/subscription/payments/callback| API
  Services -->|DOCUMENT_TEXT_DETECTION| Vision
```

---

## 2. Frontend-to-Backend Request Flow

The sequence diagram below traces a representative operational workflow—recording a daily farmer milk delivery (`POST /api/milk`)—from user interaction in `app/workspace.tsx` to PostgreSQL transaction commit, operational alert auto-resolution, and UI update.

```mermaid
sequenceDiagram
  autonumber
  actor Collector as Collector (Umucunda)
  participant UI as app/workspace.tsx (Client)
  participant MW as middleware.ts (Edge)
  participant Route as app/api/milk/route.js
  participant Auth as lib/security/authenticate.js
  participant Svc as lib/services/milk-service.js
  participant Repo as lib/repositories/milkRepository.js
  participant AlertSvc as lib/services/notification-service.js
  participant DB as Supabase PostgreSQL

  Collector->>UI: Enter Morning/Evening Liters & click Save (saveDailyMilkRow)
  alt Browser is Offline
    UI->>UI: Enqueue payload in localStorage (milk_offline_queue_v1)
    UI-->>Collector: Show queued badge ("Offline · N queued")
  else Browser is Online
    UI->>MW: POST /api/milk (Cookie: milk_session)
    MW->>MW: Verify HMAC-SHA256 signature & expiration
    MW->>Route: Forward authenticated request
    Route->>Auth: getAuthenticatedUser(request)
    Auth->>DB: SELECT user by session.id (userRepository.findById)
    Auth->>Auth: Verify account_status != 'suspended' & requireActiveSubscription(user)
    Auth-->>Route: Normalized user { id, role: 'user', accountType: 'COLLECTOR' }
    Route->>Auth: requireAccountType(user, ['COLLECTOR'])
    Route->>Svc: recordMilk({ farmerId, date, volumeMorning, volumeEvening }, { ownerUserId: user.id, actorId: user.id })
    Svc->>Svc: Validate date (YYYY-MM-DD) & positive volumeMorning + volumeEvening
    Svc->>Repo: upsertMilkRecord(payload, context)
    Repo->>DB: BEGIN TRANSACTION
    Repo->>DB: Resolve farmer scope (direct owner OR active collector_assignments)
    Repo->>DB: Resolve effective price (collection_center_prices <= date OR center default)
    Repo->>DB: Upsert collection_sessions row
    Repo->>DB: INSERT INTO milk_records (... price_per_liter, transport_rate_per_liter ...) ON CONFLICT DO NOTHING
    alt Conflict on (farmer_id, month, year, day)
      Repo->>DB: SELECT existing row FOR UPDATE
      Repo->>Repo: Reject if status IN ('adjusted','cancelled') (409) or identical values (409 DUPLICATE)
      Repo->>DB: UPDATE milk_records SET volume_morning, volume_evening, amount...
    end
    Repo->>DB: INSERT INTO audit_logs (entity_type='milk_record', action='created'|'updated')
    Repo->>DB: COMMIT TRANSACTION
    Repo-->>Svc: Persisted milk record + { created: true|false }
    Svc->>AlertSvc: Non-blocking reconcileAfterMilkEntry (auto-resolve open missed-delivery alerts)
    AlertSvc->>DB: UPDATE notifications SET status='resolved', resolution_code='delivery_recorded'
    Svc-->>Route: Return saved record
    Route-->>UI: HTTP 201 (created) or 200 (updated) JSON
    UI->>UI: Update dailyMilk state & refresh dashboard metrics
    UI-->>Collector: Display saved state & updated liters total
  end
```

---

## 3. Authentication, Session, and Authorization Flow

Authentication is 100% custom and PostgreSQL-backed (`users` table + `bcryptjs` password hashes + HMAC-SHA256 `milk_session` cookies). Despite `@supabase/ssr` being present in `package.json`, Supabase Auth is **not** used.

```mermaid
flowchart TD
  Req["Incoming HTTP Request"] --> CheckStatic{"Static / _next /<br/>manifest / includes('.')?<br/>(Finding F-010)"}
  CheckStatic -->|Yes| PassStatic["NextResponse.next()"]
  CheckStatic -->|No| CheckCookie["Verify milk_session Cookie<br/>(HMAC-SHA256 via SESSION_SECRET)"]

  CheckCookie --> IsPublic{"Public Page or Public API?<br/>(/, /login, /register, /forgot-password,<br/>/verify-email*, /api/auth/*, /api/health,<br/>/api/cron/*, /api/subscription/plans,<br/>/api/subscription/payments/callback)"}

  IsPublic -->|Yes| CheckAuthPage{"Has valid session AND<br/>visiting /login, /register,<br/>or /forgot-password?"}
  CheckAuthPage -->|Yes| RedirDash["307 Redirect to /dashboard"]
  CheckAuthPage -->|No| RouteNode["Proceed to Next.js Node Runtime"]

  IsPublic -->|No| HasValidToken{"Valid non-expired<br/>milk_session token?"}
  HasValidToken -->|No & API route| Err401["HTTP 401 Authentication required"]
  HasValidToken -->|No & Page route| RedirLogin["307 Redirect to /login?next=..."]
  HasValidToken -->|Yes| CheckAdminPath{"Path starts with<br/>/admin or /api/admin?"}

  CheckAdminPath -->|Yes & role != super_admin| DenyAdmin["API: HTTP 403 Forbidden<br/>Page: 307 Redirect to /dashboard"]
  CheckAdminPath -->|No or role == super_admin| RouteNode

  subgraph NodeGuard["Node Route Handler: getAuthenticatedUser(request)"]
    RouteNode --> LoadUser["userRepository.findById(session.id)"]
    LoadUser --> UserExists{"User exists &<br/>account_status != 'suspended'?"}
    UserExists -->|No| Node401["Return null -> HTTP 401"]
    UserExists -->|Yes| NormRole["Normalize Role:<br/>super_admin if role=='super_admin'<br/>OR email == SUPER_ADMIN_EMAIL"]
    NormRole --> IsSuperAdmin{"role == 'super_admin'?"}
    IsSuperAdmin -->|Yes| CheckRouteRole["Enforce Route-Level Guard:<br/>requireRole / requireAccountType"]
    IsSuperAdmin -->|No| IsRecovery{"Is Subscription Recovery Route?<br/>(/api/auth/me, /api/auth/profile, /api/subscription*,<br/>GET /api/reports/summary, GET /api/ukwezi/pdf,<br/>GET /api/farmer-settlements, /api/notifications*)"}
    IsRecovery -->|Yes| CheckRouteRole
    IsRecovery -->|No| SubCheck["requireActiveSubscription(user)<br/>(lib/security/subscription-access.js)"]
    SubCheck --> SubStatus{"effective_status IN<br/>('suspended', 'expired')?<br/>(Note F-012: null row passes!)"}
    SubStatus -->|Yes| Err402["HTTP 402 SUBSCRIPTION_REQUIRED"]
    SubStatus -->|No| CheckRouteRole
  end
```

---

## 4. Verified Entity-Relationship (ER) Diagram

The ER diagram below reflects the actual PostgreSQL schema created across migrations `001`–`022` (28 active tables shown; 5 unused legacy tables `session_store`, `payment_methods`, `subscription_usage_snapshots`, `collector_milk_records`, and `farmer_payments` are documented in `05-database-and-data-model.md`).

```mermaid
erDiagram
  users ||--o{ farmers : "owns (owner_user_id)"
  users ||--o{ farmers : "collects for (collector_user_id)"
  users ||--o{ collection_centers : "owns (owner_user_id)"
  users ||--o{ collector_assignments : "dairy_user_id"
  users ||--o{ collector_assignments : "collector_user_id"
  users ||--o| user_subscriptions : "user_id (UNIQUE)"
  users ||--o{ subscription_payments : "user_id"
  users ||--o{ milk_records : "owner_user_id"
  users ||--o{ collector_milk_prices : "owner_user_id"
  users ||--o{ deductions : "owner_user_id"
  users ||--o{ farmer_settlement_records : "owner_user_id"
  users ||--o{ farmer_debt_ledgers : "owner_user_id"
  users ||--o{ notifications : "owner_user_id"
  users ||--o{ audit_logs : "owner_user_id / changed_by"
  users ||--o{ import_batches : "owner_user_id"
  users ||--o{ farmer_field_configurations : "owner_user_id"

  collection_centers ||--o{ collection_center_prices : "collection_center_id"
  collection_centers ||--o{ collection_sessions : "collection_center_id"
  collection_centers ||--o{ milk_collection_adjustments : "collection_center_id"

  farmers ||--o{ milk_records : "farmer_id (NULL when is_owner_milk=TRUE)"
  farmers ||--o{ deductions : "farmer_id"
  farmers ||--o{ farmer_settlement_records : "farmer_id"
  farmers ||--o{ farmer_debt_ledgers : "farmer_id"
  farmers ||--o{ notifications : "farmer_id"

  collection_sessions ||--o{ milk_records : "collection_session_id"
  farmer_debt_ledgers ||--o{ farmer_debt_repayments : "debt_ledger_id"
  subscription_plans ||--o{ user_subscriptions : "next_plan_id (plan_id has no FK)"
  user_subscriptions ||--o{ subscription_payments : "subscription_id"
  user_subscriptions ||--o{ subscription_email_events : "subscription_id"
  subscription_payments ||--o{ subscription_email_events : "payment_id"

  users {
    bigint id PK
    varchar name
    varchar email UK
    user_role role "user | super_admin"
    user_account_type account_type "COLLECTOR | COLLECTION_CENTER"
    user_account_status account_status "active | suspended | not_approved"
    boolean email_verified
    varchar language "rw | en"
  }

  farmers {
    bigint id PK
    bigint owner_user_id FK
    bigint collector_user_id FK
    bigint farmer_number "Sequential per owner (trigger 021)"
    varchar name
    varchar phone
    varchar national_id "Global partial UNIQUE (F-017)"
    varchar account_number "Global partial UNIQUE (F-017)"
    varchar collection_center
  }

  collection_centers {
    bigint id PK
    bigint owner_user_id FK
    varchar name
    numeric price_per_liter
    numeric transport_rate_per_liter
    time morning_start
    time morning_end
    time evening_start
    time evening_end
  }

  milk_records {
    bigint id PK
    bigint farmer_id FK "NULL if is_owner_milk=TRUE"
    bigint owner_user_id FK
    boolean is_owner_milk "Check constraint 010"
    date date
    numeric volume_morning
    numeric volume_evening
    numeric volume_liters
    numeric valid_volume_liters
    numeric lost_volume_liters
    numeric price_per_liter
    numeric transport_rate_per_liter
    numeric amount
    numeric valid_amount
    milk_status status "valid | adjusted | cancelled"
  }

  deductions {
    bigint id PK
    bigint farmer_id FK
    bigint owner_user_id FK
    numeric amount
    varchar type "Advance | Umwenda | Other"
    varchar status "Active | Cleared"
    date date
  }

  farmer_settlement_records {
    bigint id PK
    bigint farmer_id FK
    bigint owner_user_id FK
    varchar payment_type "CASH | SACCO | DEBT_REPAYMENT"
    numeric amount
    numeric settled_amount
    varchar status "PENDING..SETTLED"
    date period_start
    date period_end
    varchar payment_reference
  }

  farmer_debt_ledgers {
    bigint id PK
    bigint farmer_id FK
    bigint owner_user_id FK
    numeric opening_balance
    numeric remaining_balance
    numeric total_repaid
    varchar status "OPEN | PARTIALLY_SETTLED | SETTLED"
    varchar request_key
  }
```

---

## 5. Operational & Ukwezi Accounting Workflow

The diagram below traces how daily milk entries, center-level loss adjustments, collector Owner Ifishi entries, transport rate snapshots, active deductions, SACCO eligibility, cash approvals, and debt ledgers combine into the half-month **Ukwezi** reconciliation (`lib/services/monthly-report-service.js`).

```mermaid
flowchart LR
  subgraph DailyOps["1. Daily Milk & Loss Operations"]
    FarmerMilk["Farmer Daily Milk Entry<br/>(milk_records: is_owner_milk=FALSE)<br/>Snapshots center price & transport rate"]
    CenterLoss["Center/Session Loss Adjustment<br/>(milk_collection_adjustments)<br/>Reduces valid_volume_liters & valid_amount"]
    OwnerMilk["Collector Owner Ifishi Entry<br/>(milk_records: is_owner_milk=TRUE)<br/>Priced via collector_milk_prices"]
    Deductions["Active Farmer Deductions<br/>(deductions: status='Active')<br/>Advance | Umwenda | Other"]
  end

  subgraph UkweziEngine["2. Half-Month Ukwezi Calculation (Days 1-15 or 16-End)"]
    FarmerGross["Farmer Gross Value<br/>SUM(valid_amount)"]
    FarmerTrans["Farmer Transport Charge<br/>SUM(valid_volume * transport_rate_per_liter)<br/>(0 for COLLECTION_CENTER)"]
    FarmerDed["Period Deductions<br/>SUM(active deductions in period)"]
    FarmerNet["Farmer Net Payable<br/>Gross - Transport - Deductions"]

    OwnerGross["Collector Gross Revenue<br/>SUM(owner_valid_liters * collector_price)"]
    DailySurplus["Daily Liters Difference<br/>owner_liters - farmer_liters<br/>(lib/milk-reconciliation.js)"]
    CollectorPayable["Collector Payable Retained<br/>(OwnerGross - FarmerGross)<br/>+ FarmerTransport + FarmerDeductions"]
  end

  subgraph SettlementFlow["3. Farmer Settlement & Debt Reconciliation"]
    SaccoCheck{"Has Valid SACCO Account?<br/>(len >= 4, != N/A)"}
    SaccoQueue["SACCO Payout Instruction<br/>(saccoPayableAmount = Net - ConfirmedCash)"]
    RetainedPool["Non-SACCO Retained Pool<br/>(retainedUnpaidAmount)"]
    CashApprove["Owner Cash Approval<br/>(POST /api/farmer-settlements action=cash)<br/>Status: APPROVED"]
    CollectorConfirm["Collector Payout Confirmation<br/>(POST /api/farmer-settlements action=confirm)<br/>Status: CONFIRMED"]
    DebtLedger["Carried-Forward Debt Ledger<br/>(farmer_debt_ledgers & repayments)"]
    UkweziPDF["Ukwezi Official PDF Statement<br/>(GET /api/ukwezi/pdf -> ukwezi-pdf-service.js)"]
  end

  FarmerMilk --> CenterLoss
  CenterLoss --> FarmerGross
  CenterLoss --> FarmerTrans
  Deductions --> FarmerDed
  FarmerGross --> FarmerNet
  FarmerTrans --> FarmerNet
  FarmerDed --> FarmerNet

  OwnerMilk --> OwnerGross
  OwnerMilk --> DailySurplus
  CenterLoss --> DailySurplus
  OwnerGross --> CollectorPayable
  FarmerGross --> CollectorPayable
  FarmerTrans --> CollectorPayable
  FarmerDed --> CollectorPayable

  FarmerNet --> SaccoCheck
  SaccoCheck -->|Yes| SaccoQueue
  SaccoCheck -->|No| RetainedPool
  RetainedPool --> CashApprove
  CashApprove --> CollectorConfirm
  DebtLedger --> UkweziPDF
  SaccoQueue --> UkweziPDF
  CollectorConfirm --> UkweziPDF
  CollectorPayable --> UkweziPDF
```

---

## 6. Architectural Characteristics: Caching, Transactions, Idempotency & Failure Modes

1. **Server Components vs. Client Components**:
   - All Next.js page files (`app/page.tsx`, `app/(auth)/**/page.tsx`, `app/(dashboard)/dashboard/page.tsx`) are minimal Server Components that check session cookies (`getAuthenticatedUserFromCookieStore`) for initial redirects and render Client Components (`<Welcome />`, `<Workspace />`, `<EmailVerificationPage />`).
   - All data fetching after initial page load occurs client-side via `fetch('/api/...')` with `cache: 'no-store'` inside `app/workspace.tsx` (`line 781`).
2. **Transaction Boundaries & Row Locking**:
   - Multi-step writes in `lib/repositories/*.js` use explicit `BEGIN` / `COMMIT` / `ROLLBACK` transactions on a checked-out `pg` client (`pool.connect()`), combining `pg_advisory_xact_lock` (for farmer numbering, Owner Ifishi daily writes, center loss adjustments, and debt requests) and `SELECT ... FOR UPDATE` / `FOR KEY SHARE` row locks.
   - **Exception (`F-015`)**: `POST /api/farmer-settlements` (`action === 'cash'`) computes net payable and existing cash approvals outside the `createSettlementRecord` transaction.
3. **Idempotency & Duplicate Submission Protection**:
   - **Farmer Settlements & Debts**: Uses client-generated `requestKey` (`crypto.randomUUID()`) persisted in `farmer_settlement_records.payment_reference` (`uq_farmer_settlement_reference`), `farmer_debt_ledgers.request_key` (`uq_farmer_debt_request_key`), and `farmer_debt_repayments.request_key`.
   - **Bulk Farmer Import**: Uses `import_batches (owner_user_id, batch_key)` per 50-row chunk (`019_import_batches.sql`).
   - **Milk Notebook Import (`F-027`)**: Does **not** use `import_batches`; relies on `strictInsert` conflict checks on `(farmer_id, month, year, day)`.
   - **Subscription Payments**: Reuses active `PENDING` payments for the same user and reconciles with LMBTech before creating a new collection request; enforces unique `(provider, provider_reference)` and `(provider, provider_transaction_id)`.
   - **Scheduled Cron Jobs**: `lib/repositories/jobRunRepository.js` uses session-level `pg_try_advisory_lock(hashtext(jobId))` so overlapping cron invocations skip cleanly (`{ skipped: true, reason: 'already_running' }`).
