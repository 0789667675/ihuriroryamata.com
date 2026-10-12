const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFarmerListQuery } = require('../lib/farmer-list-query.js');

test('collection center farmer queries include the selected collector filter when chosen', () => {
  const params = buildFarmerListQuery({
    userAccountType: 'COLLECTION_CENTER',
    userId: 42,
    selectedCollectorId: '77',
    farmerSearch: 'Jane',
    farmerCenter: 'North Site',
    limit: 50,
  });

  assert.equal(params.get('collectorUserId'), '77');
  assert.equal(params.get('search'), 'Jane');
  assert.equal(params.get('center'), 'North Site');
  assert.equal(params.get('limit'), '50');
});

test('farmer list requests can combine search, center filter, sorting, and cursor pagination', () => {
  const params = buildFarmerListQuery({
    userAccountType: 'COLLECTION_CENTER',
    userId: 42,
    farmerSearch: 'Marie',
    farmerCenter: 'North Site',
    sortBy: 'nationalId',
    sortDirection: 'desc',
    cursor: 's1.eyJzZWVkIjoiY3Vyc29yIn0',
    limit: 50,
  });

  assert.equal(params.get('search'), 'Marie');
  assert.equal(params.get('center'), 'North Site');
  assert.equal(params.get('sortBy'), 'nationalId');
  assert.equal(params.get('sortDirection'), 'desc');
  assert.equal(params.get('cursor'), 's1.eyJzZWVkIjoiY3Vyc29yIn0');
});

test('collector and collection center farmer queries keep the all-collectors view by default', () => {
  const collectorParams = buildFarmerListQuery({ userAccountType: 'COLLECTOR', userId: 12, limit: 50 });
  const centerParams = buildFarmerListQuery({ userAccountType: 'COLLECTION_CENTER', userId: 42, limit: 50 });

  assert.equal(collectorParams.get('collectorUserId'), '12');
  assert.equal(centerParams.has('collectorUserId'), false);
});
