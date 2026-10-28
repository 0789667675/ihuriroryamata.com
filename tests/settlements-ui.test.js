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

test('Settlements Tab 2 provides bulk and row-level digital cash payout confirmations', () => {
  assert.match(settlements, /confirmAllCashPayments/);
  assert.match(settlements, /Emeza Bose mu Ntoki/);
  assert.match(settlements, /settleSingleCash/);
  assert.match(settlements, /Emeza ko Yishyuwe/);
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
  assert.match(css, /\.inspector-mini-kpi/);
  assert.match(css, /\.inspector-quick-actions/);
});
