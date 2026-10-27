# 07 — UI/UX, Interactivity, Responsiveness, Accessibility, and Localization Audit

## 1. Visual Design System & Styling Architecture

- **Authoritative Stylesheet**: [`app/globals.css`](file:///d:/ihuriroryamata.com/app/globals.css) (`1,736` lines).
- **Color Palette & Tokens (`app/globals.css:1-42`)**:
  - Primary Dairy Blue: `--blue: #1681ab`, `--blue-deep: #0b5d7e`, `--blue-pressed: #0d6a8f`, `--blue-soft: #e6f4f9`, `--blue-pale: #f1f8fb`, `--blue-wash: #f5fafc`, `--blue-line: #cfe6ef`.
  - Surfaces & Ink: `--canvas: #f8fbfd`, `--surface: #ffffff`, `--ink: #112430`, `--muted: #526977`, `--text-note: #38505e`.
  - Semantic Status Colors: `--sage: #157f50` (success), `--amber: #b86614` (warning), `--danger: #c0292b` (error), `--orange: #d95d1e` (unread badge).
- **Typography (`app/layout.tsx:5-16`)**:
  - Sans-serif: `Plus Jakarta Sans` (`--font-sans`).
  - Numeric/Monospace: `JetBrains Mono` (`--font-mono`) with `font-variant-numeric: tabular-nums` applied to volumes, currency amounts, farmer numbers, and KPI counters.
- **Uncompiled Tailwind CSS Remnants (`Finding F-030`)**:
  - `package.json` does **not** install `tailwindcss`, `postcss`, or `autoprefixer`.
  - Five unused component files (`components/ui/badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`, `skeleton.tsx`), `components/layout/dashboard-shell.tsx`, `app/(dashboard)/layout.tsx:26` (`className="min-h-screen bg-[#f8fbfd] text-[#112430]"`), and `pages/_document.js:7` contain Tailwind utility classes that have no effect at runtime because `app/globals.css` styles `body` and `.workspace-shell` directly.

---

## 2. Interactive Components & Dynamic State Behavior

### 2.1 Forms, Comboboxes, and Search Controls
1. **Global Workspace Search (`app/workspace.tsx:1828-1865`)**:
   - Located in the sticky `.topbar`; queries `GET /api/search?q=...` across farmers, collection centers, and notifications; closes on outside pointer-down or `Escape`.
2. **Farmer Ifishi Direct Search Combobox (`app/workspace.tsx:2833-2905`)**:
   - Implements full WAI-ARIA combobox semantics (`role="combobox"`, `aria-expanded`, `aria-controls="ifishi-farmer-results"`, `aria-activedescendant`, `role="listbox"`, `role="option"`).
   - Supports keyboard navigation (`ArrowDown`, `ArrowUp`, `Enter` to select farmer and open Ifishi modal, `Escape` to close) and exposes each farmer's permanent `#001` number, name, center, and phone without a duplicate secondary dropdown (verified by `tests/ifishi-search.test.js`).
3. **Inline Daily Milk Entry (`app/workspace.tsx:2772-2830`)**:
   - Each farmer row in the daily collection table (and mobile card list) provides Morning (`Igitondo`) and Evening (`Umugoroba`) numeric inputs (`step="0.01"`, `min="0"`).
   - Tracks per-row dirty/saving/saved state (`milkRowState[farmer.id]`) and queues entries in `localStorage` (`milk_offline_queue_v1`) when offline, automatically replaying queued saves on the `window` `'online'` event (`L877-904`).

### 2.2 Modals & Focus Management (`components/ui/modal.tsx` & `components/imports/import-ui.tsx`)
1. **Shared Workspace Modal ([`components/ui/modal.tsx`](file:///d:/ihuriroryamata.com/components/ui/modal.tsx))**:
   - Renders with `role="dialog"` and `aria-modal="true"`.
   - Locks background `document.body.style.overflow = 'hidden'`.
   - Moves initial focus into the modal container (`panelRef.current?.focus()`), traps `Tab` / `Shift+Tab` focus across focusable descendants (`FOCUSABLE_SELECTOR`, `L6-15`), closes on `Escape` and backdrop click when `dismissible !== false`, and restores focus to `previousFocus` on unmount (`L27-76`).
   - Verified by Playwright spec `tests/e2e/workspace-modal.spec.ts`.
2. **Import Wizard Modal ([`components/imports/import-ui.tsx`](file:///d:/ihuriroryamata.com/components/imports/import-ui.tsx))**:
   - Wraps `Modal` with `.import-modal` (`max-width: 1240px`, sticky `.import-modal-header`, scrollable `.import-modal-body` with `overscroll-behavior: contain`, sticky `.import-modal-footer`), and `.import-steps` progress pills.

### 2.3 Dynamic UI Updates After Mutations
- **Milk Entry / Adjustment / Owner Ifishi**: Immediately updates local row state and re-fetches `loadDailyMilk()`, `loadDashboardOwnerMilk()`, and `loadOverview()` so dashboard KPIs and reconciliation differences stay synchronized.
- **Farmer Create / Edit / Import / Delete**: Calls `loadFarmers()` and refreshes farmer counts.
- **Notifications**: Uses optimistic `isRead` state updates on click (`markNotificationRead` / `markAllNotificationsRead`), coalesces duplicate clicks via `pendingNotificationReadsRef` (`L617`), and rolls back state if the `PATCH` request fails (`tests/notifications.test.js:359`).

---

## 3. Responsive Breakpoints & Mobile Adaptation

`app/globals.css` implements 7 media-query breakpoints (`1180px`, `1040px`, `980px`, `780px`, `680px`, `420px`, `380px`, `360px`):

| Breakpoint | Layout & Component Adaptations |
|---|---|
| **Desktop (`> 780px`)** | Sticky `.topbar` + left `.side-nav` (`236px` wide) + multi-column content grids. Data tables render inside `.table-scroll` (`display: block`) while `*-mobile-list` card containers are `display: none`. |
| **Tablet (`<= 980px`)** | `.dashboard-overview`, `.dashboard-lower`, `.screen-grid`, and `.settings-grid` collapse to single-column (`grid-template-columns: 1fr`). |
| **Phone (`<= 780px`)** | Left `.side-nav` hides (`display: none`); bottom fixed `.mobile-nav` bar (`min-height: 68px`, 4 primary tabs + `"More"` drawer `.mobile-more-menu`) appears with `env(safe-area-inset-bottom)` padding.<br>**Table-to-Card Transformation**: `.farmers-desktop-table`, `.milk-desktop-table`, `.deductions-desktop-table`, `.settlements-desktop-table`, `.ukwezi-desktop-table`, and `.reports-desktop-table` switch to `display: none`, and `.farmer-mobile-list`, `.milk-mobile-list`, `.deduction-mobile-list`, `.settlement-mobile-list`, `.ukwezi-mobile-list`, and `.reports-mobile-list` switch to `display: grid` (`globals.css:1430-1490`). |
| **Small Phone (`<= 420px` & `<= 360px`)** | Brand subtitle and copy compact (`max-width: 104px` / hidden at `<= 380px`); `.reports-kpi-cards` stacks into 1 column; modal padding adjusts for mobile safe areas (`100dvh - 84px`). |

---

## 4. Accessibility (a11y) Review

### Verified Accessibility Strengths
1. **Skip Navigation**:Both `app/welcome.tsx:135` and `app/workspace.tsx:1819` provide a `.skip-link` (`#main-content`) visible on `:focus-visible`.
2. **Focus Visibility**: `app/globals.css:76-82` defines high-contrast `:focus-visible` outlines (`2px solid var(--blue-pressed)`, `outline-offset: 2px`) across buttons, inputs, selects, and interactive rows.
3. **Reduced Motion Support**: `app/globals.css` and `components/ui/animated-counter.tsx`, `scroll-reveal.tsx`, and `typing-display.tsx` respect `@media (prefers-reduced-motion: reduce)`.
4. **Semantic Landmarks & Live Regions**: Uses `<header>`, `<nav>`, `<main id="main-content">`, `role="status"` on loading/empty states and toast notices, and `role="alert"` on `.form-error` banners.
5. **Sortable Table Headers**: Use `<button className="farmer-sort-button" aria-sort="ascending|descending|none">`.

### Accessibility & UX Gaps Identified (`Finding F-028`)
1. **Conflicting `<html lang>` Attributes**: `app/layout.tsx:64` hardcodes `<html lang="rw">` (even when the user switches the UI to `'en'`), while legacy `pages/_document.js:5` hardcodes `<Html lang="en">`.
2. **Hardcoded English `aria-label` Attributes**:
   - `components/imports/import-ui.tsx:31, 41`: `aria-label="Close"` and `aria-label="Import steps"`.
   - `app/workspace.tsx:4335`: `aria-label="Dismiss"` on the toast notification banner.
3. **Raw JSON Dumped in Super Admin Tables**:
   - `app/workspace.tsx:4124` (`renderAdminAudit`) and `L4210, L4227` (`renderAdminSystemHealth`) render raw `JSON.stringify(...)` inside `<code>` elements, causing wide horizontal overflow and poor readability for non-technical administrators.

---

## 5. Localization (i18n) & Terminology Audit (`rw` vs `en`)

### 5.1 Key Parity
- [`lib/i18n/public-copy.ts`](file:///d:/ihuriroryamata.com/lib/i18n/public-copy.ts) (`~880` keys) and [`lib/i18n/import-copy.ts`](file:///d:/ihuriroryamata.com/lib/i18n/import-copy.ts) (`~205` keys) maintain 100% structural key parity between `rw` and `en`.

### 5.2 Severe Kinyarwanda Mistranslations in `lib/i18n/import-copy.ts` (`Finding F-019`)
| File & Line | Key | Current Kinyarwanda (`rw`) Value | Literal Meaning of Current Value | English (`en`) Value | Recommended Kinyarwanda Fix |
|---|---|---|---|---|---|
| `lib/i18n/import-copy.ts:38, 69` | `morning`, `morningQty` | **`'Ijoro'`** | **"Night"** | `'Morning'` | **`'Igitondo'`** (matches `public-copy.ts:246`) |
| `lib/i18n/import-copy.ts:206` | `actions` | **`'Amafaranga'`** | **"Money"** | `'Actions'` | **`'Ibikorwa'`** |
| `lib/i18n/import-copy.ts:153-155` | `confHigh`, `confMedium`, `confLow` | `'Nyinshi'`, `' Gito'`, **`'Nyinshi cyane'`** | "Many", "Little", **"Very many / Very high"** (for Low!) | `'High'`, `'Medium'`, `'Low'` | `'Cyane'` / `'iringaniye'` / `'Gito'` (icyizere cyinshi / kiringaniye / gito) |
| `lib/i18n/import-copy.ts:170` | `mismatchNotice` | `'Imirongo ya some ntibagendane neza na amutwe yabo yabonetse. Emeza gutandukanya ubu mukanda.'` | Contains untranslated English word **`"some"`** and broken grammar | `'Some columns have values that do not match their detected heading...'` | `'Inkingi zimwe zifite amakuru adahuye n’umutwe wazo wabonetse. Suzuma ihuzwa ry’inkingi mbere yo gukomeza.'` |
| `lib/i18n/import-copy.ts:159` & `semantic-mapping.js:16` | `excludeColumn` / `exclude` | `'Hagaruka inkingi'` / `'Hagukana'` | Nonsensical verb form | `'Exclude / Ignore column'` | `'Kureka iyi nkingi'` / `'Kureka'` |

### 5.3 Uninterpolated Placeholders & Hardcoded English Strings (`F-019`, `F-028`)
1. **Uninterpolated `{count}` in `components/imports/farmer-bulk-import.tsx:1033`**:
   - `{field.enabled ? t('enabledLabel') : t('excludedCount')}` renders literal **`"Imirongo yakuweho: {count}"`** (`rw`) or **`"Excluded: {count}"`** (`en`) because no `{ count }` parameter is passed.
2. **Hardcoded English Validation Warnings in `lib/imports/farmer-field-config.js:209-244`**:
   - Warnings such as `'This looks like a number, not a farmer name.'` and `'This does not look like a valid phone number.'` are returned in English and rendered directly in Kinyarwanda mode (`farmer-bulk-import.tsx:1081`).
3. **Hardcoded English UI Strings in `app/workspace.tsx`**:
   - Startup failure screen (`L840, L1811`): `'Unable to start Milk System. Check your connection or try again.'`, `'Retry'`.
   - Offline queue sync (`L894`, `L4289`): `` `${synced.synced} offline milk entr... synced.` ``, `` `Offline · ${pendingWrites} queued` ``.
   - Action toasts & dialogs (`L1948, 1972, 1977, 1981, 1995, 2002, 2015, 2018`): `'Farmer details saved.'`, `` `Delete ${farmer.name}? ...` ``, `'Farmer deleted.'`, `'Collection center added.'`, `'Center settings saved.'`.
   - Collection Center headers & states (`L2380, 2382, 2384, 2561`): `'Active Ikigo'`, `'Loading assigned Abacunda…'`, `'Loading daily milk…'`, `'No active Ikigo is available for this account.'`.
