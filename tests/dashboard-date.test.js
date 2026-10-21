const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formatDateLabel, dayName } = require('../lib/i18n/date-format.js');
const {
  getAccountingDate,
  getCurrentAccountingPeriod,
  getAccountingHalfForDay,
} = require('../lib/utils/accounting-period.js');

const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
const dailyRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'milk', 'daily', 'route.js'), 'utf8');

test('Kigali local date remains 21 October 2026 when UTC is still 20 October', () => {
  const justAfterKigaliMidnight = new Date('2026-10-20T22:00:00Z');
  assert.equal(getAccountingDate(justAfterKigaliMidnight), '2026-10-21');
  assert.equal(getAccountingDate(new Date('2026-10-20T21:59:59Z')), '2026-10-20');

  const period = getCurrentAccountingPeriod(justAfterKigaliMidnight);
  assert.equal(period.year, '2026');
  assert.equal(period.month, '10');
  assert.equal(period.day, 21);
  assert.equal(period.periodType, 'second-half');
  assert.equal(period.startDate, '2026-10-16');
  assert.equal(period.endDate, '2026-10-31');
});

test('date labels use Kigali calendar parts and cannot move a collection date backward', () => {
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  assert.equal(formatDateLabel('2026-10-21', 'en', options), 'Wednesday 21 October 2026');
  assert.equal(formatDateLabel(new Date('2026-10-20T22:30:00Z'), 'en', options), 'Wednesday 21 October 2026');
  assert.equal(dayName(new Date('2026-10-20T22:30:00Z'), 'en'), 'Wednesday');

  // A historical previous-day view must show the previous date and the previous weekday.
  assert.equal(formatDateLabel('2026-10-20', 'en', options), 'Tuesday 20 October 2026');
  assert.equal(formatDateLabel('2026-10-20', 'rw', options), 'Ku wa kabiri 20 Ukwakira 2026');
});

test('dashboard label and daily metrics are derived from the same date-only collection value', () => {
  const dashboard = workspace.slice(workspace.indexOf('const renderDashboard'), workspace.indexOf('const renderDeductions'));
  assert.match(dashboard, /formatDateLabel\(collectionDate, publicLanguage\.language/);
  assert.doesNotMatch(dashboard, /new Date\(`\$\{collectionDate\}T00:00:00`\)/);

  // loadDaily sends the exact same collectionDate into the server query.
  assert.match(workspace, /new URLSearchParams\(\{ date: collectionDate, limit: String\(limit\) \}\)/);
  assert.match(workspace, /params\.set\('session', session\)/);
  assert.match(workspace, /formatDateLabel\(today\(\), publicLanguage\.language/);
  assert.doesNotMatch(workspace, /new Date\(`\$\{[^}]+}T00:00:00`\)/);
});

test('daily API fallback uses the accounting timezone instead of the UTC calendar day', () => {
  assert.match(dailyRoute, /const date = params\.get\('date'\) \|\| getAccountingDate\(\);/);
  assert.doesNotMatch(dailyRoute, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/);
  assert.equal(getAccountingHalfForDay(21), 'second-half');
  assert.equal(getAccountingHalfForDay(20), 'second-half');
});
