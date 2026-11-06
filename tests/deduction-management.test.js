const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDeductionRecovery, getUkweziPeriodKind, validateDeductionPeriod } = require('../lib/utils/deduction-period.js');
const Deductions = require('../lib/services/deduction-service.js');
const { SETUP_MESSAGE, isMissingDeductionSetup } = require('../lib/utils/deduction-schema-error.js');
const DeductionRepository = require('../lib/repositories/deductionRepository.js');
const fs = require('node:fs');
const path = require('node:path');

test('deduction periods validate Ukwezi half-month and full-month boundaries', () => {
  assert.equal(getUkweziPeriodKind('2026-11-01', '2026-11-15'), 'PERIOD');
  assert.equal(getUkweziPeriodKind('2026-11-16', '2026-11-30'), 'PERIOD');
  assert.equal(getUkweziPeriodKind('2024-02-01', '2024-02-29'), 'MONTHLY');
  assert.equal(getUkweziPeriodKind('2026-11-02', '2026-11-15'), null);
  assert.equal(getUkweziPeriodKind('2026-11-16', '2026-11-31'), null);
});

test('deduction configuration frequency and effective date must match the selected period', () => {
  assert.equal(validateDeductionPeriod({ periodStart: '2026-11-16', periodEnd: '2026-11-30', frequency: 'PERIOD', effectiveStartDate: '2026-11-16' }), 'PERIOD');
  assert.equal(validateDeductionPeriod({ periodStart: '2026-12-01', periodEnd: '2026-12-31', frequency: 'MONTHLY', effectiveStartDate: '2026-12-01' }), 'MONTHLY');
  assert.throws(() => validateDeductionPeriod({ periodStart: '2026-12-01', periodEnd: '2026-12-15', frequency: 'MONTHLY' }), /full-month/i);
  assert.throws(() => validateDeductionPeriod({ periodStart: '2026-12-16', periodEnd: '2026-12-31', frequency: 'PERIOD', effectiveStartDate: '2027-01-01' }), /not effective/i);
});

test('configured deductions never recover more than available earnings and carry the remainder', () => {
  assert.deepEqual(calculateDeductionRecovery({ chargeAmount: 500, availableEarnings: 180 }), { recoveredAmount: 180, outstandingAmount: 320 });
  assert.deepEqual(calculateDeductionRecovery({ chargeAmount: 500, availableEarnings: -20 }), { recoveredAmount: 0, outstandingAmount: 500 });
  assert.deepEqual(calculateDeductionRecovery({ chargeAmount: 500, availableEarnings: 900 }), { recoveredAmount: 500, outstandingAmount: 0 });
});

