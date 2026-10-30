/**
 * Parses the geometry returned by the OCR provider into notebook rows for one
 * selected date. If the date column cannot be identified unambiguously the row
 * is flagged instead of guessing a quantity.
 */

const { groupWordsIntoLines } = require('./text-parsing.js');

const cleanToken = (value) => String(value ?? '').replace(/^[.,;:()\[\]]+|[.,;:()\[\]]+$/g, '').trim();

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
};

const parseTargetDate = (date) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const parseReferenceYearMonth = (ref) => {
  if (!ref) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  if (typeof ref === 'object' && ref.year && ref.month) {
    return { year: Number(ref.year), month: Number(ref.month) };
  }
  const match = /^(\d{4})[-/.](\d{1,2})/.exec(String(ref));
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]) };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};

const MONTH_NAMES_MAP = {
  // Kinyarwanda
  mutarama: 1, ukwambere: 1,
  gashyantare: 2, ukwakabiri: 2,
  werurwe: 3, ukwagatu: 3,
  mata: 4, ukwakane: 4,
  gicurasi: 5, ukwagatanu: 5,
  kamena: 6, ukugaheza: 6,
  nyakanga: 7, ukwakwirindwi: 7,
  kanama: 8, ukwanani: 8,
  nzeli: 9, ukwacyenda: 9,
  ukwakira: 10, kicumi: 10,
  ugushyingo: 11,
  ukuboza: 12,
  // English
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
  // French
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

/**
 * Detect page-level month and year headers (e.g. 'UKWEZI KWA 10/2026', 'October 2026').
 */
const detectNotebookPageMonthYear = (words) => {
  const list = Array.isArray(words) ? words : (words?.words || []);
  if (!list.length) return null;
  const headerWords = list.slice(0, Math.min(list.length, 60));
  const text = headerWords.map((w) => w.text).join(' ').toLowerCase();

  // Pattern: UKWEZI KWA MM/YYYY or UKWEZI KWA MM YYYY
  let match = /ukwezi\s+kwa\s+(\d{1,2})(?:[/-](\d{4})|\s+(\d{4}))?/i.exec(text);
  if (match) {
    const month = Number(match[1]);
    const year = match[2] || match[3] ? Number(match[2] || match[3]) : new Date().getFullYear();
    if (month >= 1 && month <= 12) return { year, month };
  }

  // Pattern: Month name + Year (e.g. October 2026 or Ukwakira 2026)
  const normText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [name, m] of Object.entries(MONTH_NAMES_MAP)) {
    const regex = new RegExp(`\\b${name}\\b(?:\\s*\\/\\s*|\\s+)?(\\d{4})?`, 'i');
    match = regex.exec(normText);
    if (match) {
      let year = match[1] ? Number(match[1]) : null;
      if (!year) {
        const yearMatch = /\b(20\d{2})\b/.exec(normText);
        if (yearMatch) year = Number(yearMatch[1]);
      }
      return { year: year || new Date().getFullYear(), month: m };
    }
  }

  // Pattern: MM/YYYY or YYYY-MM
  match = /\b(0?[1-9]|1[0-2])[/-](20\d{2})\b/.exec(text);
  if (match) {
    return { year: Number(match[2]), month: Number(match[1]) };
  }
  match = /\b(20\d{2})[/-](0?[1-9]|1[0-2])\b/.exec(text);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  return null;
};

const HEADER_LABELS = new Set([
  'name', 'names', 'farmer', 'farmers', 'izina', 'amazina', 'umworozi', 'aborozi',
  'nom', 'noms', 'nom complet', 'izina ry umworozi', 'amazina y umworozi', 'farmer name',
]);

const isHeaderLabel = (text) => {
  const normalized = cleanToken(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (HEADER_LABELS.has(normalized)) return true;
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length > 0 && parts.every((p) => HEADER_LABELS.has(p) || p === 'ry' || p === 'y' || p === 'ba');
};

const isExplicitDateToken = (text) => {
  const token = cleanToken(text).replace(/\s+/g, '');
  return /^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(token);
};

const looksLikeDateToken = (text) => {
  const token = cleanToken(text).replace(/\s+/g, '');
  return /^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(token) || /^\d{1,2}$/.test(token);
};

const parseDateToken = (text, referenceYearMonth = null) => {
  const token = cleanToken(text).replace(/\s+/g, '');
  if (!token) return null;

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let match = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(token);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        year,
        month,
        day,
        isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(token);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year = 2000 + year;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        year,
        month,
        day,
        isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    }
  }

  // DD/MM or DD-MM or DD.MM
  match = /^(\d{1,2})[./-](\d{1,2})$/.exec(token);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const ref = parseReferenceYearMonth(referenceYearMonth);
      return {
        year: ref.year,
        month,
        day,
        isoDate: `${ref.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    }
  }

  // DD (1..31) with referenceYearMonth
  match = /^(\d{1,2})$/.exec(token);
  if (match) {
    const day = Number(match[1]);
    if (day >= 1 && day <= 31 && referenceYearMonth) {
      const ref = parseReferenceYearMonth(referenceYearMonth);
      return {
        year: ref.year,
        month: ref.month,
        day,
        isoDate: `${ref.year}-${String(ref.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      };
    }
  }

  return null;
};

