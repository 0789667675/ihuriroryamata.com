import { expect, test, type Page } from '@playwright/test';
import { formatDateLabel } from '../../lib/i18n/date-format.js';

test.setTimeout(180_000);

const collector = {
  id: 990001,
  name: 'Synthetic Test Collector',
  email: 'collector.test@example.invalid',
  role: 'user',
  accountType: 'COLLECTOR',
};

type MockFarmer = {
  id: number;
  name: string;
  farmerNumber: number;
  phone: string;
  nationalId: string;
  collectorUserId: number;
};

const farmers: MockFarmer[] = [
  { id: 994101, name: 'Jean Claude', farmerNumber: 17, phone: '0788000001', nationalId: '119988001', collectorUserId: collector.id },
  { id: 994102, name: 'Jean Bosco', farmerNumber: 18, phone: '0788000002', nationalId: '119988002', collectorUserId: collector.id },
  { id: 994103, name: 'Aline Test', farmerNumber: 19, phone: '0788000003', nationalId: '119988003', collectorUserId: collector.id },
];

const searchNumber = (search: string) => {
  const match = search.trim().match(/^(?:no\.?|number|#)?\s*0*([1-9]\d*)$/i);
  return match ? Number(match[1]) : null;
};

const isoToday = () => new Date().toISOString().slice(0, 10);

const dateRange = (startDate: string, endDate: string) => {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const historyPayload = (farmer: MockFarmer, startDate: string, endDate: string) => {
  const cappedEnd = endDate > isoToday() ? isoToday() : endDate;
  const dates = dateRange(startDate, cappedEnd);
  const missedDates = [dates[4], dates[11], dates[18]].filter(Boolean) as string[];
  const days = dates.map((date) => {
    const missed = missedDates.includes(date);
    return {
      date,
      recordId: missed ? null : 994000,
      morningLiters: missed ? 0 : 10,
      eveningLiters: missed ? 0 : 8,
      totalLiters: missed ? 0 : 18,
      session: missed ? 'none' : 'morning-evening',
      status: missed ? 'missing' : 'delivered',
      deliveryStatus: missed ? 'missing' : 'delivered',
    };
  });
  const deliveredDays = days.filter((day) => day.deliveryStatus === 'delivered').length;
  const missingDays = days.length - deliveredDays;
  return {
    farmer: {
      ...farmer,
      farmerId: farmer.id,
      createdDate: startDate,
      location: null,
      accountNumber: null,
      collectionCenter: 'North Site',
    },
    startDate,
    endDate: cappedEnd,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    expectedDays: days.length,
    deliveredDays,
    missingDays,
    deliveryRate: days.length ? Math.round((deliveredDays / days.length) * 10000) / 100 : 0,
    missedDates,
    days: [...days].reverse(),
  };
};

async function mockWorkspaceApis(page: Page) {
  const dailyRequests: URL[] = [];
  const farmerRequests: URL[] = [];
  const historyRequests: URL[] = [];
  await page.addInitScript(() => localStorage.setItem('milkSystem.language', 'en'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();

    let body: unknown = {};
    if (url.pathname === '/api/auth/me') body = { ok: true, user: collector };
    else if (url.pathname === '/api/farmers') {
      farmerRequests.push(url);
      const search = (url.searchParams.get('search') || '').trim();
      const numeric = searchNumber(search);
      const data = farmers
        .filter((farmer) => !search
          || farmer.name.toLowerCase().includes(search.toLowerCase())
          || farmer.phone.includes(search)
          || String(farmer.farmerNumber) === search
          || numeric === farmer.farmerNumber)
        .map((farmer) => ({
          ...farmer,
          location: null,
          accountNumber: null,
          collectionCenter: 'North Site',
          cowType: null,
        }));
      body = { data, nextCursor: null, hasMore: false, pageSize: 50 };
    } else if (url.pathname === '/api/milk/daily') {
      dailyRequests.push(url);
      const search = (url.searchParams.get('search') || '').trim();
      const numeric = searchNumber(search);
      const deliveryStatus = url.searchParams.get('deliveryStatus') || 'all';
      const rows = farmers
        .filter((farmer) => !search
          || farmer.name.toLowerCase().includes(search.toLowerCase())
          || farmer.phone.includes(search)
          || String(farmer.farmerNumber) === search
          || numeric === farmer.farmerNumber)
        .filter((farmer) => deliveryStatus === 'all' || (deliveryStatus === 'delivered' ? farmer.id === 994101 : farmer.id !== 994101))
        .map((farmer) => {
          const delivered = farmer.id === 994101;
          return {
            farmerId: farmer.id,
            farmerName: farmer.name,
            farmerNumber: farmer.farmerNumber,
            phone: farmer.phone,
            nationalId: farmer.nationalId,
            collectionCenter: 'North Site',
            collectorUserId: farmer.collectorUserId,
            collectorName: collector.name,
            recordId: delivered ? 994000 : null,
            date: url.searchParams.get('date'),
            status: delivered ? 'valid' : 'missing',
            delivered,
            deliveryStatus: delivered ? 'delivered' : 'missing',
            volumeMorning: delivered ? 10 : 0,
            volumeEvening: delivered ? 8 : 0,
            totalVolume: delivered ? 18 : 0,
            amount: 0,
          };
        });
      body = {
        farmers: rows,
        summary: {
          totalFarmers: 3,
          presentCount: 1,
          missedCount: 2,
          expectedCount: 3,
          deliveredCount: 1,
          missingCount: 2,
          deliveryRate: 33.33,
          totalMorning: 10,
          totalEvening: 8,
          totalVolume: 18,
          totalAmount: 0,
          pricePerLiter: 0,
          transportRate: 0,
        },
        farmerPagination: { nextCursor: null, hasMore: false },
        centers: [],
        collectorMilk: [],
      };
    } else if (url.pathname.startsWith('/api/farmers/') && url.pathname.endsWith('/delivery-history')) {
      historyRequests.push(url);
      const farmerId = Number(url.pathname.split('/')[3]);
      const farmer = farmers.find((entry) => entry.id === farmerId) || farmers[1];
      const startDate = url.searchParams.get('startDate') || `${isoToday().slice(0, 7)}-01`;
      const endDate = url.searchParams.get('endDate') || isoToday();
      body = historyPayload(farmer, startDate, endDate);
    } else if (url.pathname === '/api/collection-centers') body = [];
    else if (url.pathname === '/api/collector-assignments') body = { data: [] };
    else if (url.pathname === '/api/notifications/unread-count') body = { data: { unreadCount: 0 } };
    else if (url.pathname === '/api/notifications') body = { data: [] };
    else if (url.pathname === '/api/subscription') body = { account: { phone: null }, subscription: null, payments: [] };
    else if (url.pathname === '/api/milk') body = { data: [], nextCursor: null, hasMore: false, pageSize: 50 };
    else body = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { dailyRequests, farmerRequests, historyRequests };
}

async function openWorkspace(page: Page) {
  await page.goto('/login?tab=milk&flow=synthetic', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Milk entries' })).toBeVisible();
}

test('daily reconciliation, permanent-number search, Ifishi, and missing history stay consistent', async ({ page }) => {
  const { dailyRequests, farmerRequests, historyRequests } = await mockWorkspaceApis(page);
  await openWorkspace(page);

  const reconciliation = page.locator('.delivery-reconciliation');
  await expect(reconciliation).toContainText('Expected farmers');
  await expect(reconciliation).toContainText('3');
  await expect(reconciliation).toContainText('Delivered');
  await expect(reconciliation).toContainText('1');
  await expect(reconciliation).toContainText('Missing');
  await expect(reconciliation).toContainText('2');
  await expect(reconciliation).toContainText('33.33%');

  const missingPanel = page.locator('.missing-farmers-panel');
  await expect(missingPanel).toBeVisible();
  await expect(missingPanel).toContainText('No. 18 — Jean Bosco');
  await expect(missingPanel).toContainText('No. 19 — Aline Test');

  await page.locator('.milk-desktop-list tbody tr').first().getByRole('button', { name: 'Ifishi', exact: true }).click();
  const ifishi = page.getByRole('dialog', { name: 'Ifishi' });
  await expect(ifishi).toBeVisible();
  const ifishiSearch = ifishi.getByRole('combobox', { name: 'Find a farmer' });
  await ifishiSearch.fill('17');
  const option = ifishi.getByRole('listbox', { name: 'Search results' }).getByRole('option', { name: /No\. 17.*Jean Claude/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(ifishi.locator('.ifishi-selected-person')).toContainText('No. 17');
  await expect(ifishi.locator('.ifishi-selected-person')).toContainText('Jean Claude');
  expect(farmerRequests.some((request) => request.searchParams.get('search') === '17')).toBe(true);
  await ifishi.getByRole('button', { name: 'Cancel' }).click();

  const search = page.getByRole('searchbox', { name: 'Search milk entries' });
  await search.fill('17');
  await expect(page.locator('.milk-desktop-list tbody tr')).toHaveCount(1);
  await expect(page.locator('.milk-desktop-list tbody tr')).toContainText('No. 17');
  await expect(page.locator('.milk-desktop-list tbody tr')).toContainText('Jean Claude');
  await expect(page.locator('.milk-desktop-list tbody tr')).toContainText('0788000001');
  await expect(reconciliation).toContainText('3');
  await expect(reconciliation).toContainText('33.33%');
  expect(dailyRequests.some((request) => request.searchParams.get('search') === '17')).toBe(true);

  await search.fill('');
  await expect(page.locator('.milk-desktop-list tbody tr')).toHaveCount(3);
  const missingRow = missingPanel.locator('li').filter({ hasText: 'No. 18' });
  await missingRow.getByRole('button', { name: 'View history' }).click();

  const history = page.getByRole('dialog', { name: 'Milk delivery history' });
  await expect(history).toBeVisible();
  await expect(history).toContainText('No. 18');
  await expect(history).toContainText('Jean Bosco');
  const expectedDays = Number(await history.locator('.farmer-history-summary > div').filter({ hasText: 'Expected days' }).locator('b').textContent());
  const deliveredDays = Number(await history.locator('.farmer-history-summary > div').filter({ hasText: 'Delivered days' }).locator('b').textContent());
  const missingDays = Number(await history.locator('.farmer-history-summary > div').filter({ hasText: 'Missing days' }).locator('b').textContent());
  const lastHistoryRequest = historyRequests[historyRequests.length - 1];
  const requestStart = lastHistoryRequest.searchParams.get('startDate') || `${isoToday().slice(0, 7)}-01`;
  const requestEnd = lastHistoryRequest.searchParams.get('endDate') || isoToday();
  const requestedDates = dateRange(requestStart, requestEnd > isoToday() ? isoToday() : requestEnd);
  const expectedMissedDates = [requestedDates[4], requestedDates[11], requestedDates[18]]
    .filter(Boolean)
    .map((date) => formatDateLabel(date, 'en', { day: 'numeric', month: 'short', year: 'numeric' }));
  expect(expectedDays).toBeGreaterThan(0);
  expect(deliveredDays).toBe(expectedDays - expectedMissedDates.length);
  expect(missingDays).toBe(expectedMissedDates.length);
  await expect(history.locator('.farmer-history-summary')).toContainText(`${Math.round((deliveredDays / expectedDays) * 10000) / 100}%`);
  const missedItems = history.locator('.farmer-history-missed li');
  await expect(missedItems).toHaveCount(expectedMissedDates.length);
  const missedDates = await missedItems.locator('.farmer-history-missed-date').allTextContents();
  expect(missedDates.map((label) => label.trim())).toEqual(expectedMissedDates);
  await expect(missedItems.first()).toContainText('Not delivered');
  await expect(history.locator('.farmer-history-days tbody tr')).toHaveCount(expectedDays);
  await expect(history.locator('.farmer-history-days')).toContainText('Delivered');
  expect(historyRequests.length).toBeGreaterThan(0);
  await history.getByRole('button', { name: 'Cancel' }).last().click();

  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Farmers' }).click();
  const farmersSearch = page.getByRole('textbox', { name: 'Name, phone, number, ID or account' });
  await farmersSearch.fill('17');
  await farmersSearch.press('Enter');
  const farmerRow = page.locator('.farmers-desktop-table tbody tr').filter({ hasText: 'No. 17' });
  await expect(farmerRow).toHaveCount(1);
  await expect(farmerRow).toContainText('Jean Claude');
  await farmerRow.getByRole('button', { name: 'View history' }).click();
  await expect(page.getByRole('dialog', { name: 'Milk delivery history' })).toContainText('No. 17');
});

test('phone layout keeps numbers, search, missing history, and Ifishi usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockWorkspaceApis(page);
  await openWorkspace(page);

  const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(pageFits).toBe(true);
  await expect(page.locator('.milk-desktop-list')).toBeHidden();
  await expect(page.locator('.milk-mobile-list')).toBeVisible();
  const firstCard = page.locator('.milk-entry-card').first();
  await expect(firstCard).toContainText('No. 17');
  await expect(firstCard).toContainText('Jean Claude');
  await expect(firstCard).toContainText('0788000001');

  const search = page.getByRole('searchbox', { name: 'Search milk entries' });
  await expect(search).toBeVisible();
  const searchBox = await search.locator('xpath=..').boundingBox();
  expect(searchBox?.height || 0).toBeGreaterThanOrEqual(40);

  const missingPanel = page.locator('.missing-farmers-panel');
  await expect(missingPanel).toContainText('No. 18 — Jean Bosco');
  const missingHistoryButton = missingPanel.locator('li').filter({ hasText: 'No. 18' }).getByRole('button', { name: 'View history' });
  const historyBox = await missingHistoryButton.boundingBox();
  expect(historyBox?.height || 0).toBeGreaterThanOrEqual(40);
  await missingHistoryButton.click();

  const history = page.getByRole('dialog', { name: 'Milk delivery history' });
  await expect(history).toBeVisible();
  const mobileMissingDays = Number(await history.locator('.farmer-history-summary > div').filter({ hasText: 'Missing days' }).locator('b').textContent());
  await expect(history.locator('.farmer-history-missed li')).toHaveCount(mobileMissingDays);
  await expect(history.locator('.farmer-history-mobile-list')).toBeVisible();
  await expect(history.locator('.farmer-history-desktop-list')).toBeHidden();
  expect(await history.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const dialogBox = await history.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375 + 1);
  await history.getByRole('button', { name: 'Cancel' }).last().click();

  await search.fill('17');
  await expect(page.locator('.milk-entry-card')).toHaveCount(1);
  const onlyCard = page.locator('.milk-entry-card').first();
  await expect(onlyCard).toContainText('No. 17');
  await onlyCard.getByRole('button', { name: 'Ifishi', exact: true }).click();
  const ifishi = page.getByRole('dialog', { name: 'Ifishi' });
  await expect(ifishi).toBeVisible();
  expect(await ifishi.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const ifishiBox = await ifishi.boundingBox();
  expect(ifishiBox).not.toBeNull();
  expect(ifishiBox!.x).toBeGreaterThanOrEqual(0);
  expect(ifishiBox!.x + ifishiBox!.width).toBeLessThanOrEqual(375 + 1);
  const ifishiSearch = ifishi.getByRole('combobox', { name: 'Find a farmer' });
  await ifishiSearch.fill('17');
  await expect(ifishi.getByRole('listbox', { name: 'Search results' }).getByRole('option', { name: /No\. 17.*Jean Claude/ })).toBeVisible();
  await ifishi.getByRole('button', { name: 'Cancel' }).click();

  const mobileFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(mobileFits).toBe(true);
});
