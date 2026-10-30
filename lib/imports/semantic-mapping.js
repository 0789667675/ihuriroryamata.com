/**
 * Semantic (non-positional) interpretation of document column headings.
 *
 * The importer must understand what a column represents regardless of column
 * order, spelling variation, language (Kinyarwanda/English) or OCR noise.
 * Results carry confidence so low-confidence interpretations go to user
 * review instead of being silently applied.
 */

const { normalizeHeader } = require('./text-parsing.js');
const { assessFieldValue, isLikelyPhone, isLikelyNationalId, isLikelyName } = require('./farmer-field-config.js');

// Canonical import targets (fields a source column may be mapped to). The
// `exclude` target is always available and is not a farmer field.
const IMPORT_TARGETS = [
  { key: 'exclude', label: { rw: 'Hagukana', en: 'Exclude / Ignore' } },
  { key: 'farmerNumber', label: { rw: 'Nambara y\'umworozi', en: 'Farmer number (No.)' } },
  { key: 'name', label: { rw: 'Amazina y\'umworozi', en: 'Farmer full name' } },
  { key: 'nationalId', label: { rw: 'Nomero y\'indangamuntu', en: 'National ID' } },
  { key: 'phone', label: { rw: 'Telefone', en: 'Phone number' } },
  { key: 'accountNumber', label: { rw: 'Nomero ya konti', en: 'Account number' } },
  { key: 'collectionCenter', label: { rw: 'Ikigo cy\'ikusanyirizo', en: 'Collection center' } },
  { key: 'cowType', label: { rw: 'Ubwoko bw\'inka', en: 'Cow type' } },
  { key: 'volume', label: { rw: 'Litiro', en: 'Volume (Liters)' } },
  { key: 'netPayable', label: { rw: 'Asigaye', en: 'Net payable' } },
];

// Normalized aliases per target. Every alias is stored in normalized form
// (lowercase, accents/stops/apostrophes collapsed, whitespace collapsed).
const TARGET_ALIASES = {
  farmerNumber: [
    'no', 'nambara', 'nambara y umworozi', 'number', 'ref', 'reference',
    'row', 'row number', 'lineno', 'line',
  ],
  name: [
    'amazina', 'amazina yumbi', 'amazina y umworozi', 'amazina yombi y umworozi',
    'amazina yombi', 'name', 'farmer name', 'farmer', 'full name', 'izina',
    'umworozi', 'umworozi name', 'nom', 'nom complet', 'abacunda', 'umukiriya',
    'inungi', 'farmer full name',
  ],
  nationalId: [
    'indangamuntu', 'nomero y indangamuntu', 'nomero yindangamuntu',
    'nimero y indangamuntu', 'nimero yindangamuntu',
    'numeromer indangamuntu', 'national id', 'nationalid', 'national identity',
    'identity', 'id', 'id number', 'nid', 'national identification number',
    'impanuro y indangamuntu',
  ],
  phone: [
    'telephone', 'telefone', 'tel', 'phone', 'phone number', 'telephone number',
    'mobile', 'mobile number', 'nimero', 'nimero ya telefone', 'numero',
    'numero ya telefone', 'cell', 'cell phone',
  ],
  accountNumber: [
    'konti', 'numero', 'numero ya konti', 'no ya konti', 'nambara ya konti', 'nomero ya konti',
    'nimero ya konti', 'account', 'account number', 'account no', 'acct', 'acct number',
    'numero de compte', 'compte', 'bank account', 'bank',
  ],
  collectionCenter: [
    'ikigo', 'ikigo cy amata', 'ikigo cyamata', 'collection center',
    'collection centre', 'center', 'centre', 'site', 'dairy', 'ikigo cy\'ikusanyirizo',
  ],
  cowType: [
    'cow type', 'cattle type', 'breed', 'inka', 'ubwoko bw inka', 'ubwoko',
    'ubwoko bwinka',
  ],
  volume: [
    'litiro', 'liters', 'litres', 'volume', 'ingano', 'ingano y amata', 'amata',
    'amata yose', 'qty', 'quantity',
  ],
  netPayable: [
    'asigaye', 'net', 'net payable', 'montant net', 'amafaranga asigaye', 'haye',
    'ayishyuwe', 'asigaye kwishyurwa', 'reste',
  ],
};

