// Operational notification tests: pure rules, owner-scoped evaluation, reconciliation,
// resolution lifecycle, tenant isolation, and Kinyarwanda/English copy coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Rules = require('../lib/services/operational-alert-rules.js');
const Taxonomy = require('../lib/services/notification-taxonomy.js');
const Notifications = require('../lib/services/notification-service.js');
const OperationalAlerts = require('../lib/repositories/operationalAlertRepository.js');
const { isCollectionCenterAuthenticationPath, isSubscriptionRecoveryRequest } = require('../lib/security/authenticate.js');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const ownerUserId = 42;
const CENTER = { name: 'North Site', morning_start: '06:30:00', morning_end: '09:00:00', evening_start: '17:30:00', evening_end: '19:00:00' };
const EVALUATION_DATES = ['2026-09-29', '2026-09-30', '2026-10-01'];
const HISTORY_START = '2026-09-17';
const farmer = (overrides = {}) => ({
  id: 7, name: 'Aline', accountNumber: 'F-7', centerName: 'North Site',
  collectorUserId: null, collectorActive: false, createdDate: '2026-01-01', ...overrides,
});
const row = (farmerId, date, morning, evening) => ({ farmerId, date, morning, evening });
const buildPlan = ({ farmers = [farmer()], records = [], centers = [CENTER], minutes = 12 * 60, date = '2026-10-01', scope = { isCollector: true, ownerUserId } } = {}) => Rules.buildOperationalAlertPlan({
  scope,
  farmers,
  records,
  centers,
  clock: { date, minutes },
  evaluationDates: EVALUATION_DATES,
  historyStart: HISTORY_START,
});
const missedFarmers = (plan) => plan.alerts.filter((alert) => alert.type === 'farmer_missed_delivery');

test('a farmer with recent morning history but no delivery is flagged once the morning session ends', () => {
  const plan = buildPlan({ records: [row(7, '2026-09-29', 5, 4), row(7, '2026-09-30', 4, 3)] });
  const missed = missedFarmers(plan);
  assert.equal(missed.length, 1);
  assert.equal(missed[0].farmerId, 7);
  assert.equal(missed[0].date, '2026-10-01');
  assert.equal(missed[0].period, 'morning');
  assert.equal(missed[0].titleKey, 'alertTitleMissedDeliveryFarmer');
  assert.equal(missed[0].messageKey, 'alertMessageMissedDeliveryFarmer');
  assert.equal(missed[0].nextActionKey, 'alertNextVerifyDelivery');
  assert.equal(missed[0].details.evidence, 'no_recorded_delivery');
  assert.equal(missed[0].params.session, 'Mu gitondo');
  const summaries = plan.alerts.filter((alert) => alert.type === 'missed_delivery');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].period, 'morning');
  assert.deepEqual(summaries[0].details.farmerIds, [7]);
  assert.ok(plan.desired.has(summaries[0].dedupeKey));
});

test('an evening-only history flags the missing evening delivery, not the morning', () => {
  const records = [row(7, '2026-09-29', 0, 5), row(7, '2026-09-30', 0, 4)];
  assert.equal(missedFarmers(buildPlan({ records, minutes: 18 * 60 })).length, 0);
  const missed = missedFarmers(buildPlan({ records, minutes: 19 * 60 }));
  assert.equal(missed.length, 1);
  assert.equal(missed[0].period, 'evening');
  assert.equal(missed[0].params.session, 'Nimugoroba');
});

test('no missed-delivery alert is emitted while the session window is still open', () => {
  const records = [row(7, '2026-09-29', 5, 4), row(7, '2026-09-30', 4, 3)];
  assert.equal(buildPlan({ records, minutes: 6 * 60 }).alerts.length, 0);
  assert.equal(buildPlan({ records, minutes: Rules.minutesFromTime('08:59', 0) }).alerts.length, 0);
  assert.equal(missedFarmers(buildPlan({ records, minutes: Rules.minutesFromTime('09:00', 0) })).length, 1);
});