const tokenMatchesDate = (text, target) => {
  if (!target) return false;
  const token = cleanToken(text);
  if (!token) return false;
  const normalized = token.replace(/\s+/g, '');
  const dateMatch = /^(\d{1,4})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(normalized);
  if (dateMatch) {
    const first = Number(dateMatch[1]);
    const second = Number(dateMatch[2]);
    const third = dateMatch[3] ? Number(dateMatch[3]) : null;
    if (dateMatch[1].length === 4) {
      return first === target.year && second === target.month && (!third || third === target.day);
    }
    const day = first;
    const month = second;
    const year = third && third < 100 ? 2000 + third : third;
    return day === target.day && month === target.month && (!year || year === target.year);
  }
  if (/^\d{1,2}$/.test(normalized)) return Number(normalized) === target.day;
  return false;
};

/**
 * Normalizes vulgar fractions and half-litre shorthands:
 * '2½' -> '2.5', '1^' / '1'' -> '1.5', '2,5' -> '2.5', '1/2' -> '0.5'
 */
const normalizeQuantityString = (str) => {
  let s = String(str ?? '').trim();
  // Strip units
  s = s.replace(/\s*(?:l|lt|ltr|litre|litres|kg)$/i, '').trim();

  // Vulgar fractions
  s = s.replace(/½/g, '.5').replace(/¼/g, '.25').replace(/¾/g, '.75');
  if (s.startsWith('.')) s = '0' + s;

  // Fractions like 1/2 or 2 1/2
  const fracMatch = /^(\d{1,3})?[\s-]*(?:1\/2)$/.exec(s);
  if (fracMatch) {
    const whole = fracMatch[1] ? Number(fracMatch[1]) : 0;
    return String(whole + 0.5);
  }

  // Rwandan half-litre shorthand: 1^, 1', 1’, 1", 1”, 2^, 2', 2’
  const halfMatch = /^(\d{1,3})[\^'’"”/]$/.exec(s);
  if (halfMatch) {
    return String(Number(halfMatch[1]) + 0.5);
  }

  // Comma decimal
  s = s.replace(',', '.');

  return s;
};

/**
 * Corrects typical OCR character confusions in numeric milk quantity cells:
 * 'l.5' -> '1.5', 'I.5' -> '1.5', 'Z.5' -> '2.5', '1O' -> '10', '1S' -> '15', '1B' -> '18'
 */
const correctNumericOcrConfusion = (str) => {
  let s = String(str ?? '').trim();
  if (/^[a-zA-Z0-9.,^'’"”/]+$/.test(s)) {
    // Leading or isolated l / I -> 1
    s = s.replace(/^[lI|](\d|[.,])/g, '1$1');
    s = s.replace(/([0-9])[lI|]$/g, '$11');
    // Z / z -> 2
    s = s.replace(/^[Zz](\d|[.,])/g, '2$1');
    // O / o -> 0
    s = s.replace(/([0-9])[Oo]/g, '$10');
    s = s.replace(/^[Oo]([0-9])/g, '0$1');
    // S / s -> 5
    s = s.replace(/([0-9])[Ss]/g, '$15');
    // B -> 8
    s = s.replace(/([0-9])B/g, '$18');
  }
  return s;
};

/**
 * Parses a single quantity token, handling handwritten shorthand, decimals, fractions,
 * OCR confusions, zero-delivery markers, and subtotal row exclusions.
 */
const parseQuantityToken = (text, session = null) => {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { value: null, status: 'empty', raw: '' };

  // Strip row totals/subtotals at the end of rows: = 30, ) 63, Tot: 30, Total 45
  if (/^[=)\]]/.test(trimmed) || /^(?:tot|total|sum|t:)/i.test(trimmed)) {
    return { value: null, status: 'subtotal', raw: trimmed };
  }

  // Zero-delivery markers (cow gave no milk / absent): -, —, –, X, x
  if (/^[-—–Xx]$/.test(trimmed)) {
    return { value: 0, status: 'ok', raw: trimmed, isZeroMarker: true };
  }

  // Numeric zero '0' in milk register is considered unreadable / requires review
  if (trimmed === '0' || trimmed === '0.0' || trimmed === '0,0') {
    return { value: null, status: 'unreadable', raw: trimmed };
  }

  // Fractions like 1/2, 1/4, 3/4 or 2 1/2
  const fracMatch = /^(\d{1,3})?[\s-]*(?:1\/2|1\/4|3\/4)$/.exec(trimmed);
  if (fracMatch) {
    const whole = fracMatch[1] ? Number(fracMatch[1]) : 0;
    const fracPart = trimmed.endsWith('1/4') ? 0.25 : (trimmed.endsWith('3/4') ? 0.75 : 0.5);
    return { value: whole + fracPart, status: 'ok', raw: trimmed };
  }

  // Dual-session in single cell: e.g. '3/2', '3 / 2', '3+2'
  const dualMatch = /^(\d{1,3}(?:[.,]\d)?)\s*[/+]\s*(\d{1,3}(?:[.,]\d)?)$/.exec(trimmed);
  if (dualMatch) {
    const morningVal = Number(dualMatch[1].replace(',', '.'));
    const eveningVal = Number(dualMatch[2].replace(',', '.'));
    if (session === 'evening') {
      return { value: eveningVal, status: 'ok', raw: trimmed, morningValue: morningVal, eveningValue: eveningVal };
    }
    if (session === 'morning') {
      return { value: morningVal, status: 'ok', raw: trimmed, morningValue: morningVal, eveningValue: eveningVal };
    }
    return { value: morningVal + eveningVal, status: 'ok', raw: trimmed, morningValue: morningVal, eveningValue: eveningVal };
  }

  // Shorthands (1^, 1', 2', 2^) and vulgar fractions (2½, ½)
  const normalized = normalizeQuantityString(trimmed);

  if (/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) {
    const value = Number(normalized);
    if (Number.isFinite(value) && value > 0 && value <= 10000) {
      return { value, status: 'ok', raw: trimmed };
    }
  }

  if (/\d/.test(trimmed) || /[?~]/.test(trimmed)) {
    return { value: null, status: 'unreadable', raw: trimmed };
  }

  return { value: null, status: 'not-quantity', raw: trimmed };
};

