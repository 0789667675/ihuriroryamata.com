/**
 * Small, dependency-free helpers for turning pasted text, CSV, TSV and OCR
 * lines into reviewable rows. These run in the browser and in Node tests; they
 * never persist or log the source text.
 */

const normalizeHeader = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const FIELD_ALIASES = {
  name: [
    'name', 'farmer', 'farmer name', 'full name', 'amazina', 'izina', 'umworozi',
    'umworozi name', 'nom', 'nom complet', 'abacunda', 'umukiriya',
  ],
  phone: [
    'phone', 'phone number', 'telephone', 'telephone number', 'tel', 'telefone',
    'mobile', 'mobile number', 'nimero', 'nimero ya telefone', 'numero',
  ],
  nationalId: [
    'national id', 'nationalid', 'national identity', 'identity', 'id', 'id number',
    'indangamuntu', 'nimero y indangamuntu', 'nimero yindangamuntu', 'nid',
  ],
  accountNumber: [
    'account number', 'account no', 'account', 'acct', 'acct number', 'konti',
    'nimero ya konti', 'numero de compte',
  ],
  collectionCenter: [
    'collection center', 'collection centre', 'center', 'centre', 'site', 'ikigo',
    'ikigo cy amata', 'ikigo cyamata', 'dairy',
  ],
  cowType: [
    'cow type', 'cattle type', 'breed', 'inka', 'ubwoko bw inka', 'ubwoko',
  ],
};

const FIELD_ORDER = ['name', 'phone', 'nationalId', 'accountNumber', 'collectionCenter', 'cowType'];

const headerField = (value) => {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  for (const field of FIELD_ORDER) {
    if (FIELD_ALIASES[field].includes(normalized)) return field;
  }
  return null;
};

const detectDelimiter = (text) => {
  const sample = String(text ?? '').split(/\r?\n/).slice(0, 12).join('\n');
  if (sample.includes('\t')) return '\t';
  const counts = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
  };
  if (counts[';'] > counts[',']) return ';';
  return ',';
};

/** RFC-4180-ish parser with quote handling. Returns rows of strings. */
const parseDelimited = (text, delimiter) => {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const separator = delimiter || detectDelimiter(source);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
};

const splitLooseLine = (line) => {
  if (line.includes('\t')) return line.split('\t').map((value) => value.trim());
  if (line.includes(';') && !line.includes(',')) return line.split(';').map((value) => value.trim());
  if (line.includes(',')) return parseDelimited(line)[0] || [];
  const blocks = String(line).split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
  return blocks.length > 1 ? blocks : [String(line).trim()];
};

/**
 * Parse plain text into a table. Delimited text keeps its columns; a plain
 * one-name-per-line list becomes a single-column table.
 */
const parseTextRows = (text) => {
  const source = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!source) return [];
  const tabCount = (source.match(/\t/g) || []).length;
  const commaCount = (source.match(/,/g) || []).length;
  const semicolonCount = (source.match(/;/g) || []).length;
  if (tabCount || commaCount || semicolonCount) {
    return parseDelimited(source, detectDelimiter(source));
  }
  return source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitLooseLine);
};

const mapHeaderRow = (row) => {
  const mapping = {};
  (Array.isArray(row) ? row : []).forEach((cell, index) => {
    const field = headerField(cell);
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  return mapping;
};

const detectHeader = (rows) => {
  if (!Array.isArray(rows) || !rows.length) return { hasHeader: false, mapping: {} };
  const mapping = mapHeaderRow(rows[0]);
  const matches = Object.keys(mapping).length;
  if (matches >= 2 || (matches === 1 && rows[0].length === 1)) {
    return { hasHeader: true, mapping };
  }
  return { hasHeader: false, mapping: {} };
};

const positionalMapping = (width) => {
  const mapping = {};
  FIELD_ORDER.forEach((field, index) => {
    if (index < width) mapping[field] = index;
  });
  return mapping;
};

const mapRows = (rows, mapping, startIndex = 0) => {
  const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  const safeMapping = mapping && Object.keys(mapping).length ? mapping : positionalMapping(width);
  return rows.slice(startIndex).map((row) => {
    const values = Array.isArray(row) ? row : [];
    const record = {};
    FIELD_ORDER.forEach((field) => {
      const index = safeMapping[field];
      record[field] = index === undefined || index === null ? '' : String(values[index] ?? '').trim();
    });
    return record;
  });
};

/**
 * Group OCR words (Google Vision supplies x/y/width/height) into text lines.
 * Words are clustered by vertical centre and sorted left-to-right.
 */
const groupWordsIntoLines = (words) => {
  const safeWords = (Array.isArray(words) ? words : [])
    .filter((word) => word && String(word.text ?? '').trim())
    .map((word) => ({
      text: String(word.text).trim(),
      x: Number(word.x) || 0,
      y: Number(word.y) || 0,
      width: Number(word.width) || 0,
      height: Number(word.height) || 0,
      confidence: Number.isFinite(Number(word.confidence)) ? Number(word.confidence) : null,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (!safeWords.length) return [];

  const heights = safeWords.map((word) => word.height).filter((height) => height > 0).sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
  const tolerance = Math.max(8, medianHeight * 0.65);
  const lines = [];

  for (const word of safeWords) {
    const centre = word.y + word.height / 2;
    let line = lines.find((candidate) => Math.abs(candidate.centre - centre) <= tolerance);
    if (!line) {
      line = { centre, words: [] };
      lines.push(line);
    }
    line.words.push(word);
    line.centre = line.words.reduce((sum, item) => sum + (item.y + item.height / 2), 0) / line.words.length;
  }

  return lines
    .sort((a, b) => a.centre - b.centre)
    .map((line) => {
      const lineWords = [...line.words].sort((a, b) => a.x - b.x);
      return {
        text: lineWords.map((word) => word.text).join(' '),
        words: lineWords,
        y: line.centre,
      };
    });
};

/** Split one OCR line into visually separated cells using horizontal gaps. */
const lineToCells = (line, gapFactor = 1.8) => {
  const words = [...(line?.words || [])].sort((a, b) => a.x - b.x);
  if (!words.length) return [];
  const widths = words.map((word) => word.width).filter((width) => width > 0).sort((a, b) => a - b);
  const medianWidth = widths.length ? widths[Math.floor(widths.length / 2)] : 20;
  const gapThreshold = Math.max(18, medianWidth * gapFactor);
  const cells = [];
  let current = [];
  let previousEnd = null;
  for (const word of words) {
    if (previousEnd !== null && word.x - previousEnd > gapThreshold) {
      cells.push(current.map((item) => item.text).join(' ').trim());
      current = [];
    }
    current.push(word);
    previousEnd = word.x + word.width;
  }
  if (current.length) cells.push(current.map((item) => item.text).join(' ').trim());
  return cells.filter(Boolean);
};

const linesToRows = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => lineToCells(line))
  .filter((cells) => cells.length && cells.some((cell) => cell.trim()));

const isLikelyDateToken = (token) => /^\d{1,4}[./-]\d{1,2}([./-]\d{2,4})?$/.test(String(token).replace(/[,;:]+$/, ''));

module.exports = {
  FIELD_ALIASES,
  FIELD_ORDER,
  normalizeHeader,
  headerField,
  detectDelimiter,
  parseDelimited,
  parseTextRows,
  detectHeader,
  mapHeaderRow,
  positionalMapping,
  mapRows,
  groupWordsIntoLines,
  lineToCells,
  linesToRows,
  isLikelyDateToken,
};
