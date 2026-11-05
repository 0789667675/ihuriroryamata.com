import { expect, test, type Page } from '@playwright/test';
import { getAccountingDate, getCurrentAccountingPeriod } from '../../lib/utils/accounting-period.js';

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

const browserTestBaseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 3100}`;

type FarmerFixture = {
  id: number;
  name: string;
  collectionCenter?: string;
  phone?: string;
  nationalId?: string;
};

type NotificationFixture = {
  id: number;
  notification_type: string;
  title: string;
  message: string;
  priority: string;
  createdAt: string;
  isRead: boolean;
  status?: 'open' | 'resolved';
  farmer_id?: number | null;
  collection_date?: string | null;
  period?: string | null;
  collection_center?: string | null;
  details?: Record<string, unknown>;
};

type MilkFixture = {
  farmerMorning?: number;
  farmerEvening?: number;
  ownerMorning?: number;
  ownerEvening?: number;
  ownerValidLiters?: number;
  includeOwnerEntry?: boolean;
  farmers?: FarmerFixture[];
  importRows?: string[][];
  matrixSaveFailures?: number;
  fullMatrix?: boolean;
  notifications?: NotificationFixture[];
};

async function mockWorkspaceApis(page: Page, user = collector, milkFixture: MilkFixture = {}, reportOverride: Record<string, unknown> | null = null) {
  const centers: Record<string, unknown>[] = [];
  const notifications = milkFixture.notifications || [];
  let matrixSaveFailuresRemaining = milkFixture.matrixSaveFailures ?? 0;
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
    else if (url.pathname === '/api/auth/profile') body = {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: '0788000000',
        nationalId: null,
        accountNumber: null,
        profilePicture: null,
        role: user.role,
        accountType: user.accountType,
        accountStatus: 'active',
        emailVerified: true,
        language: 'en',
      },
    };
    else if (url.pathname === '/api/imports/ocr') body = { configured: true, setup: [] };
    else if (url.pathname === '/api/imports/extract') body = { rows: milkFixture.importRows || [] };
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
    else if (url.pathname === '/api/farmers') {
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const farmers = (milkFixture.farmers || [])
        .filter((farmer) => !search || farmer.name.toLowerCase().includes(search))
        .map((farmer) => ({
          id: farmer.id,
          name: farmer.name,
          location: null,
          phone: farmer.phone || null,
          nationalId: farmer.nationalId || null,
          accountNumber: null,
          collectionCenter: farmer.collectionCenter || 'North Site',
          cowType: null,
          collectorUserId: user.id,
        }));
      body = { data: farmers, nextCursor: null, hasMore: false, pageSize: 50 };
    }
    else if (url.pathname === '/api/notifications/unread-count') body = { data: { unreadCount: notifications.filter((item) => !item.isRead).length } };
    else if (url.pathname === '/api/notifications/read-all') {
      notifications.forEach((item) => { item.isRead = true; });
      body = { success: true };
    }
    else if (/^\/api\/notifications\/\d+\/read$/.test(url.pathname) && route.request().method() === 'PATCH') {
      const notification = notifications.find((item) => item.id === Number(url.pathname.split('/')[3]));
      if (notification) {
        notification.isRead = true;
        body = { data: notification };
      } else {
        status = 404;
        body = { success: false, message: 'Notification not found.' };
      }
    }
    else if (url.pathname === '/api/notifications') body = { data: notifications };
    else if (url.pathname === '/api/subscription') body = { account: { phone: null }, subscription: null, payments: [] };
    else if (url.pathname === '/api/reports/summary') body = reportOverride || {
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
    else if (url.pathname === '/api/milk/batch-matrix') {
      if (route.request().method() === 'POST' && matrixSaveFailuresRemaining > 0) {
        matrixSaveFailuresRemaining -= 1;
        status = 503;
        body = { message: 'Simulated matrix save failure.' };
      } else if (route.request().method() === 'POST') {
        const input = await route.request().postDataJSON();
        const savedCount = input.entries.reduce((count: number, entry: { days: object }) => count + Object.keys(entry.days).length, 0);
        body = { success: true, savedCount, totalVolume: 12.5 };
      } else {
        const periodType = url.searchParams.get('periodType') === 'second-half' ? 'second-half' : 'first-half';
        const month = Number(url.searchParams.get('month') || 10);
        const year = Number(url.searchParams.get('year') || 2026);
        const firstDay = periodType === 'second-half' ? 16 : 1;
        const lastDay = periodType === 'second-half' ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 15;
        const days = milkFixture.fullMatrix
          ? Object.fromEntries(Array.from({ length: lastDay - firstDay + 1 }, (_, index) => [String(firstDay + index), {
            morning: '', evening: '', total: 0,
          }]))
          : {};
        const farmers = (milkFixture.farmers || []).map((farmer, index) => ({
          farmerId: farmer.id,
          farmerNumber: index + 1,
          farmerName: farmer.name,
          phone: farmer.phone || null,
          collectionCenter: farmer.collectionCenter || 'North Site',
          days,
          totalLiters: 0,
        }));
        body = { farmers, matrix: {}, center: { pricePerLiter: 400, name: 'North Site' } };
      }
    }
    else if (url.pathname === '/api/milk') body = { data: [], nextCursor: null, hasMore: false, pageSize: 50 };
    else if (url.pathname === '/api/milk/daily') {
      const fixtureFarmers = milkFixture.farmers || [];
      const farmers = fixtureFarmers.map((farmer, index) => ({
        farmerId: farmer.id,
        farmerName: farmer.name,
        phone: farmer.phone || null,
        nationalId: farmer.nationalId || null,
        collectionCenter: farmer.collectionCenter || 'North Site',
        recordId: 994000 + index,
        volumeMorning: index === 0 ? milkFixture.farmerMorning || 0 : 0,
        volumeEvening: index === 0 ? milkFixture.farmerEvening || 0 : 0,
        totalVolume: index === 0 ? (milkFixture.farmerMorning || 0) + (milkFixture.farmerEvening || 0) : 0,
        amount: 0,
        status: 'valid',
      }));
      const totalMorning = farmers.length ? farmers.reduce((sum, farmer) => sum + farmer.volumeMorning, 0) : milkFixture.farmerMorning || 0;
      const totalEvening = farmers.length ? farmers.reduce((sum, farmer) => sum + farmer.volumeEvening, 0) : milkFixture.farmerEvening || 0;
      body = {
        farmers,
        summary: {
          totalFarmers: farmers.length || (milkFixture.farmerMorning || milkFixture.farmerEvening ? 1 : 0),
          presentCount: farmers.length || (milkFixture.farmerMorning || milkFixture.farmerEvening ? 1 : 0),
          totalMorning,
          totalEvening,
          totalVolume: totalMorning + totalEvening,
          totalAmount: 0, pricePerLiter: 0, transportRate: 0,
        },
        farmerPagination: { nextCursor: null, hasMore: false },
        centers: [],
        collectorMilk: [],
      };
    }
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

async function openWorkspace(page: Page, user = collector, query = 'tab=dashboard&flow=synthetic', milkFixture: MilkFixture = {}, reportOverride: Record<string, unknown> | null = null) {
  await mockWorkspaceApis(page, user, milkFixture, reportOverride);
  await page.goto(`/login?${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
}

