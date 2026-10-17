const notificationRepository = require('../repositories/notificationRepository.js');
const operationalAlertRepository = require('../repositories/operationalAlertRepository.js');
const {
  OPERATIONAL_NOTIFICATION_TYPES,
  MANUAL_RESOLUTION_CODES,
  ALERT_STATES,
  ALERT_CATEGORIES,
  ALERT_TYPE_GROUPS,
} = require('./notification-taxonomy.js');
const {
  EXPECTATION_LOOKBACK_DAYS,
  EVALUATION_DAYS_BACK,
  addDays,
  listEvaluationDates,
  getKigaliClock,
  buildOperationalAlertPlan,
} = require('./operational-alert-rules.js');
const defaultRepository = { ...operationalAlertRepository, ...notificationRepository };
const defaultAudit = require('./audit-service.js');

// Legacy constants kept for compatibility with existing callers and tests.
const LOW_COLLECTION_RATIO = 0.5;
const MIN_BASELINE_DAYS = 3;
const BASELINE_LOOKBACK_DAYS = 7;
const VALID_PRIORITIES = ['high', 'warning', 'info', 'success'];
const EVALUATION_ALERT_TYPES = [...OPERATIONAL_NOTIFICATION_TYPES];
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const normalizeCenter = (value) => typeof value === 'string' ? value.trim().slice(0, 100) || null : null;
const parseTime = (value) => {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
};
const isTimePast = (now, time) => now.getHours() * 60 + now.getMinutes() >= parseTime(time);
const countZeroVolumeRecords = (records) => records.filter((row) => Number(row.volume_morning || 0) + Number(row.volume_evening || 0) === 0).length;

/**
 * Legacy monitoring helper. Kept for backwards compatibility with earlier
 * evaluations; new operational alerts are derived from `evaluateOperationalAlerts`.
 */
const computeFarmerStatus = ({ farmer, record, historyRecords, currentTime, periods }) => {
  const now = currentTime.getHours() * 60 + currentTime.getMinutes();
  const morningStart = parseTime(periods.morning.start);
  const morningEnd = parseTime(periods.morning.end);
  const eveningStart = parseTime(periods.evening.start);
  const eveningEnd = parseTime(periods.evening.end);
  const currentPeriod = now >= morningStart && now < morningEnd ? 'morning' : now >= eveningStart && now < eveningEnd ? 'evening' : 'closed';
  let status = 'unknown';
  let reason = '';
  const morning = Number(record?.volume_morning || 0);
  const evening = Number(record?.volume_evening || 0);

  if (record && morning > 0 && evening > 0) {
    status = 'collected';
    reason = 'Both morning and evening records';
  } else if (record && (morning > 0 || evening > 0)) {
    status = 'collected';
    reason = 'Has collection record for today';
  } else if (currentPeriod === 'morning') {
    status = 'expected';
    reason = 'Morning collection period active';
  } else if (currentPeriod === 'evening') {
    status = 'expected_evening';
    reason = 'Evening collection period active';
  } else if (now >= morningEnd && now < eveningEnd) {
    if (record && morning === 0) {
      status = 'morning_missed';
      reason = 'Submitted zero volume for morning';
    } else if (!record && historyRecords.length === 0) {
      status = 'morning_missed';
      reason = 'Morning collection period ended without record (new farmer)';
    }
  } else if (now >= eveningEnd && !record) {
    status = 'missed_today';
    reason = 'No collection recorded for the day';
  }

  if (status === 'missed_today' || status === 'morning_missed') {
    const missedCount = countZeroVolumeRecords(historyRecords);
    if (missedCount >= 3) {
      status = 'repeatedly_missed';
      reason = `Missed ${missedCount} of last 7 expected days`;
    }
  }
  return {
    farmerId: farmer.id,
    farmerName: farmer.name,
    status,
    reason,
    hasRecord: Boolean(record),
    volumeMorning: record?.volume_morning || 0,
    volumeEvening: record?.volume_evening || 0,
    volumeTotal: record?.volume_liters || 0,
  };
};

const addNotification = async ({ repository, ownerUserId, type, title, message, center, date, period, priority, farmerId = null, details, dedupeKey }) => repository.upsertNotification({
  ownerUserId,
  type,
  title: String(title || '').replace(/\*\*/g, '').trim(),
  message: String(message || '').replace(/\*\*/g, '').trim(),
  farmerId,
  collectionCenter: center,
  collectionDate: date,
  period,
  priority,
  details: details || null,
  dedupeKey,
});

