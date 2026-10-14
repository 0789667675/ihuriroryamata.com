const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmer-settlements', 'route.js'), 'utf8');
const repositorySource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'repositories', 'farmerSettlementRepository.js'), 'utf8');

test('settlement GET reads authenticate and separate owner summaries from collector confirmations', () => {
  assert.match(routeSource, /getAuthenticatedUser\(request\)/);
  assert.match(routeSource, /if \(action === 'confirmations'\)\s*\{\s*requireCollector\(user\)/);
  assert.match(routeSource, /JOIN collector_assignments ca ON ca\.dairy_user_id = s\.owner_user_id/);
  assert.match(routeSource, /ca\.collector_user_id = \$1 AND ca\.revoked_at IS NULL/);
  assert.match(routeSource, /f\.collector_user_id = \$1/);
  assert.match(routeSource, /requireOwner\(user\)/);
  assert.match(routeSource, /assertOwnerScope\(user, ownerUserId\)/);
});

test('settlement POST confirms only the assigned collector and exact approved farmer period', () => {
  assert.match(routeSource, /if \(action === 'confirm'\)\s*\{\s*requireCollector\(user\)/);
  assert.match(routeSource, /s\.status = 'APPROVED'/);
  assert.match(routeSource, /f\.collector_user_id = \$1 AND s\.id = \$2 AND s\.farmer_id = \$3/);
  assert.match(routeSource, /s\.period_start = \$4::date AND s\.period_end = \$5::date/);
  assert.match(routeSource, /assertAssignedCollector\(user, rows\[0\]\.assignedCollectorUserId\)/);
  assert.match(routeSource, /requireOwnerAction\(user, action\)/);
  assert.match(routeSource, /approvedBy: Number\(user\.id\)/);
  assert.doesNotMatch(routeSource, /approvedBy: Number\(body\.approvedBy/);
  assert.match(repositorySource, /farmer_id = \$6 AND owner_user_id = \$7 AND status = 'APPROVED'/);
  assert.match(repositorySource, /ca\.collector_user_id = \$1 AND ca\.revoked_at IS NULL/);
});