test('daily milk notebook navigates editable cells, restores drafts, retries saves, and collapses navigation', async ({ page }) => {
  const farmers = [
    { id: 993801, name: 'Aline Test Farmer' },
    { id: 993802, name: 'Beata Test Farmer' },
    { id: 993803, name: 'Chantal Test Farmer' },
  ];
  await openWorkspace(page, collector, 'tab=milk&flow=synthetic', { farmers, matrixSaveFailures: 1 });

  const matrix = page.locator('.matrix-table');
  await expect(matrix).toBeVisible();
  await expect(matrix.locator('tbody tr')).toHaveCount(3);
  const cell = (row: number, column: number) => matrix.locator('tbody tr').nth(row).locator('.matrix-cell-input').nth(column);
  const firstMorning = cell(0, 0);
  const firstEvening = cell(0, 1);
  const secondFarmerFirstMorning = cell(1, 0);
  const thirdFarmerFirstMorning = cell(2, 0);
  const firstFarmerLastEvening = cell(0, 29);

  await firstMorning.focus();
  await page.keyboard.press('ArrowRight');
  await expect(firstEvening).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(0, 2)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstEvening).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstMorning).toBeFocused();

  await firstMorning.fill('12.5');
  await page.keyboard.press('Enter');
  await expect(firstEvening).toBeFocused();
  await expect(firstMorning).toHaveValue('12.5');
  await page.keyboard.press('Shift+Tab');
  await expect(firstMorning).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstEvening).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstMorning).toBeFocused();
  expect(await firstMorning.evaluate((input) => [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd])).toEqual([0, 4]);

  await page.keyboard.press('ArrowDown');
  await expect(secondFarmerFirstMorning).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(firstMorning).toBeFocused();
  await firstFarmerLastEvening.focus();
  await page.keyboard.press('ArrowRight');
  await expect(secondFarmerFirstMorning).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstFarmerLastEvening).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(secondFarmerFirstMorning).toBeFocused();

  await secondFarmerFirstMorning.evaluate((input) => { (input as HTMLInputElement).disabled = true; });
  await firstMorning.focus();
  await page.keyboard.press('ArrowDown');
  await expect(thirdFarmerFirstMorning).toBeFocused();
  await firstFarmerLastEvening.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(1, 1)).toBeFocused();

  await cell(0, 3).evaluate((input) => { (input as HTMLInputElement).readOnly = true; });
  await cell(0, 2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(0, 4)).toBeFocused();

  if ((page.viewportSize()?.width || 0) >= 981) {
    await page.getByRole('button', { name: 'Collapse workspace navigation' }).click();
    await expect(page.locator('.workspace-body')).toHaveClass(/is-sidebar-collapsed/);
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand workspace navigation' }).click();
    await expect(page.locator('.workspace-body')).not.toHaveClass(/is-sidebar-collapsed/);
  } else {
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.mobile-nav')).toBeVisible();
  }

  await page.reload();
  await expect(page.getByRole('button', { name: 'Restore unsaved entries' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore unsaved entries' }).click();
  await expect(firstMorning).toHaveValue('12.5');

  await page.getByRole('button', { name: /Save All 15 Days/ }).click();
  await expect(page.locator('.matrix-status-banner[role="alert"]')).toContainText('Simulated matrix save failure.');
  await expect(firstMorning).toHaveValue('12.5');
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on the server.');
});

test('daily notebook Save All records realistic request size and edit-render time', async ({ page }) => {
  const farmers = Array.from({ length: 100 }, (_, index) => ({
    id: 994000 + index,
    name: `Baseline Farmer ${index + 1}`,
  }));
  const saveRequests: Array<{ bytes: number; farmerCount: number; dayCount: number }> = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/milk/batch-matrix') && request.method() === 'POST') {
      const body = request.postDataJSON();
      saveRequests.push({
        bytes: request.postDataBuffer()?.byteLength || 0,
        farmerCount: body.entries.length,
        dayCount: body.entries.reduce((count: number, entry: { days: object }) => count + Object.keys(entry.days).length, 0),
      });
    }
  });

  await openWorkspace(page, collector, 'tab=milk&flow=synthetic', { farmers, fullMatrix: true });
  const matrix = page.locator('.matrix-table');
  await expect(matrix.locator('tbody tr')).toHaveCount(100);
  expect(await matrix.locator('.matrix-cell-input').count()).toBe(3000);

  const firstCell = matrix.locator('.matrix-cell-input').first();
  const editStart = await page.evaluate(() => performance.now());
  await firstCell.fill('2.5');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const editRenderMs = await page.evaluate((start) => performance.now() - start, editStart);

  await page.getByRole('button', { name: /Save All 15 Days/ }).click();
  await expect(page.getByRole('status')).toContainText('Saved on the server.');
  expect(saveRequests).toHaveLength(1);
  expect(saveRequests[0].farmerCount).toBe(1);
  expect(saveRequests[0].dayCount).toBe(1);
  expect(saveRequests[0].bytes).toBeLessThan(250);
  console.log(`DAILY_NOTEBOOK_AFTER ${JSON.stringify({
    farmers: 100,
    editableCells: 3000,
    editRenderMs: Number(editRenderMs.toFixed(1)),
    requestCount: saveRequests.length,
    ...saveRequests[0],
    estimatedSqlStatements: 10,
  })}`);
});