const isQuantityLike = (text) => {
  const token = cleanToken(text);
  if (/^[-—–Xx.]$/.test(token)) return true;
  if (/^[=)\]]/.test(token) || /^(?:tot|total|sum|t:)/i.test(token)) return true;
  return /^[\dOoIlSsBbZz?~]+[.,^'’"”/]?[\dOoIlSsBbZz?~]*\s*(?:l|lt|ltr|kg)?$/i.test(token)
    || /^[\dOoIlSsBbZz]+[\s]*[/+][\s]*[\dOoIlSsBbZz]+/i.test(token);
};

const centreOf = (word) => word.x + word.width / 2;
const confidenceOf = (words) => {
  const values = words.map((word) => word.confidence).filter((value) => Number.isFinite(value));
  return values.length ? Math.min(...values) : null;
};

/**
 * Splits '#Number + Name' (e.g. '1NIYONSABA' -> { farmerNumber: 1, name: 'NIYONSABA' },
 * '1. NIYONSABA' -> { farmerNumber: 1, name: 'NIYONSABA' }).
 */
const splitFarmerNumberAndName = (firstWord, subsequentWords = []) => {
  const rawText = cleanToken(firstWord?.text || '');

  // Case 1: Separate leading number token e.g. '1', '#1', '02', '1.'
  const numOnlyMatch = /^#?(\d{1,4})[.)]?$/.exec(rawText);
  if (numOnlyMatch && subsequentWords.length > 0) {
    const farmerNumber = Number(numOnlyMatch[1]);
    return { farmerNumber, nameWords: subsequentWords, rawPrefix: rawText };
  }

  // Case 2: Glued digits + letters e.g. '1NIYONSABA', '02MUKAMANA', '14KAYITARE', '1.NIYONSABA'
  const gluedMatch = /^#?(\d{1,4})[.)\s\-_]*([A-Za-z\u00C0-\u024F].*)$/.exec(rawText);
  if (gluedMatch) {
    const farmerNumber = Number(gluedMatch[1]);
    const splitWord = {
      ...firstWord,
      text: gluedMatch[2],
      x: firstWord.x + (firstWord.width * 0.25),
      width: firstWord.width * 0.75,
    };
    return { farmerNumber, nameWords: [splitWord, ...subsequentWords], rawPrefix: gluedMatch[1] };
  }

  // Case 3: No leading number
  return { farmerNumber: null, nameWords: [firstWord, ...subsequentWords], rawPrefix: '' };
};

/**
 * Detect all date columns present on a register page.
 */
const detectNotebookDateColumns = (ocrResult, referenceYearMonth = null) => {
  const words = Array.isArray(ocrResult) ? ocrResult : (ocrResult?.words || []);
  if (!words.length) return [];

  // If no referenceYearMonth provided, attempt to detect page-level month/year
  const resolvedRef = referenceYearMonth || detectNotebookPageMonthYear(words);

  const lines = groupWordsIntoLines(words);
  if (!lines.length) return [];

  let bestHeader = null;
  let bestScore = 0;

  for (let index = 0; index < Math.min(lines.length, 15); index += 1) {
    const line = lines[index];
    const lineWords = line.words;
    const hasLabel = lineWords.some((word) => isHeaderLabel(word.text)) || isHeaderLabel(line.text);
    const explicitDates = lineWords.filter((word) => isExplicitDateToken(word.text));
    const dateTokens = lineWords.filter((word) => looksLikeDateToken(word.text));

    let score = 0;
    if (hasLabel) score += 10;
    score += explicitDates.length * 6;
    if (hasLabel) {
      score += (dateTokens.length - explicitDates.length) * 3;
    }

    const isValidHeader = explicitDates.length >= 2
      || (hasLabel && explicitDates.length >= 1)
      || (hasLabel && dateTokens.length >= 2);

    if (isValidHeader && score > bestScore) {
      bestScore = score;
      bestHeader = line;
    }
  }

  if (!bestHeader) return [];

  const columns = [];
  for (const word of bestHeader.words) {
    const parsed = parseDateToken(word.text, resolvedRef);
    if (!parsed) continue;
    const x = centreOf(word);
    const duplicate = columns.find((c) => Math.abs(c.x - x) < 6 || c.isoDate === parsed.isoDate);
    if (duplicate) {
      if ((word.confidence ?? 0) > (duplicate.confidence ?? 0)) {
        duplicate.raw = cleanToken(word.text);
        duplicate.x = x;
        duplicate.confidence = Number.isFinite(word.confidence) ? word.confidence : duplicate.confidence;
      }
      continue;
    }
    columns.push({
      isoDate: parsed.isoDate,
      raw: cleanToken(word.text),
      x,
      confidence: Number.isFinite(word.confidence) ? word.confidence : null,
      width: word.width,
      y: word.y,
    });
  }

  columns.sort((a, b) => a.x - b.x);
  return columns;
};

