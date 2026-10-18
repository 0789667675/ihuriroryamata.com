import { expect, test, type Page } from '@playwright/test';
import { getCurrentAccountingPeriod } from '../../lib/utils/accounting-period.js';

const collector = {
  id: 990001,
  name: 'Synthetic Test Collector',
  email: 'collector.test@example.invalid',
  role: 'user',
  accountType: 'COLLECTOR',
};

const superAdmin = {
  id: 990002,
  name: 'Synthetic Test Admin',
  email: 'admin.test@example.invalid',
  role: 'super_admin',
  accountType: 'COLLECTOR',
};

const collectionCenter = {
  id: 990003,
  name: 'Personal Account Holder',
  email: 'center.test@example.invalid',
  role: 'user',
  accountType: 'COLLECTION_CENTER',
};

const settlementReport = {
  farmerGross: 5000,
  expectedFarmerPayable: 4500,
  saccoEligiblePayable: 0,
  saccoDistributionInstruction: 0,
  saccoConfirmedAmount: 0,
  retainedUnpaidAmount: 3500,
  cashApprovedAmount: 1500,
  cashConfirmedAmount: 500,
  debtRepaymentAmount: 300,
  outstandingDebt: 200,
  legacyUnallocatedDebtRepayments: 0,
  debtBalancesComplete: true,
  unexplainedDiscrepancy: 200,
  ownerGrossReconciliation: { ownerGross: 7000, farmerGross: 5000, surplus: 2000, discrepancy: 0 },
  farmers: [{
    farmerId: 993101,
    farmerName: 'Aline Test Farmer',
    nationalId: 'ID-993101',
    phone: '0788000000',
    accountNumber: null,
    totalVolume: 12.5,
    grossAmount: 5000,
    totalTransport: 0,
    totalDeductions: 500,
    netAmount: 4500,
    settlement: {
      saccoEligible: false,
      saccoDistributionInstruction: 0,
      cashApprovedAmount: 1500,
      cashConfirmedAmount: 500,
      debtRepaymentAmount: 300,
      outstandingDebt: 200,
      retainedUnpaidAmount: 3500,
      unexplainedDiscrepancy: 200,
    },
  }],
};

const browserTestBaseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';

type MilkFixture = {
  farmerMorning?: number;
  farmerEvening?: number;
  ownerMorning?: number;
  ownerEvening?: number;
  ownerValidLiters?: number;
  includeOwnerEntry?: boolean;
};

