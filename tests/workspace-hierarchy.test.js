const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
const publicCopy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'i18n', 'public-copy.ts'), 'utf8');

test('Collector Milk Entry puts the Owner and Owner Ifishi before the separate Aborozi list', () => {
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  const ownerIfishi = workspace.slice(workspace.indexOf('const renderOwnerIfishiEntry'), workspace.indexOf('const renderIfishi ='));
  const ownerAccount = milkEntry.indexOf('owner-account-panel');
  const ownerIfishiAction = milkEntry.indexOf("publicLanguage.t('ownerIfishiTitle')", ownerAccount);
  const ownerIfishiView = milkEntry.indexOf('isCollector && ownerIfishiOpen ? <Modal');
  const farmerIfishiView = milkEntry.indexOf('{ifishiOpen ? <Modal');
  const entryControls = milkEntry.indexOf('className="milk-entry-controls"');
  const aborozi = milkEntry.indexOf("'ABOROZI'");

  assert.ok(ownerAccount >= 0);
  assert.ok(ownerIfishiAction > ownerAccount);
  assert.ok(ownerIfishiView > ownerIfishiAction);
  assert.ok(milkEntry.indexOf('renderOwnerIfishiEntry()', ownerIfishiView) > ownerIfishiView);
  assert.ok(ownerIfishiView < entryControls);
  assert.ok(entryControls < aborozi);
  assert.ok(farmerIfishiView > aborozi);
  assert.ok(milkEntry.indexOf('renderIfishi()', farmerIfishiView) > farmerIfishiView);
  assert.ok(aborozi > ownerIfishiView);
  assert.match(milkEntry, /OWNER \/ ACCOUNT/);
  assert.match(milkEntry, /aria-expanded=\{ownerIfishiOpen\}/);
  assert.match(milkEntry, /openIfishiForFarmer\(row\.farmerId, row\.farmerName\)/);
  assert.match(workspace, /setIfishiFarmers\(\[selectedFarmer\]\)/);
  assert.match(milkEntry, /ownerIfishiHistoryOpen/);
  assert.match(ownerIfishi, /openOwnerIfishiEntry\(entry\.date\)/);
  assert.match(milkEntry, /setIfishiOpen\(false\); openOwnerIfishiEntry\(\)/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard')), /if \(isCollector\) return renderOwnerIfishi/);
});

test('Collection Center Abacunda uses owner-scoped farmer management without Collector assignment UI', () => {
  const listRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmers', 'route.ts'), 'utf8');
  const detailRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmers', '[id]', 'route.js'), 'utf8');
  const farmerView = workspace.slice(workspace.indexOf('const renderFarmers'), workspace.indexOf('const renderCenters'));

  assert.match(workspace, /tab === 'farmers' && !isAdmin \? renderFarmers\(\)/);
  assert.doesNotMatch(workspace, /tab === 'farmers' && !isAdmin && isDairy \? renderAbacundaDirectory/);
  assert.match(farmerView, /isDairy \? publicLanguage\.t\('navAbacunda'\)/);
  assert.match(farmerView, /<div className="toolbar">/);
  assert.match(farmerView, /!isCollector && !isDairy \? <div className="assignment-tool">/);
  assert.match(farmerView, /!isDairy \? <th>\{publicLanguage\.t\('assignedCollector'\)\}<\/th>/);
  assert.match(farmerView, /!isDairy \? <div><dt>\{publicLanguage\.t\('assignedCollector'\)\}<\/dt>/);
  assert.match(farmerView, /isDairy \? <><label>Active Ikigo<input readOnly value=\{centers\.find\(\(center\) => String\(center\.id\) === selectedCenter\)\?\.name \|\| ''\} required \/><\/label><label>\{publicLanguage\.t\('farmerVillage'\)\}<input required value=\{farmerForm\.location\} onChange=\{\(event\) => setFarmerForm\(\{ \.\.\.farmerForm, location: event\.target\.value \}\)\} \/><\/label>/);
  assert.match(farmerView, /isDairy \? <><label>Active Ikigo<input readOnly value=\{centers\.find\(\(center\) => String\(center\.id\) === selectedCenter\)\?\.name \|\| ''\} required \/><\/label><label>\{publicLanguage\.t\('farmerVillage'\)\}<input required value=\{farmerEdit\.location\} onChange=\{\(event\) => setFarmerEdit\(\{ \.\.\.farmerEdit, location: event\.target\.value \}\)\} \/><\/label>/);
  assert.match(farmerView, /createFarmer/);
  assert.match(farmerView, /saveFarmer/);
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
    assert.match(route, /ownerUserId: user\.id/);
    assert.doesNotMatch(route, /ownerUserId: params|ownerUserId: input/);
  }
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

test('Farmer Ifishi uses authoritative report values for transport and net payable', () => {
  const loader = workspace.slice(workspace.indexOf('const loadIfishiRecords'), workspace.indexOf('const loadOwnerIfishiHistory'));
  const view = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));

  assert.match(loader, /\/api\/milk\?/);
  assert.match(loader, /\/api\/reports\/summary\?/);
  assert.match(loader, /periodType: 'monthly'/);
  assert.match(view, /accountingFarmer\.totalTransport/);
  assert.match(view, /accountingFarmer\.netAmount/);
  assert.match(workspace, /if \(user && tab === 'milk' && ifishiOpen && ifishiFarmerId\) loadIfishiRecords\(\)/);
  assert.doesNotMatch(view, /if \(isCollector\) return renderOwnerIfishi/);
  assert.match(workspace, /setIfishiFarmers\(result\.data\.length \? result\.data : ifishiFarmers\.filter/);
  assert.match(workspace, /transportHistoryUnavailable/);
});

test('Owner Ifishi history does not request or render the Ukwezi settlement summary', () => {
  const loader = workspace.slice(workspace.indexOf('const loadOwnerIfishiHistory'), workspace.indexOf('const loadAbacundaIfishi'));
  assert.doesNotMatch(loader, /reports\/summary/);
  assert.match(publicCopy, /ownerIfishiViewHistory: 'View history'/);
  assert.match(publicCopy, /ownerIfishiHideHistory: 'Hide history'/);
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
  assert.match(billing, /billing\?\.payments\?\.length \? <>[\s\S]*subscription-payment-desktop/);
  assert.match(billing, /subscription-payment-mobile-list/);
  assert.match(billing, /provider_transaction_id/);
  assert.match(billing, /failure_reason/);
  assert.match(billing, /billing \? <div className="subscription-history-empty"/);
});

test('Collector farmer deductions are created only through the shared modal', () => {
  const view = workspace.slice(workspace.indexOf('const renderDeductions'), workspace.indexOf('const renderReports'));

  assert.match(view, /deductionsAdd/);
  assert.match(view, /deductionCreateOpen \? <Modal/);
  assert.ok(view.indexOf('deductionCreateOpen ? <Modal') < view.indexOf('onSubmit={createDeduction}'));
  assert.match(view, /deductionsNotes/);
  assert.match(view, /deductionCreateError/);
  assert.match(workspace, /deductionSubmittingRef\.current/);
  assert.match(workspace, /Promise\.all\(\[loadDeductions\(\), loadReport\(\)\]\)/);
});

test('Owner Ifishi is the only Collector owner-milk entry form', () => {
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  const ownerService = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'owner-ifishi-service.js'), 'utf8');

  assert.match(milkEntry, /isCollector && ownerIfishiOpen \? <Modal/);
  assert.doesNotMatch(milkEntry, /saveCollectorMilk|collector-combined-entry|collectorMilkVolume/);
  assert.match(workspace, /const saveOwnerIfishiEntry/);
  assert.match(workspace, /api<OwnerIfishiEntry>\(path/);
  assert.match(ownerService, /OWNER_MILK_PRICE_MISSING/);
});