// Farmer create/update stays available as low-priority activity history. It is not
// operational intelligence and must never outrank action-required alerts.
const createFarmerChangedNotification = async ({ farmer, ownerUserId, action = 'created', repository = defaultRepository, now = new Date() }) => {
  const created = action === 'created';
  return addNotification({
    repository,
    ownerUserId: Number(ownerUserId),
    type: `farmer_${action}`,
    title: created ? 'Umworozi mushya yongewemo' : "Amakuru y'umworozi yavuguruwe",
    message: created
      ? `${farmer.name} yongewemo kandi ubu araboneka mu kwandika amata.`
      : `Amakuru ya ${farmer.name} yavuguruwe kandi azakoreshwa mu bikorwa bikurikira.`,
    farmerId: farmer.id,
    center: farmer.collectionCenter || farmer.location || null,
    date: formatDate(now),
    priority: 'success',
    details: { farmerId: farmer.id, farmerName: farmer.name, action, titleKey: created ? 'alertTypeFarmerCreated' : 'alertTypeFarmerUpdated', messageKey: created ? 'alertActivityFarmerCreated' : 'alertActivityFarmerUpdated', params: { farmer: farmer.name } },
  });
};

const serializeAlertDetails = (alert) => ({
  ...alert.details,
  titleKey: alert.titleKey,
  messageKey: alert.messageKey,
  nextActionKey: alert.nextActionKey,
  params: alert.params || {},
});

const alertContentChanged = (persisted, alert) => persisted.title !== alert.title || persisted.message !== alert.message;

const resolveCodeForAlert = (persisted, states) => {
  const type = String(persisted.notification_type || '');
  const date = persisted.collection_date ? String(persisted.collection_date).slice(0, 10) : null;
  const state = date && persisted.farmer_id ? states.get(`${Number(persisted.farmer_id)}|${date}|${persisted.period}`) : null;
  if (type === 'farmer_missed_delivery') return state?.delivery ? 'delivery_recorded' : 'issue_cleared';
  if (type === 'low_delivery') return state?.delivery && !state.low ? 'volume_corrected' : 'issue_cleared';
  return 'issue_cleared';
};

const emptyEvaluation = () => ({
  createdCount: 0,
  reopenedCount: 0,
  refreshedCount: 0,
  resolvedCount: 0,
  alertCount: 0,
  scope: null,
  date: null,
  skipped: false,
  notifications: [],
});

/**
 * Evaluate the operational alerts for one owner account. Safe to retry: alerts are
 * deduplicated per owner/type/farmer/center/date/session/reference, refreshed while
 * open, reopened only when a previous evaluation resolved them, and reconciled when
 * the underlying delivery data changes.
 */
