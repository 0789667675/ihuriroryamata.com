# IHURIRO RY'AMATA: OCR Milk Scanner Architecture & Pipeline Specification

This document details the architecture, mathematical algorithms, heuristics, and security principles governing the Computer Vision and Optical Character Recognition (OCR) pipeline within **IHURIRO RY'AMATA (Milk System)**.

The system automates the ingestion of physical paper-based milk notebooks (*Amakaye y'Amata* / *Ifishi y'Umukwege*) used across Rwandan dairy collection centers and milk collection routes.

---

## 1. Architecture Overview: Google Vision API & Client-Side Canvas Pre-processing

The Milk Scanner pipeline operates as a hybrid client-server distributed system designed for minimal network overhead, sub-second latency on 3G/4G rural mobile connections, and zero disk writes on the server.

```
+-----------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER                                       |
|                                                                                         |
|  [ Physical Register Camera / Upload ]                                                  |
|                    |                                                                    |
|                    v                                                                    |
|  [ HTML5 File API + Exif Orientation Normalization ]                                    |
|                    |                                                                    |
|                    v                                                                    |
|  [ Client-Side Canvas 2D Pipeline ]                                                     |
|    - Capped at max 2400px edge (preserve resolution without byte bloat)                 |
|    - Aspect ratio clamp                                                                 |
|    - Contrast enhancement & high-pass luminance stretch                                 |
|    - JPEG 0.88 compression (reduces 12MB phone raw to ~650KB)                           |
+-----------------------------------------------------------------------------------------+
                                     |
                          POST /api/imports/ocr
                        (In-Memory Base64 Payload)
                                     v
+-----------------------------------------------------------------------------------------+
|                                    SERVER LAYER                                         |
|                                                                                         |
|  [ Auth & Subscription Check (lib/security/authenticate.js) ]                           |
|                    |                                                                    |
|                    v                                                                    |
|  [ In-Memory Google Vision API Bridge (lib/services/ocr-service.js) ]                    |
|    - Feature: DOCUMENT_TEXT_DETECTION                                                   |
|    - Language Hints: ['rw', 'en', 'fr']                                                 |
|    - JWT Bearer Auth with Google OAuth2 Token Caching (3600s TTL)                       |
|                    |                                                                    |
|                    v                                                                    |
|  [ Geometric Annotation Extractor ]                                                     |
|    - Bounding Box Vertices: { x, y, width, height, confidence }                         |
|    - Word & Symbol Graph Assembly                                                       |
+-----------------------------------------------------------------------------------------+
                                     |
                                     v
+-----------------------------------------------------------------------------------------+
|                               PARSING & HEURISTICS ENGINE                               |
|                                                                                         |
|  [ Line Grouping Engine (lib/imports/text-parsing.js) ]                                 |
|  [ Month & Year Detection (detectNotebookPageMonthYear) ]                               |
|  [ 15-Day Grid Column Corridor Clustering (detectNotebookDateColumns) ]                  |
|  [ Handwritten Shorthand Decoder (parseQuantityToken) ]                                 |
|  [ Name & #Number De-Gluer (splitFarmerNumberAndName) ]                                 |
|  [ Sub-Line Metadata Matcher (Phone, NID, Bank Account) ]                               |
|  [ Multi-Day Alignment Matrix (extractNotebookMultiDay) ]                               |
|  [ Farmer Deterministic & Levenshtein Matching (lib/imports/farmer-matching.js) ]        |
+-----------------------------------------------------------------------------------------+
```

### Server Execution Flow
1. **Endpoint**: `POST /api/imports/ocr` accepts JSON `{ image: "data:image/jpeg;base64,..." }`.
2. **Provider**: `lib/services/ocr-service.js` dispatches to Google Cloud Vision API using `DOCUMENT_TEXT_DETECTION`.
3. **Authentication**:
   - Primary: Google Cloud Service Account (`GOOGLE_VISION_SERVICE_ACCOUNT_JSON` or `GOOGLE_VISION_SERVICE_ACCOUNT_BASE64`), generating RS256-signed JWT assertions exchanged for OAuth2 tokens with 1-hour in-memory caching.
   - Fallback: Direct API Key (`GOOGLE_VISION_API_KEY`).
