const test = require('node:test');
const assert = require('node:assert/strict');

const Farmers = require('../lib/services/farmer-service.js');
const Centers = require('../lib/services/collection-center-service.js');
const DomainRepository = require('../lib/repositories/domainRepository.js');
const { createSessionToken, verifySessionToken } = require('../lib/security/session.js');

const owner = { id: 42, role: 'user' };
const currentFarmer = {
  id: 7,
  name: 'A Farmer',
  location: 'North Site',
  phone: '0788000000',
  nationalId: 'N-42',
  accountNumber: 'ACC-42',
  cowType: 'Friesian',
  collectionCenter: 'North Site',
};

test('farmer creation requires a name and location and rejects oversized fields', () => {
  assert.throws(() => Farmers.normalizeFarmerInput({ name: ' ', location: 'North' }, { create: true }), /name is required/i);
  assert.throws(() => Farmers.normalizeFarmerInput({ name: 'Name', location: '' }, { create: true }), /location is required/i);
  assert.throws(() => Farmers.normalizeFarmerInput({ name: 'Name', location: 'North', phone: 123 }, { create: true }), /phone must be a string/i);
  assert.equal(Farmers.normalizeFarmerInput({ name: ' Name ', location: ' North ' }, { create: true }).name, 'Name');
});

test('farmer creation resolves a selected center id to the canonical center name and preserves server-side ownership', async () => {
  let captured;
  const created = await Farmers.createFarmer({
    ownerUserId: owner.id,
    input: {
      name: 'Test Farmer',
      location: 'Kigali',
      collectionCenter: 'Cyumba',
      collectionCenterId: 7,
      phone: '0788123456',
    },
    repository: {
      createFarmer: async (args) => {
        captured = args;
        return {
          id: 99,
          name: args.input.name,
          location: args.input.location,
          collectionCenter: args.input.collectionCenter,
          ownerUserId: args.ownerUserId,
        };
      },
    },
  });

  assert.equal(captured.ownerUserId, owner.id);
  assert.equal(captured.input.collectionCenterId, 7);
  assert.equal(captured.input.collectionCenter, 'Cyumba');
  assert.equal(created.collectionCenter, 'Cyumba');
});

test('creating a farmer with a selected center remains visible on the next owner-scoped fetch', async () => {
  let persisted;
  const repository = {
    createFarmer: async ({ input, ownerUserId }) => {
      persisted = { id: 99, ownerUserId, ...input };
      return persisted;
    },
    listFarmers: async ({ ownerUserId }) => ({
      data: persisted?.ownerUserId === ownerUserId ? [persisted] : [],
      pageSize: 50,
      nextCursor: null,
      hasMore: false,
    }),
  };

  const created = await Farmers.createFarmer({
    ownerUserId: owner.id,
    input: { name: 'Test Farmer', location: 'Kigali', collectionCenterId: 7, collectionCenter: 'Cyumba' },
    repository,
  });
  const refreshed = await Farmers.listFarmers({ ownerUserId: owner.id, limit: 50, repository });
  const otherOwner = await Farmers.listFarmers({ ownerUserId: 99, limit: 50, repository });

  assert.equal(created.collectionCenterId, 7);
  assert.equal(created.collectionCenter, 'Cyumba');
  assert.equal(refreshed.data[0].id, created.id);
  assert.equal(refreshed.data[0].ownerUserId, owner.id);
  assert.deepEqual(otherOwner.data, []);
});

test('farmer listing enforces bounded server-side keyset pagination and owner scope', async () => {
  let received;
  const expected = { data: [{ id: 30 }], pageSize: 25, nextCursor: '30', hasMore: true };
  const result = await Farmers.listFarmers({
    ownerUserId: owner.id,
    search: 'Mary',
    center: 'North Site',
    cursor: '50',
    limit: '25',
    repository: { listFarmers: async (args) => { received = args; return expected; } },
  });

  assert.equal(result, expected);
  assert.deepEqual(received, { ownerUserId: 42, search: 'Mary', center: 'North Site', cursor: 50, limit: 25 });
  await assert.rejects(() => Farmers.listFarmers({ ownerUserId: owner.id, limit: 101, repository: { listFarmers() {} } }), /between 1 and 100/i);
});

