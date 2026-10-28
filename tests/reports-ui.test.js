// Raporo (reports) presentation tests: authoritative applied price, honest
// missing-price states, consistent KPI layout, and desktop/tablet/phone rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const workspace = read('app/workspace.tsx');
const css = read('app/globals.css');
const reports = workspace.slice(workspace.indexOf('const renderReports ='), workspace.indexOf('const renderUkwezi ='));

test('Raporo derives the applied price from report accounting values without a hard-coded tariff', () => {
  assert.match(reports, /const appliedPrice = volume > 0 && !grossMissing \? gross \/ volume : \(report\?\.pricePerLiter \?\? null\)/);
  assert.match(reports, /const priceSourceKey: PublicCopyKey = isCollector/);
  assert.match(reports, /'reportsPriceSourceCollector'/);
  assert.match(reports, /'reportsPriceSourceCenter'/);
  assert.match(reports, /'reportsPriceSourceRecorded'/);
  assert.match(reports, /const price = rowPrice\(row\)/);
  assert.match(reports, /row\?\.pricePerLiter != null && Number\(row\.pricePerLiter\) > 0/);
  assert.doesNotMatch(reports, /\b(?:300|350|400|450|500)\s*RWF/i);
  assert.doesNotMatch(reports, /pricePerLiter:\s*\d+/i);
});

test('Raporo marks missing price, transport, and net inputs as incomplete instead of zero', () => {
  assert.match(reports, /const accountingIncomplete = isCollector && \(report\?\.collectorAccountingComplete === false \|\| missingInputs\.length > 0\)/);
  assert.match(reports, /const grossMissing = grossValue == null \|\| missingInputs\.includes\('owner_historical_price'\)/);
  assert.match(reports, /const transportMissing = \(isCollector && transportValue == null\) \|\| missingInputs\.includes\('farmer_transport_snapshot'\)/);
  assert.match(reports, /const netMissing = netValue == null \|\| accountingIncomplete/);
  assert.match(reports, /const definedOr = \(value: unknown, fallback: unknown\) => value !== undefined \? value : fallback/);
  assert.match(reports, /grossMissing \? publicLanguage\.t\('reportsIncomplete'\)/);
  assert.match(reports, /transportMissing \? publicLanguage\.t\('reportsIncomplete'\)/);
  assert.match(reports, /netMissing \? publicLanguage\.t\('reportsIncomplete'\)/);
  assert.match(reports, /reportsPriceUnavailable/);
  assert.match(reports, /collectorAccountingMissingInputs/);
  assert.match(reports, /reports-callout/);
  assert.match(reports, /reportsStatusReview/);
  assert.match(reports, /reportsStatusComplete/);
  assert.match(reports, /reportsOpenSettings/);
});

test('Raporo presents four consistent executive KPIs and both desktop and mobile breakdowns', () => {
  assert.match(reports, /reports-overview/);
  assert.match(reports, /reports-status-badge/);
  assert.match(reports, /report-kpi-grid/);
  assert.equal((reports.match(/className="[^"]*kpi-stat-card[^"]*"/g) || []).length, 4);
  assert.match(reports, /reports-lower/);
  assert.match(reports, /reports-breakdown/);
  assert.match(reports, /reports-desktop-table/);
  assert.match(reports, /report-mobile-list/);
  assert.match(reports, /report-mobile-card/);
  assert.match(reports, /reportsAppliedPrice/);
});

test('Raporo has real loading, error, empty-period, and empty-breakdown states', () => {
  assert.match(reports, /const showError = reportError && !report/);
  assert.match(reports, /const showLoading = reportLoading && !report/);
  assert.match(reports, /role="alert"/);
  assert.match(reports, /reportsErrorTitle/);
  assert.match(reports, /workspace-loading/);
  assert.match(reports, /reports-empty-state/);
  assert.match(reports, /reportsEmptyTitle/);
  assert.match(reports, /reports-no-rows/);
  assert.match(reports, /reportsNoRows/);
  assert.match(reports, /reportsRecordMilk/);
});

test('Raporo responsive rules keep five, three, two, and one KPI columns and reveal mobile cards', () => {
  assert.match(css, /body \{[^}]*overflow-x: clip/);
  assert.match(css, /\.reports-kpi-cards \{\s*display: grid;\s*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 1100px\) \{[\s\S]*?\.reports-kpi-cards \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 680px\) \{[\s\S]*?\.reports-kpi-cards \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*?\.reports-kpi-cards \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.deductions-desktop-table, \.reports-desktop-table, \.admin-accounts-desktop-table \{ display: none; \}/);
  assert.match(css, /\.deduction-mobile-list, \.report-mobile-list \{ display: grid;/);
  assert.match(css, /\.reports-view > \.workspace-empty \{ margin-inline: 0; \}/);
  assert.match(css, /\.report-mobile-card dl \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
