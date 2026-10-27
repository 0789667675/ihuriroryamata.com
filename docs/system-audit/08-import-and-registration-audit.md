# 08 — Farmer Registration, Field Configuration, and Bulk Import Pipeline Audit

## 1. End-to-End Farmer Registration & Import Architecture

The system provides two pathways for registering farmers (`Aborozi`):
1. **Single Farmer Registration & Editing (`app/workspace.tsx:2479-2555` → `POST /api/farmers`, `PUT /api/farmers/[id]`)**.
2. **4-Step Bulk Farmer Import Wizard ([`components/imports/farmer-bulk-import.tsx`](file:///d:/ihuriroryamata.com/components/imports/farmer-bulk-import.tsx), 1,128 lines)** supporting:
   - **Paste**: CSV, TSV, semicolon-separated, or space-aligned text (`lib/imports/text-parsing.js`).
   - **Spreadsheet / Document Upload**: `.csv`, `.txt` (parsed client-side or via `/api/imports/extract`), `.xlsx`, `.xls`, and text-based `.pdf` (`POST /api/imports/extract` → `lib/imports/server-extraction.js`).
   - **Photo / Camera Scan**: Image preprocessing on HTML5 Canvas (`lib/imports/client-files.ts`) → Google Cloud Vision OCR (`POST /api/imports/ocr` → `lib/services/ocr-service.js`) → geometric word-to-line/cell clustering (`lib/imports/text-parsing.js:177-292`).

Additionally, Collectors can scan handwritten daily milk notebooks via **[`components/imports/milk-notebook-import.tsx`](file:///d:/ihuriroryamata.com/components/imports/milk-notebook-import.tsx)** (`lib/imports/notebook.js` → `POST /api/milk/import`).

---

## 2. Step-by-Step Audit of the Farmer Bulk Import Pipeline

### Step 1: Source Ingestion & Header Detection (`farmer-bulk-import.tsx:378-408`)
When tabular rows `rawRows` arrive from Paste, File Extraction, or OCR:
1. `prepareTable(rawRows, ...)` filters out empty rows and calls:
   ```ts
   const detected = detectHeader(clean); // from lib/imports/text-parsing.js:141-149
   const hasHeader = detected.hasHeader;
   const headings = hasHeader ? clean[0].map((h) => String(h || '').trim()) : clean[0].map((_, index) => `Column ${index + 1}`);
   const dataRows = hasHeader ? clean.slice(1) : clean;
   const interpretations = interpretColumns(headings); // from lib/imports/semantic-mapping.js:188-209
   ```

> [!CAUTION]
> **Critical Blocker `F-005`: Legacy `detectHeader` Rejects Real Kinyarwanda Cooperative Headers Before `interpretColumns` Can Run**
> - [`lib/imports/semantic-mapping.js:28-63`](file:///d:/ihuriroryamata.com/lib/imports/semantic-mapping.js#L28-L63) was specifically engineered to recognize rich Kinyarwanda, English, and French headings, including:
>   - `NO` → `farmerNumber`
>   - `AMAZINA YOMBI Y'UMWOROZI` → `name`
>   - `NOMERO Y'INDANGAMUNTU` → `nationalId`
>   - `TELEPHONE` → `phone`
>   - `NO YA KONTI` → `accountNumber`
> - **However**, `farmer-bulk-import.tsx:381` gates `headings` on `detectHeader(clean)` from [`lib/imports/text-parsing.js:14-48, 141-149`](file:///d:/ihuriroryamata.com/lib/imports/text-parsing.js#L14-L48), which uses an older, narrow `FIELD_ALIASES` dictionary with exact string equality (`FIELD_ALIASES[field].includes(normalized)`) and requires `matches >= 2` to set `hasHeader = true`!
> - In `text-parsing.js`:
>   - `'no'` is **not** in `FIELD_ALIASES` (no `farmerNumber` entry exists at all);
>   - `'amazina yombi y umworozi'` is **not** in `FIELD_ALIASES.name` (only `'amazina'`, `'izina'`, `'umworozi'`);
>   - `'nomero y indangamuntu'` is **not** in `FIELD_ALIASES.nationalId` (only `'nimero y indangamuntu'` with an `i`);
>   - `'no ya konti'` is **not** in `FIELD_ALIASES.accountNumber` (only `'nimero ya konti'`).
> - **Result on the Standard 5-Column Kinyarwanda Table (`NO | AMAZINA YOMBI Y'UMWOROZI | NOMERO Y'INDANGAMUNTU | TELEPHONE | NO YA KONTI`)**:
>   1. `detectHeader` matches only **1** column (`TELEPHONE`). Because `1 < 2`, it returns `hasHeader: false`!
>   2. `farmer-bulk-import.tsx:383-384` replaces the actual headings with `["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"]` and leaves the header row inside `dataRows` as **Farmer Row #1**!
>   3. `interpretColumns(["Column 1", ..., "Column 5"])` returns `{ field: null, confidence: 'none' }` for all 5 columns!

### Step 2: Semantic Column Mapping & Misalignment Detection (`lib/imports/semantic-mapping.js`)
- When `interpretColumns(headings)` receives actual headings, it normalizes accents/apostrophes/punctuation, checks `TARGET_ALIASES` (exact match = `high`, multi-word substring = `medium`, token set match = `low`, single-char `OCR_CONFUSIONS` substitution = `medium`), flags ambiguous multi-target matches, and prevents two columns from claiming the same target field (`duplicateTarget: true`).
- `farmerNumber` (`No.`) columns are mapped to `farmerNumber`, locked to read-only in the UI (`disabled` select at `farmer-bulk-import.tsx:962`), and ignored during row extraction (`farmer-bulk-import.tsx:605`) because PostgreSQL assigns sequential `farmer_number` values automatically.
- **Misalignment Detection Bug (`F-018`)**:
  - `detectColumnMisalignment(columnInterpretations, rows)` (`semantic-mapping.js:230-285`) checks whether $\ge 50\%$ of non-empty values in a column fail their mapped field's value pattern (`assessValueFitForColumn`) and match another field's pattern (e.g., National ID column containing farmer names, or swapped columns).
  - **Bug 1**: In `farmer-bulk-import.tsx:719-722`, `useMemo(() => detectColumnMisalignment(columnInterpretations, rows), ...)` is evaluated while `rows` is still `[]` during Step 1 (because `buildRows()` is only called when transitioning from Step 2 to Step 3 at `line 672`). Thus **zero misalignment warnings ever appear on Step 1 during initial mapping**.
  - **Bug 2**: It passes `columnInterpretations` (initial guesses) rather than `columnDecision` (the user's selected dropdown mappings).
  - **Bug 3**: In `lib/imports/farmer-field-config.js:178-181`, `isLikelyNationalId` returns `true` for any 6–20 digit string (`digits.length >= 6 && digits.length <= 20`), which matches all 9–12 digit phone numbers. In `assessFieldValue` (`line 227`), `else if (!isLikelyNationalId(text))` prevents `isLikelyPhone(text)` from ever running on a `nationalId` column containing phone numbers.

### Step 3: Per-Owner Farmer Field Configuration (`lib/imports/farmer-field-config.js` & Migration `022`)
- `DEFAULT_FIELD_DEFINITIONS` (`farmer-field-config.js:11-56`):
  - `name` (`system: true`, always `enabled: true, required: true`, max `255` chars).
  - `phone` (`enabled: true, required: false`, max `50` chars).
  - `nationalId` (`enabled: true, required: false`, max `50` chars).
  - `accountNumber` (`enabled: true, required: false`, max `255` chars).
  - `collectionCenter` (`enabled: true, required: false`, max `255` chars).
  - `cowType` (`enabled: false, required: false`, max `255` chars).
- Users can toggle `enabled` and `required` in Step 2 of `FarmerBulkImportModal` or in the standalone Field Configuration Modal (`app/workspace.tsx:2489-2535`), persisting overrides to `farmer_field_configurations` via `POST /api/farmers/field-config`.
- **Server Enforcement Gap (`F-018`)**:
  - `lib/services/farmer-service.js:19` initializes `const DEFAULT_CONFIG = defaultFieldConfig();` once at module load and never queries `domainRepository.listFarmerFieldConfigurations(ownerUserId)`. Consequently, `POST /api/farmers`, `PUT /api/farmers/[id]`, and `POST /api/farmers/import` only require `name` on the server and ignore any custom `required: true` or `enabled: false` settings saved by the owner.

### Step 4: Duplicate Detection, Row Review, Chunked Saving & Failed-Row Recovery
1. **Duplicate Detection (`lib/imports/farmer-matching.js:112-196`)**:
   - **Exact DB `nationalId` or `accountNumber` match** (or within-file duplicate `nationalId`/`accountNumber`): `status = 'duplicate'`, `lockedDuplicate = true`, `include = false` (checkbox locked).
   - **Exact DB `phone` match, exact `name` match, or fuzzy `name` match ($\text{similarity} \ge 0.72$)**: `status = 'possible-duplicate'`, `lockedDuplicate = false`, `include = false` by default; user can check the row to include it (`duplicateConfirmed: true`).
2. **Chunked Transactional Saving (`farmer-bulk-import.tsx:745-810` → `POST /api/farmers/import`)**:
   - Sends included rows in chunks of `50` with `batchKey: "${batchKeyRef.current}-${chunkIndex}"`.
   - `domainRepository.createFarmersBatch` (`lib/repositories/domainRepository.js:409-544`) records the batch in `import_batches` (`019_import_batches.sql`) for idempotency and wraps each row in `SAVEPOINT import_row` so row-level database constraint errors (`23505` duplicate National ID / account number) roll back only that row and return a row-local error.
3. **Failed-Row Recovery Lockout Bug (`F-006`)**:
   - In `farmer-bulk-import.tsx:750`, `startSave()` sets `setSaveAttempted(true)`.
   - When `saveAttempted === true`, `updateRowValue` (`L692`), `updateRowCenter` (`L705`), and `toggleInclude` (`L710`) return early, and every input, select, checkbox, Remove button, and the `"Confirm and save"` button are `disabled` (`L878-889, 1074-1104`).
   - Furthermore, `startSave()` unconditionally calls `setStep(4)` (`L794`) even when `failed > 0`, and Step 4 (`L1110-1120`) has no `"Back to review"` button. Thus failed rows cannot be edited or retried in the session.

---

## 3. Handwritten Milk Notebook Import Audit (`components/imports/milk-notebook-import.tsx`)

1. **OCR Geometry & Date Column Extraction ([`lib/imports/notebook.js`](file:///d:/ihuriroryamata.com/lib/imports/notebook.js))**:
   - Searches the first 15 OCR lines for a header row containing a recognized farmer name label (`amazina`, `umworozi`, `names`, etc.) and $\ge 2$ date tokens (`1..31`, `dd/mm`, `dd-mm-yyyy`, `yyyy-mm-dd`).
   - Locates the horizontal center `targetX` of the column matching `targetDate` and extracts only quantity tokens within horizontal distance $\le \max(14, 0.38 \times \text{columnSpacing})$ of `targetX`.
   - Never guesses a date column if `targetDate` is absent (`usedColumn = null`, marking rows `'uncertain'`).
2. **Farmer Matching & Strict Save (`POST /api/milk/import`)**:
   - Auto-selects a farmer only on an unambiguous exact match (`matchFarmer`); uncertain/ambiguous rows require manual selection in Step 2 before they can be included.
   - Saves via `milkRepository.upsertMilkRecord` with `strictInsert: true` so existing milk records with different liters are reported as conflicts (`conflictCount`) rather than silently overwritten.
3. **Identified Issues**:
   - **`F-019`**: Kinyarwanda copy in `lib/i18n/import-copy.ts:38, 69` labels Morning as **`"Ijoro"` ("Night")**.
   - **`F-027`**: `todayIso()` (`milk-notebook-import.tsx:55-59`) uses browser local time instead of `getAccountingDate()` (`Africa/Kigali`); `/api/milk/import` does not record batches in `import_batches` and triggers alert evaluation per 50-row chunk.
