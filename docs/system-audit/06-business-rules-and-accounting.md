# 06 — Business Rules, Domain Logic, and Accounting Verification

## 1. Domain Model & Account Hierarchy

### 1.1 Account Roles & Business Types
- **Platform Super Admin (`users.role = 'super_admin'`)**:
  - Identified by `users.role === 'super_admin'` or email matching `process.env.SUPER_ADMIN_EMAIL` (`lib/security/authenticate.js:49-56`).
  - Exempt from subscription enforcement (`lib/security/authenticate.js:84`).
  - Cannot record customer milk or farmers; manages platform accounts, exemptions, pricing tiers, policy timing, payment reconciliation, audit logs, and system health.
- **Milk Collector (`users.account_type = 'COLLECTOR'` / *Umucunda*)**:
  - Can operate **standalone** (owning collection sites in `collection_centers` and farmers in `farmers` where `owner_user_id = collector.id`) OR **assigned to a Collection Center** (`collector_assignments` row with `revoked_at IS NULL`, where assigned farmers have `owner_user_id = dairy.id` and `collector_user_id = collector.id`).
  - Records daily farmer milk (`Amata`), collector Owner Ifishi milk (`is_owner_milk = TRUE`), center-level loss adjustments, farmer deductions (`Ibikurwaho`), and farmer settlements/debt ledgers (`Ubwishyu`).
