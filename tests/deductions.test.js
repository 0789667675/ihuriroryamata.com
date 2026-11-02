const test = require('node:test');
const assert = require('node:assert/strict');

const Deductions = require('../lib/services/deduction-service.js');
const DeductionRepository = require('../lib/repositories/deductionRepository.js');

const ownerUserId = 42;

test('deduction creation preserves supported types/statuses and derives owner from server context', async () => {
  let received;
  const deduction = await Deductions.createDeduction({
    ownerUserId,
    actorId: ownerUserId,
    input: { farmerId: 7, amount: '1500', date: '2026-10-01', type: 'Advance', status: 'Active', reason: 'Feed advance' },
    repository: { createDeduction: async (input) => { received = input; return input; } },
  });
  assert.equal(deduction.ownerUserId, ownerUserId);
  assert.equal(received.input.amount, 1500);
  assert.equal(received.input.type, 'Advance');
  assert.equal(received.actorId, ownerUserId);
});

test('deductions reject invalid farmers, amounts, dates, types, and statuses', async () => {
  const repository = { createDeduction: async () => ({}) };
  await assert.rejects(() => Deductions.createDeduction({ ownerUserId, input: { farmerId: 0, amount: 10, date: '2026-10-01' }, repository }), /farmerId/i);
  await assert.rejects(() => Deductions.createDeduction({ ownerUserId, input: { farmerId: 7, amount: 0, date: '2026-10-01' }, repository }), /positive/i);
  await assert.rejects(() => Deductions.createDeduction({ ownerUserId, input: { farmerId: 7, amount: 10, date: '2026-02-30' }, repository }), /valid date/i);
  await assert.rejects(() => Deductions.createDeduction({ ownerUserId, input: { farmerId: 7, amount: 10, date: '2026-10-01', type: 'Unsupported' }, repository }), /type must/i);
  await assert.rejects(() => Deductions.createDeduction({ ownerUserId, input: { farmerId: 7, amount: 10, date: '2026-10-01', status: 'Deleted' }, repository }), /status must/i);
});

test('deduction updates require a complete payload and preserve reason and notes', async () => {
  let received;
  const record = await Deductions.updateDeduction({
    id: 10,
    ownerUserId,
    actorId: ownerUserId,
    input: { farmerId: 7, amount: '2000', date: '2026-10-02', type: 'Other', status: 'Active', reason: 'Advance repaid', notes: 'Updated notes' },
    repository: { updateDeduction: async (input) => { received = input; return input; } },
  });
  assert.equal(record.ownerUserId, ownerUserId);
  assert.equal(received.input.farmerId, 7);
  assert.equal(received.input.reason, 'Advance repaid');
  assert.equal(received.input.notes, 'Updated notes');
  await assert.rejects(() => Deductions.updateDeduction({ id: 10, ownerUserId, input: { amount: 20, date: '2026-10-02', type: 'Other', status: 'Active' }, repository: {} }), /farmerId/i);
  await assert.rejects(() => Deductions.updateDeduction({ id: 10, ownerUserId, input: { farmerId: 7, amount: 20, date: '2026-10-02', type: 'Other', status: 'Active', notes: 'Updated notes' }, repository: {} }), /reason/i);
});

test('deduction listing uses bounded cursor pagination and owner filters', async () => {
  let received;
  const expected = { data: [], pageSize: 25, hasMore: false, nextCursor: null };
  const result = await Deductions.listDeductions({
    ownerUserId,
    farmerId: '7',
    cursor: '2026-09-30:18',
    limit: '25',
    repository: { listDeductions: async (input) => { received = input; return expected; } },
  });
  assert.equal(result, expected);
  assert.equal(received.ownerUserId, ownerUserId);
  assert.equal(received.farmerId, 7);
  assert.equal(received.cursor.id, 18);
  await assert.rejects(() => Deductions.listDeductions({ ownerUserId, limit: 101, repository: {} }), /between 1 and 100/i);
});