test('farmer SQL applies owner, center, search, cursor, and limit as parameters', () => {
  const query = DomainRepository.buildFarmerListQuery({
    ownerUserId: owner.id,
    search: '%_input',
    center: 'North Site',
    cursor: 90,
    limit: 40,
  });

  assert.match(query.text, /owner_user_id = \$1/);
  assert.match(query.text, /LOWER\(BTRIM\(collection_center\)\) = LOWER\(BTRIM\(\$2\)\)/);
  assert.match(query.text, /ILIKE \$3/);
  assert.match(query.text, /id < \$4/);
  assert.match(query.text, /ORDER BY id DESC LIMIT \$5/);
  assert.deepEqual(query.values, [42, 'North Site', '%%_input%', 90, 41]);
  assert.ok(!query.text.includes('%_input'));
});

test('collector farmer refetch returns owned farmers when no Dairy assignment exists', async () => {
  const calls = [];
  const result = await DomainRepository.listFarmers({
    ownerUserId: owner.id,
    collectorUserId: owner.id,
    search: '',
    center: '',
    cursor: null,
    limit: 50,
  }, async (text, values) => {
    calls.push({ text, values });
    if (text.includes('FROM collector_assignments')) return { rows: [] };
    return { rows: [{ id: 7, owner_user_id: owner.id }] };
  });

  assert.deepEqual(result.data.map((farmer) => farmer.id), [7]);
  assert.match(calls[1].text, /owner_user_id = \$1/);
  assert.doesNotMatch(calls[1].text, /collector_user_id =/);
  assert.deepEqual(calls[1].values, [owner.id, 51]);
});

test('collector farmer refetch combines owned and linked Dairy farmers without crossing owners', async () => {
  let listQuery;
  const result = await DomainRepository.listFarmers({
    ownerUserId: 77,
    collectorUserId: 77,
    search: '',
    center: '',
    cursor: null,
    limit: 50,
  }, async (text, values) => {
    if (text.includes('FROM collector_assignments')) return { rows: [{ dairy_user_id: 42 }] };
    listQuery = { text, values };
    return { rows: [{ id: 7, owner_user_id: 77 }, { id: 8, owner_user_id: 42, collector_user_id: 77 }] };
  });

  assert.deepEqual(result.data.map((farmer) => farmer.id), [7, 8]);
  assert.match(listQuery.text, /owner_user_id = \$1 OR \(owner_user_id = \$2 AND collector_user_id = \$3\)/);
  assert.deepEqual(listQuery.values, [77, 42, 77, 51]);
});

test('collector cannot list a different Dairy account without its assignment', async () => {
  await assert.rejects(() => DomainRepository.listFarmers({
    ownerUserId: 99,
    collectorUserId: 77,
    search: '',
    center: '',
    cursor: null,
    limit: 50,
  }, async () => ({ rows: [] })), (error) => error.statusCode === 403);
});

test('collector center options and selected center IDs use only owned or assigned centers', async () => {
  let listQuery;
  await DomainRepository.listCollectorCenters(77, async (text, values) => {
    listQuery = { text, values };
    return { rows: [{ id: 5, name: 'North', owner_user_id: 42 }] };
  });
  assert.match(listQuery.text, /collector_assignments/);
  assert.deepEqual(listQuery.values, [77]);

  const contextCalls = [];
  const context = await DomainRepository.resolveFarmerContext({
    ownerUserId: 77,
    collectionCenterId: 5,
    client: {
      query: async (text, values) => {
        contextCalls.push({ text, values });
        if (text.includes('FROM users')) return { rows: [{ id: 77, account_type: 'COLLECTOR', account_status: 'active' }] };
        return { rows: [{ id: 5, name: 'North', owner_user_id: 42 }] };
      },
    },
  });
  assert.equal(context.collectionCenter, 'North');
  assert.match(contextCalls[1].text, /collector_assignments/);
  assert.deepEqual(contextCalls[1].values, [5, 77]);

  await assert.rejects(() => DomainRepository.resolveFarmerContext({
    ownerUserId: 77,
    collectionCenterId: 6,
    client: {
      query: async (text) => text.includes('FROM users')
        ? { rows: [{ id: 77, account_type: 'COLLECTOR', account_status: 'active' }] }
        : { rows: [] },
    },
  }), (error) => error.code === 'COLLECTION_CENTER_ORGANIZATION_MISMATCH');
});