test('an expectation requires a real session delivery within 14 days of the evaluated date', () => {
  const zeroRows = [row(7, '2026-09-29', 0, 0), row(7, '2026-09-30', 0, 0)];
  assert.equal(buildPlan({ records: zeroRows }).alerts.length, 0);
  assert.equal(buildPlan({ records: [row(7, '2026-09-14', 6, 0)] }).alerts.length, 0);
  const boundary = missedFarmers(buildPlan({ records: [row(7, '2026-09-15', 6, 0)] }));
  assert.deepEqual(boundary.map((alert) => alert.date), ['2026-09-29']);
  assert.equal(Rules.EXPECTATION_LOOKBACK_DAYS, 14);
});

test('a farmer created after an evaluated date is not flagged for that date', () => {
  const plan = buildPlan({
    farmers: [farmer({ createdDate: '2026-10-01' })],
    records: [row(7, '2026-09-29', 5, 4), row(7, '2026-09-30', 4, 3)],
  });
  assert.deepEqual(missedFarmers(plan).map((alert) => alert.date), ['2026-10-01']);
});

test('low delivery and low collection alerts compare against the own farmer and center baselines', () => {
  const records = [
    ...['24', '25', '26', '27', '28', '29', '30'].map((day) => row(7, `2026-09-${day}`, 10, 0)),
    row(7, '2026-10-01', 3, 0),
  ];
  const plan = buildPlan({ records });
  const low = plan.alerts.filter((alert) => alert.type === 'low_delivery');
  assert.equal(low.length, 1);
  assert.equal(low[0].details.evidence, 'below_own_average');
  assert.equal(low[0].details.volume, 3);
  assert.equal(low[0].details.average, 10);
  assert.equal(low[0].params.days, 7);
  assert.equal(missedFarmers(plan).length, 0);
  const lowCollection = plan.alerts.filter((alert) => alert.type === 'low_collection');
  assert.equal(lowCollection.length, 1);
  assert.equal(lowCollection[0].details.evidence, 'below_recent_average');
});

test('center alerts never fire when no farmer was expected', () => {
  assert.equal(buildPlan({ records: [] }).alerts.length, 0);
});

test('data-quality alerts need recent activity and distinguish missing configuration', () => {
  const records = [
    row(7, '2026-09-30', 4, 0),
    row(8, '2026-09-30', 3, 0),
    row(9, '2026-09-30', 2, 0),
  ];
  const centerScope = buildPlan({
    scope: { isCollector: false, ownerUserId },
    farmers: [
      farmer({ centerName: null }),
      farmer({ id: 8, name: 'Bosco' }),
      farmer({ id: 9, name: 'Claudine', collectorUserId: 55, collectorActive: true }),
    ],
    records,
  });
  assert.deepEqual(centerScope.alerts.filter((alert) => alert.type === 'farmer_missing_center').map((alert) => alert.farmerId), [7]);
  assert.deepEqual(centerScope.alerts.filter((alert) => alert.type === 'farmer_missing_collector').map((alert) => alert.farmerId), [8]);
  assert.equal(centerScope.alerts.find((alert) => alert.type === 'farmer_missing_center').details.evidence, 'missing_configuration');

  const inactive = buildPlan({
    scope: { isCollector: false, ownerUserId },
    farmers: [farmer({ collectorUserId: 55, collectorActive: false })],
    records: [row(7, '2026-09-30', 4, 0)],
  });
  assert.equal(inactive.alerts.find((alert) => alert.type === 'farmer_missing_collector').details.reason, 'collector_inactive');

  const collectorScope = buildPlan({
    scope: { isCollector: true, ownerUserId: 55 },
    farmers: [farmer({ id: 8, name: 'Bosco' }), farmer({ id: 10, name: 'David' })],
    records: [row(8, '2026-09-30', 3, 0)],
  });
  assert.equal(collectorScope.alerts.filter((alert) => alert.type === 'farmer_missing_collector').length, 0);
  assert.equal(collectorScope.alerts.filter((alert) => alert.type === 'farmer_missing_center').length, 0);
});

