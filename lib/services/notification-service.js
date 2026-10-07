const defaultRepository = require('../repositories/notificationRepository.js');
const { isIsoDate } = require('./milk-service.js');

const LOW_COLLECTION_RATIO = 0.5;
const MIN_BASELINE_DAYS = 3;
const BASELINE_LOOKBACK_DAYS = 7;
const VALID_PRIORITIES = ['high', 'warning', 'info', 'success'];
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const normalizeCenter = (value) => typeof value === 'string' ? value.trim().slice(0, 100) || null : null;
const parseTime = (value) => {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
};
const isTimePast = (now, time) => now.getHours() * 60 + now.getMinutes() >= parseTime(time);
const countZeroVolumeRecords = (records) => records.filter((row) => Number(row.volume_morning || 0) + Number(row.volume_evening || 0) === 0).length;

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
    details: { farmerId: farmer.id, farmerName: farmer.name, action },
  });
};

const evaluateNotifications = async ({ ownerUserId, center, now = new Date(), repository = defaultRepository }) => {
  const selectedCenter = normalizeCenter(center);
  const centers = await repository.getCollectionCenters({ ownerUserId: Number(ownerUserId), center: selectedCenter });
  const createdNotifications = [];
  const currentDate = formatDate(now);
  const defaults = { morning: { start: '06:30', end: '09:00' }, evening: { start: '17:30', end: '19:00' } };

  for (const centerRecord of centers) {
    const centerName = centerRecord.name;
    const periods = {
      morning: { start: String(centerRecord.morning_start || defaults.morning.start).slice(0, 5), end: String(centerRecord.morning_end || defaults.morning.end).slice(0, 5) },
      evening: { start: String(centerRecord.evening_start || defaults.evening.start).slice(0, 5), end: String(centerRecord.evening_end || defaults.evening.end).slice(0, 5) },
    };
    const morningEnded = isTimePast(now, periods.morning.end);
    const eveningEnded = isTimePast(now, periods.evening.end);
    const morningWindow = morningEnded && !isTimePast(now, periods.evening.start);
    const today = new Date(`${currentDate}T00:00:00`);
    const historyStart = new Date(today);
    historyStart.setDate(historyStart.getDate() - BASELINE_LOOKBACK_DAYS);
    const snapshot = await repository.getCenterSnapshot({ ownerUserId: Number(ownerUserId), centerName, startDate: formatDate(historyStart), endDate: currentDate });
    const todayByFarmer = new Map();
    const historyByFarmer = new Map();
    for (const row of snapshot.records) {
      const date = String(row.date).slice(0, 10);
      if (date === currentDate) todayByFarmer.set(Number(row.farmer_id), row);
      const farmerId = Number(row.farmer_id);
      if (!historyByFarmer.has(farmerId)) historyByFarmer.set(farmerId, []);
      historyByFarmer.get(farmerId).push(row);
    }
    const statuses = { collected: [], expected: [], morning_missed: [], expected_evening: [], missed_today: [], repeatedly_missed: [] };
    for (const farmer of snapshot.farmers) {
      const status = computeFarmerStatus({
        farmer,
        record: todayByFarmer.get(Number(farmer.id)) || null,
        historyRecords: historyByFarmer.get(Number(farmer.id)) || [],
        currentTime: now,
        periods,
      });
      statuses[status.status]?.push(status);
    }
    const farmersExist = snapshot.farmers.length > 0;
    const made = async (input) => {
      const result = await addNotification({ repository, ownerUserId: Number(ownerUserId), center: centerName, date: currentDate, ...input });
      if (result.created) createdNotifications.push(result.notification);
      return result;
    };

    for (const farmer of statuses.repeatedly_missed) {
      await made({
        type: 'repeatedly_missed',
        title: 'Umworozi akeneye gukurikiranwa',
        message: `Umworozi ${farmer.farmerName} amaze iminsi 3 muri 7 adatanga amata.`,
        farmerId: farmer.farmerId,
        period: 'repeatedly_missed',
        priority: 'high',
        details: { farmerId: farmer.farmerId, farmerName: farmer.farmerName },
      });
    }

    const absenceGroup = async (missedFarmers, period, type, title, message, individualType, periodLabel) => {
      if (!missedFarmers.length) return;
      await made({
        type, title, message, period, priority: 'warning',
        details: { farmerIds: missedFarmers.map((farmer) => farmer.farmerId), farmerNames: missedFarmers.map((farmer) => farmer.farmerName) },
      });
      for (const farmer of missedFarmers) {
        await made({
          type: individualType,
          title: 'Umworozi ntiyatanze amata',
          message: `${farmer.farmerName} — No. ${farmer.farmerId} — ${centerName}\nNtabwo yatanze amata. Igihe: ${periodLabel}`,
          farmerId: farmer.farmerId,
          period,
          priority: 'warning',
          details: { farmerId: farmer.farmerId, farmerName: farmer.farmerName, center: centerName, period },
        });
      }
    };
    if (morningWindow) {
      await absenceGroup(statuses.morning_missed, 'morning', 'morning_missed', 'Aborozi batatanze amata ya mugitondo',
        `Aborozi ${statuses.morning_missed.length} ntibatanze amata ya mugitondo uyu munsi.`, 'farmer_morning_missed', 'Mu gitondo');
    }
    if (eveningEnded) {
      await absenceGroup(statuses.missed_today, 'evening', 'evening_missed', 'Aborozi batatanze amata nimugoroba',
        `Aborozi ${statuses.missed_today.length} ntibatanze amata nimugoroba uyu munsi.`, 'farmer_evening_missed', 'Nimugoroba');
    }

    const allStatuses = Object.values(statuses).flat();
    const morningTotal = allStatuses.reduce((sum, row) => sum + Number(row.volumeMorning || 0), 0);
    const eveningTotal = allStatuses.reduce((sum, row) => sum + Number(row.volumeEvening || 0), 0);
    const historyRows = await repository.getCenterPeriodHistory({
      ownerUserId: Number(ownerUserId),
      centerName,
      startDate: formatDate(historyStart),
      endDate: currentDate,
    });
    const addLowCollection = async (period, volume) => {
      if (!volume || volume <= 0) return;
      const relevant = historyRows.filter((row) => Number(row[period]) > 0);
      if (relevant.length < MIN_BASELINE_DAYS) return;
      const average = relevant.reduce((sum, row) => sum + Number(row[period]), 0) / relevant.length;
      if (volume > average * LOW_COLLECTION_RATIO) return;
      const periodLabel = period === 'morning' ? 'Mu gitondo' : 'Nimugoroba';
      const roundedToday = Math.round(volume * 10) / 10;
      const roundedAverage = Math.round(average * 10) / 10;
      await made({
        type: 'low_collection',
        title: "Ikusanya ry'amata riri hasi",
        message: `${centerName} — ${periodLabel}\nAmata yanditswe: ${roundedToday} L (bisanzwe: ${roundedAverage} L).`,
        period,
        priority: 'warning',
        details: { center: centerName, period, todayVolume: roundedToday, averageVolume: roundedAverage, baselineDays: relevant.length },
      });
    };
    if (morningWindow) await addLowCollection('morning', morningTotal);
    if (eveningEnded) await addLowCollection('evening', eveningTotal);

    if (farmersExist && morningWindow && morningTotal === 0) {
      await made({ type: 'no_collection', title: 'Nta mata yakusanyijwe', message: `${centerName} — Mu gitondo\nNta mata yakusanyijwe mu gitondo.`, period: 'morning', priority: 'high', details: { center: centerName, period: 'morning' } });
    }
    if (farmersExist && eveningEnded && eveningTotal === 0) {
      const dayTotal = morningTotal + eveningTotal;
      await made({
        type: 'no_collection',
        title: 'Nta mata yakusanyijwe',
        message: dayTotal === 0 ? `${centerName} — Nimugoroba\nNta mata yakusanyijwe uyu munsi.` : `${centerName} — Nimugoroba\nNta mata yakusanyijwe mu gihe cya nimugoroba.`,
        period: 'evening',
        priority: 'high',
        details: { center: centerName, period: 'evening', dayTotal },
      });
    }
  }
  return { createdCount: createdNotifications.length, notifications: createdNotifications, center: selectedCenter };
};