test('Dairy with no active center does not issue a daily milk request', () => {
  assert.match(workspace, /if \(tab === 'milk' && \(!isDairy \|\| selectedCenter\)\) loadDaily\(\)/);
  assert.match(workspace, /if \(user && tab === 'milk' && \(!isDairy \|\| selectedCenter\)\) loadDaily\(\)/);
});

test('Owner Ifishi entry modal stays focused while history and accounting are expandable inline', () => {
  const entry = workspace.slice(workspace.indexOf('const renderOwnerIfishiEntry'), workspace.indexOf('const renderOwnerIfishiHistory'));
  const history = workspace.slice(workspace.indexOf('const renderOwnerIfishiHistory'), workspace.indexOf('const renderIfishi ='));
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishiEntry'));

  assert.match(milkEntry, /className="owner-ifishi-entry-modal"/);
  assert.match(entry, /type="date"/);
  assert.match(entry, /ownerIfishiVolume/);
  assert.doesNotMatch(entry, /owner-ifishi-period|owner-ifishi-summary|owner-ifishi-accounting-summary|owner-ifishi-mobile-list|owner-ifishi-desktop-list/);
  assert.match(history, /owner-ifishi-summary/);
  assert.match(history, /owner-ifishi-accounting-summary/);
  assert.match(milkEntry, /ownerIfishiHistoryOpen \? renderOwnerIfishiHistory\(\)/);
  assert.match(workspace, /setOwnerIfishiPeriod\(day <= 15 \? 'first-half' : 'second-half'\)/);
});

