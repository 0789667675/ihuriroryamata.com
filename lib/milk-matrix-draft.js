const createMatrixDraftKey = ({ centerId, year, month, periodType }) =>
  `milk-matrix-draft:v1:${centerId}:${year}:${month}:${periodType}`;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const validateEntries = (entries) => {
  if (!isObject(entries)) {
    throw new Error('The saved milk matrix draft has an invalid format.');
  }

  for (const [farmerId, days] of Object.entries(entries)) {
    if (!Number.isSafeInteger(Number(farmerId)) || Number(farmerId) <= 0 || !isObject(days)) {
      throw new Error('The saved milk matrix draft has an invalid format.');
    }

    for (const [day, sessions] of Object.entries(days)) {
      if (!/^\d+$/.test(day) || !isObject(sessions)) {
        throw new Error('The saved milk matrix draft has an invalid format.');
      }
      for (const session of ['morning', 'evening']) {
        if (sessions[session] !== undefined && typeof sessions[session] !== 'string') {
          throw new Error('The saved milk matrix draft has an invalid format.');
        }
      }
    }
  }

  return entries;
};

/**
 * @param {Storage} storage
 * @param {string} key
 * @returns {Record<string, Record<string, { morning?: string; evening?: string }>> | null}
 */
const readMatrixDraft = (storage, key) => {
  const rawDraft = storage.getItem(key);
  if (rawDraft === null) return null;

  const draft = JSON.parse(rawDraft);
  if (!isObject(draft) || draft.version !== 1) {
    throw new Error('The saved milk matrix draft has an unsupported format.');
  }
  return validateEntries(draft.entries);
};

/**
 * @param {Storage} storage
 * @param {string} key
 * @param {Record<string, Record<string, { morning?: string; evening?: string }>>} entries
 */
const writeMatrixDraft = (storage, key, entries) => {
  if (Object.keys(entries).length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ version: 1, entries }));
};

/**
 * @param {Record<number, Record<string, { morning: string; evening: string; total?: number; recordId?: number }>>} matrix
 * @param {Record<string, Record<string, { morning?: string; evening?: string }>>} entries
 */
const applyMatrixDraft = (matrix, entries) => {
  const restored = { ...matrix };
  for (const [farmerId, days] of Object.entries(entries)) {
    const restoredDays = { ...(restored[Number(farmerId)] || {}) };
    for (const [day, sessions] of Object.entries(days)) {
      restoredDays[day] = {
        morning: restoredDays[day]?.morning ?? '',
        evening: restoredDays[day]?.evening ?? '',
        ...restoredDays[day],
        ...sessions,
      };
    }
    restored[Number(farmerId)] = restoredDays;
  }
  return restored;
};

module.exports = {
  applyMatrixDraft,
  createMatrixDraftKey,
  readMatrixDraft,
  writeMatrixDraft,
};
