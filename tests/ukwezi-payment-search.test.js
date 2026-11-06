const test = require('node:test');
const assert = require('node:assert/strict');
const { filterUkweziPaymentRows, paginateUkweziPaymentRows } = require('../lib/utils/ukwezi-payment-search.js');

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

test('Ukwezi farmer pagination preserves every row and continuous indexes for small and large sections', () => {
  for (const count of [10, 50, 100, 126]) {
    const farmers = Array.from({ length: count }, (_, index) => ({ farmerId: index + 1 }));
    for (const pageSize of [25, 50, 100]) {
      const collectedRows = [];
      let page = 1;
      let current;
      do {
        current = paginateUkweziPaymentRows(farmers, page, pageSize);
        collectedRows.push(...current.rows);
        assert.equal(current.startIndex, (page - 1) * pageSize);
        page += 1;
      } while (page <= current.totalPages);

      assert.deepEqual(collectedRows, farmers);
      assert.equal(current.end, count);
    }
  }
});

test('Ukwezi farmer pagination clamps page bounds and defaults unsupported page sizes to 25', () => {
  const result = paginateUkweziPaymentRows(Array.from({ length: 60 }, (_, index) => index), 99, 40);

  assert.equal(result.pageSize, 25);
  assert.equal(result.currentPage, 3);
  assert.equal(result.start, 51);
  assert.equal(result.end, 60);
});

test('Ukwezi account and no-account sections keep independent page positions and sizes', () => {
  const accountRows = Array.from({ length: 126 }, (_, index) => ({ farmerId: index + 1 }));
  const ownerRows = Array.from({ length: 50 }, (_, index) => ({ farmerId: index + 1001 }));
  const accountPage = paginateUkweziPaymentRows(accountRows, 2, 25);
  const ownerPage = paginateUkweziPaymentRows(ownerRows, 1, 50);

  assert.equal(accountPage.totalPages, 6);
  assert.equal(accountPage.start, 26);
  assert.equal(accountPage.rows[0].farmerId, 26);
  assert.equal(accountPage.end, 50);
  assert.equal(ownerPage.totalPages, 1);
  assert.equal(ownerPage.start, 1);
  assert.equal(ownerPage.rows.length, 50);
});
