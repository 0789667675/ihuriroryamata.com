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
  const localizedFarmerHeading = milkEntry.indexOf("isCollector ? publicLanguage.t('navFarmers')");
  const aborozi = localizedFarmerHeading >= 0 ? localizedFarmerHeading : milkEntry.indexOf("isCollector ? 'ABOROZI' : 'ACTIVE IKIGO'");

  assert.ok(ownerAccount >= 0);
  assert.ok(ownerIfishiAction > ownerAccount);
  assert.ok(ownerIfishiView > ownerIfishiAction);
  assert.ok(milkEntry.indexOf('renderOwnerIfishiEntry()', ownerIfishiView) > ownerIfishiView);
  assert.ok(ownerIfishiView < entryControls);
  assert.ok(entryControls < aborozi);
  assert.ok(farmerIfishiView > aborozi);
  assert.ok(milkEntry.indexOf('renderIfishi()', farmerIfishiView) > farmerIfishiView);
  assert.ok(aborozi > ownerIfishiView);
  assert.match(milkEntry, /publicLanguage\.t\('ownerIfishiTitle'\).*publicLanguage\.t\('account'\)/);
  assert.doesNotMatch(ownerIfishi, /\(Morning\)|\(Evening\)|Daily total/);
  assert.match(milkEntry, /aria-expanded=\{ownerIfishiOpen\}/);
  assert.match(milkEntry, /openIfishiForFarmer\(row\.farmerId, row\.farmerName\)/);
  assert.match(workspace, /setIfishiFarmers\(\[selectedFarmer\]\)/);
  assert.match(milkEntry, /ownerIfishiHistoryOpen/);
  assert.match(ownerIfishi, /openOwnerIfishiEntry\(entry\.date\)/);
  assert.match(milkEntry, /setIfishiOpen\(false\); openOwnerIfishiEntry\(\)/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard')), /if \(isCollector\) return renderOwnerIfishi/);
});