test('deduction list SQL binds owner, farmer, date cursor, and page limit', () => {
  const query = DeductionRepository.buildDeductionListQuery({
    ownerUserId,
    farmerId: 7,
    cursor: { date: '2026-09-30', id: 18 },
    limit: 25,
  });
  assert.match(query.text, /d\.owner_user_id = \$1/);
  assert.match(query.text, /f\.owner_user_id = d\.owner_user_id/);
  assert.match(query.text, /d\.farmer_id = \$2/);
  assert.match(query.text, /\(d\.date, d\.id\) < \(\$3::date, \$4::bigint\)/);
  assert.match(query.text, /LIMIT \$5/);
  assert.deepEqual(query.values, [42, 7, '2026-09-30', 18, 26]);
});

test('deduction list combines owner, text, type, status and numeric amount sort with a stable cursor', () => {
  const query = DeductionRepository.buildDeductionListQuery({
    ownerUserId,
    farmerId: 7,
    type: 'Advance',
    status: 'Active',
    search: 'Aline',
    sortBy: 'amount',
    sortDirection: 'asc',
    cursor: { value: 1250, date: '2026-10-01', id: 22 },
    limit: 10,
  });

  assert.match(query.text, /d\.owner_user_id = \$1/);
  assert.match(query.text, /f\.owner_user_id = d\.owner_user_id/);
  assert.match(query.text, /d\.farmer_id = \$2/);
  assert.match(query.text, /d\.type = \$3/);
  assert.match(query.text, /d\.status = \$4/);
  assert.match(query.text, /f\.name ILIKE \$5/);
  assert.match(query.text, /d\.amount > \$6::numeric/);
  assert.match(query.text, /d\.date > \$7::date/);
  assert.match(query.text, /d\.id > \$8::bigint/);
  assert.match(query.text, /ORDER BY d\.amount ASC, d\.date ASC, d\.id ASC LIMIT \$9/);
  assert.deepEqual(query.values, [ownerUserId, 7, 'Advance', 'Active', '%Aline%', 1250, '2026-10-01', 22, 11]);
});

test('deduction service validates sort/filter allowlists and repository emits a deterministic next cursor', async () => {
  await assert.rejects(() => Deductions.listDeductions({ ownerUserId, sortBy: 'amount DESC;--', repository: {} }), /unsupported deduction sort field/i);
  await assert.rejects(() => Deductions.listDeductions({ ownerUserId, status: 'Deleted', repository: {} }), /invalid deduction status/i);
  const rows = [
    { id: 22, owner_user_id: ownerUserId, farmer_id: 7, farmer_name: 'Aline', date: '2026-10-01', amount: '1250', type: 'Advance', status: 'Active' },
    { id: 21, owner_user_id: ownerUserId, farmer_id: 8, farmer_name: 'Bella', date: '2026-09-30', amount: '1800', type: 'Other', status: 'Active' },
  ];
  const page = await DeductionRepository.listDeductions({ ownerUserId, sortBy: 'amount', sortDirection: 'asc', limit: 1 }, async (text, values) => {
    assert.match(text, /d\.owner_user_id = \$1/);
    assert.deepEqual(values, [ownerUserId, 2]);
    return { rows };
  });
  const nextCursor = JSON.parse(Buffer.from(page.nextCursor.slice(3), 'base64url').toString('utf8'));
  assert.equal(page.hasMore, true);
  assert.deepEqual(nextCursor, { sortBy: 'amount', sortDirection: 'asc', value: 1250, date: '2026-10-01', id: 22 });
});

test('grouped query excludes farmers without matching deductions and filters aggregate rows by type and status', () => {
  const query = DeductionRepository.buildFarmerGroupQuery({
    ownerUserId,
    collectorUserId: 9,
    farmerId: 7,
    type: 'Advance',
    status: 'Active',
    search: 'Aline',
    limit: 25,
  });
  assert.match(query.text, /SUM\(CASE WHEN d\.status = 'Active' THEN 1 ELSE 0 END\)::integer AS active_count/i);
  assert.match(query.text, /SUM\(CASE WHEN d\.status = 'Cleared' THEN d\.amount ELSE 0 END\)/i);
  assert.doesNotMatch(query.text, /d\.amountELSE/i);
  assert.match(query.text, /JOIN deductions d ON d\.farmer_id = f\.id AND d\.owner_user_id = f\.owner_user_id AND d\.type = \$4 AND d\.status = \$5/i);
  assert.doesNotMatch(query.text, /LEFT JOIN deductions/i);
  assert.match(query.text, /f\.owner_user_id = \$1/);
  assert.match(query.text, /f\.collector_user_id = \$2/);
  assert.match(query.text, /f\.id = \$3/);
  assert.match(query.text, /f\.name ILIKE \$6/);
  assert.deepEqual(query.values, [ownerUserId, 9, 7, 'Advance', 'Active', '%Aline%', 26]);
});