test('dedupe keys separate farmers, sessions, dates, and center summaries', () => {
  const plan = buildPlan({ records: [row(7, '2026-09-29', 5, 4), row(7, '2026-09-30', 4, 3)] });
  const keys = new Set(plan.alerts.map((alert) => alert.dedupeKey));
  assert.equal(keys.size, plan.alerts.length);
  const farmerKey = missedFarmers(plan)[0].dedupeKey;
  assert.match(farmerKey, /^farmer_missed_delivery\|7\|North Site\|2026-10-01\|morning\|default$/);
  assert.notEqual(plan.alerts.find((alert) => alert.type === 'missed_delivery').dedupeKey, farmerKey);
  assert.notEqual(
    Taxonomy.buildAlertDedupeKey({ type: 'farmer_missed_delivery', farmerId: 7, center: 'North Site', date: '2026-10-01', period: 'morning' }),
    Taxonomy.buildAlertDedupeKey({ type: 'farmer_missed_delivery', farmerId: 7, center: 'North Site', date: '2026-10-01', period: 'evening' })
  );
});

test('lazy evaluation is bounded to the current day and the two previous days', () => {
  assert.equal(Rules.EVALUATION_DAYS_BACK, 2);
  assert.deepEqual(Rules.listEvaluationDates({ today: '2026-10-01' }), ['2026-09-29', '2026-09-30', '2026-10-01']);
  const tokyoMorning = Rules.getKigaliClock(new Date('2026-10-01T05:00:00Z'));
  assert.equal(tokyoMorning.date, '2026-10-01');
  assert.equal(tokyoMorning.minutes, 7 * 60);
  assert.equal(Rules.isSessionComplete({ date: '2026-09-30', today: '2026-10-01', minutes: 0, period: 'morning', periods: Rules.getCenterPeriods(CENTER) }), true);
});

test('delivery index accepts repository valid-volume columns and ignores unsafe values', () => {
  const index = Rules.buildDeliveryIndex([
    { farmer_id: 7, date: '2026-10-01', valid_volume_morning: '3.5', valid_volume_evening: null },
    { farmer_id: 8, date: '2026-10-01', morning: -4, evening: 'abc' },
    { farmer_id: 'x', date: '2026-10-01', morning: 4 },
  ]);
  assert.deepEqual(index.get(7).get('2026-10-01'), { morning: 3.5, evening: 0 });
  assert.deepEqual(index.get(8).get('2026-10-01'), { morning: 0, evening: 0 });
  assert.equal(index.size, 2);
});

test('legacy alert types stay listable and resolvable after the upgrade', () => {
  for (const type of ['morning_missed', 'evening_missed', 'farmer_morning_missed', 'farmer_evening_missed', 'repeatedly_missed']) {
    assert.ok(Taxonomy.ALL_OPERATIONAL_NOTIFICATION_TYPES.includes(type));
    assert.ok(Taxonomy.ALERT_TYPE_GROUPS.missed.includes(type));
  }
  assert.deepEqual(Taxonomy.OPERATIONAL_NOTIFICATION_TYPES, [
    'missed_delivery', 'farmer_missed_delivery', 'low_delivery',
    'farmer_missing_center', 'farmer_missing_collector', 'no_collection', 'low_collection',
  ]);
});

test('evaluation scope is derived from the authenticated owner, never from request input', async () => {
  const calls = [];
  const repository = {
    getAlertOwnerScope: async ({ ownerUserId: scopeOwner }) => { calls.push(['scope', scopeOwner]); return { accountType: 'COLLECTOR', accountStatus: 'active', dairyUserId: 900 }; },
    getCollectionCenters: async ({ ownerUserId: centerOwner }) => { calls.push(['centers', centerOwner]); return []; },
    getAlertFarmers: async ({ ownerUserId: farmerOwner, dairyUserId }) => { calls.push(['farmers', farmerOwner, dairyUserId]); return []; },
    getAlertMilkRecords: async ({ ownerUserId: recordOwner, dairyUserId, startDate, endDate }) => { calls.push(['records', recordOwner, dairyUserId, startDate, endDate]); return []; },
    getAlertsForEvaluation: async ({ ownerUserId: existingOwner }) => { calls.push(['existing', existingOwner]); return []; },
    upsertOperationalAlert: async () => ({ created: false, reopened: false, notification: null }),
    refreshOperationalAlert: async () => null,
    resolveOperationalAlerts: async () => [],
  };
  const collectorRun = await Notifications.evaluateOperationalAlerts({ ownerUserId, accountType: 'COLLECTOR', now: new Date('2026-10-01T10:00:00Z'), repository });
  assert.equal(collectorRun.scope, 'COLLECTOR');
  assert.deepEqual(calls.find((call) => call[0] === 'farmers'), ['farmers', ownerUserId, 900]);
  assert.deepEqual(calls.find((call) => call[0] === 'records').slice(0, 3), ['records', ownerUserId, 900]);
  assert.deepEqual(calls.find((call) => call[0] === 'existing'), ['existing', ownerUserId]);

  const centerRun = await Notifications.evaluateOperationalAlerts({ ownerUserId: 43, accountType: 'COLLECTION_CENTER', now: new Date('2026-10-01T10:00:00Z'), repository });
  assert.equal(centerRun.scope, 'COLLECTION_CENTER');
  assert.deepEqual(calls.filter((call) => call[0] === 'farmers').at(-1), ['farmers', 43, null]);

  const evaluateRoute = read('app/api/notifications/evaluate/route.js');
  assert.match(evaluateRoute, /ownerUserId: user\.id/);
  assert.match(evaluateRoute, /accountType: user\.accountType/);
  assert.doesNotMatch(evaluateRoute, /ownerUserId: (body|input|params)/);
});

