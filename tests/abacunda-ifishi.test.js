const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Milk = require('../lib/services/milk-service.js');
const MilkRepository = require('../lib/repositories/milkRepository.js');
const AssignmentRepository = require('../lib/repositories/collectorAssignmentRepository.js');

test('Abacunda Ifishi history aggregates milk-only totals under the authenticated Dairy scope', async () => {
  let requested;
  const result = await Milk.getAbacundaIfishiHistory({
    dairyUserId: 77,
    collectorUserId: 42,
    centerId: 8,
    startDate: '2026-02-01',
    endDate: '2026-02-15',
    repository: {
      getAbacundaIfishiHistory: async (filters) => {
        requested = filters;
        return [
          { date: '2026-02-03', morningLiters: 500, eveningLiters: 420, originalLiters: 1000, validLiters: 920, lostLiters: 80, status: 'adjusted', reason: 'Lost milk' },
          { date: '2026-02-04', morningLiters: 0, eveningLiters: 0, originalLiters: 80, validLiters: 0, lostLiters: 80, status: 'cancelled', reason: 'Voided' },
        ];
      },
    },
  });

  assert.deepEqual(requested, { dairyUserId: 77, collectorUserId: 42, centerId: 8, startDate: '2026-02-01', endDate: '2026-02-15' });
  assert.equal(result.totals.morningLiters, 500);
  assert.equal(result.totals.eveningLiters, 420);
  assert.equal(result.totals.originalLiters, 1080);
  assert.equal(result.totals.validLiters, 920);
  assert.equal(result.totals.lostLiters, 160);
  assert.equal(result.entries[1].status, 'cancelled');
  assert.doesNotMatch(JSON.stringify(result), /RWF|amount|price|deduction|transport|ejo.?heza/i);
});

test('Abacunda history SQL enforces active Ikigo, linked Collector, dates, and owner isolation', async () => {
  let captured;
  await MilkRepository.getAbacundaIfishiHistory({
    dairyUserId: 77,
    collectorUserId: 42,
    centerId: 8,
    startDate: '2026-02-01',
    endDate: '2026-02-15',
    runQuery: async (text, values) => {
      captured = { text, values };
      return { rows: [{ date: '2026-02-03', morning_liters: '500', evening_liters: '420', original_liters: '1000', valid_liters: '920', lost_liters: '80', status: 'adjusted', reason: 'Lost milk' }] };
    },
  });

  assert.match(captured.text, /ca\.dairy_user_id = \$1 AND ca\.collector_user_id = \$2 AND c\.id = \$3/);
  assert.match(captured.text, /mr\.date BETWEEN \$4 AND \$5/);
  assert.match(captured.text, /mr\.is_owner_milk = FALSE/);
  assert.match(captured.text, /mr\.status = 'cancelled' THEN 0/);
  assert.deepEqual(captured.values, [77, 42, 8, '2026-02-01', '2026-02-15']);
  assert.doesNotMatch(captured.text, /amount|price_per_liter|deduction|transport|ejo.?heza/i);
});

test('Dairy Abacunda assignments are filtered through an owner-owned active Ikigo', async () => {
  let captured;
  await AssignmentRepository.getAssignments(77, 8, async (text, values) => {
    captured = { text, values };
    return { rows: [] };
  });

  assert.match(captured.text, /ca\.dairy_user_id = \$1/);
  assert.match(captured.text, /c\.owner_user_id = f\.owner_user_id/);
  assert.match(captured.text, /\$2::bigint IS NULL OR c\.id = \$2/);
  assert.deepEqual(captured.values, [77, 8]);
});

test('Dairy Abacunda Ifishi endpoint derives scope from auth and requires linked active-center membership', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ifishi', 'abacunda', 'route.js'), 'utf8');

  assert.match(route, /user\.accountType !== 'COLLECTION_CENTER'/);
  assert.match(route, /Assignments\.listAssignments\(\{ dairyUserId: user\.id, centerId \}\)/);
  assert.match(route, /dairyUserId: user\.id/);
  assert.doesNotMatch(route, /ownerUserId: params|dairyUserId: params/);
});