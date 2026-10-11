const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
const publicCopy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'i18n', 'public-copy.ts'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

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
  const farmerTable = farmerView.slice(farmerView.indexOf('table-scroll farmers-desktop-table'), farmerView.indexOf('{farmers ? farmers.data.length'));
  assert.doesNotMatch(farmerTable, /assignedCollector|navIfishi/);
  assert.doesNotMatch(farmerView, /farmerVillage|farmerForm\.location|farmerEdit\.location/);
  assert.match(styles, /farmer-mobile-card dl > div:nth-child\(5\), \.farmer-mobile-card footer > button:first-child \{ display: none; \}/);
  assert.match(farmerView, /createFarmer/);
  assert.match(farmerView, /saveFarmer/);
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
    assert.match(route, /ownerUserId: user\.id/);
    assert.doesNotMatch(route, /ownerUserId: params|ownerUserId: input/);
  }
});

test('Dairy navigation includes Settings and Dairy Amata is read-only Abacunda aggregation', () => {
  const dairyTabs = workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy'));
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));

  assert.match(dairyTabs, /id: 'settings'/);
  assert.match(milkEntry, /isCollector \? volumeInput\(row, 'morning'\) : liters\(row\.volumeMorning\)/);
  assert.match(milkEntry, /row\.presentCount \|\| 0/);
  assert.match(milkEntry, /publicLanguage\.t\('milkResultsCount'\)/);
  assert.match(milkEntry, /isCollector \? <><span className=\{`milk-entry-state/);
  assert.match(milkEntry, /isCollector \? <><button type="button" className="button button-secondary small-button" onClick=\{\(\) => openIfishiForFarmer/);
});

test('Milk Entry exposes secure search, session, page-size, clear, and reset controls', () => {
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  const header = workspace.slice(workspace.indexOf('className="content-heading"'), workspace.indexOf('{error ?'));

  assert.match(milkEntry, /className="milk-record-tools"/);
  assert.match(milkEntry, /type="search"/);
  assert.match(milkEntry, /milkClearSearch/);
  assert.match(milkEntry, /milkSessionAll/);
  assert.match(milkEntry, /dailyPageSize/);
  assert.match(workspace, /params\.set\('search', search\)/);
  assert.match(workspace, /params\.set\('session', session\)/);
  assert.match(workspace, /setDailyCursor\(null\)/);
  assert.match(workspace, /debouncedDailySearch, dailySession, dailyPageSize/);
  assert.doesNotMatch(header, /search-form|Global search|globalSearch|global-search/);
  assert.doesNotMatch(workspace, /globalSearch|runGlobalSearch|global-search-panel/);
});

test('Farmer Ifishi in Milk Entry contains milk records only', () => {
  const loader = workspace.slice(workspace.indexOf('const loadIfishiRecords'), workspace.indexOf('const loadOwnerIfishiHistory'));
  const view = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));

  assert.match(loader, /\/api\/milk\?/);
  assert.doesNotMatch(loader, /\/api\/reports\/summary/);
  assert.doesNotMatch(view, /ifishiAccounting|accountingFarmer|totalTransport|netAmount|reportsGross|dashboardDeductions/);
  assert.match(workspace, /if \(user && tab === 'milk' && ifishiOpen && ifishiFarmerId\) loadIfishiRecords\(\)/);
  assert.doesNotMatch(view, /if \(isCollector\) return renderOwnerIfishi/);
  assert.match(workspace, /setIfishiFarmers\(result\.data\.length \? result\.data : ifishiFarmers\.filter/);
  const milkEntry = workspace.slice(workspace.indexOf('const renderMilk'), workspace.indexOf('const renderOwnerIfishi'));
  assert.doesNotMatch(milkEntry, /dailySummary\.totalAmount|milkAmount/);
  assert.match(styles, /\.milk-desktop-list \{ width: 100%; margin: 0; border-top: 0; \}/);
  assert.match(styles, /\.milk-desktop-list table \{ table-layout: fixed; \}/);
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
  assert.match(ukwezi, /new URLSearchParams\(\{ month: ukweziMonth, year: ukweziYear, periodType: ukweziPeriod \}\)/);
  assert.match(ukwezi, /ukweziPdfParams\.set\('language', publicLanguage\.language\)/);
  assert.match(ukwezi, /if \(isDairy && activeCenterName\) ukweziPdfParams\.set\('collectionCenter', activeCenterName\)/);
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
  assert.match(workspace, /if \(user && tab === 'milk' && \(!isDairy \|\| selectedCenter\)\) loadDaily\(\)/);
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
  assert.match(settings, /role="tablist"/);
  assert.match(settings, /publicLanguage\.t\('myAccount'\)/);
  assert.match(settings, /publicLanguage\.t\('accountManagement'\)/);
  assert.match(settings, /role="tabpanel"/);
  assert.match(settings, /event\.key === 'ArrowRight'/);
  assert.match(settings, /event\.key === 'Home'/);
  assert.match(settings, /isCollector \? renderCenters\(\) : null/);
  assert.match(settings, /!isAdmin \? renderBilling\(\) : null/);
  assert.match(centers, /centers\.filter\(\(center\) => Number\(center\.owner_user_id\) === Number\(user\?\.id\)\)/);
  assert.match(workspace, /collectorOwnedCenters\.map\(\(center\)/);
  assert.match(workspace, /collectorOwnedCenters\.find\(\(center\)/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy')), /id: 'centers'/);
  assert.match(workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy')), /id: 'settings'/);
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

test('Login and Register use the existing visible brand lockup', () => {
  const login = workspace.slice(workspace.indexOf('function Login'), workspace.indexOf('export default function Workspace'));
  assert.match(login, /<BrandLockup className="auth-brand-lockup" imageSize=\{72\} \/>/);
  assert.match(styles, /\.auth-brand-lockup \.brand-lockup-image \{ width: 72px; height: 72px; \}/);
  assert.match(styles, /\.auth-brand-lockup \.brand-lockup-image \{ width: 52px; height: 52px; \}/);
  assert.match(login, /registering \? t\('createTitle'\) : t\('loginTitle'\)/);
  assert.match(login, /registering \? t\('registerDescription'\) : t\('loginDescription'\)/);
});

test('Ifishi has no PDF controls while Ukwezi retains its checked PDF download', () => {
  const ifishiView = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));
  assert.doesNotMatch(ifishiView, /PDF|pdf|iframe/i);
  assert.doesNotMatch(workspace, /ifishiPreviewOpen|ifishiPreviewPdf|ifishiDownloadPdf|\/api\/ifishi\/pdf/);
  assert.doesNotMatch(styles, /ifishi-preview-frame/);
  assert.match(workspace, /fetch\(`\/api\/ukwezi\/pdf\?\$\{params\}`/);
  assert.match(workspace, /application\/pdf/);
  assert.match(workspace, /ukweziPdfError/);
  assert.match(workspace, /ukweziPdfStatus/);
});

test('registration exposes Collection Center selection only outside production', () => {
  const login = workspace.slice(workspace.indexOf('function Login'), workspace.indexOf('export default function Workspace'));
  assert.match(login, /process\.env\.NODE_ENV !== 'production' \? <option value="COLLECTION_CENTER">/);
});