4. **Data Contract**: Returns pure geometric word nodes `{ text, x, y, width, height, confidence }`.

---

## 2. Field Photo Resilience

Field registers are photographed in uncontrolled rural environments characterized by harsh sunlight, tin-roof shadows, flash hot-spots, skewed camera angles, crumpled paper, and folded notebook spines.

### 2.1 Glare and Contrast Management
- **Client-Side Canvas Normalization** (`lib/imports/client-files.ts`):
  Images are read into an HTML5 `<canvas>` element. When images exceed 2400 pixels along the maximum dimension, they are proportionally downscaled using bi-cubic interpolation. This eliminates high-frequency noise from cheap camera sensors and prevents Google Vision API 413 payload rejections while retaining legibility of pencil and pen strokes.
- **Orientation Normalization**: Mobile cameras frequently write EXIF orientation flags rather than rotating pixel data. The browser canvas pipeline normalizes rotation according to EXIF tags before base64 encoding.

### 2.2 Perspective and Tilt Tolerance
- Rather than relying on fragile homography or four-point quadrilateral transforms (which fail when notebook corners are clipped or occluded by fingers holding the page open), the system utilizes **relative horizontal coordinate tracking**.
- Lines of text are clustered dynamically using vertical centroid proximity (`groupWordsIntoLines` in `lib/imports/text-parsing.js`). Words whose vertical centers fall within 45% of median word height are coalesced into a unified row regardless of moderate angular page tilt.

### 2.3 Handwritten Month Header Identification
The system extracts register-level time coordinates dynamically from the page header (`detectNotebookPageMonthYear` in `lib/imports/notebook.js`):
1. **Tri-Lingual Month Lexicon**: Supports Kinyarwanda (`Mutarama`, `Gashyantare`, `Werurwe`, `Mata`, `Gicurasi`, `Kamena`, `Nyakanga`, `Kanama`, `Nzeli`, `Ukwakira`, `Ugushyingo`, `Ukuboza`, plus traditional numbered variations `Ukwambere`, `Ukwakabiri`, `Kicumi`), English (`January`–`December`), and French (`Janvier`–`Décembre`).
2. **Syntactic Formats**:
   - `UKWEZI KWA MM/YYYY` or `UKWEZI KWA MM YYYY`
   - `[Month Name] [YYYY]` (e.g., `Ukwakira 2026`)
   - Numeric `MM/YYYY` or `YYYY-MM`.
3. **Fallback Anchor**: When no explicit page month is recognized, the pipeline gracefully binds the reference date to the active collection center accounting period (`referenceYearMonth`).

---

## 3. Grid Column Corridor Mathematics

Rwandan milk notebooks typically feature a two-week accounting register (Days 1–15 for the first half of the month, or Days 16–31 for the second half). Each row corresponds to a single milk producer, starting with the producer's ID/Name on the left margin, followed by 15 daily volume cells, and concluding with a row subtotal on the right spine.

```
|<----------------------------- Total Page Width (W) ----------------------------->|
|                                                                                   |
| [Farmer # / Name Margin] | Day 1 | Day 2 | Day 3 | ... | Day 15 | [Subtotal/Spine]|
|                          |<------------- 15 Corridors ---------->|                 |
|       (Left Margin)      |   |   |   |   |   |   |   |   |   |   |  (Right Spine)  |
|         X_start          |             Corridor Spacing S        |      X_end      |
```

### 3.1 Header Discovery & Anchor Points
Header detection (`detectNotebookDateColumns`):
1. Top lines (first 15 lines of words) are scored for date tokens:
   $$\text{Score} = (\text{hasHeaderLabel} \times 10) + (\text{explicitDates} \times 6) + (\text{dateTokens} \times 3)$$
2. Columns are sorted by horizontal coordinate:
   $$X = [x_1, x_2, \dots, x_k] \quad \text{where} \quad x_i = \text{centreOf}(\text{word}_i)$$

### 3.2 Corridor Spacing Calculation
The inter-column interval $S$ (column spacing) is determined using the statistical **median** of adjacent column center distances:
$$\Delta x_i = x_{i+1} - x_i \quad \text{for } \Delta x_i > 4\text{px}$$
$$S = \text{median}(\{\Delta x_1, \Delta x_2, \dots, \Delta x_{k-1}\})$$