/**
 * Extracts sub-line metadata (phone, national ID, account number) from a text line.
 */
const extractSublineMetadata = (lineText) => {
  const text = String(lineText || '').trim();
  if (!text) return null;

  let phone = null;
  let nationalId = null;
  let accountNumber = null;

  // Phone pattern
  const phoneMatch = /\b(?:07[2389]\d{7}|\+?2507[2389]\d{7}|\+?\d{9,14})\b/.exec(text);
  if (phoneMatch) phone = phoneMatch[0];

  // National ID pattern: 16 digits or labeled
  const idMatch = /\b(119\d{13}|120\d{13}|\d{16})\b/.exec(text)
    || /(?:id|nid|indangamuntu)[:\s]*([0-9A-Za-z]+)/i.exec(text);
  if (idMatch) nationalId = idMatch[1] || idMatch[0];

  // Account number pattern
  const accMatch = /(?:acc|account|konti|compte)[:\s]*([0-9\-]+)/i.exec(text);
  if (accMatch) accountNumber = accMatch[1];

  if (phone || nationalId || accountNumber) {
    return { phone, nationalId, accountNumber };
  }
  return null;
};

const parseNotebookPage = ({
  words,
  targetDate,
  targetX = null,
  selectedColumn = null,
  referenceYearMonth = null,
  session = null,
} = {}) => {
  const pageMonthYear = detectNotebookPageMonthYear(words);
  const effectiveRef = referenceYearMonth || pageMonthYear || targetDate;

  const resolvedTarget = typeof targetDate === 'string'
    ? parseTargetDate(targetDate) || parseDateToken(targetDate, effectiveRef)
    : targetDate;
  const lines = groupWordsIntoLines(words);
  if (!lines.length) {
    return {
      entries: [],
      dateColumnFound: false,
      headerText: '',
      lineCount: 0,
      targetDate: targetDate || null,
      businessDate: targetDate || null,
      detectedColumns: [],
    };
  }

  const detectedColumns = detectNotebookDateColumns(words, effectiveRef);

  let header = null;
  let targetWord = null;
  let dateCount = 0;
  let headerIndex = -1;

  for (let index = 0; index < Math.min(lines.length, 15); index += 1) {
    const line = lines[index];
    const lineWords = line.words;
    const dates = lineWords.filter((word) => tokenMatchesDate(word.text, resolvedTarget));
    if (!dates.length) continue;
    const dateTokens = lineWords.filter((word) => looksLikeDateToken(word.text));
    const hasLabel = lineWords.some((word) => isHeaderLabel(word.text)) || isHeaderLabel(line.text);
    if (dateTokens.length < 2 || !hasLabel) continue;
    if (!header || dateTokens.length > dateCount) {
      header = lines[index];
      headerIndex = index;
      dateCount = dateTokens.length;
      targetWord = dates[0];
    }
  }

  let dateColumnFound = Boolean(header && targetWord && dateCount > 1);
  let resolvedX = targetX;
  let matchedCol = selectedColumn;

  if (!dateColumnFound && detectedColumns.length > 0) {
    if (selectedColumn && Number.isFinite(selectedColumn.x)) {
      matchedCol = selectedColumn;
      resolvedX = selectedColumn.x;
      dateColumnFound = true;
    } else if (resolvedTarget) {
      const targetIso = `${resolvedTarget.year}-${String(resolvedTarget.month).padStart(2, '0')}-${String(resolvedTarget.day).padStart(2, '0')}`;
      const found = detectedColumns.find((c) => c.isoDate === targetIso
        || tokenMatchesDate(c.raw, resolvedTarget)
        || c.raw === String(targetDate));
      if (found) {
        matchedCol = found;
        resolvedX = found.x;
        dateColumnFound = true;
      }
    }
  }

  const finalTargetX = dateColumnFound ? (resolvedX ?? (targetWord ? centreOf(targetWord) : null)) : null;

  const headerDateCentres = detectedColumns.length > 0
    ? detectedColumns.map((c) => c.x).sort((a, b) => a - b)
    : (header
      ? header.words.filter((word) => looksLikeDateToken(word.text))
        .map(centreOf)
        .sort((a, b) => a - b)
      : []);

  const gaps = [];
  for (let index = 1; index < headerDateCentres.length; index += 1) {
    const gap = headerDateCentres[index] - headerDateCentres[index - 1];
    if (gap > 4) gaps.push(gap);
  }
  const columnSpacing = median(gaps);
  const tolerance = columnSpacing ? Math.max(14, columnSpacing * 0.38) : 24;

  const isHeaderOnlyLine = (line) => {
    const lineWords = line.words;
    if (!lineWords.length) return false;
    const hasLabel = lineWords.some((word) => isHeaderLabel(word.text)) || isHeaderLabel(line.text);
    return hasLabel && lineWords.every((word) => isHeaderLabel(word.text) || isHeaderLabel(line.text) || looksLikeDateToken(word.text));
  };

  const entries = [];
  let startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
  if (headerIndex < 0 && lines[0] && isHeaderOnlyLine(lines[0])) startIndex = 1;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const lineWords = line.words;
    const text = line.text.trim();
    if (!lineWords.length) continue;

    // Check if this line is subline metadata for the previous farmer entry (e.g. phone or national ID)
    const sublineMeta = extractSublineMetadata(text);
    const hasLetters = /[a-zA-Z\u00C0-\u024F]{2,}/.test(text);
    if (sublineMeta && !hasLetters && entries.length > 0) {
      const prevEntry = entries[entries.length - 1];
      if (sublineMeta.phone && !prevEntry.detectedPhone) prevEntry.detectedPhone = sublineMeta.phone;
      if (sublineMeta.nationalId && !prevEntry.detectedNationalId) prevEntry.detectedNationalId = sublineMeta.nationalId;
      if (sublineMeta.accountNumber && !prevEntry.detectedAccountNumber) prevEntry.detectedAccountNumber = sublineMeta.accountNumber;
      continue;
    }

    // Split #Number and Name (handles '1NIYONSABA', '02MUKAMANA', '1. NIYONSABA', '1', 'NIYONSABA')
    const { farmerNumber, nameWords: splitWords } = splitFarmerNumberAndName(
      lineWords[0],
      lineWords.slice(1)
    );

    const nameWords = [];
    for (let wIdx = 0; wIdx < splitWords.length; wIdx += 1) {
      const word = splitWords[wIdx];
      const token = cleanToken(word.text);
      if (isQuantityLike(token)) {
        break;
      }
      if (/^\d+$/.test(token) && !/[a-zA-Z]/i.test(token)) {
        break;
      }
      nameWords.push(word);
    }

    if (!nameWords.length) continue;
    const name = nameWords.map((word) => cleanToken(word.text)).join(' ').trim();
    if (!/[a-zA-Z\u00C0-\u024F]/.test(name)) continue;

    const lastWord = nameWords[nameWords.length - 1];
    const lastIndex = lineWords.indexOf(lastWord);
    const remainingWords = lastIndex >= 0 ? lineWords.slice(lastIndex + 1) : lineWords.slice(1);
    const quantityWords = remainingWords.filter((word) => isQuantityLike(word.text));

    let selected = null;
    let selectedEvening = null;
    let quantityStatus = 'unreadable';
    let usedColumn = dateColumnFound && finalTargetX !== null;

    if (usedColumn) {
      const near = quantityWords
        .map((word) => ({ word, distance: Math.abs(centreOf(word) - finalTargetX) }))
        .filter((entry) => entry.distance <= tolerance)
        .sort((left, right) => left.distance - right.distance);

      if (near.length === 1 || (near.length > 1 && near[0].distance + 6 < near[1].distance)) {
        selected = near[0].word;
      } else if (near.length === 2 && Math.abs(near[0].word.y - near[1].word.y) > 8) {
        // Vertically stacked dual sessions under the same column!
        const sortedY = [...near].sort((a, b) => a.word.y - b.word.y);
        selected = session === 'evening' ? sortedY[1].word : sortedY[0].word;
        selectedEvening = sortedY[1].word;
      } else if (near.length > 1) {
        quantityStatus = 'ambiguous';
      }
    } else if (quantityWords.length === 1) {
      selected = quantityWords[0];
      usedColumn = false;
    } else if (quantityWords.length === 2 && Math.abs(quantityWords[0].y - quantityWords[1].y) > 8) {
      const sortedY = [...quantityWords].sort((a, b) => a.y - b.y);
      selected = session === 'evening' ? sortedY[1] : sortedY[0];
      selectedEvening = sortedY[1];
      usedColumn = false;
    } else if (quantityWords.length > 1) {
      quantityStatus = 'ambiguous';
    }

    const parsed = selected
      ? parseQuantityToken(selected.text, session)
      : { value: null, status: 'unreadable', raw: '' };

    let status = quantityStatus;
    if (selected && parsed.status === 'ok' && quantityStatus !== 'ambiguous') {
      const quantityConfidence = confidenceOf([selected]);
      const nameConfidence = confidenceOf(nameWords);
      const lowConfidence = (quantityConfidence !== null && quantityConfidence < 0.72)
        || (nameConfidence !== null && nameConfidence < 0.6);
      status = lowConfidence || !usedColumn ? 'uncertain' : 'ok';
    } else if (selected && parsed.status === 'subtotal') {
      status = 'unreadable';
    } else if (selected && parsed.status !== 'ok') {
      status = 'unreadable';
    }

    const confidenceCandidates = [
      confidenceOf(nameWords),
      selected ? confidenceOf([selected]) : null,
    ].filter((value) => value !== null);
    const confidence = confidenceCandidates.length ? Math.min(...confidenceCandidates) : null;

    const rowBusinessDate = matchedCol?.isoDate
      || (targetWord ? parseDateToken(targetWord.text, targetDate)?.isoDate : null)
      || targetDate
      || null;

    const rawQty = selected
      ? cleanToken(selected.text).replace(/\s*(?:l|lt|ltr|litre|litres|kg)$/i, '')
      : '';

    const eveningParsed = selectedEvening ? parseQuantityToken(selectedEvening.text, 'evening') : null;

    entries.push({
      rowNumber: entries.length + 1,
      farmerNumber: farmerNumber || null,
      rawText: text,
      name,
      nameRaw: text.split(/\s{2,}|\t/)[0] || name,
      quantity: parsed.status === 'ok' ? parsed.value : null,
      quantityRaw: parsed.status === 'ok' ? String(parsed.value) : rawQty,
      morningQuantity: parsed.morningValue !== undefined ? parsed.morningValue : (session === 'morning' ? parsed.value : null),
      eveningQuantity: parsed.eveningValue !== undefined ? parsed.eveningValue : (eveningParsed?.value ?? (session === 'evening' ? parsed.value : null)),
      status,
      confidence,
      dateColumnFound: Boolean(usedColumn),
      dateRequiresConfirmation: !usedColumn || (matchedCol?.confidence !== null && matchedCol?.confidence !== undefined && matchedCol.confidence < 0.72),
      businessDate: rowBusinessDate,
      detectedPhone: null,
      detectedNationalId: null,
      detectedAccountNumber: null,
      x: nameWords[0]?.x ?? 0,
      y: line.y,
      words: lineWords,
    });
  }

  const { SUMMARY_ROW_PATTERN } = require('./text-parsing.js');
  const cleanEntries = [];
  let checksum = null;
  const startCheck = Math.max(0, entries.length - 3);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (i >= startCheck && SUMMARY_ROW_PATTERN.test(entry.name)) {
      checksum = {
        checksumLiters: entry.quantity || null,
        rawEntry: entry,
      };
    } else {
      cleanEntries.push(entry);
    }
  }

  const authoritativeBusinessDate = matchedCol?.isoDate
    || (targetWord ? parseDateToken(targetWord.text, targetDate)?.isoDate : null)
    || targetDate
    || null;

  return {
    entries: cleanEntries,
    checksum: checksum || null,
    dateColumnFound,
    headerText: header?.text || '',
    lineCount: lines.length,
    targetDate: targetDate || null,
    businessDate: authoritativeBusinessDate,
    columnTolerance: tolerance,
    detectedColumns,
    selectedColumn: matchedCol || (targetWord ? {
      isoDate: authoritativeBusinessDate,
      raw: cleanToken(targetWord.text),
      x: centreOf(targetWord),
      confidence: Number.isFinite(targetWord.confidence) ? targetWord.confidence : null,
    } : null),
  };
};

