const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Notifications = require('../lib/services/notification-service.js');
const NotificationRepository = require('../lib/repositories/notificationRepository.js');

const ownerUserId = 42;
const readRoute = (routePath) => fs.readFileSync(path.join(__dirname, '..', routePath), 'utf8');

const makeRepository = (overrides = {}) => ({
  upsertNotification: async (input) => ({ created: true, notification: { id: 1, ...input } }),
  getNotifications: async (input) => [input],
  getUnreadCount: async () => 3,
  markNotificationRead: async ({ id, ownerUserId: scopedOwner }) => scopedOwner === ownerUserId ? { id, isRead: true } : null,
  markAllRead: async (input) => input,
  getCollectionCenters: async () => [],
  getCenterSnapshot: async () => ({ farmers: [], records: [] }),
  getCenterPeriodHistory: async () => [],
  ...overrides,
});

test('notification dedupe keys include tenant-independent event dimensions and upserts are owner scoped', async () => {
  let saved;
  const result = await Notifications.createFarmerChangedNotification({
    farmer: { id: 7, name: 'Aline', collectionCenter: 'North Site' },
    ownerUserId,
    now: new Date('2026-10-01T10:00:00Z'),
    repository: { upsertNotification: async (input) => { saved = input; return { created: true, notification: input }; } },
  });
  assert.equal(result.notification.ownerUserId, ownerUserId);
  assert.equal(saved.type, 'farmer_created');
  assert.equal(saved.farmerId, 7);
  assert.equal(saved.collectionCenter, 'North Site');
  assert.equal(NotificationRepository.buildDedupeKey({ type: 'missed', farmerId: 7, center: 'North', date: '2026-10-01', period: 'morning' }), 'missed|7|North|2026-10-01|morning|default');
});

test('successful farmer create and update routes emit non-blocking owner-scoped notifications', () => {
  const createRoute = readRoute('app/api/farmers/route.ts');
  const updateRoute = readRoute('app/api/farmers/[id]/route.js');
  assert.match(createRoute, /await Farmers\.createFarmer[\s\S]*?createFarmerChangedNotification\(\{ farmer, ownerUserId: user\.id, action: 'created' \}\)/);
  assert.match(updateRoute, /await Farmers\.updateFarmer[\s\S]*?createFarmerChangedNotification\(\{ farmer, ownerUserId: user\.id, action: 'updated' \}\)/);
  assert.match(createRoute, /Farmer-created notification failed/);
  assert.match(updateRoute, /Farmer-updated notification failed/);
});

test('notification list, unread count, and mark-read always carry authenticated owner', async () => {
  const calls = [];
  const repository = makeRepository({
    getNotifications: async (input) => { calls.push(input); return []; },
    getUnreadCount: async (input) => { calls.push(input); return 4; },
    markNotificationRead: async (input) => { calls.push(input); return null; },
    markAllRead: async (input) => { calls.push(input); return { success: true }; },
  });
  await Notifications.getNotifications({ ownerUserId, center: ' North ', status: 'unread', priority: 'warning', repository });
  assert.equal(await Notifications.getUnreadCount({ ownerUserId, repository }), 4);
  assert.equal(await Notifications.markNotificationRead({ id: 9, ownerUserId, repository }), null);
  await Notifications.markAllRead({ ownerUserId, repository });
  assert.ok(calls.every((call) => call.ownerUserId === ownerUserId));
  assert.equal(calls[0].center, 'North');
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, limit: 101, repository }), /between 1 and 100/i);
});

test('notification query combines real status/type/priority/text filters with date or type ordering', async () => {
  let statement;
  await NotificationRepository.getNotifications({
    ownerUserId,
    center: 'North Site',
    status: 'unread',
    priority: 'warning',
    type: 'milk_missing',
    search: 'Aline',
    sortBy: 'type',
    sortDirection: 'asc',
    limit: 25,
    runQuery: async (text, values) => { statement = { text, values }; return { rows: [] }; },
  });

  assert.match(statement.text, /owner_user_id = \$1/);
  assert.match(statement.text, /collection_center = \$2/);
  assert.match(statement.text, /is_read = FALSE/);
  assert.match(statement.text, /priority = \$3/);
  assert.match(statement.text, /notification_type = \$4/);
  assert.match(statement.text, /title ILIKE \$5 OR message ILIKE \$5/);
  assert.match(statement.text, /ORDER BY notification_type ASC, id ASC LIMIT \$6/);
  assert.deepEqual(statement.values, [ownerUserId, 'North Site', 'warning', 'milk_missing', '%Aline%', 25]);
});