test('farmer-period ledger SQL starts from all farmers and left-joins period deductions and debts', () => {
  const query = DeductionRepository.buildFarmerPeriodLedgerQuery({
    ownerUserId: 42,
    collectorUserId: 42,
    periodStart: '2026-11-16',
    periodEnd: '2026-11-30',
    farmerStatus: 'NOT_DEDUCTED',
    search: 'Aline',
    cursor: 15,
    limit: 25,
  });
  assert.match(query.text, /FROM farmers f/);
  assert.match(query.text, /LEFT JOIN LATERAL/);
  assert.match(query.text, /d\.date BETWEEN \$2::date AND \$3::date/);
  assert.match(query.text, /f\.owner_user_id = \$1/);
  assert.match(query.text, /f\.collector_user_id = \$5/);
  assert.match(query.text, /farmer_id > \$7::bigint/);
  assert.match(query.text, /summary AS \([\s\S]*COUNT\(\*\) FILTER \(WHERE deduction_amount > 0 OR debt_repaid_in_period > 0\)/);
  assert.match(query.text, /SELECT page\.\*, summary\.\* FROM summary LEFT JOIN page ON TRUE/);
  const summaryQuery = query.text.slice(query.text.indexOf('summary AS ('));
  assert.doesNotMatch(summaryQuery, /farmer_id > \$7::bigint/);
  assert.match(query.text, /ledger_status = 'NOT_DEDUCTED'/);
  assert.doesNotMatch(query.text, /JOIN deductions d ON/);
  assert.deepEqual(query.values, [42, '2026-11-16', '2026-11-30', null, 42, '%Aline%', 15, 26]);
});

test('farmer-period ledger supports all five status filters without excluding uncharged farmers', () => {
  const statuses = ['ALL', 'DEDUCTED', 'NOT_DEDUCTED', 'PARTIALLY_DEDUCTED', 'OUTSTANDING_DEBT'];
  for (const status of statuses) {
    const query = DeductionRepository.buildFarmerPeriodLedgerQuery({
      ownerUserId: 42,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-15',
      farmerStatus: status,
      limit: 50,
    });
    assert.match(query.text, /FROM farmers f/);
    assert.match(query.text, /LEFT JOIN LATERAL/);
    if (status === 'ALL') assert.doesNotMatch(query.text, /WHERE ledger_status/);
    else assert.match(query.text, new RegExp(`ledger_status = '${status}'`));
  }
  const selectedConfig = DeductionRepository.buildFarmerPeriodLedgerQuery({
    ownerUserId: 42,
    periodStart: '2026-11-16',
    periodEnd: '2026-11-30',
    configurationId: 19,
    farmerStatus: 'NOT_DEDUCTED',
  });
  assert.match(selectedConfig.text, /i\.configuration_id = \$4/);
  assert.match(selectedConfig.text, /WHEN \$4::bigint IS NOT NULL AND configured_deduction_count = 0 THEN 'NOT_DEDUCTED'/);
  assert.deepEqual(selectedConfig.values, [42, '2026-11-16', '2026-11-30', 19, 101]);
});

test('farmer-period ledger service validates date range, status, cursor, and page bounds', async () => {
  let received;
  await Deductions.listFarmerPeriodLedger({
    ownerUserId: 42,
    periodStart: '2026-11-01',
    periodEnd: '2026-11-15',
    farmerStatus: 'NOT_DEDUCTED',
    cursor: '12',
    repository: { listFarmerPeriodLedger: async (filters) => { received = filters; return filters; } },
  });
  assert.equal(received.cursor, 12);
  assert.equal(received.farmerStatus, 'NOT_DEDUCTED');
  await assert.rejects(() => Deductions.listFarmerPeriodLedger({ ownerUserId: 42, periodStart: '2026-11-02', periodEnd: '2026-11-15', repository: {} }), /valid Ukwezi/i);
  await assert.rejects(() => Deductions.listFarmerPeriodLedger({ ownerUserId: 42, periodStart: '2026-11-01', periodEnd: '2026-11-15', farmerStatus: 'UNKNOWN', repository: {} }), /invalid farmer deduction status/i);
  await assert.rejects(() => Deductions.listFarmerPeriodLedger({ ownerUserId: 42, periodStart: '2026-11-01', periodEnd: '2026-11-15', cursor: 'bad', repository: {} }), /cursor/i);
});

test('manual batch validates farmer IDs and carries the selected configuration and period to the repository', async () => {
  let received;
  await Deductions.applyDeductionBatch({
    ownerUserId: 42,
    actorId: 42,
    input: { configurationId: 8, farmerIds: [4, 9], periodStart: '2026-11-16', periodEnd: '2026-11-30', requestKey: 'batch-123' },
    repository: { applyDeductionBatch: async (input) => { received = input; return input; } },
  });
  assert.equal(received.configurationId, 8);
  assert.deepEqual(received.farmerIds, [4, 9]);
  assert.equal(received.periodStart, '2026-11-16');
  assert.equal(received.requestKey, 'batch-123');
  await assert.rejects(() => Deductions.applyDeductionBatch({ ownerUserId: 42, input: { configurationId: 8, farmerIds: [4, 4], periodStart: '2026-11-16', periodEnd: '2026-11-30', requestKey: 'batch-123' }, repository: {} }), /once/i);
  await assert.rejects(() => Deductions.applyDeductionBatch({ ownerUserId: 42, input: { configurationId: 8, farmerIds: [4], periodStart: '2026-11-16', periodEnd: '2026-11-30' }, repository: {} }), /idempotency/i);
});

test('applyToAll batch skips explicit farmer IDs and sends applyToAll flag to repository', async () => {
  let received;
  await Deductions.applyDeductionBatch({
    ownerUserId: 42,
    actorId: 42,
    input: { configurationId: 8, applyToAll: true, farmerIds: [], periodStart: '2026-11-16', periodEnd: '2026-11-30', requestKey: 'batch-all-123' },
    repository: { applyDeductionBatch: async (input) => { received = input; return input; } },
  });
  assert.equal(received.applyToAll, true);
  assert.deepEqual(received.farmerIds, []);
  assert.equal(received.requestKey, 'batch-all-123');
});

test('previewDeductionBatch carries configuration, farmer IDs, applyToAll, and period to the repository', async () => {
  let received;
  await Deductions.previewDeductionBatch({
    ownerUserId: 42,
    input: { configurationId: 8, farmerIds: [1, 2, 3], periodStart: '2026-11-16', periodEnd: '2026-11-30' },
    repository: { previewDeductionBatch: async (input) => { received = input; return { summary: { requested: 3, toApply: 3, totalConfigured: 450, totalRecovered: 300, totalOutstanding: 150 } }; } },
  });
  assert.equal(received.configurationId, 8);
  assert.deepEqual(received.farmerIds, [1, 2, 3]);
  assert.equal(received.periodStart, '2026-11-16');
  assert.equal(received.periodEnd, '2026-11-30');
  assert.equal(received.applyToAll, false);
});

test('previewDeductionBatch with applyToAll sends applyToAll flag and no farmer IDs', async () => {
  let received;
  await Deductions.previewDeductionBatch({
    ownerUserId: 42,
    input: { configurationId: 8, applyToAll: true, farmerIds: [], periodStart: '2026-11-16', periodEnd: '2026-11-30' },
    repository: { previewDeductionBatch: async (input) => { received = input; return { summary: { requested: 50, toApply: 50, totalConfigured: 7500, totalRecovered: 5000, totalOutstanding: 2500 } }; } },
  });
  assert.equal(received.applyToAll, true);
  assert.deepEqual(received.farmerIds, []);
});

test('batch input rejects more than 5000 explicit farmers', async () => {
  const manyIds = Array.from({ length: 5001 }, (_, i) => i + 1);
  await assert.rejects(() => Deductions.applyDeductionBatch({
    ownerUserId: 42, input: { configurationId: 8, farmerIds: manyIds, periodStart: '2026-11-16', periodEnd: '2026-11-30', requestKey: 'batch-many' },
    repository: { applyDeductionBatch: async () => ({}) },
  }), /5000/);
});

test('batch input accepts up to 5000 explicit farmers', async () => {
  const manyIds = Array.from({ length: 5000 }, (_, i) => i + 1);
  let received;
  await Deductions.applyDeductionBatch({
    ownerUserId: 42, input: { configurationId: 8, farmerIds: manyIds, periodStart: '2026-11-16', periodEnd: '2026-11-30', requestKey: 'batch-max' },
    repository: { applyDeductionBatch: async (input) => { received = input; return { succeeded: [], duplicates: [], skipped: [], failed: [], summary: {} }; } },
  });
  assert.deepEqual(received.farmerIds, manyIds);
});

test('batch input requires requestKey for apply operations', async () => {
  await assert.rejects(() => Deductions.applyDeductionBatch({
    ownerUserId: 42, input: { configurationId: 8, farmerIds: [1], periodStart: '2026-11-16', periodEnd: '2026-11-30' },
    repository: { applyDeductionBatch: async () => ({}) },
  }), /idempotency/i);
});

test('deduction configurations are manual-only and batch rows are unique per farmer, configuration, and period', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/031_deduction_period_batch_management.sql'), 'utf8');
  const repository = fs.readFileSync(path.join(__dirname, '../lib/repositories/deductionRepository.js'), 'utf8');
  const configUpdate = repository.slice(repository.indexOf('const updateDeductionConfiguration'), repository.indexOf('const applyDeductionBatch'));
  assert.match(migration, /execution_mode VARCHAR\(20\) NOT NULL DEFAULT 'MANUAL' CHECK \(execution_mode = 'MANUAL'\)/);
  assert.match(migration, /UNIQUE \(owner_user_id, farmer_id, configuration_id, period_start\)/);
  assert.match(migration, /UNIQUE \(owner_user_id, reference\)/);
  assert.match(configUpdate, /UPDATE deduction_configurations/);
  assert.doesNotMatch(configUpdate, /UPDATE deductions|UPDATE deduction_batch_items/);
  assert.match(repository, /deduction-batch:\$\{ownerUserId\}:\$\{farmerId\}:\$\{periodStart\}/);
  assert.match(repository, /const \{ rows: existingItems \}/);
  assert.match(repository, /Number\(config\.amount_per_farmer\)/);
});