test('daily notebook drafts, scrolling, inputs, and Save All remain usable after rotation', async ({ page }) => {
  const farmers = [
    { id: 995001, name: 'Rotation Test Farmer One' },
    { id: 995002, name: 'Rotation Test Farmer Two' },
  ];
  await openWorkspace(page, collector, 'tab=milk&flow=synthetic', { farmers });

  const firstCell = page.locator('.matrix-cell-input').first();
  await firstCell.fill('3.25');
  const viewports = [
    { name: 'small phone portrait', width: 320, height: 568 },
    { name: 'large phone portrait', width: 430, height: 932 },
    { name: 'small phone landscape', width: 568, height: 320 },
    { name: 'large phone landscape', width: 844, height: 390 },
    { name: 'tablet portrait', width: 768, height: 1024 },
    { name: 'tablet landscape', width: 1024, height: 768 },
    { name: 'desktop', width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(firstCell, viewport.name).toHaveValue('3.25');
    const scrollport = page.locator('.matrix-table-scroll');
    const scrollPosition = await scrollport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft;
    });
    expect(scrollPosition, `${viewport.name} can reach the last notebook columns`).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /Save All 15 Days/ })).toBeVisible();
    await scrollport.evaluate((element) => { element.scrollLeft = 0; });
  }

  await expect(page.getByRole('status')).toContainText('1 unsaved value(s)');
  const savedDraftKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('milk-matrix-draft:')));
  expect(savedDraftKeys.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Restore unsaved entries' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore unsaved entries' }).click();
  await expect(firstCell).toHaveValue('3.25');
  const saveButton = page.getByRole('button', { name: /Save All 15 Days/ });
  await saveButton.scrollIntoViewIfNeeded();
  await expect(saveButton).toBeInViewport();
  await saveButton.click();
  await expect(page.getByRole('status')).toContainText('Saved on the server.');
});

