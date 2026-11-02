const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMatrixDraft,
  createMatrixDraftKey,
  readMatrixDraft,
  writeMatrixDraft,
} = require('../lib/milk-matrix-draft.js');

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('milk matrix drafts persist across reloads and restore only the edited sessions', async () => {
  const storage = createStorage();
  const key = createMatrixDraftKey({
    centerId: 12,
    year: 2026,
    month: 11,
    periodType: 'first-half',
  });
  const pending = {
    '104': {
      '3': { morning: '4.5' },
      '7': { evening: '2' },
    },
  };

  writeMatrixDraft(storage, key, pending);

  await assert.rejects(
    async () => {
      throw new Error('Simulated network failure');
    },
    /Simulated network failure/
  );
  const reloadedDraft = readMatrixDraft(storage, key);
  assert.deepEqual(reloadedDraft, pending);

  const restored = applyMatrixDraft({
    104: {
      '3': { morning: '1', evening: '3', total: 4, recordId: 99 },
      '7': { morning: '5', evening: '', total: 5 },
    },
  }, reloadedDraft);

  assert.deepEqual(restored[104]['3'], { morning: '4.5', evening: '3', total: 4, recordId: 99 });
  assert.deepEqual(restored[104]['7'], { morning: '5', evening: '2', total: 5 });
});

test('milk matrix draft keys isolate center and accounting period', () => {
  const base = { centerId: 12, year: 2026, month: 11, periodType: 'first-half' };
  assert.notEqual(
    createMatrixDraftKey(base),
    createMatrixDraftKey({ ...base, periodType: 'second-half' })
  );
  assert.notEqual(
    createMatrixDraftKey(base),
    createMatrixDraftKey({ ...base, centerId: 13 })
  );
});

test('milk matrix drafts are cleared only by an explicit empty write', () => {
  const storage = createStorage();
  const key = createMatrixDraftKey({
    centerId: 12,
    year: 2026,
    month: 11,
    periodType: 'first-half',
  });
  writeMatrixDraft(storage, key, { '104': { '3': { morning: '4.5' } } });

  assert.throws(() => readMatrixDraft({
    getItem: () => '{invalid json',
  }, key));
  assert.notEqual(readMatrixDraft(storage, key), null);

  writeMatrixDraft(storage, key, {});
  assert.equal(readMatrixDraft(storage, key), null);
});