### 3.3 Dynamic Column Tolerance
The acceptance corridor around a target column $X_t$ is defined as:
$$\text{Tolerance } T = \max(14\text{px}, \, S \times 0.38)$$
Any quantity token candidate $w_q$ whose center coordinate satisfies:
$$|x(w_q) - X_t| \le T$$
is assigned to date column $X_t$.

If multiple quantity tokens are found within tolerance $T$:
- If vertically separated ($|\Delta y| > 8\text{px}$), they represent **morning and evening split deliveries** for that same day.
- If horizontally adjacent without clear separation, the cell is flagged with status `'ambiguous'` to enforce manual human review.

### 3.4 Right Spine Subtotal Exclusion
Subtotal cells on the right edge often confuse naive OCR parsers. The scanner explicitly filters these out via token grammar:
- Tokens starting with `=`, `)`, `]`, or matching `^(tot|total|sum|t:)/i` are classified as `subtotal` and excluded from daily intake sums.
- Terminal rows matching `SUMMARY_ROW_PATTERN` (`TOTAL`, `RUSANGE`, `YOSE`, `SUBTOTAL`) are peeled off as validation checksums rather than farmer intake rows.

---

## 4. Handwritten Decoder

Milk delivery registers contain diverse handwritten notations, abbreviations, fractional quantities, and zero marks.

### 4.1 Vulgar Fractions & Rwandan Shorthand
Standard milk measures in Rwanda commonly use half-liter and quarter-liter steps. Handwriters use distinct shorthand marks:
- **Rwandan Caret / Apostrophe Shorthand**:
  - `1^`, `1'`, `1’`, `1"`, `1/` $\rightarrow 1.5\text{ Liters}$
  - `2^`, `2'`, `2’`, `2"`, `2/` $\rightarrow 2.5\text{ Liters}$
  - Handled via regex: `/^(\d{1,3})[\^'’"”/]$/` $\rightarrow \text{Number}(match[1]) + 0.5$
- **Vulgar Unicode Fractions**:
  - `½` $\rightarrow .5$, `¼` $\rightarrow .25$, `¾` $\rightarrow .75$
  - Handled via `normalizeQuantityString`.
- **Textual Fractions**:
  - `1/2` $\rightarrow 0.5$, `2 1/2` $\rightarrow 2.5$.

### 4.2 OCR Character Confusion Engine
Numeric OCR frequently confuses handwritten letters with visually identical digits. `correctNumericOcrConfusion` handles common confusions:
- `l` or `I` or `|` at beginning or end $\rightarrow 1$ (e.g., `l.5` $\rightarrow 1.5$, `I.5` $\rightarrow 1.5$)
- `Z` or `z` with decimal stroke $\rightarrow 2$ (e.g., `Z.5` $\rightarrow 2.5$)
- `O` or `o` $\rightarrow 0$ (e.g., `1O` $\rightarrow 10$)
- `S` or `s` $\rightarrow 5$ (e.g., `1S` $\rightarrow 15$)
- `B` $\rightarrow 8$ (e.g., `1B` $\rightarrow 18$)

### 4.3 Affirmative Zero-Delivery vs. Empty Absence
- **No-Delivery Markers**:
  Handwritten hyphens, em-dashes, or crosses (`-`, `—`, `–`, `X`, `x`) indicate that the farmer was present or accounted for, but delivered zero milk ($0\text{ Liters}$).
  These are tagged with:
  `{ value: 0, status: 'ok', isZeroMarker: true }`
  This distinguishes an affirmative zero delivery from an absent/missing record.
- **Literal Zero Digit (`0`, `0.0`)**:
  In physical milk registers, a handwritten `0` frequently indicates an overwritten stroke or correction. It is marked as `unreadable` to prompt visual human confirmation.

### 4.4 Stroke Separation for Dual Sessions
When collectors record both morning and evening milk in a single register cell:
- **Slash or Plus Separator**: `3/2` or `3+2` $\rightarrow \text{Morning: } 3.0\text{ L}, \text{Evening: } 2.0\text{ L}$.
- **Vertical Stacking**: When two digits are detected within the same corridor tolerance $T$ but separated by vertical distance $\Delta y > 8\text{px}$, the upper token is routed to `morning` and the lower token to `evening`.