test('notifications and account security controls remain usable across phone, tablet, and desktop orientations', async ({ page }) => {
  const notifications: NotificationFixture[] = [
    {
      id: 995801,
      notification_type: 'payment_failed',
      title: 'Payment failed',
      message: 'The payment was not completed.',
      priority: 'warning',
      createdAt: '2026-10-25T10:00:00.000Z',
      isRead: false,
      status: 'open',
      details: {
        titleKey: 'alertTitlePaymentFailed',
        messageKey: 'alertMessagePaymentFailed',
        nextActionKey: 'alertNextReviewSubscription',
        params: { plan: 'Test tier', amount: '5,000', currency: 'RWF' },
      },
    },
    {
      id: 995802,
      notification_type: 'farmer_milk_missing',
      title: 'Missing milk record',
      message: 'No milk was recorded for the morning session.',
      priority: 'warning',
      createdAt: '2026-10-25T09:00:00.000Z',
      isRead: false,
      status: 'open',
      farmer_id: 993801,
      collection_date: '2026-10-24',
      period: 'morning',
      collection_center: 'North Site',
      details: {
        farmerId: 993801,
        titleKey: 'alertTitleFarmerMilkMissing',
        messageKey: 'alertMessageFarmerMilkMissing',
        nextActionKey: 'alertNextRecordMilk',
        params: { farmer: 'Aline Test Farmer', number: '#001', session: 'Morning' },
        evidence: 'no_record_for_session',
      },
    },
  ];
  await openWorkspace(page, collector, 'tab=dashboard&flow=synthetic', {
    farmers: [{ id: 993801, name: 'Aline Test Farmer' }],
    notifications,
  });
  const openNotifications = async () => {
    await page.getByRole('button', { name: /Alerts:/ }).click();
    await page.getByRole('button', { name: 'Open notification inbox', exact: true }).click();
  };
  await openNotifications();
  await expect(page).toHaveURL(/tab=notifications/);

  const cards = page.locator('.notice-row');
  await expect(cards).toHaveCount(2);
  const farmerCard = cards.filter({ hasText: 'Aline Test Farmer' });
  await expect(farmerCard).toHaveCount(1);
  await farmerCard.getByRole('button', { name: /Record milk|Andika Amata/i }).click();
  await expect(page).toHaveURL(/tab=milk/);
  await openNotifications();
  await expect(page).toHaveURL(/tab=notifications/);
  await expect(cards).toHaveCount(2);

  const viewports = [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(cards.first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }

  const paymentCard = cards.filter({ hasText: 'Payment failed' });
  await expect(paymentCard).toHaveCount(1);
  await paymentCard.getByRole('button', { name: /Renew your subscription|Vugurura gahunda/i }).click();
  await expect(page).toHaveURL(/tab=billing/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('navigation', { name: 'More' }).getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page).toHaveURL(/tab=settings/);
  await expect(page.locator('input[autocomplete="email"]')).toBeVisible();
  await expect(page.locator('.account-settings-security')).toBeVisible();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.account-settings-view')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});

test('direct tab, reload, back, and forward retain valid workspace navigation', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=ukwezi&flow=synthetic');
  await expect(page).toHaveURL(/tab=ukwezi/);
  await expect(page.getByRole('heading', { name: 'Ukwezi' })).toBeVisible();

  await page.getByRole('button', { name: 'Milk', exact: true }).first().click();
  await expect(page).toHaveURL(/tab=milk/);
  await expect(page.getByRole('heading', { name: /Milk|Amata/i })).toBeVisible();
  await page.getByRole('button', { name: 'Farmers', exact: true }).first().click();
  await expect(page).toHaveURL(/tab=farmers/);
  await page.goBack();
  await expect(page).toHaveURL(/tab=milk/);
  await expect(page.getByRole('heading', { name: /Milk|Amata/i })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/tab=farmers/);
  await expect(page.getByRole('heading', { name: /Farmers|Aborozi/i })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: /Farmers|Aborozi/i })).toBeVisible();
  await expect(page).toHaveURL(/flow=synthetic/);
});