test('grouped totals retain separate Active and Cleared counts while independent filters constrain joined rows', () => {
  const allStatuses = DeductionRepository.buildFarmerGroupQuery({ ownerUserId, limit: 10 });
  assert.match(allStatuses.text, /COUNT\(d\.id\)::integer AS deduction_count/);
  assert.match(allStatuses.text, /SUM\(CASE WHEN d\.status = 'Active' THEN 1 ELSE 0 END\)::integer AS active_count/);
  assert.match(allStatuses.text, /SUM\(CASE WHEN d\.status = 'Cleared' THEN 1 ELSE 0 END\)::integer AS cleared_count/);
  assert.match(allStatuses.text, /SUM\(CASE WHEN d\.status = 'Active' THEN d\.amount ELSE 0 END\)/);
  assert.match(allStatuses.text, /SUM\(CASE WHEN d\.status = 'Cleared' THEN d\.amount ELSE 0 END\)/);

  const typeFiltered = DeductionRepository.buildFarmerGroupQuery({ ownerUserId, type: 'Umwenda', limit: 10 });
  assert.match(typeFiltered.text, /JOIN deductions d ON d\.farmer_id = f\.id AND d\.owner_user_id = f\.owner_user_id AND d\.type = \$2/);
  assert.deepEqual(typeFiltered.values, [ownerUserId, 'Umwenda', 11]);

  const statusFiltered = DeductionRepository.buildFarmerGroupQuery({ ownerUserId, status: 'Cleared', limit: 10 });
  assert.match(statusFiltered.text, /JOIN deductions d ON d\.farmer_id = f\.id AND d\.owner_user_id = f\.owner_user_id AND d\.status = \$2/);
  assert.deepEqual(statusFiltered.values, [ownerUserId, 'Cleared', 11]);
});

test('grouped query sorting is allowlisted and cursor boundaries use the selected aggregate and farmer tie-breaker', () => {
  const query = DeductionRepository.buildFarmerGroupQuery({
    ownerUserId,
    sortBy: 'amount',
    sortDirection: 'asc',
    cursor: { sortBy: 'amount', sortDirection: 'asc', value: 1250, farmerId: 17 },
    limit: 10,
  });
  assert.match(query.text, /WHERE \(total_active_amount > \$2::numeric OR \(total_active_amount = \$2::numeric AND farmer_id > \$3::bigint\)\)/);
  assert.match(query.text, /ORDER BY total_active_amount ASC, farmer_id ASC/);
  assert.deepEqual(query.values, [ownerUserId, 1250, 17, 11]);
  assert.doesNotMatch(query.text, /ORDER BY [^\n]*(?:;|--)/);
});

test('grouped service validates sort fields, directions and cursor tokens as bad requests', async () => {
  const repository = { listFarmerDeductionGroups: async (filters) => filters };
  await assert.rejects(
    () => Deductions.listDeductionGroups({ ownerUserId, sortBy: 'amount DESC;--', repository }),
    (error) => error.statusCode === 400 && /sort field/i.test(error.message),
  );
  await assert.rejects(
    () => Deductions.listDeductionGroups({ ownerUserId, sortDirection: 'sideways', repository }),
    (error) => error.statusCode === 400 && /sortDirection/i.test(error.message),
  );
  await assert.rejects(
    () => Deductions.listDeductionGroups({ ownerUserId, cursor: 'invalid', repository }),
    (error) => error.statusCode === 400 && /cursor/i.test(error.message),
  );
});