---

## 5. Farmer Matching & Inline Registration

### 5.1 Name and Number De-Gluing
Handwritten registers frequently omit spaces between the sequence number and the farmer's name. The pipeline executes deterministic splitting (`splitFarmerNumberAndName`):
1. **Case 1: Isolated Prefix**: `#1`, `1.`, `02` followed by name tokens.
2. **Case 2: Glued Prefix**: `1NIYONSABA`, `02MUKAMANA`, `14KAYITARE`
   - Split via regex: `/^#?(\d{1,4})[.)\s\-_]*([A-Za-z\u00C0-\u024F].*)$/`
   - Yields: `farmerNumber: 1` and name token `NIYONSABA`.

### 5.2 Multi-Key Deterministic Matching
`lib/imports/farmer-matching.js` builds an in-memory multi-index across the active collection center's registered farmers:
1. **Primary Match**: Farmer Sequence Number (`farmerNumber`).
2. **National ID Match**: 16-digit Rwandan NID (`119...` / `120...`) extracted from line sub-text.
3. **Phone Match**: 9-digit normalized mobile number (`078...`, `072...`, `073...`).
4. **Exact Normalized Name Match**: Lowercased, diacritics stripped via NFD decomposition.
5. **Fuzzy Levenshtein Fallback**: Normalized similarity score:
   $$\text{Similarity} = 1 - \frac{\text{Levenshtein}(A, B)}{\max(\text{len}(A), \text{len}(B))}$$
   If similarity $\ge 0.85$, the candidate is surfaced in the review UI for one-click human confirmation. The system **never** automatically commits fuzzy matches without review.

### 5.3 Inline Quick Registration
When an unrecognized farmer is detected in the register (e.g., a new farmer who recently joined the route):
1. The row is marked with `status: 'needsMatch'`.
2. The user can click **"Ongeramo Umworozi" (Add Farmer)** directly inside the review table.
3. The farmer is registered on the spot with their detected sequence number and name, immediately updating the review matrix without restarting the scan.

---

## 6. Data Privacy & Ephemeral Processing

Operating in compliance with Rwandan data protection regulations and strict multi-tenant privacy mandates:

1. **Zero Permanent Image Retention**:
   - Uploaded register photos are processed strictly in RAM buffers.
   - **No register images are ever written to the disk, stored in object storage buckets, or logged to disk files.**
   - Once the Google Vision API returns the text coordinates and geometric bounds, the base64 buffer is dereferenced and garbage collected.
2. **Strict Owner Scoping**:
   - All farmer lookups and milk insertion transactions are hard-scoped to the authenticated collector or collection center (`owner_user_id = user.id` or `collection_center_id = activeCenter.id`).
   - Center owners and collectors cannot view, cross-reference, or match farmers belonging to other routes or collection centers.
3. **Audit Trail**:
   - Final reviewed milk insertions record the intake source (`source: 'notebook_ocr'`) and capture the batch checksum, ensuring full traceability back to the accounting date.

---

## 7. Pipeline Summary Table

| Stage | Input | Component | Output |
|---|---|---|---|
| **Capture & Compress** | Raw Mobile Camera (5–15MB) | Browser Canvas 2D | Normalized JPEG (<1MB, max 2400px) |
| **Vision OCR** | Base64 Image Payload | `lib/services/ocr-service.js` | Word token vertices & confidence scores |
| **Grid Corridor Analysis** | Geometric Word Graph | `lib/imports/notebook.js` | 15-day column corridor boundaries & tolerance $T$ |
| **Handwritten Decode** | Cell string tokens | `parseQuantityToken` | Decoded numbers, half-liter fractions, zero markers |
| **Identity Resolution** | Raw name/number tokens | `lib/imports/farmer-matching.js` | Scoped farmer ID, sequence number, NID |
| **Matrix Review UI** | Structured multi-day rows | `components/imports/` | Interactive validation table with 0-error blocking |
| **Ledger Commit** | Approved records | `POST /api/milk` & `/api/milk/daily` | Committed database rows with accounting dates |

---

*Authored by Principal Full-Stack & Systems Reliability Engineering for IHURIRO RY'AMATA.*