test('multi-day milk matrix supports spreadsheet navigation without losing edits or intercepting Tab', async ({ page }) => {
  const dates = Array.from({ length: 15 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
  const farmers = [
    { id: 993801, name: 'Aline Test Farmer' },
    { id: 993802, name: 'Beata Test Farmer' },
    { id: 993803, name: 'Chantal Test Farmer' },
  ];
  const importRows = [
    ['Farmer', ...dates],
    ...farmers.map((farmer, index) => [farmer.name, ...dates.map(() => String(index + 1))]),
  ];
  const milkImportRequests: string[] = [];

  await openWorkspace(page, collector, 'tab=milk&flow=synthetic', { farmers, importRows });
  page.on('request', (request) => {
    if (request.url().includes('/api/milk/import') && request.method() === 'POST') milkImportRequests.push(request.url());
  });
  await page.getByRole('button', { name: 'Scan notebook', exact: true }).click();
  await page.getByRole('radio', { name: 'Multi-Day Batch' }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'milk-register.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Farmer,2026-10-01'),
  });
  await page.getByRole('button', { name: 'Extract Document' }).click();

  const matrix = page.locator('.import-multiday-table');
  await expect(matrix.locator('tbody tr')).toHaveCount(3);
  await expect(matrix).toContainText('Day 15');
  const cell = (row: number, input: number) => matrix.locator('tbody tr').nth(row).locator('input[type="number"]').nth(input);
  const firstMorning = cell(0, 0);
  const firstEvening = cell(0, 1);
  const secondFarmerFirstMorning = cell(1, 0);
  const thirdFarmerFirstMorning = cell(2, 0);
  const firstFarmerLastEvening = cell(0, 29);
  const lastCell = cell(2, 29);

  await firstMorning.focus();
  await page.keyboard.press('ArrowRight');
  await expect(firstEvening).toBeFocused();
  await expect(firstEvening).toHaveValue('');
  await page.keyboard.press('ArrowRight');
  await expect(cell(0, 2)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstEvening).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstMorning).toBeFocused();

  const secondDayEvening = cell(0, 3);
  await secondDayEvening.evaluate((input) => { (input as HTMLInputElement).readOnly = true; });
  await cell(0, 2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(0, 4)).toBeFocused();
  await secondDayEvening.evaluate((input) => { (input as HTMLInputElement).readOnly = false; });

  await firstMorning.focus();
  await page.keyboard.press('ArrowDown');
  await expect(secondFarmerFirstMorning).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(firstMorning).toBeFocused();

  await firstMorning.fill('12.5');
  await page.keyboard.press('Enter');
  await expect(firstEvening).toBeFocused();
  await expect(firstMorning).toHaveValue('12.5');
  await firstFarmerLastEvening.focus();
  await page.keyboard.press('ArrowRight');
  await expect(secondFarmerFirstMorning).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstFarmerLastEvening).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(secondFarmerFirstMorning).toBeFocused();

  await firstMorning.focus();
  await page.keyboard.press('Tab');
  await expect(firstEvening).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(firstMorning).toBeFocused();

  await matrix.locator('tbody tr').nth(1).locator('.import-row-number-label input').click();
  await expect(secondFarmerFirstMorning).toBeDisabled();
  await firstMorning.focus();
  await page.keyboard.press('ArrowDown');
  await expect(thirdFarmerFirstMorning).toBeFocused();
  await firstFarmerLastEvening.focus();
  await page.keyboard.press('ArrowRight');
  await expect(thirdFarmerFirstMorning).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstFarmerLastEvening).toBeFocused();

  await lastCell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(lastCell).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(lastCell).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(lastCell).toBeFocused();
  await firstMorning.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(firstMorning).toBeFocused();
  expect(milkImportRequests).toHaveLength(0);
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