test('editing farmer center preserves the selected center ID and other farmer fields', async () => {
  let update;
  const repository = {
    getFarmer: async () => currentFarmer,
    updateFarmer: async (args) => { update = args; return args.input; },
  };
  const updated = await Farmers.updateFarmer({
    id: currentFarmer.id,
    ownerUserId: owner.id,
    input: { name: currentFarmer.name, location: currentFarmer.location, phone: currentFarmer.phone, collectionCenterId: '12', collectionCenter: 'South Site' },
    repository,
  });

  assert.equal(update.ownerUserId, owner.id);
  assert.equal(updated.collectionCenterId, 12);
  assert.equal(updated.collectionCenter, 'South Site');
  assert.equal(updated.phone, currentFarmer.phone);
});

test('collector scope resolves the assigned dairy before farmer filtering', async () => {
  const scope = await DomainRepository.resolveCollectorScope({
    collectorUserId: 77,
    client: {
      query: async (text, values) => {
        assert.match(text, /collector_assignments/);
        assert.deepEqual(values, [77]);
        return { rows: [{ dairy_user_id: 42 }] };
      },
    },
  });

  assert.equal(scope.ownerUserId, 42);
  assert.equal(scope.collectorUserId, 77);
});

test('farmer detail and center resolution queries are constrained by the authenticated owner', async () => {
  let detailQuery;
  await DomainRepository.getFarmer(7, owner.id, {
    query: async (text, values) => { detailQuery = { text, values }; return { rows: [] }; },
  });
  assert.match(detailQuery.text, /WHERE id = \$1 AND owner_user_id = \$2/);
  assert.deepEqual(detailQuery.values, [7, 42]);

  const statements = [];
  await assert.rejects(() => DomainRepository.resolveFarmerContext({
    ownerUserId: owner.id,
    requestedCenter: 'Foreign Center',
    client: {
      query: async (text, values) => {
        statements.push({ text, values });
        if (text.includes('FROM users')) return { rows: [{ id: 42, account_type: 'COLLECTOR', account_status: 'active' }] };
        return { rows: [] };
      },
    },
  }), (error) => error.code === 'COLLECTION_CENTER_ORGANIZATION_MISMATCH');
  assert.match(statements[1].text, /owner_user_id = \$2/);
  assert.match(statements[1].text, /collector_assignments/);
  assert.deepEqual(statements[1].values, ['Foreign Center', 42]);
});

test('farmer creation does not synthesize blank daily milk records', async () => {
  const statements = [];
  const farmer = await DomainRepository.createFarmer({
    input: { name: 'A Farmer', location: 'Kigali', collectionCenterId: 7, collectionCenter: 'North Site' },
    ownerUserId: owner.id,
    actorId: owner.id,
    poolProvider: () => ({
      connect: async () => ({
        query: async (text) => {
          statements.push(text);
          if (text.includes('FROM users')) return { rows: [{ id: owner.id, account_type: 'COLLECTOR', account_status: 'active' }] };
          if (text.includes('FROM collection_centers')) return { rows: [{ id: 7, name: 'North Site', owner_user_id: owner.id }] };
          if (text.includes('INSERT INTO farmers')) return { rows: [{ id: 88, name: 'A Farmer', owner_user_id: owner.id, location: 'Kigali', collectionCenter: 'North Site' }] };
          return { rows: [] };
        },
        release() {},
      }),
    }),
  });

  assert.equal(farmer.id, 88);
  assert.equal(farmer.owner_user_id, owner.id);
  assert.ok(!statements.some((statement) => /INSERT INTO milk_records/i.test(statement)));
});