test('evaluation reads are owner-scoped and exclude cancelled or zero-value deliveries', async () => {
  const statements = [];
  const runQuery = async (text, values) => { statements.push({ text, values }); return { rows: [] }; };
  await OperationalAlerts.getAlertFarmers({ ownerUserId, dairyUserId: null, runQuery });
  assert.match(statements[0].text, /f\.owner_user_id = \$1/);
  assert.deepEqual(statements[0].values, [ownerUserId, null]);
  await OperationalAlerts.getAlertFarmers({ ownerUserId, dairyUserId: 900, runQuery });
  assert.match(statements[1].text, /collector_assignments/);
  assert.deepEqual(statements[1].values, [ownerUserId, 900]);
  await OperationalAlerts.getAlertMilkRecords({ ownerUserId, dairyUserId: 900, startDate: '2026-09-17', endDate: '2026-10-01', runQuery });
  assert.match(statements[2].text, /COALESCE\(mr\.status, 'valid'\) <> 'cancelled'/);
  assert.match(statements[2].text, /COALESCE\(mr\.valid_volume_morning, mr\.volume_morning, 0\)/);
  assert.match(statements[2].text, /COALESCE\(mr\.valid_volume_evening, mr\.volume_evening, 0\)/);
  await OperationalAlerts.getAlertsForEvaluation({ ownerUserId, types: Taxonomy.OPERATIONAL_NOTIFICATION_TYPES, startDate: '2026-09-29', endDate: '2026-10-01', runQuery });
  assert.match(statements[3].text, /owner_user_id = \$1/);
  assert.match(statements[3].text, /\(collection_date IS NULL OR collection_date BETWEEN \$3 AND \$4\)/);
});

test('late delivery entry resolves the open missed-delivery alert with an auditable system reason', async () => {
  const state = {
    farmers: [farmer()],
    records: [row(7, '2026-09-29', 5, 4), row(7, '2026-09-30', 4, 3)],
    stored: [],
  };
  const repository = {
    getAlertOwnerScope: async () => ({ accountType: 'COLLECTOR', accountStatus: 'active', dairyUserId: null }),
    getCollectionCenters: async () => [CENTER],
    getAlertFarmers: async () => state.farmers,
    getAlertMilkRecords: async () => state.records,
    getAlertsForEvaluation: async () => state.stored,
    upsertOperationalAlert: async (input) => {
      const existing = state.stored.find((row_) => row_.dedupe_key === input.dedupeKey);
      if (existing) return { created: false, reopened: false, notification: existing };
      const notification = {
        id: state.stored.length + 1,
        ...input,
        notification_type: input.type,
        farmer_id: input.farmerId ?? null,
        collection_date: input.date ?? null,
        dedupe_key: input.dedupeKey,
        status: 'open',
        resolved_by: null,
        resolved_at: null,
      };
      state.stored.push(notification);
      return { created: true, reopened: false, notification };
    },
    refreshOperationalAlert: async () => null,
    resolveOperationalAlerts: async ({ ids, resolutionCode }) => ids.map((id) => {
      const stored = state.stored.find((row_) => row_.id === id);
      stored.status = 'resolved';
      stored.resolution_code = resolutionCode;
      stored.resolved_by = null;
      stored.resolved_at = new Date('2026-10-01T12:00:00Z');
      return stored;
    }),
  };

  const first = await Notifications.evaluateOperationalAlerts({ ownerUserId, accountType: 'COLLECTOR', now: new Date('2026-10-01T10:00:00Z'), repository });
  assert.equal(first.createdCount, 3);
  assert.equal(state.stored.length, 3);

  state.records.push(row(7, '2026-10-01', 6, 0));
  const second = await Notifications.evaluateOperationalAlerts({ ownerUserId, accountType: 'COLLECTOR', now: new Date('2026-10-01T12:00:00Z'), repository });
  assert.equal(second.createdCount, 0);
  assert.equal(second.resolvedCount, 3);
  const farmerAlert = state.stored.find((row_) => row_.notification_type === 'farmer_missed_delivery');
  assert.equal(farmerAlert.status, 'resolved');
  assert.equal(farmerAlert.resolution_code, 'delivery_recorded');
  const summary = state.stored.find((row_) => row_.notification_type === 'missed_delivery');
  assert.equal(summary.resolution_code, 'issue_cleared');
});