test('no active job, report writer, or payout rendering remains for automatic Igipande charges', () => {
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  const settlementRepository = fs.readFileSync(path.join(__dirname, '../lib/repositories/farmerSettlementRepository.js'), 'utf8');
  const reportService = fs.readFileSync(path.join(__dirname, '../lib/services/monthly-report-service.js'), 'utf8');
  const pdfService = fs.readFileSync(path.join(__dirname, '../lib/services/ukwezi-pdf-service.js'), 'utf8');
  assert.equal(deployment.crons.some((cron) => cron.path.includes('igipande')), false);
  assert.doesNotMatch(settlementRepository, /ensureIgipandePeriod|farmer_igipande_contributions/);
  assert.doesNotMatch(reportService, /ensureIgipandePeriod|igipandeRecoveryAmount/);
  assert.doesNotMatch(pdfService, /igipandeTitle|igipandeRecoveryAmount/);
});

test('deduction configuration rejects scheduled execution and accepts explicit manual control', () => {
  const input = {
    name: 'Monthly co-op fee',
    description: 'Manual period batch',
    amountPerFarmer: 250,
    type: 'Other',
    eligibilityMode: 'ALL',
    eligibleFarmerIds: [],
    frequency: 'PERIOD',
    effectiveStartDate: '2026-11-16',
    isActive: true,
    executionMode: 'MANUAL',
  };
  assert.equal(Deductions.normalizeConfiguration(input).executionMode, 'MANUAL');
  assert.throws(() => Deductions.normalizeConfiguration({ ...input, executionMode: 'SCHEDULED' }), /Only manual deductions/i);
});