const normalizeLimit = (limit) => {
  const value = limit === undefined || limit === null || limit === '' ? 50 : Number(limit);
  if (!Number.isInteger(value) || value < 1 || value > 100) throw badRequest('limit must be an integer between 1 and 100.');
  return value;
};

const getNotifications = async ({ ownerUserId, center, status, priority, limit, repository = defaultRepository }) => {
  if (status && status !== 'unread') throw badRequest('Invalid notification status.');
  if (priority && !VALID_PRIORITIES.includes(priority)) throw badRequest('Invalid notification priority.');
  return repository.getNotifications({ ownerUserId: Number(ownerUserId), center: normalizeCenter(center), status: status || null, priority: priority || null, limit: normalizeLimit(limit) });
};

const getPaymentNotifications = async ({ ownerUserId, status, priority, limit, repository = defaultRepository }) => {
  if (priority && !VALID_PRIORITIES.includes(priority)) throw badRequest('Invalid notification priority.');
  return repository.getNotifications({ ownerUserId: Number(ownerUserId), status: status ? 'unread' : null, priority: priority || null, limit: normalizeLimit(limit), typePrefix: 'payment_' });
};

const getUnreadCount = async ({ ownerUserId, center, repository = defaultRepository }) => repository.getUnreadCount({ ownerUserId: Number(ownerUserId), center: normalizeCenter(center) });

const markNotificationRead = async ({ id, ownerUserId, repository = defaultRepository }) => {
  const notificationId = Number(id);
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) throw badRequest('Invalid notification ID.');
  return repository.markNotificationRead({ id: notificationId, ownerUserId: Number(ownerUserId) });
};

const markAllRead = async ({ ownerUserId, center, repository = defaultRepository }) => repository.markAllRead({ ownerUserId: Number(ownerUserId), center: normalizeCenter(center) });

module.exports = {
  LOW_COLLECTION_RATIO,
  MIN_BASELINE_DAYS,
  BASELINE_LOOKBACK_DAYS,
  formatDate,
  normalizeCenter,
  computeFarmerStatus,
  createFarmerChangedNotification,
  evaluateNotifications,
  getNotifications,
  getPaymentNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
};