test('notification service validates sort keys, directions, and read/unread filter values', async () => {
  const repository = makeRepository();
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, sortBy: 'message;DROP TABLE notifications', repository }), /unsupported notification sort field/i);
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, sortDirection: 'random', repository }), /sortDirection/i);
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, status: 'archived', repository }), /invalid notification status/i);
});

test('monitoring preserves new-farmer and repeated zero-volume status rules', () => {
  const farmer = { id: 2, name: 'Aline' };
  const periods = { morning: { start: '06:30', end: '09:00' }, evening: { start: '17:30', end: '19:00' } };
  const newFarmer = Notifications.computeFarmerStatus({ farmer, record: null, historyRecords: [], currentTime: new Date('2026-10-01T10:00:00'), periods });
  assert.equal(newFarmer.status, 'morning_missed');
  const establishedFarmer = Notifications.computeFarmerStatus({ farmer, record: null, historyRecords: [{ volume_morning: 5 }], currentTime: new Date('2026-10-01T10:00:00'), periods });
  assert.equal(establishedFarmer.status, 'unknown');
  const repeatedlyMissed = Notifications.computeFarmerStatus({
    farmer,
    record: null,
    historyRecords: [{ volume_morning: 0 }, { volume_morning: 0 }, { volume_evening: 0 }],
    currentTime: new Date('2026-10-01T20:00:00'),
    periods,
  });
  assert.equal(repeatedlyMissed.status, 'repeatedly_missed');
});

test('evaluation creates deduped operational alerts for a completed session with no delivery', async () => {
  const stored = [];
  const repository = {
    getAlertOwnerScope: async () => ({ accountType: 'COLLECTOR', accountStatus: 'active', dairyUserId: null }),
    getCollectionCenters: async () => [{ name: 'North Site', morning_start: '06:30:00', morning_end: '09:00:00', evening_start: '17:30:00', evening_end: '19:00:00' }],
    getAlertFarmers: async () => [{ id: 7, name: 'Aline', accountNumber: 'F-7', centerName: 'North Site', collectorUserId: null, collectorActive: false, createdDate: '2026-01-01' }],
    getAlertMilkRecords: async () => [
      { farmerId: 7, date: '2026-09-20', morning: 6, evening: 0 },
      { farmerId: 7, date: '2026-09-29', morning: 5, evening: 4 },
      { farmerId: 7, date: '2026-09-30', morning: 4, evening: 3 },
    ],
    getAlertsForEvaluation: async () => stored,
    upsertOperationalAlert: async (input) => {
      const existing = stored.find((row) => row.dedupe_key === input.dedupeKey);
      if (existing) return { created: false, reopened: false, notification: existing };
      const notification = {
        id: stored.length + 1,
        ...input,
        notification_type: input.type,
        farmer_id: input.farmerId ?? null,
        collection_date: input.date ?? null,
        dedupe_key: input.dedupeKey,
        status: 'open',
        resolved_by: null,
      };
      stored.push(notification);
      return { created: true, reopened: false, notification };
    },
    refreshOperationalAlert: async () => null,
    resolveOperationalAlerts: async () => [],
  };
  const first = await Notifications.evaluateNotifications({ ownerUserId, now: new Date('2026-10-01T10:00:00Z'), repository });
  assert.equal(first.createdCount, 3);
  assert.ok(first.notifications.some((notification) => notification.notification_type === 'farmer_missed_delivery'));
  assert.ok(first.notifications.some((notification) => notification.notification_type === 'missed_delivery'));
  assert.ok(first.notifications.some((notification) => notification.notification_type === 'no_collection'));
  const missed = first.notifications.find((notification) => notification.notification_type === 'farmer_missed_delivery');
  assert.equal(missed.collection_date, '2026-10-01');
  assert.equal(missed.period, 'morning');
  assert.equal(missed.farmer_id, 7);
  assert.equal(missed.details.titleKey, 'alertTitleMissedDeliveryFarmer');
  assert.equal(missed.details.messageKey, 'alertMessageMissedDeliveryFarmer');
  assert.equal(missed.details.evidence, 'no_recorded_delivery');

  const second = await Notifications.evaluateNotifications({ ownerUserId, now: new Date('2026-10-01T10:00:00Z'), repository });
  assert.equal(second.createdCount, 0);
  assert.equal(second.refreshedCount, 0);
  assert.equal(second.resolvedCount, 0);
  assert.equal(stored.length, 3);
});