test('Collector settlements uses report accounting, while Ukwezi shows eligible payment rosters', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=settlements&flow=synthetic');
  const summary = page.locator('.settlement-reconciliation');
  const reconciliationTable = page.locator('.settlement-farmer-table');
  await expect(summary).toContainText(/Period payment reconciliation|Ibaruramari ry'ukwezi/i);
  await expect(summary).toContainText(/Amafaranga Yose Agomba Kwishyurwa|Farmer gross|Gross amount/i);
  await expect(summary).toContainText(/Ayanyuze Kuri Nyirayo|Cash approved|Approved cash/i);
  await expect(summary).toContainText('1,500 RWF');
  await expect(summary).toContainText(/Ayishyuwe Kugeza Ubu|Cash received|Received/i);
  await expect(summary).toContainText('500 RWF');
  await expect(summary).toContainText(/Imyenda yishyuwe|Debt repaid|Debt paid/i);
  await expect(summary).toContainText('300 RWF');
  await expect(summary).toContainText(/Imyenda ikiriho|Debt outstanding|Outstanding debt/i);
  await expect(summary).toContainText('200 RWF');
  await expect(summary).toContainText(/Itandukaniro ridasobanutse|Unexplained difference|Difference/i);
  await expect(summary).toContainText(/Ibyiciro by'ishyurwa|Payable breakdown|Breakdown/i);
  await expect(reconciliationTable).toContainText('Aline Test Farmer');
  await expect(reconciliationTable).toContainText('3,500 RWF');
  await expect(reconciliationTable).toContainText('200 RWF');
  await expect(page.getByText('Aline Test Farmer').filter({ visible: true })).toHaveCount(4);

  await page.getByRole('button', { name: 'Ukwezi', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Ukwezi' })).toBeVisible();
  const paymentRoster = page.locator('.ukwezi-payment-roster');
  await expect(paymentRoster).toBeVisible();
  await expect(page.locator('.settlement-farmer-table')).toHaveCount(0);
  await expect(page.getByText('Payment history')).toHaveCount(0);
  await expect(paymentRoster).toContainText('Aline Test Farmer');
  await expect(paymentRoster).toContainText('3,500.00 RWF');
  await expect(paymentRoster).toContainText(/Farmers without accounts|Aborozi badafite nimero ya konti/i);
  await expect(paymentRoster).toContainText(/Milk volume \(L\)|Ingano y’amata \(L\)/i);
  await expect(paymentRoster).toContainText(/National ID number|Nomero y'indangamuntu/i);
  await expect(paymentRoster).toContainText(/Ejoheza \(RWF\)|FRW ya Ejoheza/i);
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (viewport.width <= 980) {
      await expect(paymentRoster.locator('.ukwezi-payment-desktop')).toBeHidden();
      await expect(paymentRoster.locator('.ukwezi-payment-mobile').first()).toBeVisible();
      await expect(paymentRoster.locator('.ukwezi-mobile-card').first()).toBeVisible();
      await expect(paymentRoster.locator('.ukwezi-mobile-card').first()).toContainText(/Account number|Nimero ya konti/i);
    } else {
      await expect(paymentRoster.locator('.ukwezi-payment-desktop').first()).toBeVisible();
      const scroller = paymentRoster.locator('.ukwezi-payment-desktop').first();
      const metrics = await scroller.evaluate((element) => ({
        overflows: element.scrollWidth > element.clientWidth,
        overflowX: getComputedStyle(element).overflowX,
      }));
      expect(metrics.overflows).toBe(true);
      expect(metrics.overflowX).toBe('auto');
    }
  }
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

test('cash batch reports partial success and safely retries only the failed farmer', async ({ page }) => {
  const period = getCurrentAccountingPeriod();
  const makeCashFarmer = (farmerId: number, farmerName: string, amount: number) => ({
    ...settlementReport.farmers[0],
    farmerId,
    farmerName,
    phone: '0788000000',
    totalVolume: 12.5,
    grossAmount: amount,
    netAmount: amount,
    settlement: { saccoEligible: false, retainedUnpaidAmount: amount, cashApprovedAmount: 0, cashConfirmedAmount: 0 },
  });
  const report = {
    totalFarmers: 3,
    totalVolume: 37.5,
    rangeStart: period.startDate,
    rangeEnd: period.endDate,
    settlementAccounting: {
      ...settlementReport,
      expectedFarmerPayable: 6700,
      farmers: [
        makeCashFarmer(993101, 'Aline Test Farmer', 3500),
        makeCashFarmer(993102, 'Blaise Test Farmer', 2200),
        makeCashFarmer(993103, 'Chantal Test Farmer', 1000),
      ],
    },
  };
  const payments = new Map<string, Record<string, unknown>>();
  const historyRecords: Array<Record<string, unknown>> = [{
    id: 993299,
    settlementId: 993299,
    farmerId: 993101,
    farmerName: 'Aline Test Farmer',
    amount: 700,
    status: 'APPROVED',
    periodStart: period.startDate,
    periodEnd: period.endDate,
    approvedAt: '2026-11-02T07:00:00.000Z',
    confirmedAt: null,
    confirmedBy: null,
  }];
  const cashRequests: Array<{ farmerId: number; requestKey: string }> = [];
  const confirmRequests: number[] = [];
  const failedOnce = new Set<number>();
  let nextSettlementId = 993300;

  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, collector, 'tab=settlements&flow=synthetic', {}, report);
  await page.route('**/api/farmer-settlements**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (route.request().method() === 'GET' && action === 'confirmations') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [...historyRecords, ...payments.values()] }) });
      return;
    }
    if (route.request().method() !== 'POST') return route.fallback();

    const body = route.request().postDataJSON();
    if (body.action === 'cash') {
      cashRequests.push({ farmerId: Number(body.farmerId), requestKey: String(body.requestKey) });
      const requestKey = `${body.farmerId}:${body.requestKey}`;
      let record = payments.get(requestKey);
      if (!record) {
        record = {
          id: nextSettlementId++,
          settlementId: nextSettlementId - 1,
          farmerId: Number(body.farmerId),
          farmerName: ['Aline Test Farmer', 'Blaise Test Farmer', 'Chantal Test Farmer'][Number(body.farmerId) - 993101],
          amount: Number(body.amount),
          status: 'APPROVED',
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          approvedAt: '2026-11-02T08:00:00.000Z',
          confirmedAt: null,
          confirmedBy: null,
        };
        payments.set(requestKey, record);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record }) });
      return;
    }
    if (body.action === 'confirm') {
      const farmerId = Number(body.farmerId);
      confirmRequests.push(farmerId);
      if (farmerId === 993102 && !failedOnce.has(farmerId)) {
        failedOnce.add(farmerId);
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary confirmation interruption.' }) });
        return;
      }
      const record = [...historyRecords, ...payments.values()].find((item) => Number(item.id) === Number(body.settlementId));
      if (record) {
        record.status = 'CONFIRMED';
        record.confirmedAt = '2026-11-02T09:00:00.000Z';
        record.confirmedBy = collector.id;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record }) });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });

  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.locator('.settlement-debt-drawer > summary').click();
  await page.locator('.settlement-operations').getByRole('button', { name: 'Confirm received' }).first().click();
  await expect(page.locator('.settlement-operations')).toContainText('Actor #990001');

  await page.locator('.settlement-tabs .settlement-tab-button').nth(1).click();
  await expect(page.locator('.settlement-farmer-table .settlements-desktop-table')).toBeHidden();
  await expect(page.locator('.settlement-farmer-table .settlements-mobile-list')).toBeVisible();
  const checkboxes = page.getByRole('checkbox', { name: /Select settlement for/ });
  await expect(checkboxes).toHaveCount(3);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await checkboxes.nth(2).check();

  const confirmButton = page.getByRole('button', { name: 'Confirm selected (3)' });
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await confirmButton.click();
  await expect(confirmButton).toBeDisabled();
  const progress = page.locator('.settlement-batch-progress');
  await expect(progress).toContainText('Selected 3; processed 3; confirmed 2; failed 1.');
  await expect(progress).toContainText('Blaise Test Farmer');
  await expect(progress).toContainText('Temporary confirmation interruption.');
  await expect(progress).not.toContainText('All selected settlements were processed.');
  expect(payments.size).toBe(3);

  const retryButton = progress.getByRole('button', { name: 'Retry eligible failed (1)' });
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await retryButton.click();
  await expect(progress).toContainText('Selected 1; processed 1; confirmed 1; failed 0.');
  expect(payments.size).toBe(3);
  expect(cashRequests.filter((request) => request.farmerId === 993102)).toHaveLength(2);
  expect(new Set(cashRequests.filter((request) => request.farmerId === 993102).map((request) => request.requestKey)).size).toBe(1);
  expect(confirmRequests.filter((farmerId) => farmerId === 993102)).toHaveLength(2);

  await page.setViewportSize({ width: 1280, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.locator('.settlement-farmer-table .settlements-desktop-table')).toBeVisible();
  const headerPosition = await page.locator('.settlement-farmer-table .settlements-desktop-table thead th').first().evaluate((element) => getComputedStyle(element).position);
  expect(headerPosition).toBe('sticky');
});

