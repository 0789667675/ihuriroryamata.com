/**
 * Deterministic farmer matching used by both import wizards. It deliberately
 * never auto-selects a fuzzy or duplicate name match: those require a human
 * decision in the review table.
 */

const normalizeName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const normalizeIdentifier = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const normalizePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length >= 9) return digits.slice(-9);
  return digits;
};

const levenshtein = (left, right) => {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
};

const nameSimilarity = (left, right) => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshtein(a, b) / longest);
};

const farmerLabel = (farmer) => {
  if (!farmer) return '';
  const extras = [farmer.nationalId, farmer.phone || farmer.accountNumber].filter(Boolean);
  return extras.length ? `${farmer.name} (${extras.join(' · ')})` : farmer.name;
};

const buildFarmerIndex = (farmers) => {
  const list = Array.isArray(farmers) ? farmers.filter((farmer) => farmer && farmer.id) : [];
  const byName = new Map();
  const byNationalId = new Map();
  const byAccountNumber = new Map();
  const byPhone = new Map();
  const add = (map, key, farmer) => {
    if (!key) return;
    const entries = map.get(key) || [];
    entries.push(farmer);
    map.set(key, entries);
  };
  for (const farmer of list) {
    add(byName, normalizeName(farmer.name), farmer);
    add(byNationalId, normalizeIdentifier(farmer.nationalId), farmer);
    add(byAccountNumber, normalizeIdentifier(farmer.accountNumber), farmer);
    add(byPhone, normalizePhone(farmer.phone), farmer);
  }
  return { farmers: list, byName, byNationalId, byAccountNumber, byPhone };
};

const uniqueFarmers = (groups) => {
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    for (const farmer of group || []) {
      if (seen.has(farmer.id)) continue;
      seen.add(farmer.id);
      result.push(farmer);
    }
  }
  return result;
};

const fuzzyCandidates = (name, index, limit = 5) => {
  const normalized = normalizeName(name);
  if (!normalized || !index.farmers.length) return [];
  const scored = [];
  for (const farmer of index.farmers) {
    const candidate = normalizeName(farmer.name);
    if (!candidate) continue;
    if (Math.abs(candidate.length - normalized.length) > Math.max(5, normalized.length * 0.45)) continue;
    const score = nameSimilarity(normalized, candidate);
    if (score >= 0.72) scored.push({ farmer, score });
  }
  scored.sort((left, right) => right.score - left.score || left.farmer.name.localeCompare(right.farmer.name));
  return scored.slice(0, limit);
};

/**
 * Match a single extracted record against the account's farmers.
 * Identifier matches are authoritative; a duplicate name is ambiguous.
 */
const matchFarmer = (record, farmersOrIndex) => {
  const index = farmersOrIndex && farmersOrIndex.byName
    ? farmersOrIndex
    : buildFarmerIndex(farmersOrIndex);
  const identifierLookups = [
    ['nationalId', normalizeIdentifier(record?.nationalId), index.byNationalId],
    ['accountNumber', normalizeIdentifier(record?.accountNumber), index.byAccountNumber],
    ['phone', normalizePhone(record?.phone), index.byPhone],
  ];
  const identifierMatches = uniqueFarmers(identifierLookups.map(([, key, lookup]) => lookup.get(key)));
  if (identifierMatches.length === 1) {
    const matchedField = identifierLookups.find(([, key, lookup]) => key && lookup.has(key))?.[0] || 'identifier';
    return { status: 'exact', farmerId: identifierMatches[0].id, farmer: identifierMatches[0], candidates: identifierMatches, reason: 'identifier', matchedField };
  }
  if (identifierMatches.length > 1) {
    return { status: 'ambiguous', farmerId: null, farmer: null, candidates: identifierMatches.slice(0, 8), reason: 'identifier-duplicate', matchedField: 'identifier' };
  }

  const exactName = index.byName.get(normalizeName(record?.name));
  if (exactName?.length === 1) {
    return { status: 'exact', farmerId: exactName[0].id, farmer: exactName[0], candidates: exactName, reason: 'name', matchedField: 'name' };
  }
  if (exactName?.length > 1) {
    return { status: 'ambiguous', farmerId: null, farmer: null, candidates: exactName.slice(0, 8), reason: 'name-duplicate', matchedField: 'name' };
  }

  const fuzzy = fuzzyCandidates(record?.name, index);
  if (fuzzy.length) {
    return {
      status: 'possible',
      farmerId: null,
      farmer: null,
      candidates: fuzzy.map((entry) => entry.farmer),
      scores: fuzzy,
      reason: fuzzy[0].score >= 0.9 ? 'very-close-name' : 'similar-name',
    };
  }

  if (!normalizeName(record?.name)) {
    return { status: 'invalid', farmerId: null, farmer: null, candidates: [], reason: 'missing-name' };
  }
  return { status: 'none', farmerId: null, farmer: null, candidates: [], reason: 'no-match' };
};

/**
 * Detect duplicate identifiers and names inside one pasted/uploaded batch.
 * Duplicate national IDs/account numbers block creation; duplicate names are
 * surfaced for review but do not block by themselves.
 */
const findImportDuplicates = (records) => {
  const seenNationalId = new Map();
  const seenAccountNumber = new Map();
  const seenPhone = new Map();
  const seenName = new Map();
  return (Array.isArray(records) ? records : []).map((record, index) => {
    const rowNumber = record?.rowNumber ?? index + 1;
    const nationalId = normalizeIdentifier(record?.nationalId);
    const accountNumber = normalizeIdentifier(record?.accountNumber);
    const phone = normalizePhone(record?.phone);
    const name = normalizeName(record?.name);
    const result = {
      rowNumber,
      duplicateOf: null,
      duplicateField: null,
      nameDuplicateOf: null,
    };
    if (nationalId && seenNationalId.has(nationalId)) {
      result.duplicateOf = seenNationalId.get(nationalId);
      result.duplicateField = 'nationalId';
    } else if (accountNumber && seenAccountNumber.has(accountNumber)) {
      result.duplicateOf = seenAccountNumber.get(accountNumber);
      result.duplicateField = 'accountNumber';
    } else if (phone && seenPhone.has(phone)) {
      result.duplicateOf = seenPhone.get(phone);
      result.duplicateField = 'phone';
    } else if (name && seenName.has(name)) {
      result.nameDuplicateOf = seenName.get(name);
    }
    if (nationalId && !seenNationalId.has(nationalId)) seenNationalId.set(nationalId, rowNumber);
    if (accountNumber && !seenAccountNumber.has(accountNumber)) seenAccountNumber.set(accountNumber, rowNumber);
    if (phone && !seenPhone.has(phone)) seenPhone.set(phone, rowNumber);
    if (name && !seenName.has(name)) seenName.set(name, rowNumber);
    return result;
  });
};

module.exports = {
  normalizeName,
  normalizeIdentifier,
  normalizePhone,
  nameSimilarity,
  farmerLabel,
  buildFarmerIndex,
  matchFarmer,
  findImportDuplicates,
};
