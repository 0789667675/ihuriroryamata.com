const test = require('node:test');
const assert = require('node:assert/strict');

const Notifications = require('../lib/services/notification-service.js');
const NotificationRepository = require('../lib/repositories/notificationRepository.js');

const ownerUserId = 42;

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

test('evaluation creates a deduped notification for a new farmer missing morning collection', async () => {
  const stored = [];
  const repository = makeRepository({
    getCollectionCenters: async () => [{ name: 'North Site', morning_start: '06:30:00', morning_end: '09:00:00', evening_start: '17:30:00', evening_end: '19:00:00' }],
    getCenterSnapshot: async () => ({ farmers: [{ id: 7, name: 'Aline', collectionCenter: 'North Site' }], records: [] }),
    upsertNotification: async (input) => {
      const duplicate = stored.some((row) => row.type === input.type && row.farmerId === input.farmerId && row.period === input.period);
      if (duplicate) return { created: false, notification: stored[0] };
      const notification = { id: stored.length + 1, ...input };
      stored.push(notification);
      return { created: true, notification };
    },
  });
  const result = await Notifications.evaluateNotifications({ ownerUserId, now: new Date('2026-10-01T10:00:00'), repository });
  assert.ok(result.notifications.some((notification) => notification.type === 'morning_missed'));
  assert.ok(result.notifications.some((notification) => notification.type === 'farmer_morning_missed'));
  assert.equal(result.center, null);
});