- **Collection Center / Dairy (`users.account_type = 'COLLECTION_CENTER'` / *Ikigo cy'ikusanyirizo*)**:
  - Configures its owned `Ikigo` (`collection_centers`), links/revokes Collectors (`collector_assignments`), registers farmers (`owner_user_id = dairy.id`), and monitors aggregated collector deliveries (`Ifishi y'Abacunda`) and `Ukwezi` / `Raporo` statements.
  - Forbidden from configuring transport charges: `createCenter` forces `transportRatePerLiter = 0` (`lib/services/collection-center-service.js:76`), and `updateCenter` throws `403 DAIRY_TRANSPORT_FORBIDDEN` (`L109-111`) if a `COLLECTION_CENTER` sends a non-zero transport rate.

### 1.2 Permanent Farmer Numbering (`#001`)
- Defined in [`supabase/migrations/021_farmer_numbers.sql`](file:///d:/ihuriroryamata.com/supabase/migrations/021_farmer_numbers.sql) and [`lib/farmer-delivery.js:3-24`](file:///d:/ihuriroryamata.com/lib/farmer-delivery.js#L3-L24).
- Every farmer has a permanent, owner-scoped integer `farmer_number` (`UNIQUE (owner_user_id, farmer_number)`), formatted as `#001`, `#002`, ..., `#999`, `#1000` (`String(n).padStart(3, '0')`).
- Allocated under transaction-scoped advisory lock `pg_advisory_xact_lock(owner_user_id)` both in the PostgreSQL `BEFORE INSERT` trigger `assign_farmer_number()` and in `domainRepository.allocateNextFarmerNumber` (`lib/repositories/domainRepository.js:354-360`).

---

## 2. Daily Milk Collection, Pricing, Losses, and Voiding Rules

### 2.1 Effective Price & Transport Snapshot Rules (`lib/repositories/milkRepository.js:55-97, 145-241`)
When a Collector records milk for farmer $f$ on collection date $d$:
1. **Effective Price Resolution**:
   - Queries `collection_center_prices` for the farmer's center where `effective_date <= d`, ordered by `effective_date DESC, id DESC LIMIT 1`.
   - Falls back to `collection_centers.price_per_liter` if no historical price row predates $d$.
   - If `pricePerLiter <= 0`, throws HTTP `400` (`COLLECTION_CENTER_PRICE_NOT_CONFIGURED`).
2. **Volume & Gross Calculation**:
   $$V_{\text{total}} = \text{round}_2(V_{\text{morning}} + V_{\text{evening}}), \quad V_{\text{total}} > 0$$
   $$A_{\text{gross}} = \text{round}_2(V_{\text{total}} \times P_{\text{effective}})$$
3. **Immutable Snapshot Columns Written on `INSERT`**:
   - `volume_morning`, `volume_evening`, `volume_liters` $= V_{\text{total}}$
   - `valid_volume_morning` $= V_{\text{morning}}$, `valid_volume_evening` $= V_{\text{evening}}$, `valid_volume_liters` $= V_{\text{total}}$
   - `lost_volume_liters = 0`, `status = 'valid'`
   - `price_per_liter` $= P_{\text{effective}}$, `amount` $= A_{\text{gross}}$, `valid_amount` $= A_{\text{gross}}$
   - `transport_rate_per_liter` $= T_{\text{center}}$ (from `collection_centers.transport_rate_per_liter`)
4. **Same-Day Upsert & Conflict Rules (`UNIQUE (farmer_id, month, year, day)`)**:
   - If existing row has `status IN ('adjusted', 'cancelled')`: throws HTTP `409 MILK_RECORD_ADJUSTED` (prevents overwriting a loss-adjusted or voided row via normal milk entry).
   - If morning, evening, price, and amount are unchanged: throws HTTP `409 DUPLICATE_MILK_RECORD`.
   - If `strictInsert: true` (Milk Notebook Import `/api/milk/import`): throws HTTP `409 MILK_RECORD_CONFLICT` rather than overwriting an existing different value.
   - Otherwise (`POST /api/milk` or `PUT /api/milk/template`): updates volumes and amount. (**Finding `F-023`**: the conflict `UPDATE` in `upsertMilkRecord` and `updateMilkRecord` omits updating `transport_rate_per_liter`.)

### 2.2 Center-Level Milk Loss Adjustments (`lib/repositories/milkAdjustmentRepository.js:5-168`)
A Collector can record a percentage loss $L \in [0, 100]$ for a center, date $d$, and period $p \in \{\text{'morning'}, \text{'evening'}, \text{'all'}\}$ with a mandatory `reason`:
1. **Original Baseline Preservation**:
   - On the first adjustment, `original_volume_liters`, `original_volume_morning`, `original_volume_evening`, and `original_amount` are initialized from the unadjusted values via `COALESCE(original_..., current_...)`.
   - Subsequent corrections to $L$ always recalculate from `original_*` (idempotent; verified by `tests/milk-loss.test.js:248-249`).
2. **Session-Specific Scaling**:
   - Let $k = 1 - \frac{L}{100}$.
   - If $p = \text{'morning'}$: $V_{\text{valid,m}} = \text{round}_2(V_{\text{orig,m}} \times k)$, $V_{\text{valid,e}}$ unchanged.
   - If $p = \text{'evening'}$: $V_{\text{valid,e}} = \text{round}_2(V_{\text{orig,e}} \times k)$, $V_{\text{valid,m}}$ unchanged.
   - If $p = \text{'all'}$: both sessions scaled by $k$.
   - Total valid day volume: $V_{\text{valid}} = \text{round}_2(V_{\text{valid,m}} + V_{\text{valid,e}})$.
   - Lost volume: $V_{\text{lost}} = \text{round}_2(V_{\text{orig}} - V_{\text{valid}})$.
   - Valid amount:
     $$A_{\text{valid}} = \begin{cases} \text{round}_2\!\left(A_{\text{orig}} \times \frac{V_{\text{valid}}}{V_{\text{orig}}}\right) & \text{if } V_{\text{orig}} > 0 \\ 0 & \text{otherwise} \end{cases}$$
   - Record status: `'cancelled'` if $p = \text{'all'}$ and $L = 100$; `'valid'` if $V_{\text{lost}} = 0$; `'adjusted'` otherwise.
   - **Critical Bug (`F-008`)**: `applyCollectionAdjustment` (`milkAdjustmentRepository.js:23-33`) selects all `milk_records` for the center and date without filtering `AND status <> 'cancelled'`. If an individual farmer's record was previously voided (`100%` loss), applying a center-wide partial loss (e.g. `5%`) overwrites that farmer's voided record to `95%` valid volume!

### 2.3 Individual Record Voiding (`milkRepository.voidMilkRecord` & `collectorMilkRepository.voidDaily`)
- Requires a non-empty `reason`.
- Sets `status = 'cancelled'`, `loss_percentage = 100`, `valid_volume_liters = 0`, `valid_volume_morning = 0`, `valid_volume_evening = 0`, `valid_amount = 0`, and `lost_volume_liters = COALESCE(original_volume_liters, volume_liters)`.
- **Critical Bugs**:
  - **`F-001`**: `DELETE /api/milk/[id]` crashes with `ReferenceError: requireActiveSubscription is not defined` before reaching `voidMilkRecord`.
  - **`F-023`**: `collectorMilkRepository.voidDaily` (`L237-248`) sets `valid_volume_liters = 0` and `status = 'cancelled'`, but omits `valid_amount = 0`.

---

## 3. Owner Ifishi, Abacunda Ifishi, and Daily Delivery Reconciliation

1. **Owner Ifishi (`Ifishi ya nyir'amata` — `lib/services/owner-ifishi-service.js`)**:
   - Stored in `milk_records` with `is_owner_milk = TRUE` and `farmer_id IS NULL` (`uq_milk_records_owner_daily`).
   - Priced using the Collector's own price schedule in `collector_milk_prices (owner_user_id, effective_date)`.
   - Compares Collector Owner valid liters ($V_{\text{owner}}$) against aggregated valid farmer liters ($V_{\text{farmers}}$) on the same date via `calculateMilkDifference` ([`lib/milk-reconciliation.js:1-11`](file:///d:/ihuriroryamata.com/lib/milk-reconciliation.js#L1-L11)):
     $$\Delta V = \text{round}_2(V_{\text{owner}} - V_{\text{farmers}}), \quad V_{\text{surplus}} = \max(0, \Delta V)$$
   - Never substitutes farmer liters for owner liters when no Owner Ifishi entry exists (`status: 'missing'`).
2. **Abacunda Ifishi (`Ifishi y'Abacunda` — `app/api/ifishi/abacunda/route.js`)**:
   - Available to `COLLECTION_CENTER` accounts for any actively linked Collector (`collector_assignments WHERE revoked_at IS NULL`).
   - Returns milk-only daily and period aggregates (`volumeMorning`, `volumeEvening`, `totalVolume`, `farmersCount`) under the Dairy's active `Ikigo`.
3. **Farmer Delivery Traceability (`lib/farmer-delivery.js:35-177`)**:
   - `calculateDeliveryReconciliation`: counts unique expected farmers vs unique delivered farmers (`status !== 'cancelled'` and session volume $> 0$).
   - `calculateFarmerDeliveryHistory`: generates calendar days in `[startDate, min(endDate, todayKigali)]` clamped to `farmer.created_at`, identifying exact missed delivery dates without inserting blank database rows.

---

## 4. Ukwezi Half-Month Accounting & Collector Balance Sheet

### 4.1 Accounting Period Resolution (`lib/utils/accounting-period.js`)
- All calendar calculations use `ACCOUNTING_TIME_ZONE = 'Africa/Kigali'`.
- **`first-half` (`Igice cya 1`)**: Day `01` through Day `15` inclusive (`YYYY-MM-01` .. `YYYY-MM-15`).
- **`second-half` (`Igice cya 2`)**: Day `16` through the last calendar day of the month (`28`, `29`, `30`, or `31`).
- For `Ukwezi` endpoints, server-calculated half-month boundaries always override any browser-supplied custom `startDate`/`endDate` (`tests/monthly-report.test.js:264`).

### 4.2 Farmer Period Accounting Formulas (`lib/repositories/reportRepository.js` & `lib/services/monthly-report-service.js`)
For each farmer $i$ in period $[D_{\text{start}}, D_{\text{end}}]$:
1. **Valid Volume ($V_i$)**: Sum of `COALESCE(valid_volume_liters, volume_liters)` across non-cancelled `milk_records`.
2. **Historical Gross Milk Value ($G_i$)**:
   - Sum of each day's valid liters multiplied by its historical price (`mr.price_per_liter` if $> 0$, else historical `collection_center_prices` effective on `mr.date`).
   - If any positive-volume record has no historical price (`missingPriceRecords > 0`), `milkValueComplete = false` and `grossAmount = null` (never substitutes current price or `0`).
3. **Transport Charge ($T_i$)**:
   - For `COLLECTION_CENTER`: $T_i = 0$.
   - For `COLLECTOR`: $T_i = \sum \text{round}_2(V_{i,d} \times r_{i,d})$ where $r_{i,d}$ is `mr.transport_rate_per_liter`. If any positive-volume record has `transport_rate_per_liter IS NULL` (pre-migration `013`), `transportIsComplete = false` and $T_i = \text{null}$.
4. **Active Deductions ($D_i$)**:
   - Sum of `deductions.amount` for farmer $i$ where `status = 'Active'`, `type IN ('Advance', 'Umwenda', 'Other')`, and `date BETWEEN D_start AND D_end`.
5. **Farmer Net Payable ($N_i$)**:
   $$N_i = \begin{cases} \text{round}_2(G_i - T_i - D_i) & \text{if } G_i \neq \text{null and } T_i \neq \text{null} \\ \text{null} & \text{otherwise} \end{cases}$$

### 4.3 Collector Balance Sheet (`calculateCollectorBalanceSheet` in `monthly-report-service.js:79-211`)
For a `COLLECTOR` account over period $[D_{\text{start}}, D_{\text{end}}]$:
- **Collector Owner Gross ($G_{\text{owner}}$)**: $\sum_d \text{round}_2(V_{\text{owner},d} \times P_{\text{collector},d})$ from Owner Ifishi records and `collector_milk_prices`.
- **Collector Surplus Amount ($S_{\text{collector}}$)**: $\text{round}_2(G_{\text{owner}} - \sum_i G_i)$.
- **Collector Payable Retained ($P_{\text{collector}}$)**:
  $$P_{\text{collector}} = \text{round}_2\!\left(S_{\text{collector}} + \sum_i D_i + \sum_i T_i\right)$$
- **Total Farmer Net Payable ($N_{\text{farmers}}$)**: $\sum_i N_i$.
- **Reconciliation Identity**:
  $$P_{\text{collector}} + N_{\text{farmers}} = (G_{\text{owner}} - G_{\text{farmers}} + D + T) + (G_{\text{farmers}} - T - D) = G_{\text{owner}}$$
  Marked `reconciled = true` when $|G_{\text{owner}} - (P_{\text{collector}} + N_{\text{farmers}})| \le 0.01$.

---

## 5. Farmer Settlements, SACCO vs. Cash Rules, and Debt Ledgers

Implemented in [`lib/services/monthly-report-service.js:426-557`](file:///d:/ihuriroryamata.com/lib/services/monthly-report-service.js#L426-L557), [`lib/services/farmer-settlement-service.js`](file:///d:/ihuriroryamata.com/lib/services/farmer-settlement-service.js), and [`lib/repositories/farmerSettlementRepository.js`](file:///d:/ihuriroryamata.com/lib/repositories/farmerSettlementRepository.js):
1. **SACCO Eligibility (`hasValidSaccoAccount`)**:
   - A farmer is SACCO-eligible iff `account_number` trimmed has length $\ge 4$ and is not `'N/A'` or `'NA'`.
   - For SACCO-eligible farmers: unpaid net payable is routed to `saccoPayableAmount` ($\max(0, N_i - C_{\text{confirmed}} - S_{\text{confirmed}} - R_{\text{debt}})$). Manual confirmed cash paid to a SACCO-eligible farmer reduces their remaining `saccoPayableAmount` without altering historical $N_i$.
2. **Non-SACCO Retained Pool & Cash Approval**:
   - Farmers without a valid SACCO account hold their unpaid balance in `retainedUnpaidAmount` (kept strictly separate from Collector profit/surplus).
   - `POST /api/farmer-settlements` (`action: 'cash'`) creates an `'APPROVED'` cash settlement record (restricted to non-SACCO farmers and capped at $N_i - \text{existingCash}$).
   - `POST /api/farmer-settlements` (`action: 'confirm'`) transitions an `'APPROVED'` settlement to `'CONFIRMED'` (`settled_amount = amount, remaining_amount = 0`).
3. **Debt Ledgers & Carry-Forward (`farmer_debt_ledgers` & `farmer_debt_repayments`)**:
   - `action: 'debt'` records an opening debt balance (`status = 'OPEN'`).
   - `action: 'debt-repayment'` locks the debt ledger row (`FOR UPDATE`), subtracts the repayment (`remaining_balance = opening_balance - total_repaid`), sets status to `'PARTIALLY_SETTLED'` or `'SETTLED'`, and inserts an immutable `farmer_debt_repayments` audit row.
4. **Identified Settlement Bugs**:
   - **`F-015`**: Cash payable ceiling check in `app/api/farmer-settlements/route.js:123-140` runs outside a transaction without row locking; `getSettlementRecord` (`farmerSettlementRepository.js:128-136`) has a `$2`/`$3` parameter binding bug.
   - **`F-016`**: When $N_i < 0$ (deductions + transport exceed gross milk value) and $0$ payments are made, `paidOverage = 0 - N_i > 0` triggers a false `unexplainedDiscrepancy` (`monthly-report-service.js:488-552`).

---

## 6. Subscriptions, Volume Tiers, Initial Access Window, and LMBTech MoMo

1. **Initial Access Window (`lib/services/subscription-time.js` & `subscription_policy_settings`)**:
   - New accounts receive `initial_access_days` (default `15` days) anchored to the local calendar date in `Africa/Kigali`.
   - The authoritative payment deadline (`payment_due_at`) is `00:00:00` (`enforcement_time`) on Day $15 + 1 + \text{grace\_period\_days}$ (i.e., midnight at the start of Day 16 in `Africa/Kigali` when grace is `0`).
   - Once `now >= payment_due_at` without a provider-confirmed `SUCCESS` payment (and `billing_exempt === false`), `effective_status` becomes `'suspended'` (for unpaid initial access) or `'expired'` (for elapsed paid periods).
2. **Pricing Model (`subscription_plans` & `collection_center_subscription_config`)**:
   - **Collectors (`COLLECTOR`)**: 5 contiguous monthly volume tiers based on 15-day / period valid farmer liters:
     - `USAGE_0_5000_MONTHLY`: `0 – 5,000 L` → `5,000 RWF`
     - `USAGE_5001_10000_MONTHLY`: `5,001 – 10,000 L` → `10,000 RWF`
     - `USAGE_10001_20000_MONTHLY`: `10,001 – 20,000 L` → `17,000 RWF`
     - `USAGE_20001_40000_MONTHLY`: `20,001 – 40,000 L` → `20,000 RWF`
     - `USAGE_40001_PLUS_MONTHLY`: `40,001+ L` → `25,000 RWF`
   - **Collection Centers (`COLLECTION_CENTER`)**: Single flat monthly plan (`COLLECTION_CENTER_MONTHLY`, default `30,000 RWF`).
   - **Critical Bug (`F-007`)**: `subscriptionRepository.buildFarmerMilkUsageQuery` (`L412-430`) inner-joins `collector_assignments`, so standalone Collectors who are not linked to a Collection Center always compute `0 L` of farmer milk usage!
3. **LMBTech MTN Mobile Money Flow (`lib/services/payment-provider.js` & `subscription-service.js`)**:
   - Requires explicit production opt-in (`LMBTECH_LIVE_PAYMENTS_ENABLED=true`), valid API key/secret, and HTTPS non-localhost `LMBTECH_CALLBACK_URL`.
   - Payment initiation uses the server-stored plan price and the user's verified Rwanda MTN mobile number (`078`/`079`).
   - Webhook callbacks (`POST /api/subscription/payments/callback`) and manual status checks (`POST /api/subscription/payments/[paymentId]`) verify the transaction directly with LMBTech's status endpoint before activating the subscription.
