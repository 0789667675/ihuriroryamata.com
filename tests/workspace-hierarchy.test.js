const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');

test('Collector Milk Entry puts the Owner and Owner Ifishi before the separate Aborozi list', () => {
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  const ownerIfishi = workspace.slice(workspace.indexOf('const renderOwnerIfishi'), workspace.indexOf('const renderIfishi ='));
  const ownerAccount = milkEntry.indexOf('owner-account-panel');
  const ownerIfishiAction = milkEntry.indexOf("publicLanguage.t('ownerIfishiTitle')", ownerAccount);
  const ownerIfishiView = milkEntry.indexOf('isCollector && ownerIfishiOpen ? renderOwnerIfishi()');
  const farmerIfishiView = milkEntry.indexOf('{ifishiOpen ? renderIfishi() : null}');
  const entryControls = milkEntry.indexOf('className="milk-entry-controls"');
  const aborozi = milkEntry.indexOf("'ABOROZI'");

  assert.ok(ownerAccount >= 0);
  assert.ok(ownerIfishiAction > ownerAccount);
  assert.ok(ownerIfishiView > ownerIfishiAction);
  assert.ok(ownerIfishiView < entryControls);
  assert.ok(entryControls < aborozi);
  assert.ok(farmerIfishiView > aborozi);
  assert.ok(aborozi > ownerIfishiView);
  assert.match(milkEntry, /OWNER \/ ACCOUNT/);
  assert.match(milkEntry, /aria-expanded=\{ownerIfishiOpen\}/);
  assert.match(milkEntry, /openIfishiForFarmer\(row\.farmerId, row\.farmerName\)/);
  assert.match(workspace, /setIfishiFarmers\(\[selectedFarmer\]\)/);
  assert.doesNotMatch(ownerIfishi, /RWF|payment|amount|deduction|transport|ejo.?heza/i);
  assert.match(workspace, /setIfishiOpen\(false\); setOwnerIfishiOpen/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard')), /if \(isCollector\) return renderOwnerIfishi/);
});

test('Collection Center directory lists only active-Ikigo linked Abacunda with milk-history Ifishi', () => {
  const directory = workspace.slice(workspace.indexOf('const renderAbacundaDirectory'), workspace.indexOf('const renderFarmers'));

  assert.match(directory, /Active Ikigo/);
  assert.match(directory, /collectorAssignments\.map/);
  assert.match(directory, /openAbacundaIfishi\(assignment\)/);
  assert.match(workspace, /\/api\/ifishi\/abacunda/);
  assert.doesNotMatch(directory, /farmers\?\.data|renderFarmers|linkCollector|unlinkCollector/);
  assert.match(workspace, /tab === 'farmers' && !isAdmin && isDairy \? renderAbacundaDirectory\(\)/);
  assert.match(workspace, /tab === 'farmers' && !isAdmin && !isDairy \? renderFarmers\(\)/);
  assert.doesNotMatch(workspace, /renderDairyCollectors/);
});

test('Milk workspace has no loaded-page search and the header has no global search', () => {
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  const header = workspace.slice(workspace.indexOf('className="content-heading"'), workspace.indexOf('{error ?'));

  assert.doesNotMatch(milkEntry, /type="search"|milkSearch|normalizedSearch/);
  assert.doesNotMatch(header, /search-form|Global search|globalSearch|global-search/);
  assert.doesNotMatch(workspace, /globalSearch|runGlobalSearch|global-search-panel/);
});

test('Farmer Ifishi requests milk history only and renders no financial values', () => {
  const loader = workspace.slice(workspace.indexOf('const loadIfishiRecords'), workspace.indexOf('const loadOwnerIfishiHistory'));
  const view = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));

  assert.match(loader, /\/api\/milk\?/);
  assert.doesNotMatch(loader, /reports\/summary|grossAmount|transport|RWF|ejo.?heza/i);
  assert.match(workspace, /if \(user && tab === 'milk' && ifishiOpen && ifishiFarmerId\) loadIfishiRecords\(\)/);
  assert.match(workspace, /if \(user && tab === 'milk' && ifishiOpen && ifishiFarmerId\) loadIfishiRecords\(\)/);
  assert.doesNotMatch(view, /if \(isCollector\) return renderOwnerIfishi/);
  assert.match(workspace, /setIfishiFarmers\(result\.data\.length \? result\.data : ifishiFarmers\.filter/);
  assert.doesNotMatch(view, /RWF|grossAmount|transport|ejo.?heza|ifishiGross|ifishiTransport|ifishiTotalDeductions|ifishiFinalPayment/i);
});

test('Ukwezi UI requests selected half-months and only scopes a Dairy to its active Ikigo', () => {
  const loadUkwezi = workspace.slice(workspace.indexOf('const loadUkwezi'), workspace.indexOf('const loadUnreadCount'));
  const ukwezi = workspace.slice(workspace.indexOf('const renderUkwezi'), workspace.indexOf('const renderTransport'));

  assert.match(loadUkwezi, /periodType: ukweziPeriod, month: ukweziMonth, year: ukweziYear/);
  assert.match(loadUkwezi, /if \(isDairy && selectedCenter\)/);
  assert.match(ukwezi, /value="first-half">1–15/);
  assert.match(ukwezi, /value="second-half">16–/);
  assert.match(ukwezi, /ukweziReport\.rangeStart\} – \{ukweziReport\.rangeEnd/);
  assert.doesNotMatch(workspace, /ejo.?heza/i);
});