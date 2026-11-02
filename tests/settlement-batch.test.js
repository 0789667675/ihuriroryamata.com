const test = require('node:test');
const assert = require('node:assert/strict');

const { confirmSettlementBatch } = require('../lib/utils/settlement-batch.js');

test('settlement batch continues after row failure and reports each processed outcome', async () => {
  const records = [
    { farmerId: 11, farmerName: 'Aline', amount: 1200 },
    { farmerId: 12, farmerName: 'Blaise', amount: 900 },
    { farmerId: 13, farmerName: 'Chantal', amount: 700 },
  ];
  const processed = [];
  const updates = [];

  const result = await confirmSettlementBatch(records, async (record) => {
    processed.push(record.farmerId);
    if (record.farmerId === 12) throw Object.assign(new Error('Assignment expired.'), { status: 404 });
  }, (progress) => updates.push(progress));

  assert.deepEqual(processed, [11, 12, 13]);
  assert.equal(result.selectedCount, 3);
  assert.equal(result.processedCount, 3);
  assert.equal(result.confirmedCount, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(result.failures, [{ ...records[1], reason: 'Assignment expired.', retryable: false }]);
  assert.equal(updates.at(-2).processedCount, 3);
  assert.equal(updates.at(-2).complete, false);
  assert.equal(updates.at(-1).complete, true);
});

test('retrying failed settlements only processes the supplied eligible subset', async () => {
  const retryRecords = [
    { farmerId: 22, farmerName: 'Diane', amount: 500 },
    { farmerId: 23, farmerName: 'Eric', amount: 800 },
  ];
  const processed = [];

  const result = await confirmSettlementBatch(retryRecords, async (record) => {
    processed.push(record.farmerId);
    if (record.farmerId === 23) throw new Error('Temporary connection failure.');
  });

  assert.deepEqual(processed, [22, 23]);
  assert.equal(result.selectedCount, 2);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.failures[0].retryable, true);
});