async function mockWorkspaceApis(page: Page, user = collector, milkFixture: MilkFixture = {}) {
  const centers: Record<string, unknown>[] = [];
  await page.unrouteAll({ behavior: 'wait' });
  page.on('pageerror', (error) => console.error('Browser runtime error:', error.stack || error.message));
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/auth/me')) console.error('Auth bootstrap request failed:', request.failure()?.errorText);
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/auth/me')) console.log('Auth bootstrap response:', response.status());
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('Browser console error:', message.text());
  });
  await page.addInitScript(() => localStorage.setItem('milkSystem.language', 'en'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(browserTestBaseURL).origin) {
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    let body: unknown = {};
    let status = 200;
    if (url.pathname === '/api/auth/me') body = { ok: true, user };
    else if (url.pathname === '/api/collection-centers') {
      if (route.request().method() === 'POST') {
        const input = await route.request().postDataJSON();
        const center = {
          ...input,
          id: 993001,
          owner_user_id: user.id,
          pricePerLiter: Number(input.pricePerLiter),
          transportRatePerLiter: 0,
          morning_start: input.morningStart,
          morning_end: input.morningEnd,
          evening_start: input.eveningStart,
          evening_end: input.eveningEnd,
        };
        centers.push(center);
        body = center;
      } else body = centers;
    }
    else if (url.pathname === '/api/farmers') body = { data: [], nextCursor: null, hasMore: false, pageSize: 50 };
    else if (url.pathname === '/api/notifications/unread-count') body = { data: { unreadCount: 0 } };
    else if (url.pathname === '/api/notifications') body = { data: [] };
    else if (url.pathname === '/api/subscription') body = { account: { phone: null }, subscription: null, payments: [] };
    else if (url.pathname === '/api/reports/summary') body = {
      totalFarmers: 0, totalVolume: 0, totalMorning: 0, totalEvening: 0,
      totalRevenueMonth: 0, totalDeductionsMonth: 0, totalTransportFeesMonth: 0,
      netRevenueMonth: 0, todayTotal: 0, todayMorning: 0, todayEvening: 0,
      rangeStart: '2026-10-01', rangeEnd: '2026-10-15', collectorPayable: 4500,
      ownerGeneratedVolume: 15, ownerGeneratedGross: 7000, collectorFarmerMilkValue: 5000,
      collectorFarmerPayable: 4500, collectorFarmerTransport: 0,
      farmerPayments: [{ ...settlementReport.farmers[0], pricePerLiter: 400 }],
      settlementAccounting: settlementReport,
      settlementAccountingStatus: 'AVAILABLE',
    };
    else if (url.pathname === '/api/farmer-settlements') {
      const action = url.searchParams.get('action');
      if (user.accountType !== 'COLLECTOR') {
        status = 403;
        body = { ok: false, message: 'Collector access required.' };
      } else if (route.request().method() === 'POST') body = { ok: true };
      else if (action === 'confirmations') body = {
        ok: true,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-15',
        data: [
          { id: 993201, settlementId: 993201, farmerId: 993101, farmerName: 'Aline Test Farmer', amount: 1000, status: 'APPROVED', periodStart: '2026-10-01', periodEnd: '2026-10-15' },
          { id: 993202, settlementId: 993202, farmerId: 993101, farmerName: 'Aline Test Farmer', amount: 500, status: 'CONFIRMED', periodStart: '2026-10-01', periodEnd: '2026-10-15' },
        ],
      };
      else if (action === 'debts') body = { ok: true, data: [] };
      else body = { ok: false, message: 'Unsupported settlement query.' };
    }
    else if (url.pathname === '/api/milk/daily') body = {
      farmers: [],
      summary: {
        totalFarmers: milkFixture.farmerMorning || milkFixture.farmerEvening ? 1 : 0,
        presentCount: milkFixture.farmerMorning || milkFixture.farmerEvening ? 1 : 0,
        totalMorning: milkFixture.farmerMorning || 0,
        totalEvening: milkFixture.farmerEvening || 0,
        totalVolume: (milkFixture.farmerMorning || 0) + (milkFixture.farmerEvening || 0),
        totalAmount: 0, pricePerLiter: 0, transportRate: 0,
      },
      farmerPagination: { nextCursor: null, hasMore: false },
      centers: [],
      collectorMilk: [],
    };
    else if (url.pathname === '/api/ifishi/owner') body = {
      owner: { name: user.name },
      startDate: '2026-10-16',
      endDate: '2026-10-31',
      entries: milkFixture.includeOwnerEntry ? [{
        id: 992016,
        date: new Date().toISOString().slice(0, 10),
        volumeMorning: milkFixture.ownerMorning ?? 0,
        volumeEvening: milkFixture.ownerEvening ?? 0,
        volumeLiters: (milkFixture.ownerMorning || 0) + (milkFixture.ownerEvening || 0),
        originalVolumeLiters: (milkFixture.ownerMorning || 0) + (milkFixture.ownerEvening || 0),
        validVolumeLiters: milkFixture.ownerValidLiters ?? (milkFixture.ownerMorning || 0) + (milkFixture.ownerEvening || 0),
        lostVolumeLiters: 0, pricePerLiter: 400, grossAmount: 0, assignedFarmerLiters: 0,
        surplusLiters: 0, differenceLiters: 0, status: 'valid', adjustmentReason: null, adjustedAt: null,
      }] : [],
      totals: { originalVolumeLiters: 0, ownerVolumeLiters: 0, lostVolumeLiters: 0, ownerMilkGross: 0, ownerMilkValueComplete: true, assignedFarmerLiters: 0, surplusLiters: 0 },
    };

    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function openWorkspace(page: Page, user = collector, query = 'tab=dashboard&flow=synthetic', milkFixture: MilkFixture = {}) {
  await mockWorkspaceApis(page, user, milkFixture);
  await page.goto(`/login?${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
}

test('direct tab, reload, back, and forward retain valid workspace navigation', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=ukwezi&flow=synthetic');
  await expect(page).toHaveURL(/tab=ukwezi/);
  await expect(page.getByRole('heading', { name: 'Ukwezi', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Milk', exact: true }).first().click();
  await expect(page).toHaveURL(/tab=milk/);
  await expect(page.getByRole('heading', { name: 'Milk', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Farmers', exact: true }).first().click();
  await expect(page).toHaveURL(/tab=farmers/);
  await page.goBack();
  await expect(page).toHaveURL(/tab=milk/);
  await expect(page.getByRole('heading', { name: 'Milk', level: 1 })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/tab=farmers/);
  await expect(page.getByRole('heading', { name: 'Farmers', level: 1 })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Farmers', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/flow=synthetic/);
});

test('unknown and role-restricted direct tabs normalize to the allowed dashboard', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=accounts&flow=synthetic');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/tab=dashboard/);

  await openWorkspace(page, superAdmin, 'tab=farmers&flow=synthetic');
  await expect(page.getByRole('heading', { name: 'Platform overview', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/tab=dashboard/);

  await openWorkspace(page, collector, 'tab=not-a-real-tab&flow=synthetic');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/tab=dashboard/);

  await openWorkspace(page, collectionCenter, 'tab=settlements&flow=synthetic');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/tab=dashboard/);
  await expect(page.getByRole('button', { name: 'Farmer settlements', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch('/api/farmer-settlements')).status)).toBe(403);
});

test('Collector settlements uses report accounting, while Ukwezi keeps its milk table', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=settlements&flow=synthetic');
  const summary = page.locator('.settlement-reconciliation');
  const reconciliationTable = page.locator('.settlement-farmer-table');
  await expect(summary).toContainText('Period payment reconciliation');
  await expect(summary).toContainText('Farmer gross');
  await expect(summary).toContainText('Cash approved');
  await expect(summary).toContainText('1,500 RWF');
  await expect(summary).toContainText('Cash received');
  await expect(summary).toContainText('500 RWF');
  await expect(summary).toContainText('Debt repaid');
  await expect(summary).toContainText('300 RWF');
  await expect(summary).toContainText('Debt outstanding');
  await expect(summary).toContainText('200 RWF');
  await expect(summary).toContainText('Unexplained difference');
  await expect(summary).toContainText('Payable breakdown');
  await expect(reconciliationTable).toContainText('Aline Test Farmer');
  await expect(reconciliationTable).toContainText('3,500 RWF');
  await expect(reconciliationTable).toContainText('200 RWF');
  await expect(page.getByText('Aline Test Farmer').filter({ visible: true })).toHaveCount(4);

  await page.getByRole('button', { name: 'Ukwezi', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Ukwezi', level: 1 })).toBeVisible();
  await expect(page.locator('.ukwezi-settlement-table')).toBeVisible();
  await expect(page.locator('.settlement-farmer-table')).toHaveCount(0);
  await expect(page.getByText('Payment history')).toHaveCount(0);
  await expect(page.locator('.ukwezi-settlement-table')).toContainText('Milk price');
  await expect(page.locator('.ukwezi-settlement-table')).toContainText('Transport');
});

test('settlement tables render as phone cards and stay contained tables at tablet and desktop widths', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=settlements&flow=synthetic');
  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(pageFits).toBe(true);
    if (viewport.width <= 680) {
      await expect(page.locator('.settlement-farmer-table .settlements-desktop-table')).toBeHidden();
      await expect(page.locator('.settlement-farmer-table .settlements-mobile-list')).toBeVisible();
      await expect(page.locator('.settlement-farmer-table .settlement-mobile-card').first()).toBeVisible();
      await expect(page.locator('.settlement-operations .settlements-mobile-list').first()).toBeVisible();
      await expect(page.locator('.settlement-operations .settlements-desktop-table').first()).toBeHidden();
    } else {
      await expect(page.locator('.settlement-farmer-table .settlements-desktop-table')).toBeVisible();
      await expect(page.locator('.settlement-farmer-table .settlements-mobile-list')).toBeHidden();
      const result = await page.locator('.settlement-farmer-table .table-scroll').evaluate((element) => ({
        scrollOverflow: element.scrollWidth >= element.clientWidth,
        overflowX: getComputedStyle(element).overflowX,
      }));
      expect(result.scrollOverflow).toBe(true);
      expect(result.overflowX).toBe('auto');
      await expect(page.locator('.settlement-farmer-table table')).toBeVisible();
    }
  }
});

test('Ukwezi defaults to the current half, keeps historical choice, and restores phone cards', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=ukwezi&flow=synthetic');
  await expect(page.locator('.ukwezi-totals')).toBeVisible();
  const period = getCurrentAccountingPeriod();
  const controls = page.locator('.ukwezi-period-controls');
  const month = controls.locator('select').nth(0);
  const year = controls.locator('select').nth(1);
  const half = controls.locator('select').nth(2);

  await expect(half).toHaveValue(period.periodType);
  const historicalMonth = new Date(Date.UTC(Number(period.year), Number(period.month) - 2, 1));
  await year.selectOption(String(historicalMonth.getUTCFullYear()));
  await month.selectOption(String(historicalMonth.getUTCMonth() + 1).padStart(2, '0'));
  await half.selectOption('first-half');
  await expect(half).toHaveValue('first-half');
  await year.selectOption(period.year);
  await month.selectOption(period.month);
  await expect(half).toHaveValue(period.periodType);

  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(pageFits).toBe(true);
    if (viewport.width <= 680) {
      await expect(page.locator('.ukwezi-settlement-table')).toBeHidden();
      await expect(page.locator('.ukwezi-mobile-list')).toBeVisible();
      await expect(page.locator('.ukwezi-mobile-card').first()).toBeVisible();
    } else {
      await expect(page.locator('.ukwezi-settlement-table')).toBeVisible();
      await expect(page.locator('.ukwezi-mobile-list')).toBeHidden();
    }
  }
});

test('Collection Center can register a center under its own name, distinct from the account holder', async ({ page }) => {
  await openWorkspace(page, collectionCenter, 'tab=centers&flow=synthetic');
  const centerName = page.locator('#new-center-name');
  await expect(centerName).toBeVisible();
  await centerName.fill('Nyabihu MCC');
  const centerForm = page.locator('form').filter({ has: centerName });
  await centerForm.locator('input[type="number"]').first().fill('400');
  await centerForm.getByRole('button').click();
  await expect(page.locator('.center-config-row input').first()).toHaveValue('Nyabihu MCC');
  await expect(page.locator('.center-config-row')).toContainText('0 RWF/L');
  await expect(page.locator('.panel-wide .panel-heading-actions').getByRole('button', { name: 'Account settings: Personal Account Holder' })).toBeVisible();
});

test('Owner Ifishi dialog is transient and does not return after reload', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=milk&flow=synthetic');
  await page.getByRole('button', { name: 'Owner Ifishi', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Owner Ifishi' })).toBeVisible();
  await expect(page).not.toHaveURL(/ownerIfishi|correctionModal/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Milk', level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

const dashboardMilkCases = [
  { label: 'positive difference', farmerMorning: 110, farmerEvening: 107.5, ownerMorning: 120, ownerEvening: 127, ownerValidLiters: 247, expected: '+29.5 L', expectedFarmerTotal: '217.5', higher: 'Owner higher' },
  { label: 'negative difference', farmerMorning: 110, farmerEvening: 105.5, ownerMorning: 110, ownerEvening: 100, ownerValidLiters: 210, expected: '-5.5 L', expectedFarmerTotal: '215.5', higher: 'Farmers higher' },
  { label: 'confirmed zero owner entry', farmerMorning: 110, farmerEvening: 107.5, ownerMorning: 0, ownerEvening: 0, ownerValidLiters: 0, expected: '-217.5 L', expectedFarmerTotal: '217.5', higher: 'Farmers higher' },
];

for (const scenario of dashboardMilkCases) {
  test(`dashboard shows ${scenario.label} without double counting`, async ({ page }) => {
    await openWorkspace(page, collector, 'tab=dashboard&flow=synthetic', { ...scenario, includeOwnerEntry: true });
    const comparison = page.locator('.dashboard-milk-reconciliation');
    await expect(comparison).toContainText(scenario.expected);
    await expect(comparison).toContainText(scenario.higher);
    await expect(page.locator('.dashboard-volume strong')).toHaveText(scenario.expectedFarmerTotal);
  });
}

test('dashboard labels missing Owner Ifishi separately from recorded zero', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=dashboard&flow=synthetic', { farmerMorning: 110, farmerEvening: 107.5 });
  const comparison = page.locator('.dashboard-milk-reconciliation');
  await expect(comparison).toContainText('No Owner Ifishi entry is recorded for this date.');
  await expect(comparison).not.toContainText('Owner higher');
});

const modalViewports = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
  { width: 568, height: 320 },
];

for (const viewport of modalViewports) {
  test(`Owner Ifishi dialog fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page, collector, 'tab=milk&flow=synthetic');
    await page.getByRole('button', { name: 'Owner Ifishi', exact: true }).first().click();
    const panel = page.locator('.owner-ifishi-entry-modal');
    await expect(panel).toBeVisible();
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('.owner-ifishi-entry-modal');
      const bounds = dialog?.getBoundingClientRect();
      const mobileNav = document.querySelector<HTMLElement>('.mobile-nav');
      const navBounds = mobileNav?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        left: bounds?.left ?? -1,
        right: bounds?.right ?? -1,
        top: bounds?.top ?? -1,
        bottom: bounds?.bottom ?? -1,
        height: bounds?.height ?? 0,
        navTop: navBounds?.top ?? window.innerHeight,
      };
    });
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight);
    if (viewport.width <= 680) expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop + 1);
    const submitAction = panel.getByRole('button', { name: /Save|Correct/ });
    await expect(submitAction).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(submitAction).toBeFocused();
  });
}