const evaluateOperationalAlerts = async ({ ownerUserId, accountType = null, now = new Date(), repository = defaultRepository }) => {
  const userId = Number(ownerUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw badRequest('Invalid owner account.');
  const scopeRow = await repository.getAlertOwnerScope({ ownerUserId: userId });
  if (!scopeRow) return { ...emptyEvaluation(), reason: 'account_not_found' };
  if (scopeRow.accountStatus === 'suspended') return { ...emptyEvaluation(), reason: 'account_suspended' };
  const isCollector = (accountType === 'COLLECTOR' || accountType === 'COLLECTION_CENTER')
    ? accountType === 'COLLECTOR'
    : scopeRow.accountType === 'COLLECTOR';
  const dairyUserId = isCollector ? scopeRow.dairyUserId : null;

  const clock = getKigaliClock(now);
  const evaluationDates = listEvaluationDates({ today: clock.date, daysBack: EVALUATION_DAYS_BACK });
  const historyStart = addDays(clock.date, -EXPECTATION_LOOKBACK_DAYS);
  const centers = await repository.getCollectionCenters({ ownerUserId: userId });
  const farmers = await repository.getAlertFarmers({ ownerUserId: userId, dairyUserId });
  const records = await repository.getAlertMilkRecords({ ownerUserId: userId, dairyUserId, startDate: historyStart, endDate: clock.date });
  const plan = buildOperationalAlertPlan({
    scope: { isCollector, ownerUserId: userId },
    farmers,
    records,
    centers,
    clock,
    evaluationDates,
    historyStart,
  });

  const existing = await repository.getAlertsForEvaluation({
    ownerUserId: userId,
    types: EVALUATION_ALERT_TYPES,
    startDate: evaluationDates[0],
    endDate: clock.date,
  });
  const persistedByKey = new Map(existing.map((row) => [row.dedupe_key, row]));
  const created = [];
  const reopened = [];
  let refreshedCount = 0;

  for (const alert of plan.alerts) {
    const persisted = persistedByKey.get(alert.dedupeKey);
    if (!persisted) {
      const result = await repository.upsertOperationalAlert({ ownerUserId: userId, ...alert, details: serializeAlertDetails(alert) });
      if (result.created) created.push(result.notification);
      else if (result.reopened) reopened.push(result.notification);
      continue;
    }
    if (persisted.status === 'resolved' && persisted.resolved_by === null) {
      const result = await repository.upsertOperationalAlert({ ownerUserId: userId, ...alert, details: serializeAlertDetails(alert) });
      if (result.reopened) reopened.push(result.notification);
      continue;
    }
    if (persisted.status === 'open' && persisted.resolved_by === null && alertContentChanged(persisted, alert)) {
      const updated = await repository.refreshOperationalAlert({
        id: persisted.id,
        ownerUserId: userId,
        title: alert.title,
        message: alert.message,
        details: serializeAlertDetails(alert),
      });
      if (updated) refreshedCount += 1;
    }
  }

  const idsByResolution = new Map();
  for (const row of existing) {
    if (row.status !== 'open') continue;
    if (plan.desired.has(row.dedupe_key)) continue;
    const code = resolveCodeForAlert(row, plan.states);
    if (!idsByResolution.has(code)) idsByResolution.set(code, []);
    idsByResolution.get(code).push(row.id);
  }
  const resolved = [];
  for (const [code, ids] of idsByResolution.entries()) {
    const rows = await repository.resolveOperationalAlerts({ ownerUserId: userId, ids, resolutionCode: code, now });
    resolved.push(...rows);
  }

  return {
    createdCount: created.length,
    reopenedCount: reopened.length,
    refreshedCount,
    resolvedCount: resolved.length,
    alertCount: plan.alerts.length,
    scope: isCollector ? 'COLLECTOR' : 'COLLECTION_CENTER',
    date: clock.date,
    rangeStart: evaluationDates[0],
    skipped: false,
    notifications: created,
    alerts: plan.alerts,
  };
};

// The notification API evaluates the same operational rules that replaced the
// original morning/evening group alerts.
const evaluateNotifications = evaluateOperationalAlerts;

const writeResolutionAudit = async ({ audit, action, notification, actorId, ownerUserId, details }) => {
  try {
    await audit.createAuditLog({
      entityType: 'notification',
      entityId: notification.id,
      action,
      details: {
        notificationType: notification.notification_type,
        farmerId: notification.farmer_id ?? null,
        collectionDate: notification.collection_date ?? null,
        period: notification.period ?? null,
        ...details,
      },
      actorId: Number(actorId),
      ownerUserId: Number(ownerUserId),
    });
  } catch (error) {
    console.error('[notifications] Resolution audit failed.', { code: error.code || null });
  }
};

const parseNotificationId = (id) => {
  const notificationId = Number(id);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) throw badRequest('Invalid notification ID.');
  return notificationId;
};

const resolveNotification = async ({
  id, ownerUserId, actorId = ownerUserId, resolutionCode, note = '', now = new Date(),
  repository = defaultRepository, audit = defaultAudit,
}) => {
  const notificationId = parseNotificationId(id);
  const code = String(resolutionCode || '').trim();
  if (!MANUAL_RESOLUTION_CODES.includes(code)) throw badRequest('Invalid resolution reason.');
  const trimmedNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const notification = await repository.resolveNotification({
    id: notificationId,
    ownerUserId: Number(ownerUserId),
    actorId: Number(actorId),
    resolutionCode: code,
    note: trimmedNote || null,
    now,
  });
  if (!notification) {
    const existing = await repository.getNotificationById({ id: notificationId, ownerUserId: Number(ownerUserId) });
    if (!existing) throw Object.assign(new Error('Notification not found.'), { statusCode: 404 });
    return { notification: existing, changed: false };
  }
  await writeResolutionAudit({ audit, action: 'resolved', notification, actorId, ownerUserId, details: { resolutionCode: code, note: trimmedNote || null } });
  return { notification, changed: true };
};