test('reconciliation never overrides a decision a user already made', () => {
  const service = read('lib/services/notification-service.js');
  const repository = read('lib/repositories/notificationRepository.js');
  assert.match(service, /persisted\.status === 'resolved' && persisted\.resolved_by === null/);
  assert.match(service, /state\?\.delivery \? 'delivery_recorded' : 'issue_cleared'/);
  assert.match(repository, /status = 'resolved' AND resolved_by IS NULL/);
});

test('resolve and reopen are owner-scoped, audited, and keep read state consistent', async () => {
  const auditCalls = [];
  const audit = { createAuditLog: async (entry) => { auditCalls.push(entry); } };
  const repository = {
    resolveNotification: async (input) => ({ id: input.id, owner_user_id: input.ownerUserId, status: 'resolved', resolution_code: input.resolutionCode, resolved_by: input.actorId, is_read: true }),
    reopenNotification: async (input) => ({ id: input.id, owner_user_id: input.ownerUserId, status: 'open', is_read: false }),
    getNotificationById: async () => null,
  };
  const resolved = await Notifications.resolveNotification({ id: 5, ownerUserId, actorId: ownerUserId, resolutionCode: 'farmer_absent', note: 'Called the farmer', repository, audit, now: new Date('2026-10-01T10:00:00Z') });
  assert.equal(resolved.changed, true);
  assert.equal(resolved.notification.status, 'resolved');
  assert.equal(resolved.notification.is_read, true);
  assert.equal(auditCalls[0].action, 'resolved');
  assert.equal(auditCalls[0].entityType, 'notification');
  assert.equal(auditCalls[0].ownerUserId, ownerUserId);
  assert.equal(auditCalls[0].details.resolutionCode, 'farmer_absent');

  const reopened = await Notifications.reopenNotification({ id: 5, ownerUserId, repository, audit });
  assert.equal(reopened.changed, true);
  assert.equal(reopened.notification.status, 'open');
  assert.equal(reopened.notification.is_read, false);
  assert.equal(auditCalls[1].action, 'reopened');

  await assert.rejects(() => Notifications.resolveNotification({ id: 5, ownerUserId, resolutionCode: 'not_a_real_reason', repository, audit }), /invalid resolution reason/i);
  await assert.rejects(() => Notifications.resolveNotification({ id: 0, ownerUserId, resolutionCode: 'dismissed', repository, audit }), /invalid notification id/i);
  await assert.rejects(() => Notifications.reopenNotification({ id: -3, ownerUserId, repository, audit }), /invalid notification id/i);

  const unchanged = await Notifications.resolveNotification({
    id: 5,
    ownerUserId,
    resolutionCode: 'dismissed',
    repository: { resolveNotification: async () => null, getNotificationById: async () => ({ id: 5, status: 'resolved' }) },
    audit,
  });
  assert.equal(unchanged.changed, false);
  await assert.rejects(() => Notifications.resolveNotification({
    id: 99,
    ownerUserId,
    resolutionCode: 'dismissed',
    repository: { resolveNotification: async () => null, getNotificationById: async () => null },
    audit,
  }), /not found/i);
});

