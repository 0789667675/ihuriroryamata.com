const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmer-settlements', 'route.js'), 'utf8');
const repositorySource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'repositories', 'farmerSettlementRepository.js'), 'utf8');

test('settlement GET is Collector-only and scopes history and debts through active assignments', () => {
  assert.match(routeSource, /getAuthenticatedUser\(request\)/);
  assert.match(routeSource, /export async function GET\(request\)\s*\{\s*try\s*\{\s*const user = await getAuthenticatedUser\(request\);[\s\S]*?requireCollector\(user\)/);
  assert.match(routeSource, /export async function POST\(request\)\s*\{\s*try\s*\{\s*const user = await getAuthenticatedUser\(request\);[\s\S]*?requireCollector\(user\)/);
  assert.match(routeSource, /JOIN collector_assignments ca ON ca\.dairy_user_id = s\.owner_user_id/);
  assert.match(routeSource, /ca\.collector_user_id = \$1 AND ca\.revoked_at IS NULL/);
  assert.match(routeSource, /f\.collector_user_id = \$1/);
  assert.match(routeSource, /const getAssignedFarmer = async/);
  assert.match(routeSource, /assignedCollectorOnly: true/);
  assert.match(routeSource, /getCurrentAccountingPeriod\(\)/);
  assert.match(routeSource, /searchParams\.get\('periodStart'\) \|\| currentPeriod\.startDate/);
  assert.match(routeSource, /searchParams\.get\('periodEnd'\) \|\| currentPeriod\.endDate/);
  assert.doesNotMatch(routeSource, /requireOwner\(user\)|assertOwnerScope\(user/);
});

test('settlement POST keeps confirmation period, cash, and debt writes within the assigned Collector scope', () => {
  assert.match(routeSource, /if \(action === 'confirm'\)\s*\{/);
  assert.match(routeSource, /s\.status = 'APPROVED'/);
  assert.match(routeSource, /f\.collector_user_id = \$1 AND s\.id = \$2 AND s\.farmer_id = \$3/);
  assert.match(routeSource, /s\.period_start = \$4::date AND s\.period_end = \$5::date/);
  assert.match(routeSource, /assertAssignedCollector\(user, rows\[0\]\.assignedCollectorUserId\)/);
  assert.match(routeSource, /collectorUserId: Number\(user\.id\), amount, paymentMethod: 'CASH'/);
  assert.match(routeSource, /status IN \('APPROVED', 'CONFIRMED'\)/);
  assert.match(routeSource, /collectorUserId: Number\(user\.id\), openingBalance/);
  assert.match(routeSource, /collectorUserId: Number\(user\.id\), amount, actorId: Number\(user\.id\)/);
  assert.doesNotMatch(routeSource, /approvedBy: Number\(body\.approvedBy/);
  assert.match(repositorySource, /farmer_id = \$6 AND owner_user_id = \$7 AND status = 'APPROVED'/);
  assert.match(repositorySource, /ca\.collector_user_id = \$1 AND ca\.revoked_at IS NULL/);
  assert.match(repositorySource, /FOR KEY SHARE OF f, ca/);
  assert.match(repositorySource, /FOR UPDATE OF d, ca/);
});

test('missing settlement schema returns a safe unavailable response without database details', () => {
  assert.match(routeSource, /error\.code === '42P01' \|\| error\.code === '42703'/);
  assert.match(routeSource, /code: 'SETTLEMENT_SCHEMA_UNAVAILABLE'/);
  assert.match(routeSource, /Settlement information is temporarily unavailable\./);
  assert.doesNotMatch(routeSource, /message: error\.message \|\| 'Unable to load settlements\.'/);
});