test('grouped pagination returns a stable cursor and continues after the last farmer without duplicates', async () => {
  const pages = [
    [
      { farmer_id: 1, farmer_name: 'Aline', deduction_count: 2, active_count: 2, cleared_count: 0, total_active_amount: 1250, total_cleared_amount: 0, latest_deduction_date: '2026-10-12' },
      { farmer_id: 2, farmer_name: 'Bella', deduction_count: 1, active_count: 0, cleared_count: 1, total_active_amount: 0, total_cleared_amount: 800, latest_deduction_date: '2026-10-10' },
      { farmer_id: 3, farmer_name: 'Cleo', deduction_count: 1, active_count: 1, cleared_count: 0, total_active_amount: 200, total_cleared_amount: 0, latest_deduction_date: '2026-10-08' },
    ],
    [
      { farmer_id: 3, farmer_name: 'Cleo', deduction_count: 1, active_count: 1, cleared_count: 0, total_active_amount: 200, total_cleared_amount: 0, latest_deduction_date: '2026-10-08' },
      { farmer_id: 4, farmer_name: 'Dora', deduction_count: 1, active_count: 1, cleared_count: 0, total_active_amount: 500, total_cleared_amount: 0, latest_deduction_date: '2026-10-06' },
    ],
  ];
  let groupQueryCount = 0;
  let nextQuery;
  const runQuery = async (text, values = []) => {
    if (text.includes('SELECT dairy_user_id FROM collector_assignments')) return { rows: [{ dairy_user_id: ownerUserId }] };
    groupQueryCount += 1;
    if (groupQueryCount === 1) {
      assert.match(text, /ORDER BY latest_deduction_date DESC, farmer_id ASC/);
      assert.deepEqual(values, [ownerUserId, 9, 3]);
    } else {
      nextQuery = { text, values };
    }
    return { rows: pages[groupQueryCount - 1] };
  };
  const first = await DeductionRepository.listFarmerDeductionGroups({ ownerUserId, collectorUserId: 9, limit: 2 }, runQuery);
  const cursor = Deductions.normalizeGroupCursor(first.nextCursor, 'date', 'desc');
  const second = await DeductionRepository.listFarmerDeductionGroups({ ownerUserId, collectorUserId: 9, limit: 2, sortBy: 'date', sortDirection: 'desc', cursor }, runQuery);
  assert.deepEqual(first.data.map((group) => group.farmerId), [1, 2]);
  assert.deepEqual(second.data.map((group) => group.farmerId), [3, 4]);
  assert.match(nextQuery.text, /latest_deduction_date < \$3::date/);
  assert.deepEqual(nextQuery.values, [ownerUserId, 9, '2026-10-10', 2, 3]);
});

test('grouped collector scope filters assigned farmers and farmerId is passed through', async () => {
  let groupedQuery;
  const runQuery = async (text, values = []) => {
    if (text.includes('SELECT dairy_user_id FROM collector_assignments')) return { rows: [{ dairy_user_id: ownerUserId }] };
    groupedQuery = { text, values };
    return { rows: [] };
  };
  await Deductions.listDeductionGroups({ ownerUserId: 9, collectorUserId: 9, farmerId: 7, limit: 20, repository: {
    listFarmerDeductionGroups: (filters) => DeductionRepository.listFarmerDeductionGroups(filters, runQuery),
  } });
  assert.match(groupedQuery.text, /f\.owner_user_id = \$1/);
  assert.match(groupedQuery.text, /f\.collector_user_id = \$2/);
  assert.match(groupedQuery.text, /f\.id = \$3/);
  assert.deepEqual(groupedQuery.values, [ownerUserId, 9, 7, 21]);
});

test('deduction deletion preserves the historical row by clearing it with an audit event', async () => {
  const statements = [];
  const pool = {
    connect: async () => ({
      query: async (text, values = []) => {
        statements.push({ text, values });
        if (text.includes('SELECT d.*')) return { rows: [{ id: 12, farmer_id: 7, owner_user_id: ownerUserId, amount: 1500, type: 'Advance', status: 'Active', date: '2026-10-01' }] };
        if (text.includes('UPDATE deductions SET status')) return { rows: [{ id: 12, status: 'Cleared' }] };
        return { rows: [] };
      },
      release() {},
    }),
  };

  const deleted = await DeductionRepository.deleteDeduction({ id: 12, ownerUserId, actorId: ownerUserId, poolProvider: () => pool });

  assert.equal(deleted, true);
  assert.ok(statements.some(({ text }) => text.includes("UPDATE deductions SET status = 'Cleared'")));
  assert.ok(statements.some(({ text, values }) => text.includes('INSERT INTO audit_logs') && values[1] === 'cleared'));
  assert.equal(statements.some(({ text }) => text.includes('DELETE FROM deductions')), false);
});