test('resolution state transitions are enforced in SQL for the whole lifecycle', () => {
  const repository = read('lib/repositories/notificationRepository.js');
  assert.match(repository, /resolution_note = \$4, resolved_by = \$5,[^;]*is_read = TRUE/);
  assert.match(repository, /SET status = 'open', resolution_code = NULL, resolution_note = NULL, resolved_by = NULL,[^;]*is_read = FALSE/);
  assert.match(repository, /SET status = 'resolved', resolution_code = \$3, resolved_at = \$4,[^;]*is_read = TRUE/);
  const resolveFunction = repository.slice(repository.indexOf('const resolveNotification ='), repository.indexOf('const reopenNotification ='));
  const reopenFunction = repository.slice(repository.indexOf('const reopenNotification ='), repository.indexOf('const getNotifications ='));
  assert.match(resolveFunction, /owner_user_id = \$2/);
  assert.match(reopenFunction, /owner_user_id = \$2/);
});

test('resolution endpoints are authenticated, owner-scoped, and cannot touch milk records', () => {
  const service = read('lib/services/notification-service.js');
  const resolutionSection = service.slice(service.indexOf('const resolveNotification ='), service.indexOf('const normalizeLimit'));
  assert.doesNotMatch(resolutionSection, /milk/i);
  for (const routePath of ['app/api/notifications/[id]/resolve/route.js', 'app/api/notifications/[id]/reopen/route.js']) {
    const route = read(routePath);
    assert.match(route, /getAuthenticatedUser\(request\)/);
    assert.match(route, /ownerUserId: user\.id/);
    assert.match(route, /actorId: user\.id/);
    assert.doesNotMatch(route, /milk/i);
  }
  assert.equal(isCollectionCenterAuthenticationPath('/api/notifications/14/resolve'), true);
  assert.equal(isCollectionCenterAuthenticationPath('/api/notifications/14/reopen'), true);
  assert.equal(isCollectionCenterAuthenticationPath('/api/notifications/14/read'), true);
  assert.equal(isCollectionCenterAuthenticationPath('/api/notifications/14/resolve/extra'), false);
  assert.equal(isSubscriptionRecoveryRequest({ url: 'https://milk.example.test/api/notifications/14/resolve', method: 'PATCH' }), false);
  assert.equal(isSubscriptionRecoveryRequest({ url: 'https://milk.example.test/api/notifications/14/reopen', method: 'PATCH' }), false);
});

test('notification list filters accept state, category, and alert-group parameters with validation', async () => {
  let received;
  const repository = { getNotifications: async (input) => { received = input; return []; } };
  await Notifications.getNotifications({ ownerUserId, state: 'action', category: 'operational', alertGroup: 'missed', repository });
  assert.equal(received.state, 'action');
  assert.equal(received.category, 'operational');
  assert.equal(received.alertGroup, 'missed');
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, state: 'pending', repository }), /invalid notification state/i);
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, category: 'everything', repository }), /invalid notification category/i);
  await assert.rejects(() => Notifications.getNotifications({ ownerUserId, alertGroup: 'milk', repository }), /invalid notification group/i);
  const listRoute = read('app/api/notifications/route.js');
  assert.match(listRoute, /state: params\.get\('state'\)/);
  assert.match(listRoute, /category: params\.get\('category'\)/);
  assert.match(listRoute, /alertGroup: params\.get\('alertGroup'\)/);
});