const reopenNotification = async ({ id, ownerUserId, actorId = ownerUserId, now = new Date(), repository = defaultRepository, audit = defaultAudit }) => {
  const notificationId = parseNotificationId(id);
  const notification = await repository.reopenNotification({ id: notificationId, ownerUserId: Number(ownerUserId), now });
  if (!notification) {
    const existing = await repository.getNotificationById({ id: notificationId, ownerUserId: Number(ownerUserId) });
    if (!existing) throw Object.assign(new Error('Notification not found.'), { statusCode: 404 });
    return { notification: existing, changed: false };
  }
  await writeResolutionAudit({ audit, action: 'reopened', notification, actorId, ownerUserId, details: {} });
  return { notification, changed: true };
};

const normalizeLimit = (limit) => {
  const value = limit === undefined || limit === null || limit === '' ? 50 : Number(limit);
  if (!Number.isInteger(value) || value < 1 || value > 100) throw badRequest('limit must be an integer between 1 and 100.');
  return value;
};

const getNotifications = async ({
  ownerUserId, center, status, priority, type, search,
  state, category, alertGroup, sortBy, sortDirection, limit,
  repository = defaultRepository,
}) => {
  if (status && !['read', 'unread'].includes(status)) throw badRequest('Invalid notification status.');
  if (priority && !VALID_PRIORITIES.includes(priority)) throw badRequest('Invalid notification priority.');
  if (type && (typeof type !== 'string' || type.length > 100)) throw badRequest('Invalid notification type.');
  const parsedSortBy = sortBy || 'date';
  const parsedSortDirection = String(sortDirection || 'desc').toLowerCase();
  if (!['date', 'type'].includes(parsedSortBy)) throw badRequest('Unsupported notification sort field.');
  if (!['asc', 'desc'].includes(parsedSortDirection)) throw badRequest('sortDirection must be asc or desc.');
  if (state && !ALERT_STATES.includes(String(state))) throw badRequest('Invalid notification state.');
  if (category && !ALERT_CATEGORIES.includes(String(category))) throw badRequest('Invalid notification category.');
  if (alertGroup && !Object.keys(ALERT_TYPE_GROUPS).includes(String(alertGroup))) throw badRequest('Invalid notification group.');
  return repository.getNotifications({
    ownerUserId: Number(ownerUserId),
    center: normalizeCenter(center),
    status: status || null,
    priority: priority || null,
    type: type || null,
    state: state && state !== 'all' ? String(state) : null,
    category: category && category !== 'all' ? String(category) : null,
    alertGroup: alertGroup || null,
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    sortBy: parsedSortBy,
    sortDirection: parsedSortDirection,
    limit: normalizeLimit(limit),
  });
};

const getPaymentNotifications = async ({ ownerUserId, status, priority, limit, repository = defaultRepository }) => {
  if (priority && !VALID_PRIORITIES.includes(priority)) throw badRequest('Invalid notification priority.');
  return repository.getNotifications({ ownerUserId: Number(ownerUserId), status: status ? 'unread' : null, priority: priority || null, limit: normalizeLimit(limit), typePrefix: 'payment_' });
};

const getUnreadCount = async ({ ownerUserId, center, repository = defaultRepository }) => repository.getUnreadCount({ ownerUserId: Number(ownerUserId), center: normalizeCenter(center) });

const markNotificationRead = async ({ id, ownerUserId, repository = defaultRepository }) => {
  const notificationId = parseNotificationId(id);
  return repository.markNotificationRead({ id: notificationId, ownerUserId: Number(ownerUserId) });
};

const markAllRead = async ({ ownerUserId, center, repository = defaultRepository }) => repository.markAllRead({ ownerUserId: Number(ownerUserId), center: normalizeCenter(center) });

module.exports = {
  LOW_COLLECTION_RATIO,
  MIN_BASELINE_DAYS,
  BASELINE_LOOKBACK_DAYS,
  EXPECTATION_LOOKBACK_DAYS,
  EVALUATION_DAYS_BACK,
  EVALUATION_ALERT_TYPES,
  MANUAL_RESOLUTION_CODES,
  formatDate,
  normalizeCenter,
  computeFarmerStatus,
  createFarmerChangedNotification,
  evaluateNotifications,
  evaluateOperationalAlerts,
  resolveNotification,
  reopenNotification,
  getNotifications,
  getPaymentNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
};
