// Settlement workspace presentation tests: Executive 4-Card Payout Strip,
// two clean segmented view tabs (verified accounts vs custodial cash roster),
// bulk and row-level cash confirmations, and expandable carried debts drawer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const workspace = read('app/workspace.tsx');
const css = read('app/globals.css');
const settlementRoute = read('app/api/farmer-settlements/route.js');
const settlements = workspace.slice(workspace.indexOf('const renderSettlements ='), workspace.indexOf('const renderReports ='));
const farmerHistory = workspace.slice(workspace.indexOf('const renderFarmerHistory ='), workspace.indexOf('const renderMilk ='));

test('Settlements renders an Executive 4-Card Payout Strip', () => {
  assert.match(settlements, /settlement-payout-grid/);
  assert.match(settlements, /Amafaranga Yose Agomba Kwishyurwa/);
  assert.match(settlements, /Ayanyuze Kuri Konti/);
  assert.match(settlements, /Ayanyuze Kuri Nyirayo \/ Mu Ntoki/);
  assert.match(settlements, /Ayishyuwe Kugeza Ubu/);
});

test('Settlements provides two clean segmented view tabs for verified accounts vs custodial cash', () => {
  assert.match(settlements, /settlement-tabs/);
  assert.match(settlements, /settlementTab === 'accounts'/);
  assert.match(settlements, /settlementTab === 'cash'/);
  assert.match(settlements, /Aborozi Bafite Nimero ya Konti/);
  assert.match(settlements, /Aborozi Badafite Nimero ya Konti \(Kuri Konti ya Nyirayo\)/);
  assert.doesNotMatch(settlements, /SACCO Distribution Instruction/i);
  assert.doesNotMatch(settlements, /Ejo Heza/i);
});

test('Settlements Tab 2 supports selected cash batches, progress, row-level confirmation, and eligible retries', () => {
  assert.match(settlements, /confirmCashPayments/);
  assert.match(settlements, /selectedCashFarmers/);
  assert.match(settlements, /SettlementBatchProgress/);
  assert.match(settlements, /confirmSettlementBatch/);
  assert.match(settlements, /settlementsConfirmSelected/);
  assert.match(settlements, /toggleAllCashFarmers/);
  assert.doesNotMatch(settlements, /confirmAllCashPayments/);
  assert.match(settlements, /settleSingleCash/);
  assert.match(settlements, /settlementsConfirmRow/);
});

test('settlement history exposes recorded approval and confirmation timestamps on desktop and mobile', () => {
  assert.match(settlements, /settlementsApprovedAt/);
  assert.match(settlements, /settlementsConfirmedAt/);
  assert.match(settlements, /record\.confirmedBy/);
  assert.match(settlements, /settlementDateTime\(record\.confirmedAt\)/);
  assert.match(settlementRoute, /s\.confirmed_at AS "confirmedAt"/);
  assert.match(settlementRoute, /s\.confirmed_by AS "confirmedBy"/);
});

test('farmer financial history uses actual assigned settlement records and does not invent a zero debt', () => {
  const financialLoader = workspace.slice(workspace.indexOf('const loadFarmerSettlementHistory'), workspace.indexOf('const openFarmerHistory'));
  const financialView = read('components/views/farmer-settlement-history.tsx');

  assert.match(financialLoader, /isCollector/);
  assert.match(financialLoader, /action: 'confirmations'/);
  assert.match(financialLoader, /periodStart/);
  assert.match(financialLoader, /periodEnd/);
  assert.match(financialLoader, /record\.farmerId \?\? record\.farmer_id/);
  assert.match(farmerHistory, /<FarmerSettlementHistory/);
  assert.match(farmerHistory, /carriedDebtKnown/);
  assert.match(financialView, /settlementsStatusApproved/);
  assert.match(financialView, /settlementsStatusConfirmed/);
  assert.match(financialView, /record\.confirmedAt/);
  assert.match(financialView, /farmer-financial-history-mobile/);
});

test('Settlements wraps carried debts and legacy reconciliations in an expandable drawer', () => {
  assert.match(settlements, /<details className="settlement-debt-drawer">/);
  assert.match(settlements, /Imyenda n'Ibyishyuwe mu Byiciro Bya Shize \/ Carried Debts & Repayments/);
  assert.match(settlements, /settlementsCashApprovedAmount/);
  assert.match(settlements, /settlementsDebtOutstanding/);
});

test('Inspector Drawer displays status badge, quick actions, and mini KPI strip', () => {
  assert.match(farmerHistory, /farmer-number-badge/);
  assert.match(farmerHistory, /Bafite Konti/);
  assert.match(farmerHistory, /Kuri Konti ya Nyirayo/);
  assert.match(farmerHistory, /inspector-quick-actions/);
  assert.match(farmerHistory, /inspector-mini-kpi/);
  assert.match(farmerHistory, /farmerHistory\.expectedDays/);
  assert.match(farmerHistory, /farmerHistory\.deliveredDays/);
  assert.match(farmerHistory, /farmerHistory\.missingDays/);
  assert.match(farmerHistory, /farmerHistory\.deliveryRate/);
});

test('CSS includes responsive layout rules for settlement payout grid and tabs', () => {
  assert.match(css, /\.settlement-payout-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  assert.match(css, /\.settlement-tabs/);
  assert.match(css, /\.settlement-custodial-header/);
  assert.match(css, /\.settlement-debt-drawer/);
  assert.match(css, /\.settlement-batch-progress/);
  assert.match(css, /\.settlements-desktop-table thead th \{ position: sticky/);
  assert.match(css, /\.farmer-financial-history-mobile \{ display: none/);
  assert.match(css, /\.inspector-mini-kpi/);
  assert.match(css, /\.inspector-quick-actions/);
});