test('Raporo uses authoritative accounting values and stays contained at desktop, tablet, and phone widths', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=reports&flow=synthetic');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.locator('.reports-kpi-card')).toHaveCount(5);
  await expect(page.locator('.reports-status-badge')).toContainText('Complete');
  await expect(page.locator('.reports-price-source')).toContainText('Applied price per liter');
  await expect(page.locator('.reports-price-source')).toContainText('466.67 RWF / L');
  await expect(page.locator('.reports-price-source')).toContainText('collector price recorded on each milk date');
  await expect(page.locator('.reports-summary')).toContainText('7,000 RWF');
  await expect(page.locator('.reports-summary')).toContainText('4,500 RWF');

  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(pageFits).toBe(true);
    if (viewport.width <= 680) {
      await expect(page.locator('.reports-desktop-table')).toBeHidden();
      await expect(page.locator('.report-mobile-list')).toBeVisible();
      await expect(page.locator('.report-mobile-card').first()).toContainText('Aline Test Farmer');
      await expect(page.locator('.report-mobile-card').first()).toContainText('4,500 RWF');
    } else {
      await expect(page.locator('.reports-desktop-table')).toBeVisible();
      await expect(page.locator('.report-mobile-list')).toBeHidden();
      await expect(page.locator('.reports-desktop-table')).toContainText('Aline Test Farmer');
    }
  }
});

