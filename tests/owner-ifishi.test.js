const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OwnerIfishi = require('../lib/services/owner-ifishi-service.js');
const CollectorMilkRepository = require('../lib/repositories/collectorMilkRepository.js');
const ReportRepository = require('../lib/repositories/reportRepository.js');

const ownerUserId = 42;
const fixedNow = new Date('2026-10-06T12:00:00.000Z');

const inMemoryRepository = () => {
  const saved = [];
  return {
    saved,
    getOwnerIfishiHistory: async ({ ownerUserId: scope, startDate, endDate }) => saved
      .filter((row) => row.ownerUserId === scope && row.date >= startDate && row.date <= endDate)
      .map((row) => ({ ...row, assignedFarmerLiters: row.assignedFarmerLiters || 0 })),
    getPriceAtDate: async ({ ownerUserId: scope }) => {
      assert.equal(scope, ownerUserId);
      return { pricePerLiter: 400 };
    },
    createOwnerEntry: async (input) => {
      assert.equal(input.ownerUserId, ownerUserId);
      assert.equal(input.actorId, ownerUserId);
      const row = {
        id: saved.length + 1,
        ownerUserId: input.ownerUserId,
        date: input.date,
        volumeLiters: input.volumeLiters,
        originalVolumeLiters: input.volumeLiters,
        validVolumeLiters: input.volumeLiters,
        lostVolumeLiters: 0,
        assignedFarmerLiters: 0,
        status: 'valid',
      };
      saved.push(row);
      return row;
    },
    correctOwnerEntry: async (input) => {
      const row = saved.find((entry) => entry.id === input.id && entry.ownerUserId === input.ownerUserId);
      if (!row) return null;
      row.date = input.date;
      row.volumeLiters = input.volumeLiters;
      row.originalVolumeLiters = input.volumeLiters;
      row.validVolumeLiters = input.volumeLiters;
      return row;
    },
  };
};

test('Owner Ifishi history includes owner milk, assigned volume, valid surplus, and void history without double counting', async () => {
  const repository = {
    getOwnerIfishiHistory: async (filters) => {
      assert.deepEqual(filters, { ownerUserId, startDate: '2026-10-01', endDate: '2026-10-31' });
      return [
        { id: 1, date: '2026-10-04', volumeLiters: 100, originalVolumeLiters: 100, validVolumeLiters: 100, lostVolumeLiters: 0, assignedFarmerLiters: 70, status: 'valid' },
        { id: 2, date: '2026-10-03', volumeLiters: 80, originalVolumeLiters: 80, validVolumeLiters: 0, lostVolumeLiters: 80, assignedFarmerLiters: 0, status: 'cancelled' },
        { id: null, date: '2026-10-02', volumeLiters: 0, originalVolumeLiters: 0, validVolumeLiters: 0, lostVolumeLiters: 0, assignedFarmerLiters: 45, status: 'missing' },
      ];
    },
  };
  const history = await OwnerIfishi.getHistory({ ownerUserId, startDate: '2026-10-01', endDate: '2026-10-31', repository });

  assert.equal(history.entries[0].volumeLiters, 100);
  assert.equal(history.entries[0].assignedFarmerLiters, 70);
  assert.equal(history.entries[0].surplusLiters, 30);
  assert.equal(history.entries[1].status, 'cancelled');
  assert.equal(history.entries[1].validVolumeLiters, 0);
  assert.equal(history.entries[2].surplusLiters, 0);
  assert.deepEqual(history.totals, { ownerVolumeLiters: 100, assignedFarmerLiters: 115, surplusLiters: 30 });
  assert.doesNotMatch(JSON.stringify(history), /gross|amount|price|payment|deduction|transport|ubwikorezi|ejo.?heza|RWF/i);
});

test('missed historical Owner Ifishi entry persists through the milk-record repository path', async () => {
  const repository = inMemoryRepository();
  const entry = await OwnerIfishi.createEntry({
    ownerUserId,
    actorId: ownerUserId,
    date: '2026-10-02',
    volumeLiters: '25.5',
    repository,
    now: fixedNow,
  });

  assert.equal(entry.date, '2026-10-02');
  assert.equal(entry.validVolumeLiters, 25.5);
  assert.equal(repository.saved.length, 1);
  assert.equal(repository.saved[0].ownerUserId, ownerUserId);
});

