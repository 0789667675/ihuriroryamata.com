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
  assert.match(ownerIfishi, /ownerIfishiReport\?\.farmerPayments/);
  assert.match(ownerIfishi, /ownerIfishiReport\.collectorPayable/);
  assert.match(workspace, /setIfishiOpen\(false\); setOwnerIfishiOpen/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard')), /if \(isCollector\) return renderOwnerIfishi/);
});

test('Collection Center directory lists only active-Ikigo linked Abacunda with milk-history Ifishi', () => {
  const directory = workspace.slice(workspace.indexOf('const renderAbacundaDirectory'), workspace.indexOf('const renderFarmers'));

  assert.match(directory, /Active Ikigo/);
  assert.match(directory, /collectorAssignments\.map/);
  assert.match(directory, /collectorAssignments\.reduce\(/);
  assert.match(directory, /openAbacundaIfishi\(assignment\)/);
  assert.match(workspace, /\/api\/ifishi\/abacunda/);
  assert.doesNotMatch(directory, /farmers\?\.data|renderFarmers|linkCollector|unlinkCollector/);
  assert.match(workspace, /tab === 'farmers' && !isAdmin && isDairy \? renderAbacundaDirectory\(\)/);
  assert.match(workspace, /tab === 'farmers' && !isAdmin && !isDairy \? renderFarmers\(\)/);
  assert.doesNotMatch(workspace, /renderDairyCollectors/);
});

test('Dairy navigation excludes Settings and Dairy Amata is read-only Abacunda aggregation', () => {
  const dairyTabs = workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy'));
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));

  assert.doesNotMatch(dairyTabs, /id: 'settings'/);
  assert.match(milkEntry, /isCollector \? volumeInput\(row, 'morning'\) : liters\(row\.volumeMorning\)/);
  assert.match(milkEntry, /row\.presentCount \|\| 0/);
  assert.match(milkEntry, /\$\{dailySummary\.presentCount\} milk entries · \$\{dailySummary\.totalFarmers\} Abacunda/);
  assert.match(milkEntry, /isCollector \? <><span className=\{`milk-entry-state/);
  assert.match(milkEntry, /isCollector \? <><button type="button" className="button button-secondary small-button" onClick=\{\(\) => openIfishiForFarmer/);
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

test('notifications are restored in the header and use the existing owned notification APIs', () => {
  const header = workspace.slice(workspace.indexOf('<header className="topbar"'), workspace.indexOf('<div className="workspace-body"'));

  assert.match(header, /notification-dropdown/);
  assert.match(header, /unreadCount/);
  assert.match(workspace, /api<\{ data: Notice\[\] \}>\('\/api\/notifications\?limit=50'\)/);
  assert.match(workspace, /api<\{ data: \{ unreadCount: number \} \}>\('\/api\/notifications\/unread-count'\)/);
  assert.ok(workspace.includes('api(`/api/notifications/${notification.id}/read`'));
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

test('Active Ikigo selection stays valid and falls back to the first center when needed', () => {
  const loadCenters = workspace.slice(workspace.indexOf('const loadCenters'), workspace.indexOf('const loadCollectorAssignments'));

  assert.match(loadCenters, /setSelectedCenter\(\(current\) =>/);
  assert.match(loadCenters, /data\.some\(\(center\) => String\(center\.id\) === String\(current\)\)/);
  assert.match(loadCenters, /String\(data\[0\]\.id\)/);
});

test('Session startup has a bounded failure state and local assignment and milk retries', () => {
  assert.match(workspace, /setTimeout\(\(\) => controller\.abort\(\), 12000\)/);
  assert.match(workspace, /Unable to start Milk System/);
  assert.match(workspace, /onClick=\{\(\) => \{ setAuthError\(''\); setAuthLoading\(true\); setAuthAttempt/);
  assert.match(workspace, /if \(status === 401\) \{[\s\S]*?setUser\(null\)/);
  assert.match(workspace, /collectorAssignmentsError \? <div className="workspace-empty" role="alert">[\s\S]*?Retry/);
  assert.match(workspace, /dailyError \? <div className="workspace-empty" role="alert">[\s\S]*?Retry/);
  assert.match(workspace, /register\('\/sw\.js'\)\.catch\(\(\) => undefined\)/);
});

test('Subscription API failures are not presented as missing subscriptions or empty payment history', () => {
  const billing = workspace.slice(workspace.indexOf('const renderBilling'), workspace.indexOf('const renderNotifications'));

  assert.match(billing, /billingError && !billing \? null/);
  assert.match(billing, /billingError \? null : <p>\{publicLanguage\.t\('subscriptionUnavailable'\)\}<\/p>/);
  assert.match(billing, /billing\?\.payments\?\.length \? [\s\S]*: billing \? <div className="subscription-history-empty"/);
});

test('Dairy with no active center does not issue a daily milk request', () => {
  assert.match(workspace, /if \(tab === 'milk' && \(!isDairy \|\| selectedCenter\)\) loadDaily\(\)/);
  assert.match(workspace, /if \(user && tab === 'milk' && \(!isDairy \|\| selectedCenter\)\) loadDaily\(\)/);
});