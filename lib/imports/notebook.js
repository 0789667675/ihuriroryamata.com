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

const HEADER_LABELS = new Set([
  'name', 'names', 'farmer', 'farmers', 'izina', 'amazina', 'umworozi', 'aborozi',
  'nom', 'noms', 'nom complet',
]);

const isHeaderLabel = (text) => {
  const normalized = cleanToken(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return HEADER_LABELS.has(normalized);
};

const looksLikeDateToken = (text) => {
  const token = cleanToken(text).replace(/\s+/g, '');
  return /^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(token) || /^\d{1,2}$/.test(token);
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

const parseQuantityToken = (text) => {
  const raw = cleanToken(text);
  if (!raw) return { value: null, status: 'empty', raw };
  const withoutUnit = raw.replace(/\s*(?:l|lt|ltr|litre|litres|kg)$/i, '');
  if (/^\d{1,4}[.,]\d{1,2}$/.test(withoutUnit)) {
    const value = Number(withoutUnit.replace(',', '.'));
    if (Number.isFinite(value) && value > 0 && value <= 10000) return { value, status: 'ok', raw };
  }
  if (/^\d{1,4}$/.test(withoutUnit)) {
    const value = Number(withoutUnit);
    if (Number.isFinite(value) && value > 0 && value <= 10000) return { value, status: 'ok', raw };
  }
  if (/\d/.test(withoutUnit)) return { value: null, status: 'unreadable', raw };
  return { value: null, status: 'not-quantity', raw };
};

const isQuantityLike = (text) => /^[\dOoIlSsBb]+[.,]?[\dOoIlSsBb]*\s*(?:l|lt|ltr|kg)?$/i.test(cleanToken(text));

const centreOf = (word) => word.x + word.width / 2;
const confidenceOf = (words) => {
  const values = words.map((word) => word.confidence).filter((value) => Number.isFinite(value));
  return values.length ? Math.min(...values) : null;
};

const parseNotebookPage = ({ words, targetDate } = {}) => {
  const target = parseTargetDate(targetDate);
  const lines = groupWordsIntoLines(words);
  if (!lines.length) {
    return { entries: [], dateColumnFound: false, headerText: '', lineCount: 0, targetDate: targetDate || null };
  }

  let header = null;
  let targetWord = null;
  let dateCount = 0;
  let headerIndex = -1;
  for (let index = 0; index < Math.min(lines.length, 15); index += 1) {
    const lineWords = lines[index].words;
    const dates = lineWords.filter((word) => tokenMatchesDate(word.text, target));
    if (!dates.length) continue;
    const dateTokens = lineWords.filter((word) => looksLikeDateToken(word.text));
    // A date written next to a single farmer row is just a value, not a date
    // header. Require a recognizable name label and at least two date columns
    // before selecting one column, otherwise rows are kept and flagged instead
    // of being silently dropped or assigned the wrong quantity.
    if (dateTokens.length < 2 || !lineWords.some((word) => isHeaderLabel(word.text))) continue;
    if (!header || dateTokens.length > dateCount) {
      header = lines[index];
      headerIndex = index;
      dateCount = dateTokens.length;
      targetWord = dates[0];
    }
  }

  const dateColumnFound = Boolean(header && targetWord && dateCount > 1);
  const targetX = dateColumnFound ? centreOf(targetWord) : null;
  const headerDateCentres = header
    ? header.words.filter((word) => looksLikeDateToken(word.text))
      .map(centreOf)
      .sort((a, b) => a - b)
    : [];
  const gaps = [];
  for (let index = 1; index < headerDateCentres.length; index += 1) {
    const gap = headerDateCentres[index] - headerDateCentres[index - 1];
    if (gap > 4) gaps.push(gap);
  }
  const columnSpacing = median(gaps);
  const tolerance = columnSpacing ? Math.max(14, columnSpacing * 0.38) : 24;

  const isHeaderOnlyLine = (lineWords) => lineWords.length > 0
    && lineWords.some((word) => isHeaderLabel(word.text))
    && lineWords.every((word) => isHeaderLabel(word.text) || looksLikeDateToken(word.text));

  const entries = [];
  let startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
  // A single-day header such as "Izina 25/10/2026" cannot select a column, but
  // it is still a label, not a farmer. Skip only the unambiguous label line.
  if (headerIndex < 0 && lines[0] && isHeaderOnlyLine(lines[0].words)) startIndex = 1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const lineWords = line.words;
    const text = line.text.trim();
    if (!lineWords.length) continue;

    // Ignore a leading row number (for example "1 MUKAMANA Alice 12.5").
    let wordIndex = 0;
    while (wordIndex < lineWords.length - 1 && /^\d{1,3}[.)]?$/.test(cleanToken(lineWords[wordIndex].text))) {
      wordIndex += 1;
    }
    const nameWords = [];
    while (wordIndex < lineWords.length) {
      const token = cleanToken(lineWords[wordIndex].text);
      if (isQuantityLike(token)) break;
      if (/\d/.test(token) && !/[a-z]/i.test(token)) break;
      nameWords.push(lineWords[wordIndex]);
      wordIndex += 1;
    }
    if (!nameWords.length) continue;
    const name = nameWords.map((word) => cleanToken(word.text)).join(' ').trim();
    if (!/[a-z]/i.test(name)) continue;

    const quantityWords = lineWords.slice(wordIndex).filter((word) => isQuantityLike(word.text));
    let selected = null;
    let quantityStatus = 'unreadable';
    let usedColumn = dateColumnFound;

    if (usedColumn) {
      const near = quantityWords
        .map((word) => ({ word, distance: Math.abs(centreOf(word) - targetX) }))
        .filter((entry) => entry.distance <= tolerance)
        .sort((left, right) => left.distance - right.distance);
      if (near.length === 1 || (near.length > 1 && near[0].distance + 6 < near[1].distance)) {
        selected = near[0].word;
      } else if (near.length > 1) {
        quantityStatus = 'ambiguous';
      }
    } else if (quantityWords.length === 1) {
      selected = quantityWords[0];
      usedColumn = false;
    } else if (quantityWords.length > 1) {
      quantityStatus = 'ambiguous';
    }

    const parsed = selected ? parseQuantityToken(selected.text) : { value: null, status: 'unreadable', raw: '' };
    let status = quantityStatus;
    if (selected && parsed.status === 'ok' && quantityStatus !== 'ambiguous') {
      const quantityConfidence = confidenceOf([selected]);
      const nameConfidence = confidenceOf(nameWords);
      const lowConfidence = (quantityConfidence !== null && quantityConfidence < 0.72)
        || (nameConfidence !== null && nameConfidence < 0.6);
      status = lowConfidence || !usedColumn ? 'uncertain' : 'ok';
    } else if (selected && parsed.status !== 'ok') {
      status = 'unreadable';
    }

    const confidenceCandidates = [
      confidenceOf(nameWords),
      selected ? confidenceOf([selected]) : null,
    ].filter((value) => value !== null);
    const confidence = confidenceCandidates.length ? Math.min(...confidenceCandidates) : null;

    entries.push({
      rowNumber: entries.length + 1,
      rawText: text,
      name,
      nameRaw: name,
      quantity: parsed.status === 'ok' ? parsed.value : null,
      quantityRaw: parsed.status === 'ok' ? String(parsed.value) : cleanToken(selected?.text || ''),
      status,
      confidence,
      dateColumnFound: Boolean(usedColumn),
      x: nameWords[0]?.x ?? 0,
      y: line.y,
      words: lineWords,
    });
  }

  return {
    entries,
    dateColumnFound,
    headerText: header?.text || '',
    lineCount: lines.length,
    targetDate: targetDate || null,
    columnTolerance: tolerance,
  };
};

module.exports = {
  parseTargetDate,
  tokenMatchesDate,
  parseQuantityToken,
  parseNotebookPage,
};