test('Owner Ifishi historical correction persists and can only target the authenticated owner record', async () => {
  const repository = inMemoryRepository();
  await OwnerIfishi.createEntry({ ownerUserId, date: '2026-10-02', volumeLiters: 25, repository, now: fixedNow });
  const corrected = await OwnerIfishi.correctEntry({
    ownerUserId,
    actorId: ownerUserId,
    id: 1,
    date: '2026-10-02',
    volumeLiters: 31,
    repository,
    now: fixedNow,
  });
  const crossOwner = await OwnerIfishi.correctEntry({
    ownerUserId: 99,
    id: 1,
    date: '2026-10-02',
    volumeLiters: 31,
    repository: { ...repository, correctOwnerEntry: async () => null, getPriceAtDate: async () => null, getOwnerIfishiHistory: async () => [] },
    now: fixedNow,
  });

  assert.equal(corrected.volumeLiters, 31);
  assert.equal(repository.saved[0].validVolumeLiters, 31);
  assert.equal(crossOwner, null);
});

test('Owner Ifishi repository writes milk_records with owner scope and audit history', async () => {
  const queries = [];
  const createdRow = {
    id: 801, owner_user_id: ownerUserId, date: '2026-10-02', volume_liters: 25,
    valid_volume_liters: 25, original_volume_liters: 25, lost_volume_liters: 0,
    price_per_liter: 400, amount: 10000, status: 'valid', is_owner_milk: true,
  };
  const pool = { connect: async () => ({
    query: async (text, values = []) => {
      queries.push({ text, values });
      if (text.includes('SELECT * FROM milk_records')) return { rows: [] };
      if (text.includes('INSERT INTO milk_records')) return { rows: [createdRow] };
      return { rows: [] };
    },
    release() {},
  }) };

  const result = await CollectorMilkRepository.createOwnerEntry({
    ownerUserId, actorId: ownerUserId, date: '2026-10-02', volumeLiters: 25, pricePerLiter: 400, pool,
  });
  const insert = queries.find(({ text }) => text.includes('INSERT INTO milk_records'));
  const audit = queries.find(({ text }) => text.includes('INSERT INTO audit_logs'));

  assert.equal(result.id, 801);
  assert.match(insert.text, /farmer_id, owner_user_id/);
  assert.match(insert.text, /is_owner_milk/);
  assert.equal(insert.values[0], ownerUserId);
  assert.equal(insert.values[5], 25);
  assert.match(audit.text, /VALUES \('milk_record'/);
  assert.equal(audit.values[3], ownerUserId);
  assert.equal(audit.values[4], ownerUserId);
});

test('Owner Ifishi history query scopes owner rows and assigned farmer rows through authenticated assignments', async () => {
  let captured;
  await CollectorMilkRepository.getOwnerIfishiHistory({
    ownerUserId,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    runQuery: async (text, values) => {
      captured = { text, values };
      return { rows: [{ id: 9, owner_user_id: ownerUserId, date: '2026-10-04', volume_liters: 100, valid_volume_liters: 100, original_volume_liters: 100, lost_volume_liters: 0, assigned_farmer_liters: 70, status: 'valid' }] };
    },
  });

  assert.deepEqual(captured.values, [ownerUserId, '2026-10-01', '2026-10-31']);
  assert.match(captured.text, /mr\.owner_user_id = \$1/);
  assert.match(captured.text, /ca\.collector_user_id = \$1/);
  assert.match(captured.text, /mr\.is_owner_milk = TRUE/);
  assert.match(captured.text, /farmer_daily/);
});

test('Owner Ifishi cross-owner history is empty under the requested authenticated owner scope', async () => {
  let scopedOwner;
  const history = await OwnerIfishi.getHistory({
    ownerUserId: 99,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    repository: { getOwnerIfishiHistory: async ({ ownerUserId: requestedOwner }) => { scopedOwner = requestedOwner; return []; } },
  });
  assert.equal(scopedOwner, 99);
  assert.deepEqual(history.entries, []);
  assert.deepEqual(history.totals, { ownerVolumeLiters: 0, assignedFarmerLiters: 0, surplusLiters: 0 });
});

test('Owner Ifishi correction SQL rejects cross-owner record IDs and audits legitimate corrections', async () => {
  const queries = [];
  const pool = { connect: async () => ({
    query: async (text, values = []) => {
      queries.push({ text, values });
      if (text.includes('SELECT * FROM milk_records')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  }) };
  const missing = await CollectorMilkRepository.correctOwnerEntry({
    id: 801, ownerUserId: 99, actorId: 99, date: '2026-10-02', volumeLiters: 30, pricePerLiter: 400, pool,
  });
  const scopedLookup = queries.find(({ text }) => text.includes('SELECT * FROM milk_records'));

  assert.equal(missing, null);
  assert.match(scopedLookup.text, /id = \$1 AND owner_user_id = \$2 AND is_owner_milk = TRUE/);
  assert.deepEqual(scopedLookup.values, [801, 99]);
});

test('Owner Ifishi legitimate correction updates milk_records and records the actor in the audit trail', async () => {
  const queries = [];
  const existing = {
    id: 801, owner_user_id: ownerUserId, date: '2026-10-02', volume_liters: 25,
    valid_volume_liters: 25, original_volume_liters: 25, lost_volume_liters: 0, status: 'valid',
  };
  const updated = { ...existing, volume_liters: 31, valid_volume_liters: 31, original_volume_liters: 31 };
  const pool = { connect: async () => ({
    query: async (text, values = []) => {
      queries.push({ text, values });
      if (text.includes('SELECT * FROM milk_records')) return { rows: [existing] };
      if (text.includes('UPDATE milk_records')) return { rows: [updated] };
      return { rows: [] };
    },
    release() {},
  }) };
  const result = await CollectorMilkRepository.correctOwnerEntry({
    id: 801, ownerUserId, actorId: ownerUserId, date: '2026-10-02', volumeLiters: 31, pricePerLiter: 400, pool,
  });
  const update = queries.find(({ text }) => text.includes('UPDATE milk_records'));
  const audit = queries.find(({ text }) => text.includes('INSERT INTO audit_logs'));

  assert.equal(result.volumeLiters, 31);
  assert.match(update.text, /WHERE id = \$7 AND owner_user_id = \$8 AND is_owner_milk = TRUE/);
  assert.equal(update.values[4], 31);
  assert.equal(audit.values[1], 'owner_ifishi_corrected');
  assert.equal(audit.values[3], ownerUserId);
  assert.equal(audit.values[4], ownerUserId);
});

test('owner settlement history reads owner-tagged milk_records instead of the legacy ledger', () => {
  const query = ReportRepository.buildCollectorEntriesQuery({ ownerUserId, startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.match(query.text, /FROM milk_records cm/);
  assert.match(query.text, /cm\.owner_user_id = \$1 AND cm\.is_owner_milk = TRUE/);
  assert.doesNotMatch(query.text, /FROM collector_milk_records/);
});

test('Owner Ifishi migration backfills legacy owner entries into milk_records and constrains ownership identity', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '010_owner_ifishi_milk_records.sql'), 'utf8');
  assert.match(migration, /ALTER COLUMN farmer_id DROP NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_milk_records_owner_daily/);
  assert.match(migration, /INSERT INTO milk_records/);
  assert.match(migration, /FROM collector_milk_records cm/);
  assert.match(migration, /ON CONFLICT \(owner_user_id, date\).*DO NOTHING/s);
});

test('Owner Ifishi API derives owner scope from authentication and keeps financial fields out of payload code', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ifishi', 'owner', 'route.js'), 'utf8');
  const correctionRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ifishi', 'owner', '[id]', 'route.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  assert.match(route, /ownerUserId: user\.id/);
  assert.match(route, /getHistoryForPeriod/);
  assert.doesNotMatch(route, /params\.get\(['"]startDate['"]\)|params\.get\(['"]endDate['"]\)/);
  assert.match(route, /actorId: user\.id/);
  assert.doesNotMatch(route, /ownerUserId: input\.|ownerId: input\./);
  assert.doesNotMatch(route, /params\.get\(['"]owner(?:User)?Id['"]\)/);
  assert.match(correctionRoute, /ownerUserId: user\.id/);
  assert.match(correctionRoute, /actorId: user\.id/);
  const ownerScreen = workspace.slice(workspace.indexOf('const renderOwnerIfishi'), workspace.indexOf('const renderIfishi ='));
  assert.match(ownerScreen, /ownerIfishiLoading/);
  assert.match(ownerScreen, /ownerIfishiError/);
  assert.match(ownerScreen, /ownerIfishiEmpty/);
  assert.match(ownerScreen, /type="date"/);
  assert.match(ownerScreen, /owner-ifishi-mobile-list/);
  assert.match(ownerScreen, /ownerIfishiReport\?\.farmerPayments/);
  assert.match(ownerScreen, /ownerIfishiReport\.collectorPayable/);
  assert.match(ownerScreen, /ownerIfishiReport\.collectorFarmerTransport/);
  assert.match(ownerScreen, /ownerIfishiReport\.collectorFarmerDeductions/);
  assert.match(styles, /\.owner-ifishi-desktop-list \{ display: none; \}/);
  assert.match(styles, /\.owner-ifishi-mobile-list \{ display: grid;/);
});

test('Owner Ifishi resolves half-month history dates on the server', async () => {
  let filters;
  const history = await OwnerIfishi.getHistoryForPeriod({
    ownerUserId,
    month: '02',
    year: '2024',
    periodType: 'second-half',
    repository: { getOwnerIfishiHistory: async (input) => { filters = input; return []; } },
  });
  assert.deepEqual(filters, { ownerUserId, startDate: '2024-02-16', endDate: '2024-02-29' });
  assert.equal(history.startDate, '2024-02-16');
  assert.equal(history.endDate, '2024-02-29');
});