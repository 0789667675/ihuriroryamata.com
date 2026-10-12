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

test('deduction updates require amount/date and retain legacy defaults for omitted optional fields', async () => {
  let received;
  const record = await Deductions.updateDeduction({
    id: 10,
    ownerUserId,
    actorId: ownerUserId,
    input: { amount: '2000', date: '2026-10-02' },
    repository: { updateDeduction: async (input) => { received = input; return input; } },
  });
  assert.equal(record.ownerUserId, ownerUserId);
  assert.equal(received.input.type, 'Other');
  assert.equal(received.input.status, 'Active');
  assert.equal(received.input.reason, null);
  await assert.rejects(() => Deductions.updateDeduction({ id: 10, ownerUserId, input: { amount: 20 }, repository: {} }), /date/i);
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
