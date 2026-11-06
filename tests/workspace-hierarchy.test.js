const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = fs.readFileSync(path.join(__dirname, '..', 'app', 'workspace.tsx'), 'utf8');
const publicCopy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'i18n', 'public-copy.ts'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

test('Collector Milk Records keeps Owner Ifishi distinct and exposes farmer record actions', () => {
  const milkEntry = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');
  const ownerIfishi = workspace.slice(workspace.indexOf('const renderOwnerIfishiEntry'), workspace.indexOf('const renderIfishi ='));
  assert.match(milkEntry, /milk-owner-context/);
  assert.match(milkEntry, /onOpenOwnerIfishi/);
  assert.match(milkEntry, /ownerHistoryContent/);
  assert.match(milkEntry, /onOpenIfishi\(row\.farmerId, row\.farmerName\)/);
  assert.match(milkEntry, /ownerEntryDialog/);
  assert.match(workspace, /ownerEntryDialog=\{isCollector && ownerIfishiOpen \? <Modal/);
  assert.match(workspace, /ifishiDialog=\{ifishiOpen \? <Modal/);
  assert.doesNotMatch(ownerIfishi, /\(Morning\)|\(Evening\)|Daily total/);
  assert.match(workspace, /setIfishiFarmers\(\[selectedFarmer\]\)/);
  assert.match(milkEntry, /ownerHistoryOpen/);
  assert.match(ownerIfishi, /openOwnerIfishiEntry\(entry\.date\)/);
  assert.match(workspace, /onOpenOwnerIfishi=\{\(\) => \{ setIfishiOpen\(false\); openOwnerIfishiEntry\(\); \}\}/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard')), /if \(isCollector\) return renderOwnerIfishi/);
});

test('Collection Center farmer management uses owner scope without Collector assignment UI', () => {
  const listRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmers', 'route.ts'), 'utf8');
  const detailRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'farmers', '[id]', 'route.js'), 'utf8');
  const farmersComponent = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'farmers-view.tsx'), 'utf8');
  const farmerView = workspace.slice(workspace.indexOf('const renderFarmers'), workspace.indexOf('const renderCenters'));

  assert.match(workspace, /tab === 'farmers' && !isAdmin \? renderFarmers\(\)/);
  assert.doesNotMatch(workspace, /tab === 'farmers' && !isAdmin && isDairy \? renderAbacundaDirectory/);
  assert.match(farmersComponent, /title=\{t\('navFarmers'\)\}/);
  assert.match(farmersComponent, /className="farmers-toolbar"/);
  assert.match(farmerView, /const collectorManagement = !isCollector && !isDairy \? <div className="assignment-tool">/);
  assert.match(farmersComponent, /farmerNumberShort/);
  assert.match(farmersComponent, /assignedCollectors/);
  assert.doesNotMatch(farmersComponent, /statusLabel|farmer-status-active/);
  assert.match(farmersComponent, /viewFarmerHistory/);
  assert.match(farmersComponent, /navIfishi/);
  assert.doesNotMatch(farmersComponent, /farmerVillage|farmerForm\.location|farmerEdit\.location/);
  assert.match(farmerView, /onOpenHistory=\{openFarmerHistory\}/);
  assert.doesNotMatch(styles, /farmer-mobile-card dl > div:nth-child\(5\).*display: none/);
  assert.match(styles, /\.farmer-mobile-card footer \{ justify-content: flex-start; flex-wrap: wrap;/);
  assert.match(farmerView, /onSubmitCreate=\{createFarmer\}/);
  assert.match(farmerView, /onSubmitEdit=\{saveFarmer\}/);
  assert.match(farmersComponent, /screen-grid farmers-view/);
  assert.match(farmersComponent, /farmer-sort-mobile/);
  assert.match(farmersComponent, /aria-sort=/);
  assert.match(farmersComponent, /collectorFilter/);
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
  const milkEntry = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');

  assert.match(dairyTabs, /id: 'settings'/);
  assert.match(milkEntry, /volumeInput\(row, 'morning'\)/);
  assert.match(milkEntry, /presentCount|abacundaCount/);
  assert.match(milkEntry, /t\('milkResultsCount'\)/);
  assert.match(milkEntry, /entryState\(row\) === 'saved'/);
  assert.match(milkEntry, /milk-card-identity/);
  assert.match(milkEntry, /onOpenHistory\(row\)/);
  assert.match(milkEntry, /onSave\(row\)/);
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
  assert.match(settlementView, /publicLanguage\.t\('ukweziReconciliationUnavailableDetail'\)/);
  assert.match(ukweziView, /settlementAccountingStatus === 'MIGRATION_REQUIRED'/);
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

test('shared workspace headings and mobile overflow navigation expose accessible shell behavior', () => {
  const pageHeader = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'workspace-page-header.tsx'), 'utf8');

  assert.match(pageHeader, /<h1>\{title\}<\/h1>/);
  assert.match(pageHeader, /role="group" aria-label="Page actions"/);
  assert.match(workspace, /mobileMoreMenuRef/);
  assert.match(workspace, /mobileMoreTriggerRef\.current\?\.focus\(\)/);
  assert.match(workspace, /document\.addEventListener\('pointerdown', closeOnOutsidePointerDown\)/);
  assert.match(workspace, /<nav ref=\{mobileMoreMenuRef\} className="mobile-more-menu"/);
  assert.match(styles, /\.mobile-more-menu[^\n]*max-height: min\(60vh, 480px\)[^\n]*overflow-y: auto/);
  assert.match(styles, /\.user-name\.user-settings-shortcut\s*\{\s*display: inline-flex !important;/);
  assert.match(styles, /\.topbar-right > button\.icon-button:last-child\s*\{\s*display: inline-grid !important;/);
});

test('Milk Entry exposes secure search, session, page-size, clear, and reset controls', () => {
  const milkEntry = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');
  const header = workspace.slice(workspace.indexOf('className="content-heading"'), workspace.indexOf('{error ?'));

  assert.match(milkEntry, /className="milk-record-tools"/);
  assert.match(milkEntry, /type="search"/);
  assert.match(milkEntry, /milkClearSearch/);
  assert.match(milkEntry, /milkSessionAll/);
  assert.match(milkEntry, /onPageSizeChange|pageSize/);
  assert.match(workspace, /params\.set\('search', search\)/);
  assert.match(workspace, /params\.set\('session', session\)/);
  assert.match(workspace, /setDailyCursor\(null\)/);
  assert.match(workspace, /const dailyFilterState = \[debouncedDailySearch, dailySession, dailyDeliveryFilter, dailyCollectorFilter, dailyPageSize\]/);
  assert.doesNotMatch(header, /search-form|Global search|globalSearch|global-search/);
  assert.doesNotMatch(workspace, /globalSearch|runGlobalSearch|global-search-panel/);
});

test('Farmer Ifishi in Milk Entry contains milk records only', () => {
  const loader = workspace.slice(workspace.indexOf('const loadIfishiRecords'), workspace.indexOf('const loadOwnerIfishiHistory'));
  const milkEntry = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');
  const view = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));

  assert.match(loader, /\/api\/milk\?/);
  assert.doesNotMatch(loader, /\/api\/reports\/summary/);
  assert.doesNotMatch(view, /ifishiAccounting|accountingFarmer|totalTransport|netAmount|reportsGross|dashboardDeductions/);
  assert.match(workspace, /if \(user && tab === 'milk' && ifishiOpen && ifishiFarmerId\) loadIfishiRecords\(\)/);
  assert.doesNotMatch(view, /if \(isCollector\) return renderOwnerIfishi/);
  assert.match(workspace, /setIfishiSelectedFarmer\(selectedFarmer\)/);
  assert.match(workspace, /setIfishiFarmers\(result\.data\)/);
  assert.doesNotMatch(workspace, /setIfishiFarmerId\(String\(result\.data\[0\]\.id\)\)/);
  assert.doesNotMatch(milkEntry, /dailySummary\.totalAmount|milkAmount/);
  assert.match(styles, /\.milk-desktop-list \{ width: 100%; margin: 0; border-top: 0; \}/);
  assert.match(styles, /\.milk-desktop-list table \{ min-width: 1000px; table-layout: fixed;/);
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
  assert.match(ukwezi, /if \(reportCenterName\) ukweziPdfParams\.set\('collectionCenter', reportCenterName\)/);
  assert.match(ukwezi, /ukweziReport\.rangeStart\} – \{ukweziReport\.rangeEnd/);
  assert.match(publicCopy, /ukweziColEjoheza:/);
  assert.match(publicCopy, /ukweziEjohezaNoRecords:/);
});

test('Collector Ukwezi separates summary, owner accounting, and positive-payable routes', () => {
  const ukwezi = workspace.slice(workspace.indexOf('const renderUkwezi'), workspace.indexOf('const renderTransport'));
  const roster = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'collector-ukwezi-payment-roster.tsx'), 'utf8');
  const monthlyReport = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'monthly-report-service.js'), 'utf8');

  assert.match(ukwezi, /className="ukwezi-summary"/);
  assert.match(ukwezi, /className="ukwezi-owner-accounting"/);
  assert.match(ukwezi, /className=\{`ukwezi-reconciliation/);
  assert.match(ukwezi, /ownerGrossForCheck\) - totalDistributed/);
  assert.match(ukwezi, /Number\(row\.validVolumeLiters \?\? row\.totalVolume \?\? 0\) > 0/);
  assert.match(ukwezi, /return Number\.isFinite\(payable\) \? Math\.max\(0, payable\) : null/);
  assert.match(ukwezi, /account\.length >= 4 && !\['N\/A', 'NA', '—', '-', 'NONE', 'NULL'\]\.includes\(account\.toUpperCase\(\)\)/);
  assert.match(monthlyReport, /const hasValidSaccoAccount = \(farmer\) =>/);
  assert.match(monthlyReport, /!\['N\/A', 'NA'\]\.includes\(acc\.toUpperCase\(\)\) && acc\.length >= 4/);
  assert.match(roster, /t\('ukweziColNationalId'\)/);
  assert.match(roster, /t\('ukweziColTotalDeductions'\)/);
  assert.match(roster, /t\('ukweziPaymentAmount'\)/);
  assert.match(roster, /t\('ukweziColAccountNumber'\)/);
  assert.match(roster, /t\('ukweziOwnerAccount'\)/);
  assert.match(roster, /ukwezi-debt-recovery/);
  assert.match(roster, /openingDebt/);
  assert.match(roster, /debtRecovered/);
  assert.match(roster, /closingDebt/);
  assert.match(workspace, /action: 'close-period'/);
  assert.match(workspace, /ukweziCloseConfirm/);
  assert.match(monthlyReport, /openingDebt: details\.debtBalanceComplete/);
  assert.match(monthlyReport, /closingDebt: details\.debtBalanceComplete/);
  assert.match(publicCopy, /ukweziDistributionFormula:/);
  assert.match(styles, /\.ukwezi-debt-mobile \{ display: none; \}/);
  assert.match(styles, /\.ukwezi-debt-mobile \{ display: grid; gap: 8px; \}/);
  assert.match(styles, /\.ukwezi-payment-desktop \{ display: none; \}/);
  assert.match(styles, /\.ukwezi-summary-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test('Collector Ukwezi farmer search filters both payment lists and debt rows without changing reconciliation inputs', () => {
  const roster = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'collector-ukwezi-payment-roster.tsx'), 'utf8');
  const search = fs.readFileSync(path.join(__dirname, '..', 'lib', 'utils', 'ukwezi-payment-search.js'), 'utf8');

  assert.match(roster, /filterUkweziPaymentRows\(\[\.\.\.accountRows\]\.sort\(compareFarmerNames\), searchQuery\)/);
  assert.match(roster, /filterUkweziPaymentRows\(\[\.\.\.ownerRows\]\.sort\(compareFarmerNames\), searchQuery\)/);
  assert.match(roster, /paginateUkweziPaymentRows\(filteredAccountRows, accountPage, accountPageSize\)/);
  assert.match(roster, /paginateUkweziPaymentRows\(filteredOwnerRows, ownerPage, ownerPageSize\)/);
  assert.match(roster, /rows: accountPagination\.rows[\s\S]*rows: ownerPagination\.rows/);
  assert.match(roster, /accountTotals = useMemo\(\(\) => getPaymentTotals\(accountRows\)/);
  assert.match(roster, /formatMoney\(accountTotals\.payable, language\)/);
  assert.match(roster, /ukweziSearchResults/);
  assert.match(search, /row\.accountNumber/);
  assert.match(search, /row\.nationalId/);
  assert.match(search, /row\.phone/);
});

test('Active Ikigo selection stays valid and falls back to the first center when needed', () => {
  const loadCenters = workspace.slice(workspace.indexOf('const loadCenters'), workspace.indexOf('const loadCollectorAssignments'));

  assert.match(loadCenters, /setSelectedCenter\(\(current\) =>/);
  assert.match(loadCenters, /data\.some\(\(center\) => String\(center\.id\) === String\(current\)\)/);
  assert.match(loadCenters, /String\(data\[0\]\.id\)/);
});

test('Session startup has a bounded failure state and local assignment and milk retries', () => {
  const milkView = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');
  assert.match(workspace, /setTimeout\(\(\) => controller\.abort\(\), 12000\)/);
  assert.match(workspace, /Unable to start Milk System/);
  assert.match(workspace, /onClick=\{\(\) => \{ setAuthError\(''\); setAuthLoading\(true\); setAuthAttempt/);
  assert.match(workspace, /if \(status === 401\) \{[\s\S]*?setUser\(null\)/);
  assert.match(workspace, /collectorAssignmentsError \? <div className="workspace-empty" role="alert">[\s\S]*?Retry/);
  assert.match(milkView, /error \? <div className="workspace-empty" role="alert">[\s\S]*?onRetry/);
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
  const deductionView = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'deductions-view.tsx'), 'utf8');
  const deductionRepository = fs.readFileSync(path.join(__dirname, '..', 'lib', 'repositories', 'deductionRepository.js'), 'utf8');

  assert.match(view, /<DeductionView/);
  assert.match(view, /onAddDeduction=\{async \(input\) => \{ await createDeductionFromView\(input\); \}\}/);
  assert.match(deductionView, /createOpen \? \(/);
  assert.match(deductionView, /onSubmit=\{submitCreate\}/);
  assert.match(deductionView, /deductionsAdd/);
  assert.match(deductionView, /deductionsNotes/);
  assert.match(workspace, /const createDeductionFromView = async/);
  assert.match(workspace, /deductionSubmittingRef\.current/);
  assert.match(workspace, /const refreshDeductionView = async/);
  assert.match(workspace, /const refreshDeductionAccounting = async/);
  assert.match(deductionView, /const today = \(\) => getAccountingDate\(\)/);
  assert.match(deductionRepository, /FROM farmers f[\s\S]*LEFT JOIN LATERAL/);
  assert.match(deductionView, /deductionFilterNotDeducted/);
  assert.match(deductionView, /deductionFilterPartial/);
  assert.match(deductionView, /deductionFilterDebt/);
  assert.match(deductionView, /onLoadAllEligible/);
  assert.match(deductionView, /deductionBatchConfirmation/);
  assert.match(deductionView, /onApplyConfiguredBatch/);
  assert.match(deductionView, /deduction-summary-grid/);
  assert.match(deductionView, /deduction-row-breakdown/);
  assert.match(deductionView, /inspectLedgerFarmer/);
  assert.doesNotMatch(deductionView, /deduction-screen-panel|deductionsRecent|sortableHeader/);
  assert.doesNotMatch(deductionView, /onOpenBatchCreate/);
  assert.doesNotMatch(deductionView, /toISOString\(\)|articleclassName|divclassName/);
  assert.match(deductionView, /t\('deductionsClear'\)/);
  assert.doesNotMatch(deductionView, /t\('delete'\)/);
  assert.match(publicCopy, /deductionsClear: 'Shyira ko byarangiye'/);
  assert.match(publicCopy, /deductionsClear: 'Mark cleared'/);
  for (const selector of ['.deduction-summary-grid', '.deduction-row-breakdown', '.deduction-history-list', '.deduction-history-item', '.deduction-history-actions']) {
    assert.ok(styles.includes(selector), `missing responsive deduction style ${selector}`);
  }
});

test('Collector Ukwezi opens a period-bound deduction modal from farmer rows', () => {
  const ukwezi = workspace.slice(workspace.indexOf('const renderUkwezi'), workspace.indexOf('const renderTransport'));

  assert.match(ukwezi, /const selectedUkweziRange = getHalfMonthDateRange/);
  assert.match(ukwezi, /isCollector \? <th>\{publicLanguage\.t\('actions'\)\}<\/th> : null/);
  assert.match(ukwezi, /openFarmerDeduction\(row\.farmerId, row\.farmerName, selectedUkweziRange\.startDate, selectedUkweziRange\.endDate/);
  assert.match(ukwezi, /className="ukwezi-mobile-card"[\s\S]*?openFarmerDeduction\(row\.farmerId/);
  assert.match(workspace, /deductionCreateOpen && deductionContextFarmer \? <Modal/);
  assert.match(workspace, /onSubmit=\{createDeduction\}/);
  assert.match(workspace, /min=\{deductionContextFarmer\.periodStart\} max=\{deductionContextFarmer\.periodEnd\}/);
  assert.match(workspace, /deductionContextFarmer\.grossAmount/);
  assert.match(workspace, /deductionContextFarmer\.totalTransport/);
  assert.match(workspace, /deductionSubmittingRef\.current/);
});

test('Owner Ifishi is the only Collector owner-milk entry form', () => {
  const milkEntry = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');
  const ownerService = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'owner-ifishi-service.js'), 'utf8');

  assert.match(milkEntry, /ownerEntryDialog/);
  assert.doesNotMatch(milkEntry, /saveCollectorMilk|collector-combined-entry|collectorMilkVolume/);
  assert.match(workspace, /ownerEntryDialog=\{isCollector && ownerIfishiOpen \? <Modal/);
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
  const milkEntry = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'milk-records-view.tsx'), 'utf8');

  assert.match(milkEntry, /ownerEntryDialog/);
  assert.match(workspace, /ownerEntryDialog=\{isCollector && ownerIfishiOpen \? <Modal[^]*?className="owner-ifishi-entry-modal"/);
  assert.match(entry, /type="date"/);
  assert.match(entry, /ownerIfishiMorning/);
  assert.match(entry, /ownerIfishiEvening/);
  assert.doesNotMatch(entry, /owner-ifishi-period|owner-ifishi-summary|owner-ifishi-accounting-summary|owner-ifishi-mobile-list|owner-ifishi-desktop-list/);
  assert.match(history, /owner-ifishi-summary/);
  assert.match(history, /owner-ifishi-accounting-summary/);
  assert.match(milkEntry, /ownerHistoryOpen \? ownerHistoryContent : null/);
  assert.match(workspace, /setOwnerIfishiPeriod\(getAccountingHalfForDay\(day\)\)/);
});

test('Collector Settings exposes only owned collection sites while Dairy has no Collector site management', () => {
  const collectorTabs = workspace.slice(workspace.indexOf('const collectorTabs'), workspace.indexOf('const dairyTabs'));
  const settings = workspace.slice(workspace.indexOf('const renderAccountSettings'), workspace.indexOf('const renderBilling'));
  const centers = workspace.slice(workspace.indexOf('const renderCenters'), workspace.indexOf('const renderMilk'));
  const farmersView = fs.readFileSync(path.join(__dirname, '..', 'components', 'views', 'farmers-view.tsx'), 'utf8');

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
  assert.match(farmersView, /collectorOwnedCenters\.map\(\(center\)/);
  assert.match(workspace, /collectorOwnedCenters\.find\(\(center\)/);
  const dairyTabs = workspace.slice(workspace.indexOf('const dairyTabs'), workspace.indexOf('const navigationCopy'));
  assert.match(dairyTabs, /id: 'settlements'/);
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

test('Super Admin System Health loads protected platform diagnostics instead of the public liveness route', () => {
  const healthView = workspace.slice(workspace.indexOf('const renderSystemHealth'), workspace.indexOf('const activeTab ='));
  const healthLoader = workspace.slice(workspace.indexOf("if (tab === 'system-health')"), workspace.indexOf("if (tab === 'notifications-admin')"));

  assert.match(healthLoader, /api<SystemHealth>\('\/api\/admin\/system-health', \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(healthLoader, /fetch\('\/api\/health'\)/);
  assert.match(healthView, /systemHealth\?\.database/);
  assert.match(healthView, /systemHealth\?\.migrations/);
  assert.match(healthView, /systemHealth\?\.emailOutbox/);
  assert.match(healthView, /systemHealth\?\.payments/);
  assert.match(healthView, /systemHealth\?\.scheduler/);
  assert.match(healthView, /systemHealth\?\.notificationEvaluation/);
  assert.match(healthView, /healthNotConfigured/);
  assert.doesNotMatch(healthView, />Healthy</);
  assert.doesNotMatch(healthView, />Operational</);
});

test('Super Admin account list paginates, displays verification, confirms destructive actions, and documents the approval gap', () => {
  const accounts = workspace.slice(workspace.indexOf('const renderAdminAccounts'), workspace.indexOf('const renderAdminAccountDetailsModal'));
  const loader = workspace.slice(workspace.indexOf('const loadAccounts ='), workspace.indexOf('const loadAdminAccountDetails'));
  const action = workspace.slice(workspace.indexOf('const adminAction ='), workspace.indexOf('const openAbacundaIfishi'));
  assert.match(loader, /ACCOUNT_PAGE_SIZE/);
  assert.match(loader, /page: String\(page\)/);
  assert.match(accounts, /emailVerificationStatus/);
  assert.match(accounts, /emailVerifiedValue/);
  assert.match(accounts, /accounts\.page >= totalPages/);
  assert.match(accounts, /previousPage/);
  assert.match(accounts, /adminNotApprovedNoWorkflow/);
  assert.match(action, /adminSuspendConfirm/);
  assert.match(action, /adminReactivateConfirm/);
  assert.match(action, /window\.confirm/);
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
  assert.match(dairyTabs, /id: 'settlements'/);
  assert.match(workspace, /tab === 'settlements' && \(isCollector \|\| isDairy\) \? renderSettlements\(\) : null/);
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

test('deduction batch and configuration routes require a Collector and active subscription for writes', () => {
  const configRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'deductions', 'configurations', 'route.js'), 'utf8');
  const configItemRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'deductions', 'configurations', '[id]', 'route.js'), 'utf8');
  const batchRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'deductions', 'batch', 'route.js'), 'utf8');
  for (const route of [configRoute, configItemRoute, batchRoute]) assert.match(route, /requireAccountType\(user, 'COLLECTOR'\)/);
  for (const route of [configItemRoute, batchRoute]) assert.match(route, /requireActiveSubscription\(user\)/);
  assert.match(configRoute, /listDeductionConfigurations/);
  assert.match(configRoute, /createDeductionConfiguration/);
  assert.match(configItemRoute, /updateDeductionConfiguration/);
  assert.match(batchRoute, /applyDeductionBatch/);
});