test('every operational alert copy key exists in both Kinyarwanda and English', () => {
  const copy = read('lib/i18n/public-copy.ts');
  const enStart = copy.indexOf('en: {');
  const keysOf = (block) => new Set([...block.matchAll(/^    ([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
  const rw = keysOf(copy.slice(copy.indexOf('rw: {'), enStart));
  const en = keysOf(copy.slice(enStart, copy.indexOf('} as const;', enStart)));
  assert.equal(rw.size, en.size);
  for (const key of rw) assert.ok(en.has(key), `${key} must exist in English`);

  const required = new Set([
    'alertTitleMissedDelivery', 'alertMessageMissedDelivery', 'alertNextReviewCollection',
    'alertTitleMissedDeliveryFarmer', 'alertMessageMissedDeliveryFarmer', 'alertNextVerifyDelivery',
    'alertTitleLowDelivery', 'alertMessageLowDelivery', 'alertNextReviewVolume',
    'alertTitleMissingCenter', 'alertMessageMissingCenter', 'alertNextAssignCenter',
    'alertTitleMissingCollector', 'alertMessageMissingCollector', 'alertNextAssignCollector',
    'alertTitleNoCollection', 'alertMessageNoCollection', 'alertTitleLowCollection', 'alertMessageLowCollection',
    'alertFilterAll', 'alertFilterAction', 'alertFilterMissed', 'alertFilterLow', 'alertFilterQuality', 'alertFilterResolved',
    'alertsNeedsAttention', 'alertsActivity', 'alertsResolved', 'alertsOpenInbox',
    'notificationsLoading', 'notificationsLoadError', 'notificationsEmptyBody', 'notificationsEvaluated',
    'alertStatusOpen', 'alertStatusResolved', 'alertPriorityHigh', 'alertPriorityWarning', 'alertPriorityInfo', 'alertPrioritySuccess',
    'alertSessionMorning', 'alertSessionEvening', 'alertResolvedBySystem', 'alertResolvedByUser', 'alertResolvedLabel',
    'alertResolutionTitle', 'alertResolutionCodeLabel', 'alertResolutionNote', 'alertResolutionSubmit', 'alertResolutionSaved',
    'alertResolutionFarmerAbsent', 'alertResolutionNoMilk', 'alertResolutionReportedOther',
    'alertResolutionPendingVerification', 'alertResolutionDismissed', 'alertResolutionOther',
    'alertResolutionDeliveryRecorded', 'alertResolutionVolumeCorrected', 'alertResolutionIssueCleared',
    'alertResolve', 'alertReopen', 'alertOpenFarmer', 'alertRecordMilk', 'alertUncertainNote', 'alertReopened',
    'alertTypeMissedDelivery', 'alertTypeFarmerMissedDelivery', 'alertTypeLowDelivery',
    'alertTypeFarmerMissingCenter', 'alertTypeFarmerMissingCollector', 'alertTypeNoCollection', 'alertTypeLowCollection',
    'alertTypeMorningMissed', 'alertTypeEveningMissed', 'alertTypeFarmerMorningMissed', 'alertTypeFarmerEveningMissed',
    'alertTypeRepeatedlyMissed', 'alertTypeFarmerCreated', 'alertTypeFarmerUpdated', 'alertTypePayment',
    'alertActivityFarmerCreated', 'alertActivityFarmerUpdated',
  ]);
  const plan = buildPlan({ records: [row(7, '2026-09-29', 5, 4), row(7, '2026-09-30', 4, 3)] });
  for (const alert of plan.alerts) {
    for (const key of [alert.titleKey, alert.messageKey, alert.nextActionKey]) if (key) required.add(key);
  }
  for (const key of required) {
    assert.ok(rw.has(key), `${key} missing in Kinyarwanda`);
    assert.ok(en.has(key), `${key} missing in English`);
  }
});

test('the workspace wires the alert lifecycle through the owned notification APIs', () => {
  const workspace = read('app/workspace.tsx');
  assert.match(workspace, /api<\{ data: Notice\[\] \}>\('\/api\/notifications\?limit=50'\)/);
  assert.match(workspace, /api<\{ data: \{ unreadCount: number \} \}>\('\/api\/notifications\/unread-count'\)/);
  assert.ok(workspace.includes('api(`/api/notifications/${notification.id}/read`'));
  assert.ok(workspace.includes('api(`/api/notifications/${resolveTarget.id}/resolve`'));
  assert.ok(workspace.includes('api(`/api/notifications/${notification.id}/reopen`'));
  assert.match(workspace, /'\/api\/notifications\/evaluate', \{ method: 'POST' \}/);
  assert.match(workspace, /formatPublicCopy\(publicLanguage\.language, item\.details\?\.titleKey, item\.title, item\.details\?\.params\)/);
  assert.match(workspace, /tab === 'notifications-admin' && isAdmin \? renderNotifications\(\) : null/);
});