const roundLitres = (value) => Math.round(value * 100) / 100;

const DAY_STATUS_RANK = { ok: 0, uncertain: 1, ambiguous: 2, unreadable: 3 };

/**
 * Extracts every selected date column of a register page in one pass.
 *
 * Business dates come exclusively from the physical register's column headers
 * (never from the scan date). Each returned row is aligned across all columns:
 * { farmerNumber, detectedName, sublineMetadata, dailyVolumes, totalPeriodLiters }
 * where dailyVolumes is keyed by ISO date and holds { morning, evening, total }.
 * Half-litre shorthand (1^, 2') is normalised by parseQuantityToken and the
 * zero markers (-, X) yield 0 L with `missed: true`.
 *
 * Column selection (first match wins): options.columns (detected column objects),
 * options.dates (ISO dates), options.range ({ from, to } ISO dates), otherwise
 * every detected column.
 */
const extractNotebookMultiDay = (ocrResult, options = {}, referenceYearMonth = null) => {
  const words = Array.isArray(ocrResult) ? ocrResult : (ocrResult?.words || []);
  const pageMonthYear = detectNotebookPageMonthYear(words);
  const effectiveRef = referenceYearMonth || pageMonthYear || null;
  const detectedColumns = detectNotebookDateColumns(words, effectiveRef);

  let columns = detectedColumns;
  if (Array.isArray(options.columns) && options.columns.length) {
    columns = options.columns
      .map((selected) => detectedColumns.find((c) => c.isoDate === (selected.isoDate || selected))
        || (selected && Number.isFinite(selected.x) && selected.isoDate ? selected : null))
      .filter(Boolean);
  } else if (Array.isArray(options.dates) && options.dates.length) {
    const wanted = new Set(options.dates);
    columns = detectedColumns.filter((c) => wanted.has(c.isoDate));
  } else if (options.range && options.range.from && options.range.to) {
    columns = detectedColumns.filter((c) => c.isoDate >= options.range.from && c.isoDate <= options.range.to);
  }
  columns = [...columns].sort((a, b) => (a.isoDate < b.isoDate ? -1 : a.isoDate > b.isoDate ? 1 : 0));

  const dates = columns.map((c) => c.isoDate);
  const rows = [];

  columns.forEach((column) => {
    const parsed = parseNotebookPage({
      words,
      targetDate: column.isoDate,
      targetX: column.x,
      selectedColumn: column,
      referenceYearMonth: effectiveRef || column.isoDate,
      session: 'morning',
    });

    parsed.entries.forEach((entry, index) => {
      if (!rows[index]) {
        rows[index] = {
          rowNumber: index + 1,
          farmerNumber: entry.farmerNumber ?? null,
          detectedName: entry.name,
          nameRaw: entry.nameRaw,
          sublineMetadata: {
            phone: entry.detectedPhone || null,
            nationalId: entry.detectedNationalId || null,
            accountNumber: entry.detectedAccountNumber || null,
          },
          dailyVolumes: {},
          dayStatuses: {},
          status: 'ok',
          totalPeriodLiters: 0,
          y: entry.y,
        };
      }
      const row = rows[index];
      const morningRaw = entry.morningQuantity;
      const eveningRaw = entry.eveningQuantity;
      const hasValue = entry.quantity !== null && entry.quantity !== undefined;
      const morning = hasValue ? roundLitres(Number(morningRaw ?? entry.quantity)) : null;
      const evening = hasValue ? roundLitres(Number(eveningRaw ?? 0)) : null;
      const total = hasValue ? roundLitres(morning + evening) : null;
      row.dailyVolumes[column.isoDate] = {
        morning,
        evening,
        total,
        missed: hasValue && total === 0,
        raw: entry.quantityRaw || '',
        status: entry.status,
      };
      row.dayStatuses[column.isoDate] = entry.status;
      if ((DAY_STATUS_RANK[entry.status] ?? 3) > (DAY_STATUS_RANK[row.status] ?? 0)) row.status = entry.status;
      if (total !== null) row.totalPeriodLiters = roundLitres(row.totalPeriodLiters + total);
      if (!row.sublineMetadata.phone && entry.detectedPhone) row.sublineMetadata.phone = entry.detectedPhone;
      if (!row.sublineMetadata.nationalId && entry.detectedNationalId) row.sublineMetadata.nationalId = entry.detectedNationalId;
      if (!row.sublineMetadata.accountNumber && entry.detectedAccountNumber) row.sublineMetadata.accountNumber = entry.detectedAccountNumber;
    });
  });

  const rawRows = rows.filter(Boolean);
  const { SUMMARY_ROW_PATTERN: MULTI_SUMMARY_PATTERN } = require('./text-parsing.js');
  const cleanRows = [];
  let checksum = null;
  const startCheck = Math.max(0, rawRows.length - 3);
  for (let i = 0; i < rawRows.length; i += 1) {
    const r = rawRows[i];
    if (i >= startCheck && MULTI_SUMMARY_PATTERN.test(r.detectedName)) {
      checksum = {
        checksumLiters: r.totalPeriodLiters || null,
        rawRow: r,
      };
    } else {
      cleanRows.push(r);
    }
  }

  const result = cleanRows.filter(Boolean);
  return Object.assign(result, {
    multiDay: true,
    dates,
    columns,
    detectedColumns,
    dateColumnFound: columns.length > 0,
    checksum: checksum || null,
  });
};

