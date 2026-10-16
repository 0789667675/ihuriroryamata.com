const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMilkDifference, projectOwnerMilkEntry } = require('../lib/milk-reconciliation');

test('milk reconciliation reports the owner as higher with a positive difference', () => {
  assert.deepEqual(calculateMilkDifference(220, 215.5), { difference: 4.5, higherSide: 'owner' });
});

test('milk reconciliation reports farmers as higher with a negative difference', () => {
  assert.deepEqual(calculateMilkDifference(215.5, 220), { difference: -4.5, higherSide: 'farmers' });
});

test('milk reconciliation preserves zero and rejects unavailable values', () => {
  assert.deepEqual(calculateMilkDifference(0, 0), { difference: 0, higherSide: 'equal' });
  assert.equal(calculateMilkDifference(null, 10), null);
  assert.equal(calculateMilkDifference(Number.NaN, 10), null);
});

test('Owner Ifishi projection distinguishes missing records from persisted zero entries', () => {
  assert.equal(projectOwnerMilkEntry([], '2026-10-16'), null);
  assert.equal(projectOwnerMilkEntry([{ id: null, date: '2026-10-16', volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0 }], '2026-10-16'), null);
  assert.deepEqual(projectOwnerMilkEntry([{ id: 12, date: '2026-10-16', volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0 }], '2026-10-16'), {
    volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0,
  });
});