test('Raporo marks missing pricing and transport as needing review instead of zero', async ({ page }) => {
  const missingReport = {
    totalFarmers: 0, totalVolume: 15, totalMorning: 0, totalEvening: 0,
    totalRevenueMonth: 0, totalDeductionsMonth: 0, totalTransportFeesMonth: null,
    netRevenueMonth: 0, todayTotal: 0, todayMorning: 0, todayEvening: 0,
    rangeStart: '2026-10-01', rangeEnd: '2026-10-15',
    collectorPayable: null, ownerGeneratedVolume: 15, ownerGeneratedGross: null,
    collectorFarmerMilkValue: null, collectorFarmerPayable: null, collectorFarmerTransport: null,
    farmerPayments: [],
    collectorAccountingComplete: false,
    collectorAccountingMissingInputs: ['owner_historical_price', 'farmer_transport_snapshot'],
  };
  await openWorkspace(page, collector, 'tab=reports&flow=synthetic', {}, missingReport);
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.locator('.reports-status-badge')).toContainText('Needs review');
  await expect(page.locator('.reports-callout')).toContainText('Some accounting data is missing');
  await expect(page.locator('.reports-callout')).toContainText('Set the Collector price effective on or before this period');
  await expect(page.locator('.reports-callout')).toContainText('Historical transport could not be established');
  await expect(page.locator('.reports-price-source')).toContainText('No complete price is available for this period.');
  await expect(page.locator('.reports-kpi-card').first()).toContainText('15 L');
  await expect(page.locator('.reports-kpi-card').nth(1)).toContainText('Needs review');
  await expect(page.locator('.reports-kpi-card').nth(2)).toContainText('Needs review');
  await expect(page.locator('.reports-kpi-card').nth(4)).toContainText('Needs review');
  const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(pageFits).toBe(true);
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

test('Ifishi search results are directly selectable and stay contained on phone widths', async ({ page }) => {
  await openWorkspace(page, collector, 'tab=milk&flow=synthetic', {
    farmerMorning: 10,
    farmerEvening: 8,
    farmers: [
      { id: 994101, name: 'Jean Claude', collectionCenter: 'North Site', nationalId: '119988001', phone: '0788000001' },
      { id: 994102, name: 'Jean Bosco', collectionCenter: 'South Site', nationalId: '119988002', phone: '0788000002' },
      { id: 994103, name: 'Aline Test', collectionCenter: 'North Site', nationalId: '119988003', phone: '0788000003' },
    ],
  });
  await page.getByRole('button', { name: 'Ifishi', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Ifishi' });
  await expect(dialog).toBeVisible();

  const search = dialog.getByRole('combobox', { name: 'Find a farmer' });
  await search.fill('Jean');
  const results = dialog.getByRole('listbox', { name: 'Search results' });
  await expect(results).toBeVisible();
  await expect(results.getByRole('option')).toHaveCount(2);
  await expect(results.getByRole('option', { name: /Jean Claude/ })).toBeVisible();
  await expect(results.getByRole('option', { name: /Jean Bosco/ })).toBeVisible();
  await expect(results.getByText('Aline Test')).toHaveCount(0);

  await results.getByRole('option', { name: /Jean Bosco/ }).click();
  const selected = dialog.locator('.ifishi-selected-person');
  await expect(selected).toContainText('Selected farmer');
  await expect(selected).toContainText('Jean Bosco');
  await expect(selected).toContainText('South Site');
  await expect(selected).toContainText('ID 119988002');
  await expect(dialog.getByRole('spinbutton').first()).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await search.focus();
  await expect(results).toBeVisible();
  await results.scrollIntoViewIfNeeded();
  const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(pageFits).toBe(true);
  const dialogBox = await dialog.boundingBox();
  const resultsBox = await results.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(resultsBox).not.toBeNull();
  expect(resultsBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(resultsBox!.x + resultsBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
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

test.describe('dashboard date consistency in the Kigali timezone', () => {
  test.use({ timezoneId: 'Africa/Kigali' });

  test('dashboard label, header label, and daily query all use the same Kigali date', async ({ page }) => {
    const before = getAccountingDate();
    const dailyRequest = page.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).pathname === '/api/milk/daily');
    await openWorkspace(page, collector, 'tab=dashboard&flow=synthetic', { farmerMorning: 7, farmerEvening: 5 });
    const request = await dailyRequest;
    const requestDate = new URL(request.url()).searchParams.get('date');
    const after = getAccountingDate();

    expect(requestDate).not.toBeNull();
    expect([before, after]).toContain(requestDate!);
    await expect(page.locator('.dashboard-today h2')).toHaveText(dateLabelFor(requestDate!));
    await expect(page.locator('.date-stamp')).toHaveText(dateLabelFor(requestDate!));
    await expect(page.locator('.dashboard-volume strong')).toHaveText('12');
  });
});

function dateLabelFor(dateOnly: string) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kigali', weekday: 'long' }).format(date);
  const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kigali', month: 'long' }).format(date);
  return `${weekday} ${day} ${monthName} ${year}`;
}

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