test('Igipande is available as a manual deduction type', () => {
  assert.ok(Deductions.VALID_TYPES.includes('Igipande'));
  assert.equal(Deductions.normalizeInput({ farmerId: 7, amount: 100, type: 'Igipande', date: '2026-11-16' }, { creating: true }).type, 'Igipande');
});

test('deduction configuration route explains when migration 031 is missing', () => {
  const route = fs.readFileSync(path.join(__dirname, '../app/api/deductions/configurations/route.js'), 'utf8');
  const ledgerRoute = fs.readFileSync(path.join(__dirname, '../app/api/deductions/route.js'), 'utf8');
  assert.match(route, /isMissingDeductionSetup/);
  assert.match(ledgerRoute, /isMissingDeductionSetup/);
  assert.match(SETUP_MESSAGE, /migration 031_deduction_period_batch_management\.sql/);
});

test('deduction endpoints explain missing or partially applied migration 031 schema', () => {
  assert.equal(isMissingDeductionSetup({ code: '42P01', message: 'relation "public.deduction_batch_items" does not exist' }), true);
  assert.equal(isMissingDeductionSetup({ code: '42703', message: 'column i.configuration_id does not exist' }), true);
  assert.equal(isMissingDeductionSetup({ code: '42P01', message: 'relation "farmers" does not exist' }), false);
  assert.equal(isMissingDeductionSetup({ code: '42703', message: 'column farmers.phone does not exist' }), false);
  assert.equal(isMissingDeductionSetup({ code: '23505', message: 'duplicate key' }), false);
});