// Single-character OCR confusions tried when no confident match is found.
const OCR_CONFUSIONS = [
  { from: /o/g, to: '0' },
  { from: /0/g, to: 'o' },
  { from: /i/g, to: '1' },
  { from: /1/g, to: 'i' },
  { from: /s/g, to: '5' },
  { from: /5/g, to: 's' },
];

const normalizeHeading = (value) => {
  const normalized = normalizeHeader(value);
  const withoutApostrophes = normalized.replace(/['’`]/g, '');
  return withoutApostrophes.replace(/\s+/g, ' ').trim();
};

const ocrVariants = (normalized) => {
  const variants = [normalized];
  for (const { from, to } of OCR_CONFUSIONS) {
    const added = [];
    for (const variant of variants) {
      if (from.test(variant)) added.push(variant.replace(from, to));
    }
    variants.push(...added);
  }
  return variants.filter((variant, index, all) => all.indexOf(variant) === index);
};

const matchAlias = (normalized, aliases) => {
  // Exact normalized match is authoritative.
  if (aliases.includes(normalized)) return { confidence: 'high', exact: true, matched: normalized };

  const headingTokens = normalized.split(/\s+/).filter(Boolean);

  // Multi-word alias phrases contained in the heading (single-token fragments
  // like "tel" or "number" must not match inside mangled words such as
  // "telef0ne" or "id number").
  const phraseHits = aliases.filter((alias) => {
    const tokens = alias.split(/\s+/).filter(Boolean);
    return tokens.length > 1 && normalized.includes(alias);
  });
  if (phraseHits.length) {
    const bestPhrase = phraseHits.reduce((best, alias) => (alias.length > best.length ? alias : best), '');
    return { confidence: 'medium', exact: false, matched: bestPhrase };
  }

  // Every token of the alias appears as a separate heading token.
  if (headingTokens.length) {
    const tokenAliases = aliases.filter((alias) => {
      const tokens = alias.split(/\s+/).filter(Boolean);
      return tokens.length && tokens.every((token) => headingTokens.includes(token));
    });
    if (tokenAliases.length) return { confidence: 'low', exact: false, matched: tokenAliases[0] };
  }

  return null;
};

const interpretHeading = (value, language = 'rw') => {
  const normalized = normalizeHeading(String(value ?? ''));
  if (!normalized) return { field: null, confidence: 'none', normalized, matched: null, reasons: ['empty-heading'] };

  const results = [];
  for (const [field, aliases] of Object.entries(TARGET_ALIASES)) {
    const match = matchAlias(normalized, aliases);
    if (match) results.push({ field, ...match });
  }

  if (results.length === 0) {
    // Try OCR-confusion variants (O/0, I/1, S/5) so OCR headings like
    // "INDANGAMUNT0" still resolve with reduced confidence.
    for (const variant of ocrVariants(normalized).slice(1)) {
      for (const [field, aliases] of Object.entries(TARGET_ALIASES)) {
        const match = matchAlias(variant, aliases);
        if (match && match.confidence === 'high') {
          results.push({ field, confidence: 'medium', exact: false, ocrConfusion: true });
        }
      }
    }
  }

  // De-duplicate by field, keep the best confidence.
  const best = new Map();
  for (const result of results) {
    const current = best.get(result.field);
    const rank = { high: 3, medium: 2, low: 1, none: 0 }[result.confidence] || 0;
    if (!current || rank > (rankOf(current.confidence) || 0)) best.set(result.field, result);
  }

  const candidates = Array.from(best.values())
    .sort((a, b) => rankOf(b.confidence) - rankOf(a.confidence) || (a.exact === b.exact ? 0 : a.exact ? -1 : 1));
  const top = candidates[0];

  const reasons = [];
  if (!top) reasons.push('no-semantic-match');
  if (top && top.ocrConfusion) reasons.push('ocr-confusion');

  // Short generic headings ("numero", "id", "no") map to multiple targets:
  // flag ambiguity instead of guessing.
  let ambiguous = false;
  if (top && top.confidence === 'low') ambiguous = true;
  const tied = candidates.filter((c) => rankOf(c.confidence) === (top ? rankOf(top.confidence) : -1));
  let resolvedField = top ? top.field : null;
  let resolvedConfidence = top ? top.confidence : 'none';
  if (tied.length > 1) {
    ambiguous = true;
    // Multiple fields match with equal confidence: do not guess which one
    // the heading means. Leave it unmapped so the user decides. Candidates
    // keep their original fields so the reviewer can choose.
    resolvedField = null;
    resolvedConfidence = 'low';
  }

  return {
    field: resolvedField,
    confidence: resolvedConfidence,
    normalized,
    matched: top ? top.matched ?? null : null,
    ocrConfusion: Boolean(top && top.ocrConfusion),
    ambiguous,
    candidates: candidates.map((c) => ({ field: c.field, confidence: c.confidence })),
    reasons,
  };
};

const rankOf = (confidence) => ({ high: 3, medium: 2, low: 1, none: 0 }[confidence] || 0);

/**
 * Interpret every column heading of a document. Returns one entry per source
 * column, in column order. Columns that cannot be interpreted are `field: null`
 * and must be mapped manually or excluded; they are never positionally guessed.
 */
const interpretColumns = (headers, language = 'rw') => {
  return (Array.isArray(headers) ? headers : []).map((heading, index) => ({
    index,
    heading: String(heading ?? '').trim(),
    ...interpretHeading(heading, language),
  }));
};

/**
 * Compare an extracted value against its column's interpreted field. Flags
 * heading/value mismatches (e.g. a phone number under a name heading) without
 * silently swapping anything.
 */
const assessValueFitForColumn = (field, value) => {
  if (!field) return { fit: 'unknown', warnings: [] };
  return assessFieldValue(field, value);
};

/**
 * Detect suspicious column/value misalignment across a sample of rows.
 * `rows` carries values keyed by farmer field (as produced by the column
 * mapping). For each mapped column, if the majority of non-empty values
 * clearly belong to a different field, the mapping is flagged for review.
 */
const detectColumnMisalignment = (columns, rows) => {
  const flags = [];
  for (const column of columns) {
    if (!column.field || column.field === 'exclude') continue;
    const values = rows
      .map((row) => row.values && row.values[column.field])
      .filter((value) => value !== undefined && value !== null && String(value).trim());
    if (!values.length) continue;

    let nameLike = 0;
    let phoneLike = 0;
    let idLike = 0;
    for (const value of values) {
      if (isLikelyName(value)) nameLike += 1;
      if (isLikelyPhone(value)) phoneLike += 1;
      if (isLikelyNationalId(value)) idLike += 1;
    }
    const total = values.length;

    const suspects = [];
    if (column.field === 'name' && phoneLike / total > 0.6) suspects.push('phone');
    if (column.field === 'name' && idLike / total > 0.6) suspects.push('national id');
    if (column.field === 'phone' && nameLike / total > 0.6) suspects.push('name');
    if (column.field === 'nationalId' && nameLike / total > 0.6) suspects.push('name');
    if (column.field === 'accountNumber' && nameLike / total > 0.6) suspects.push('name');

    if (suspects.length) {
      flags.push({
        columnIndex: column.index,
        heading: column.heading,
        field: column.field,
        suspects,
        sampleSize: total,
      });
    }
  }
  return flags;
};

module.exports = {
  IMPORT_TARGETS,
  normalizeHeading,
  interpretHeading,
  interpretColumns,
  assessValueFitForColumn,
  detectColumnMisalignment,
  TARGET_ALIASES,
};
