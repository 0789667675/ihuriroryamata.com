const test = require('node:test');
const assert = require('node:assert/strict');

const { searchGlobalData } = require('../lib/services/global-search.js');

test('searchGlobalData matches farmers, centers and notification text within a single owner-scoped query', () => {
  const results = searchGlobalData({
    ownerUserId: 42,
    query: 'mugisha',
    farmers: [
      { id: 7, name: 'Mugisha Jean', collectionCenter: 'Kigali Center', location: 'Kigali', ownerUserId: 42 },
      { id: 8, name: 'Alice Uwase', collectionCenter: 'Nyagatare', location: 'Eastern', ownerUserId: 77 },
    ],
    centers: [
      { id: 3, name: 'Mugisha Collection Center', pricePerLiter: 240, ownerUserId: 42 },
      { id: 4, name: 'Nyagatare Hub', pricePerLiter: 220, ownerUserId: 77 },
    ],
    notifications: [
      { id: 1, title: 'New farmer added', message: 'Mugisha Jean was added to Kigali collection', createdAt: '2025-01-25T08:00:00.000Z', ownerUserId: 42 },
      { id: 2, title: 'Reminder', message: 'Check the Rukomo collection route', createdAt: '2025-01-24T08:00:00.000Z', ownerUserId: 77 },
    ],
  });

  assert.deepEqual(results.farmers.map((item) => item.id), [7]);
  assert.deepEqual(results.centers.map((item) => item.id), [3]);
  assert.deepEqual(results.notifications.map((item) => item.id), [1]);
  assert.equal(results.total, 3);
});

test('searchGlobalData ignores cross-owner matches and enforces bounded result caps', () => {
  const results = searchGlobalData({
    ownerUserId: 42,
    query: 'kigali',
    limit: 2,
    farmers: [
      { id: 10, name: 'Kigali Farmer', ownerUserId: 42 },
      { id: 11, name: 'Kigali Farmer 2', ownerUserId: 42 },
      { id: 12, name: 'Kigali Farmer 3', ownerUserId: 99 },
    ],
    centers: [
      { id: 111, name: 'Kigali Center', ownerUserId: 42 },
      { id: 112, name: 'Kigali Secondary', ownerUserId: 42 },
      { id: 113, name: 'Kigali Other Owner', ownerUserId: 99 },
    ],
    notifications: [
      { id: 201, title: 'Kigali alert', message: 'Owner 42 update', ownerUserId: 42 },
      { id: 202, title: 'Kigali alert 2', message: 'Owner 42 update', ownerUserId: 42 },
      { id: 203, title: 'Kigali alert 3', message: 'Owner 99 update', ownerUserId: 99 },
    ],
  });

  assert.deepEqual(results.farmers.map((item) => item.id), [10, 11]);
  assert.deepEqual(results.centers.map((item) => item.id), [111, 112]);
  assert.deepEqual(results.notifications.map((item) => item.id), [201, 202]);
  assert.equal(results.total, 6);
});