test('Collector Settings exposes only owned collection sites while Dairy has no Collector site management', () => {
  const collectorTabs = workspace.slice(workspace.indexOf('const collectorTabs'), workspace.indexOf('const dairyTabs'));
  const settings = workspace.slice(workspace.indexOf('const renderAccountSettings'), workspace.indexOf('const renderBilling'));
  const centers = workspace.slice(workspace.indexOf('const renderCenters'), workspace.indexOf('const renderMilk'));

  assert.match(collectorTabs, /id: 'settings'/);
  assert.match(settings, /isCollector \? renderCenters\(\) : null/);
  assert.match(centers, /centers\.filter\(\(center\) => Number\(center\.owner_user_id\) === Number\(user\?\.id\)\)/);
  assert.match(workspace, /collectorOwnedCenters\.map\(\(center\)/);
  assert.match(workspace, /collectorOwnedCenters\.find\(\(center\)/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy')), /id: 'settings'|id: 'centers'/);
});

test('Super Admin subscriptions editor saves only five controlled Collector tier prices', () => {
  const loader = workspace.slice(workspace.indexOf("if (tab === 'subscriptions')"), workspace.indexOf("if (tab === 'system-health')"));
  const save = workspace.slice(workspace.indexOf('const saveAdminCollectorPrices'), workspace.indexOf('const saveAccountSettings'));
  const editor = workspace.slice(workspace.indexOf('const renderAdminSubscriptions'), workspace.indexOf('const renderSystemHealth'));
  const plansRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'config', 'plans', 'route.js'), 'utf8');

  assert.match(loader, /api<SubscriptionPlan\[]>\('\/api\/admin\/config\/plans'\)/);
  assert.match(loader, /plans\.filter\(\(plan\) => isCollectorTier\(plan\) && plan\.is_active\)/);
  assert.match(loader, /setCollectorTierEdits\(Object\.fromEntries/);
  assert.match(editor, /collectorPlans\.map\(\(plan\)/);
  assert.match(editor, /value=\{collectorTierEdits\[plan\.code\] \?\? String\(plan\.price\)\}/);
  assert.match(editor, /setCollectorTierEdits\(\(current\) => \(\{ \.\.\.current, \[plan\.code\]: event\.target\.value \}\)\)/);
  assert.match(editor, /onClick=\{\(\) => \{ void saveAdminCollectorPrices\(\); \}\}/);
  assert.match(editor, /disabled=\{busy\}/);
  assert.match(save, /for \(const code of COLLECTOR_TIER_CODES\)/);
  assert.match(save, /if \(!plan\) throw new Error/);
  assert.match(save, /Number\.isSafeInteger\(tier\.price\)/);
  assert.match(save, /\/api\/admin\/config\/plans/);
  assert.match(plansRoute, /user\.role !== 'super_admin'/);
});