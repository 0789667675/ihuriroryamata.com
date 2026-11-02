const test = require('node:test');
const assert = require('node:assert/strict');

const { validateFarmerBatchRows, validateDeductionBatchRows } = require('../lib/utils/multi-entry-validation.js');

test('farmer batch validation rejects empty rows and trims valid entries', () => {
  const result = validateFarmerBatchRows([
    { name: '  Aline ', phone: '0700', nationalId: '123', accountNumber: '1000' },
    { name: '   ', phone: '0701' },
    { name: 'Blaise', phone: '', nationalId: '', accountNumber: '' },
  ], { requireCenter: false });

  assert.equal(result.valid.length, 2);
  assert.equal(result.valid[0].name, 'Aline');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /required/i);
});

test('deduction batch validation enforces supported types and totals', () => {
  const result = validateDeductionBatchRows([
    { amount: '1500', date: '2026-11-01', type: 'Advance', status: 'Active', reason: 'Feed', notes: 'Initial' },
    { amount: '0', date: '2026-11-02', type: 'Other', status: 'Active', reason: 'Other', notes: 'Zero' },
    { amount: '750', date: '2026-11-03', type: 'Unsupported', status: 'Active', reason: 'Bad', notes: 'Bad' },
  ]);

  assert.equal(result.valid.length, 1);
  assert.equal(result.total, 1500);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].message, /positive/i);
  assert.match(result.errors[1].message, /Advance.*Umwenda.*Other|unsupported/i);
});