test('phone-only farmer edits preserve all other fields and stay owner scoped', async () => {
  let update;
  const repository = {
    getFarmer: async (id, ownerUserId) => ownerUserId === owner.id ? currentFarmer : null,
    updateFarmer: async (args) => { update = args; return args.input; },
  };
  const updated = await Farmers.updateFarmer({
    id: 7,
    ownerUserId: owner.id,
    input: { phone: '0788111222' },
    repository,
  });

  assert.equal(update.ownerUserId, owner.id);
  assert.equal(updated.phone, '0788111222');
  assert.equal(updated.name, currentFarmer.name);
  assert.equal(updated.nationalId, currentFarmer.nationalId);
  await Farmers.updateFarmer({
    id: 7,
    ownerUserId: owner.id,
    input: { collection_center: 'South Site' },
    repository,
  });
  assert.equal(update.input.collectionCenter, 'South Site');
  assert.equal(await Farmers.updateFarmer({ id: 7, ownerUserId: 99, input: { phone: '1' }, repository }), null);
});

test('center configuration retains collection windows and validates price and time ordering', () => {
  assert.deepEqual(Centers.normalizeConfig({}, { creating: true }), {
    pricePerLiter: 0,
    transportRatePerLiter: 0,
    morningStart: '06:30:00',
    morningEnd: '09:00:00',
    eveningStart: '17:30:00',
    eveningEnd: '19:00:00',
  });
  assert.throws(() => Centers.normalizeConfig({ pricePerLiter: 0 }), /Invalid price per liter/i);
  assert.throws(() => Centers.normalizeConfig({ morningStart: '09:00', morningEnd: '08:00' }), /Morning start/i);
  assert.throws(() => Centers.normalizeConfig({ eveningStart: 'not-time' }), /time format/i);
  assert.equal(Centers.normalizeConfig({ transportRatePerLiter: '10.5' }).transportRatePerLiter, 10.5);
});

test('center create and update carry only authenticated owner identity', async () => {
  const calls = [];
  const repository = {
    createCenter: async (args) => { calls.push(args); return args; },
    updateCenter: async (args) => { calls.push(args); return args; },
  };
  await Centers.createCenter({ ownerUserId: owner.id, input: { name: '  North  ' }, repository });
  await Centers.updateCenter({ id: 3, ownerUserId: owner.id, input: { eveningEnd: '19:30' }, repository });

  assert.equal(calls[0].ownerUserId, 42);
  assert.equal(calls[0].input.name, 'North');
  assert.equal(calls[1].ownerUserId, 42);
  assert.deepEqual(calls[1].input, { eveningEnd: '19:30:00' });
});

test('accessible center loading uses the authenticated Collector scope', async () => {
  let received;
  const collectorCenters = [{ id: 5, owner_user_id: owner.id, name: 'North' }];
  const repository = {
    listCollectorCenters: async (collectorUserId) => { received = ['collector', collectorUserId]; return collectorCenters; },
    listCenters: async (ownerUserId) => { received = ['owner', ownerUserId]; return []; },
  };

  assert.equal(await Centers.listAccessibleCenters({ ownerUserId: owner.id, accountType: 'COLLECTOR', repository }), collectorCenters);
  assert.deepEqual(received, ['collector', owner.id]);
  await Centers.listAccessibleCenters({ ownerUserId: 88, accountType: 'COLLECTION_CENTER', repository });
  assert.deepEqual(received, ['owner', 88]);
});

test('price history accepts positive prices and resolves the owner default center', async () => {
  let args;
  const result = await Centers.addPrice({
    ownerUserId: owner.id,
    input: { pricePerLiter: 415 },
    today: '2026-10-01',
    repository: {
      listCenters: async (ownerUserId) => [{ id: 5, owner_user_id: ownerUserId }],
      addCenterPrice: async (value) => { args = value; return value; },
    },
  });
  assert.equal(result.input.collectionCenterId, 5);
  assert.equal(args.input.effectiveDate, '2026-10-01');
  await assert.rejects(() => Centers.addPrice({ ownerUserId: owner.id, input: { pricePerLiter: 0 }, repository: {} }), /Invalid price/i);
});

test('signed sessions reject tampering and expose a numeric user identity', () => {
  process.env.SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-characters';
  const token = createSessionToken({ id: owner.id, role: owner.role });
  assert.deepEqual(verifySessionToken(token), { id: owner.id, role: owner.role, exp: verifySessionToken(token).exp });
  assert.equal(verifySessionToken(`${token}x`), null);
});