const normalizeNameForStitching = (name) => String(name ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Merges multi-day register results from two pages (e.g. Left Page Days 1-15, Right Page Days 16-30).
 * Aligns rows by matching #farmerNumber and farmer name between the two pages,
 * then merges the daily columns into a single complete monthly ledger row for each farmer.
 */
const stitchNotebookMultiDay = (leftResult, rightResult) => {
  if (!leftResult && !rightResult) return Object.assign([], { multiDay: true, dates: [], columns: [], detectedColumns: [], dateColumnFound: false });
  if (!leftResult) return rightResult;
  if (!rightResult) return leftResult;

  const allDatesSet = new Set([...(leftResult.dates || []), ...(rightResult.dates || [])]);
  const dates = Array.from(allDatesSet).sort();

  const colMap = new Map();
  for (const c of [...(leftResult.columns || []), ...(rightResult.columns || [])]) {
    if (c && c.isoDate && !colMap.has(c.isoDate)) colMap.set(c.isoDate, c);
  }
  const columns = Array.from(colMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const detMap = new Map();
  for (const c of [...(leftResult.detectedColumns || []), ...(rightResult.detectedColumns || [])]) {
    if (c && c.isoDate && !detMap.has(c.isoDate)) detMap.set(c.isoDate, c);
  }
  const detectedColumns = Array.from(detMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const leftRows = Array.isArray(leftResult) ? leftResult : [];
  const rightRows = Array.isArray(rightResult) ? rightResult : [];

  const matchedRightIndices = new Set();
  const mergedRows = [];

  for (const leftRow of leftRows) {
    let matchedRightIndex = -1;

    // 1. Match by farmerNumber if present on both
    if (leftRow.farmerNumber !== null && leftRow.farmerNumber !== undefined) {
      for (let j = 0; j < rightRows.length; j += 1) {
        if (!matchedRightIndices.has(j) && rightRows[j].farmerNumber === leftRow.farmerNumber) {
          matchedRightIndex = j;
          break;
        }
      }
    }

    // 2. Match by exact normalized name
    if (matchedRightIndex === -1) {
      const leftNorm = normalizeNameForStitching(leftRow.detectedName);
      if (leftNorm) {
        for (let j = 0; j < rightRows.length; j += 1) {
          if (!matchedRightIndices.has(j)) {
            const rightNorm = normalizeNameForStitching(rightRows[j].detectedName);
            if (rightNorm && rightNorm === leftNorm) {
              matchedRightIndex = j;
              break;
            }
          }
        }
      }
    }

    // 3. Match by partial/token overlap if name has 4+ characters
    if (matchedRightIndex === -1) {
      const leftNorm = normalizeNameForStitching(leftRow.detectedName);
      if (leftNorm.length >= 4) {
        for (let j = 0; j < rightRows.length; j += 1) {
          if (!matchedRightIndices.has(j)) {
            const rightNorm = normalizeNameForStitching(rightRows[j].detectedName);
            if (rightNorm.length >= 4) {
              if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) {
                matchedRightIndex = j;
                break;
              }
            }
          }
        }
      }
    }

    if (matchedRightIndex !== -1) {
      matchedRightIndices.add(matchedRightIndex);
      const rightRow = rightRows[matchedRightIndex];
      const mergedDailyVolumes = { ...(leftRow.dailyVolumes || {}), ...(rightRow.dailyVolumes || {}) };
      const mergedDayStatuses = { ...(leftRow.dayStatuses || {}), ...(rightRow.dayStatuses || {}) };

      let totalLiters = 0;
      for (const d of dates) {
        const v = mergedDailyVolumes[d];
        if (v && typeof v.total === 'number' && Number.isFinite(v.total)) {
          totalLiters = roundLitres(totalLiters + v.total);
        }
      }

      let status = leftRow.status || 'ok';
      if ((DAY_STATUS_RANK[rightRow.status] ?? 0) > (DAY_STATUS_RANK[status] ?? 0)) {
        status = rightRow.status;
      }

      mergedRows.push({
        rowNumber: mergedRows.length + 1,
        farmerNumber: leftRow.farmerNumber ?? rightRow.farmerNumber ?? null,
        detectedName: leftRow.detectedName || rightRow.detectedName || '',
        nameRaw: leftRow.nameRaw || rightRow.nameRaw || '',
        sublineMetadata: {
          phone: leftRow.sublineMetadata?.phone || rightRow.sublineMetadata?.phone || null,
          nationalId: leftRow.sublineMetadata?.nationalId || rightRow.sublineMetadata?.nationalId || null,
          accountNumber: leftRow.sublineMetadata?.accountNumber || rightRow.sublineMetadata?.accountNumber || null,
        },
        dailyVolumes: mergedDailyVolumes,
        dayStatuses: mergedDayStatuses,
        status,
        totalPeriodLiters: totalLiters,
        y: leftRow.y ?? rightRow.y ?? 0,
      });
    } else {
      mergedRows.push({
        ...leftRow,
        rowNumber: mergedRows.length + 1,
      });
    }
  }

  // Append remaining rightRows that were not matched
  for (let j = 0; j < rightRows.length; j += 1) {
    if (!matchedRightIndices.has(j)) {
      mergedRows.push({
        ...rightRows[j],
        rowNumber: mergedRows.length + 1,
      });
    }
  }

  // Strip summary rows (TOTAL, IGITERANYO) in the last 3 rows if present
  const { SUMMARY_ROW_PATTERN: STITCH_SUMMARY_PATTERN } = require('./text-parsing.js');
  const cleanMergedRows = [];
  const startCheckStitch = Math.max(0, mergedRows.length - 3);
  let checksum = null;
  for (let i = 0; i < mergedRows.length; i += 1) {
    const r = mergedRows[i];
    if (i >= startCheckStitch && STITCH_SUMMARY_PATTERN.test(r.detectedName)) {
      checksum = {
        checksumLiters: r.totalPeriodLiters || null,
        rawRow: r,
      };
    } else {
      cleanMergedRows.push(r);
    }
  }

  return Object.assign(cleanMergedRows, {
    multiDay: true,
    dates,
    columns,
    detectedColumns,
    dateColumnFound: columns.length > 0,
    checksum: checksum || leftResult.checksum || rightResult.checksum || null,
  });
};

const stitchNotebookPages = (pagesOcr, options = {}, referenceYearMonth = null) => {
  if (!Array.isArray(pagesOcr) || !pagesOcr.length) {
    return Object.assign([], { multiDay: true, dates: [], columns: [], detectedColumns: [], dateColumnFound: false });
  }
  const pageResults = pagesOcr.map((page) => extractNotebookMultiDay(page, options, referenceYearMonth));
  if (pageResults.length === 1) return pageResults[0];
  let acc = pageResults[0];
  for (let i = 1; i < pageResults.length; i += 1) {
    acc = stitchNotebookMultiDay(acc, pageResults[i]);
  }
  return acc;
};

const extractNotebookEntries = (ocrResult, selectedDateOrColumn, referenceYearMonth = null, options = null) => {
  if (selectedDateOrColumn && typeof selectedDateOrColumn === 'object' && selectedDateOrColumn.multiDay) {
    return extractNotebookMultiDay(ocrResult, selectedDateOrColumn, referenceYearMonth);
  }
  if (options && options.multiDay) {
    return extractNotebookMultiDay(ocrResult, options, referenceYearMonth);
  }
  const words = Array.isArray(ocrResult) ? ocrResult : (ocrResult?.words || []);
  let targetDate = null;
  let targetX = null;
  let selectedColumn = null;
  let session = null;

  if (typeof selectedDateOrColumn === 'string') {
    targetDate = selectedDateOrColumn;
  } else if (selectedDateOrColumn && typeof selectedDateOrColumn === 'object') {
    selectedColumn = selectedDateOrColumn;
    targetDate = selectedDateOrColumn.isoDate || selectedDateOrColumn.raw || selectedDateOrColumn.date || null;
    targetX = Number.isFinite(selectedDateOrColumn.x) ? selectedDateOrColumn.x : null;
    session = selectedDateOrColumn.session || null;
  }

  const parsed = parseNotebookPage({
    words,
    targetDate,
    targetX,
    selectedColumn,
    referenceYearMonth: referenceYearMonth || targetDate,
    session,
  });

  const result = Object.assign([...parsed.entries], parsed);
  return result;
};

module.exports = {
  detectNotebookDateColumns,
  detectNotebookPageMonthYear,
  extractNotebookEntries,
  extractNotebookMultiDay,
  stitchNotebookMultiDay,
  stitchNotebookPages,
  parseNotebookPage,
  parseTargetDate,
  parseDateToken,
  tokenMatchesDate,
  parseQuantityToken,
  splitFarmerNumberAndName,
  extractSublineMetadata,
  normalizeQuantityString,
  correctNumericOcrConfusion,
};