test('Collection Center farmer management uses owner scope without Collector assignment UI', () => {
  const listRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmers', 'route.ts'), 'utf8');
  const detailRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmers', '[id]', 'route.js'), 'utf8');
  const farmerView = workspace.slice(workspace.indexOf('const renderFarmers'), workspace.indexOf('const renderCenters'));

  assert.match(workspace, /tab === 'farmers' && !isAdmin \? renderFarmers\(\)/);
  assert.doesNotMatch(workspace, /tab === 'farmers' && !isAdmin && isDairy \? renderAbacundaDirectory/);
  assert.match(farmerView, /<h2>\{publicLanguage\.t\('navFarmers'\)\}<\/h2>/);
  assert.match(farmerView, /<div className="toolbar farmers-toolbar">/);
  assert.match(farmerView, /!isCollector && !isDairy \? <div className="assignment-tool">/);
  const farmerTable = farmerView.slice(farmerView.indexOf('table-scroll farmers-desktop-table'), farmerView.indexOf('{farmers ? farmers.data.length'));
  assert.doesNotMatch(farmerTable, /assignedCollector|navIfishi/);
  assert.doesNotMatch(farmerView, /farmerVillage|farmerForm\.location|farmerEdit\.location/);
  assert.match(styles, /farmer-mobile-card dl > div:nth-child\(5\), \.farmer-mobile-card footer > button:first-child \{ display: none; \}/);
  assert.match(farmerView, /createFarmer/);
  assert.match(farmerView, /saveFarmer/);
  assert.match(farmerView, /screen-grid farmers-view/);
  assert.match(farmerView, /farmer-sort-mobile/);
  assert.match(farmerView, /aria-sort=/);
  assert.match(workspace, /sortBy: farmerSortBy \\|\\| undefined/);
  assert.match(styles, /\.farmers-view \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.farmers-desktop-table table \{ table-layout: fixed;/);
  assert.match(styles, /\.farmers-desktop-table \{ width: 100%;/);
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
    assert.match(route, /ownerUserId: user\.id/);
    assert.doesNotMatch(route, /ownerUserId: params|ownerUserId: input/);
  }
});

test('wide panels span the full grid and never inherit the desktop side column', () => {
  assert.match(styles, /\.screen-grid > \.panel-wide \+ \.panel-wide \{ grid-column: 1 \/ -1; grid-row: auto; \}/);
  assert.match(styles, /\.screen-grid\.owner-ifishi-view, \.screen-grid\.deductions-view \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  const desktop = styles.slice(styles.indexOf('@media (min-width: 1100px)'), styles.indexOf('@media (max-width: 980px)'));
  const sideColumn = desktop.indexOf('.screen-grid > .panel-wide + .panel { grid-column: 2; grid-row: 1; }');
  const widePair = desktop.indexOf('.screen-grid > .panel-wide + .panel-wide { grid-column: 1 / -1; grid-row: auto; }');
  assert.ok(sideColumn >= 0, 'the >=1100 block keeps the side-column placement for a regular panel');
  assert.ok(widePair > sideColumn, 'a wide panel following a wide panel overrides the side-column placement');
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

test('Settlements and shared navigation use paired locale copy and accessible labels', () => {
  const settlementView = workspace.slice(workspace.indexOf('const renderSettlements'), workspace.indexOf('const renderReports'));
  const ukweziView = workspace.slice(workspace.indexOf('const renderUkwezi'), workspace.indexOf('const renderBilling'));
  const navigation = workspace.slice(workspace.indexOf('const navigationCopy'), workspace.indexOf('const accountStatusCopy'));
  const localeKeys = [
    'navSettlements', 'workspaceNavigation', 'settlementsTitle', 'settlementsNote',
    'settlementsEmptyApproved', 'settlementsLoadError', 'settlementsActionError',
    'settlementsStatusPending', 'settlementsStatusApproved', 'settlementsStatusConfirmed',
    'ukweziReconciliationUnavailable', 'ukweziReconciliationUnavailableDetail', 'ukweziBreakdownUnavailable',
    'settlementsSchemaUnavailable', 'billingLoadError', 'billingAuthError', 'billingAccessError', 'billingAccountError',
  ];

  assert.match(navigation, /settlements: 'navSettlements'/);
  assert.match(workspace, /aria-label=\{publicLanguage\.t\('workspaceNavigation'\)\}/);
  assert.match(navigation, /farmers: 'navFarmers'/);
  assert.doesNotMatch(workspace, /item\.id === 'farmers' && isDairy/);
  assert.doesNotMatch(settlementView, /Farmer settlements|Settlement activity is separate|No approved payments|Confirm received/);
  assert.doesNotMatch(workspace, /0 \+ 0 \+ 0 = 0 RWF|0 \+ 0 \+ 0 = 0/);
  assert.match(settlementView, /formatDateLabel\(value, publicLanguage\.language/);
  assert.match(settlementView, /new Intl\.NumberFormat\(publicLanguage\.language/);
  assert.match(workspace, /ukweziReconciliationUnavailableDetail/);
  assert.equal((ukweziView.match(/publicLanguage\.t\('ukweziReconciliationUnavailableDetail'\)/g) || []).length, 1);
  assert.match(workspace, /publicLanguage\.t\(settlementError\)/);
  assert.match(workspace, /settlementsRetry/);
  assert.doesNotMatch(publicCopy, /settlementsLoadError: '[^']*Ongera ugerageze/);
  for (const key of localeKeys) {
    assert.equal((publicCopy.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 2, `${key} must exist in both locales`);
  }
});

test('billing errors stay localized and singular while identical reads are coalesced', () => {
  const loader = workspace.slice(workspace.indexOf('const loadBilling ='), workspace.indexOf('const loadAdminPayments'));
  const billing = workspace.slice(workspace.indexOf('const renderBilling'), workspace.indexOf('const renderNotifications'));
  const customerRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'subscription', 'route.js'), 'utf8');

  assert.match(loader, /billingRequestRef\.current\?\.key === key/);
  assert.match(loader, /billingRequestRef\.current\?\.id === requestId/);
  assert.match(loader, /statusCode === 401 \? 'billingAuthError'/);
  assert.match(loader, /setBilling\(null\)/);
  assert.match(billing, /billing\?\.payments\?\.length \? <>/);
  assert.match(billing, /billing \? <div className="subscription-history-empty"/);
  assert.match(publicCopy, /billingPaymentUnavailable: 'Ubwishyu ntibuboneka ubu\.[^']*MTN MoMo[^']*Nta cyifuzo cy’ubwishyu cyoherejwe\.'/);
  assert.match(publicCopy, /billingPaymentUnavailable: 'Payments are unavailable right now\.[^']*MTN MoMo configuration; no payment request was sent\.'/);
  assert.match(billing, /publicLanguage\.t\(billingError\).*publicLanguage\.t\('tryAgain'\)/);
  assert.equal((billing.match(/billingError \? <div className="form-error" role="alert">/g) || []).length, 1);
  assert.match(workspace, /disabled=\{billingLoading\}/);
  assert.match(workspace, /!isAdmin \? renderBilling\(\) : null/);
  assert.match(customerRoute, /if \(user\.role !== 'user'\)/);
  assert.match(customerRoute, /userId: user\.id/);
  assert.doesNotMatch(workspace, /loadBilling\(\)\.catch\(\(reason\) => setError\(reason\.message\)\)/);
  assert.doesNotMatch(workspace, /tab === 'settlements'\) loadSettlementData\(\)\.catch\(\(reason\) => setError/);
});

test('workspace navigation uses unique supported semantic Lucide icons across roles', () => {
  const iconMap = workspace.slice(workspace.indexOf('const navigationIcons'), workspace.indexOf('const collectorTabs'));
  const mapped = [...iconMap.matchAll(/^\s+(?:'([^']+)'|(\w+)): (\w+),$/gm)];
  const iconNames = mapped.map((match) => match[3]);
  const lucide = require('lucide-react');

  assert.ok(iconNames.length >= 17);
  assert.equal(new Set(iconNames).size, iconNames.length);
  for (const iconName of iconNames) assert.ok(lucide[iconName], `${iconName} must exist in installed Lucide`);
  for (const id of ['dashboard', 'farmers', 'milk', 'ukwezi', 'settlements', 'reports', 'billing', 'accounts', 'audit', 'settings']) {
    assert.match(iconMap, new RegExp(`\\b${id}:`));
  }
  assert.match(workspace, /aria-label=\{publicLanguage\.t\('workspaceNavigation'\)\}/);
  assert.match(workspace, /tab === 'billing' && !isAdmin/);
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
  assert.match(workspace, /setIfishiSelectedFarmer\(selectedFarmer\)/);
  assert.match(workspace, /setIfishiFarmers\(result\.data\)/);
  assert.doesNotMatch(workspace, /setIfishiFarmerId\(String\(result\.data\[0\]\.id\)\)/);
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
  assert.ok(workspace.includes('api<{ data: { unreadCount: number } }>(`/api/notifications/unread-count'));
  assert.match(workspace, /api<\{ data\?: Notice \}>\(`\/api\/notifications\/\$\{notification\.id\}\/read`/);
});

test('Ukwezi UI requests selected half-months and only scopes a Dairy to its active Ikigo', () => {
  const loadUkwezi = workspace.slice(workspace.indexOf('const loadUkwezi'), workspace.indexOf('const loadUnreadCount'));
  const ukwezi = workspace.slice(workspace.indexOf('const renderUkwezi'), workspace.indexOf('const renderTransport'));

  assert.match(loadUkwezi, /periodType: ukweziPeriod, month: ukweziMonth, year: ukweziYear/);
  assert.match(loadUkwezi, /if \(isDairy && selectedCenter\)/);
  assert.match(ukwezi, /value="first-half">1–15/);
  assert.match(ukwezi, /value="second-half">16–/);
  assert.match(workspace, /const \[ukweziPeriod, setUkweziPeriod\] = useState<AccountingHalf>\(getCurrentAccountingHalf\)/);
  assert.match(workspace, /const \[settlementHalf, setSettlementHalf\] = useState<AccountingHalf>\(getCurrentAccountingHalf\)/);
  assert.match(workspace, /const \[ownerIfishiPeriod, setOwnerIfishiPeriod\] = useState<AccountingHalf>\(getCurrentAccountingHalf\)/);
  assert.match(workspace, /synchronizeCurrentAccountingHalf\(month, ukweziYear, setUkweziPeriod\)/);
  assert.match(workspace, /synchronizeCurrentAccountingHalf\(month, year, setSettlementHalf\)/);
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
  assert.match(entry, /ownerIfishiMorning/);
  assert.match(entry, /ownerIfishiEvening/);
  assert.doesNotMatch(entry, /owner-ifishi-period|owner-ifishi-summary|owner-ifishi-accounting-summary|owner-ifishi-mobile-list|owner-ifishi-desktop-list/);
  assert.match(history, /owner-ifishi-summary/);
  assert.match(history, /owner-ifishi-accounting-summary/);
  assert.match(milkEntry, /ownerIfishiHistoryOpen \? renderOwnerIfishiHistory\(\)/);
  assert.match(workspace, /setOwnerIfishiPeriod\(getAccountingHalfForDay\(day\)\)/);
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
  const dairyTabs = workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy'));
  assert.doesNotMatch(dairyTabs, /id: 'settlements'/);
  assert.match(dairyTabs, /id: 'settings'/);
  assert.match(centers, /onSubmit=\{createCenter\}/);
});

test('Super Admin pricing editor manages dynamic tiers and timing policy without duplicate views', () => {
  const loader = workspace.slice(workspace.indexOf("if (tab === 'config')"), workspace.indexOf("if (tab === 'settings')"));
  const save = workspace.slice(workspace.indexOf('const saveAdminCollectorPrices'), workspace.indexOf('const saveAccountSettings'));
  const editor = workspace.slice(workspace.indexOf('const renderAdminCollectorPricing'), workspace.indexOf('const renderSystemHealth'));
  const centerPricingEditor = workspace.slice(workspace.indexOf('const renderAdminConfig'), workspace.indexOf('const renderAdminSubscriptionPolicy'));
  const pricingView = workspace.slice(workspace.indexOf("{tab === 'config' && isAdmin"), workspace.indexOf("{tab === 'system-health' && isAdmin"));
  const plansRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'admin', 'config', 'plans', 'route.js'), 'utf8');

  assert.match(loader, /api<SubscriptionPlan\[]>\('\/api\/admin\/config\/plans', \{ cache: 'no-store' \}\)/);
  assert.match(loader, /api<SubscriptionPolicy>\('\/api\/admin\/config\/subscription', \{ cache: 'no-store' \}\)/);
  assert.match(loader, /plans\.filter\(isCollectorTier\)/);
  assert.match(loader, /setCollectorTierEdits\(Object\.fromEntries/);
  assert.match(pricingView, /renderAdminCollectorPricing\(\)/);
  assert.match(pricingView, /renderAdminSubscriptionPolicy\(\)/);
  assert.doesNotMatch(pricingView, /renderAdminSubscriptions/);
  assert.match(editor, /collectorPlans\.map\(\(plan\)/);
  assert.match(editor, /const addTier =/);
  assert.match(editor, /minVolumeLiters/);
  assert.match(editor, /maxVolumeLiters/);
  assert.match(editor, /isActive/);
  assert.match(editor, /adminAddTier/);
  assert.match(editor, /adminTierMinimum/);
  assert.match(editor, /adminTierMaximum/);
  assert.match(editor, /price: ''/);
  assert.doesNotMatch(editor, /price: 1|price: '1'/);
  assert.match(workspace, /MtnMoMoBrand/);
  assert.match(workspace, /admin-pricing-layout/);
  assert.match(editor, /value=\{price\}/);
  assert.match(editor, /onClick=\{\(\) => \{ void saveAdminCollectorPrices\(\); \}\}/);
  assert.match(editor, /disabled=\{busy\}/);
  assert.match(save, /subscriptionPlans\.filter\(isCollectorTier\)\.map/);
  assert.match(save, /isActive:/);
  assert.match(save, /initialAccessDays/);
  assert.match(save, /minVolumeLiters/);
  assert.match(save, /maxVolumeLiters/);
  assert.match(save, /\/api\/admin\/config\/plans/);
  assert.match(plansRoute, /user\.role !== 'super_admin'/);
  assert.match(centerPricingEditor, /centerPricing\?\.config\?\.monthly_amount \?\? centerPricing\?\.plan\?\.price/);
  assert.match(centerPricingEditor, /billingPeriodLabel/);
  assert.doesNotMatch(centerPricingEditor, /30000|monthly_amount \|\|.*0/);
});

test('Super Admin System Health displays fetched database, migration, and API status', () => {
  const healthView = workspace.slice(workspace.indexOf('const renderSystemHealth'), workspace.indexOf('const activeTab ='));
  const healthLoader = workspace.slice(workspace.indexOf("if (tab === 'system-health')"), workspace.indexOf("if (tab === 'notifications-admin')"));

  assert.match(healthLoader, /fetch\('\/api\/health'\)/);
  assert.match(healthLoader, /setSystemHealth\(await response\.json\(\)\)/);
  assert.match(healthView, /systemHealth\?\.database\.connected/);
  assert.match(healthView, /systemHealth\?\.migrated/);
  assert.match(healthView, /systemHealth\?\.ok/);
  assert.doesNotMatch(healthView, />Healthy</);
  assert.doesNotMatch(healthView, />Operational</);
});

test('Login and Register use the existing visible brand lockup', () => {
  const login = workspace.slice(workspace.indexOf('function Login'), workspace.indexOf('export default function Workspace'));
  assert.match(login, /<BrandLockup className="auth-brand-lockup" imageSize=\{72\} \/>/);
  assert.match(styles, /\.auth-brand-lockup \.brand-lockup-image \{ width: 72px; height: 72px; \}/);
  assert.match(styles, /\.auth-brand-lockup \.brand-lockup-image \{ width: 52px; height: 52px; \}/);
  assert.match(login, /forgotPassword \? t\('forgotTitle'\) : registering \? t\('createTitle'\) : t\('loginTitle'\)/);
  assert.match(login, /forgotPassword \? t\('forgotDescription'\) : registering \? t\('registerDescription'\) : t\('loginDescription'\)/);
});

test('Forgot Password link opens the route-specific reset flow using existing APIs', () => {
  const login = workspace.slice(workspace.indexOf('function Login'), workspace.indexOf('export default function Workspace'));
  const forgotPage = fs.readFileSync(path.join(__dirname, '..', 'app', '(auth)', 'forgot-password', 'page.tsx'), 'utf8');
  assert.match(login, /const forgotPassword = pathname === '\/forgot-password'/);
  assert.match(login, /<Link className="auth-forgot-link" href="\/forgot-password">/);
  assert.match(login, /api\('\/api\/auth\/password-reset\/request'/);
  assert.match(login, /api\('\/api\/auth\/password-reset\/verify'/);
  assert.match(login, /api\('\/api\/auth\/password-reset'/);
  assert.match(forgotPage, /return <Workspace \/>/);
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

test('registration exposes Collection Center selection in production as part of the account type selector', () => {
  const login = workspace.slice(workspace.indexOf('function Login'), workspace.indexOf('export default function Workspace'));
  assert.match(login, /<option value="COLLECTION_CENTER">\{t\('collectionCenter'\)\}<\/option>/);
});

test('Super Admin Alerts tab renders the notifications it loads', () => {
  assert.match(workspace, /tab === 'notifications-admin' && isAdmin \? renderNotifications\(\) : null/);
});

test('Collector settlements owns operational reconciliation while Ukwezi retains milk accounting', () => {
  const settlementView = workspace.slice(workspace.indexOf('const renderSettlements'), workspace.indexOf('const renderReports'));
  const ukweziView = workspace.slice(workspace.indexOf('const renderUkwezi'), workspace.indexOf('const renderTransport'));
  const dairyTabs = workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy'));

  assert.match(workspace, /setSettlementReport\(await api<Report>\(`\/api\/reports\/summary\?\$\{reportParams\}`/);
  assert.match(settlementView, /const reconciliation = settlementReport\?\.settlementAccounting/);
  assert.match(settlementView, /const farmerRows = reconciliation\?\.farmers \|\| \[\]/);
  assert.match(settlementView, /farmerRows\.map/);
  assert.match(settlementView, /settlementData\?\.data \|\| \[\]/);
  assert.match(settlementView, /settlementsCashApprovedAmount/);
  assert.match(settlementView, /settlementsCashReceived/);
  assert.match(settlementView, /settlementsDebtRepaid/);
  assert.match(settlementView, /settlementsDebtOutstanding/);
  assert.doesNotMatch(ukweziView, /settlementAccounting\.farmers|settlementsCashApprovedAmount|settlementsDebtOutstanding/);
  assert.match(ukweziView, /ukwezi-settlement-table/);
  assert.doesNotMatch(dairyTabs, /id: 'settlements'/);
  assert.match(workspace, /tab === 'settlements' && isCollector \? renderSettlements\(\) : null/);
});

test('tables use mobile cards on phones and retain table layout outside the phone breakpoint', () => {
  assert.match(styles, /\.table-scroll, \.table-wrap \{[^}]*overflow-x: auto/);
  assert.match(styles, /\.table-scroll > table, \.table-wrap > table \{ width: max-content; min-width: 100%; \}/);
  assert.doesNotMatch(styles, /\.table-scroll, \.table-wrap \{ display: block !important/);
  assert.match(styles, /\.milk-desktop-list \{ display: none; \}/);
  assert.match(styles, /\.milk-mobile-list \{ display: grid; gap: 8px/);
  assert.match(styles, /\.farmers-desktop-table \{ display: none; \}/);
  assert.match(styles, /\.farmer-mobile-list \{ display: grid; gap: 8px/);
  assert.match(styles, /\.ukwezi-settlement-table \{ display: none; \}/);
  assert.match(styles, /\.ukwezi-mobile-list \{ display: grid; gap: 8px; \}/);
  assert.match(styles, /\.settlements-desktop-table \{ display: none; \}/);
  assert.match(styles, /\.settlements-mobile-list \{ display: grid; gap: 8px/);
  assert.match(styles, /\.settlements-mobile-list \{ display: none; \}/);
  assert.match(styles, /\.settlement-mobile-card \{ min-width: 0;/);
  assert.match(workspace, /table-scroll settlements-desktop-table/);
  assert.match(workspace, /settlement-mobile-card/);
  assert.doesNotMatch(styles, /\.milk-mobile-list,[\s\S]*?\.ukwezi-mobile-list \{ display: none !important; \}/);
});