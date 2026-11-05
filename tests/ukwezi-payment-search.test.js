const test = require('node:test');
const assert = require('node:assert/strict');
const { filterUkweziPaymentRows } = require('../lib/utils/ukwezi-payment-search.js');

const rows = [
  { farmerId: 1, farmerName: 'Élodie Niyonsaba', nationalId: 'ID-100', phone: '0781000001', accountNumber: 'ACC-001' },
  { farmerId: 2, farmerName: 'Jean Claude', nationalId: 'ID-200', phone: '0782000002', accountNumber: null },
];

test('Ukwezi farmer search matches names case-insensitively and ignores accents', () => {
  assert.deepEqual(filterUkweziPaymentRows(rows, 'elodie'), [rows[0]]);
  assert.deepEqual(filterUkweziPaymentRows(rows, 'JEAN'), [rows[1]]);
});

test('Ukwezi farmer search includes ID, phone, account, and farmer ID fields', () => {
  assert.deepEqual(filterUkweziPaymentRows(rows, 'id-200'), [rows[1]]);
  assert.deepEqual(filterUkweziPaymentRows(rows, '0781000001'), [rows[0]]);
  assert.deepEqual(filterUkweziPaymentRows(rows, 'acc-001'), [rows[0]]);
  assert.deepEqual(filterUkweziPaymentRows(rows, '2'), [rows[1]]);
});

test('empty Ukwezi farmer search returns the full list and unmatched search returns none', () => {
  assert.equal(filterUkweziPaymentRows(rows, '  '), rows);
  assert.deepEqual(filterUkweziPaymentRows(rows, 'missing'), []);
});
