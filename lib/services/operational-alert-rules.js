// Pure operational-alert rules. No database access, no environment access.
// The evaluator loads data, then delegates every decision to this module so the
// business rules can be unit tested without a database.

const { ACCOUNTING_TIME_ZONE, getAccountingDate } = require('../utils/accounting-period.js');
const { buildAlertDedupeKey } = require('./notification-taxonomy.js');

const SESSIONS = ['morning', 'evening'];

// Session start/end times are read from each collection center's configured
// schedule (collection_centers.morning_start/end, evening_start/end). No
// collection clock time is hard-coded here: administrators configure session
// times per account and reminder evaluation follows those values automatically.

// Reminder policy: elapsed durations, not clock times. These are server-side
// policy values (not user-facing configuration) and are applied relative to the
// account-configured session schedule.
const COLLECTION_GRACE_PERIOD_MINUTES = 20;
// A farmer is expected to deliver in a session when they delivered valid milk in
// that same session at least once during this window.
const EXPECTATION_LOOKBACK_DAYS = 14;
// Lazy evaluation re-checks the current day plus this many previous days, so a
// missed session is still detected when the collector opens the app the next day.
const EVALUATION_DAYS_BACK = 2;
// Low-delivery baseline uses the farmer's own recent valid deliveries only.
const LOW_DELIVERY_BASELINE_DAYS = 7;
const MIN_LOW_DELIVERY_BASELINE_DAYS = 3;
const LOW_DELIVERY_RATIO = 0.5;
const LOW_COLLECTION_RATIO = 0.5;
const MIN_LOW_COLLECTION_BASELINE_DAYS = 3;
// Rapid-increase and reconciliation alerts use complete days and a stable
// baseline so a single unusual record does not create noise.
const SPIKE_BASELINE_DAYS = 7;
const MIN_SPIKE_BASELINE_DAYS = 3;
const FARMER_SPIKE_RATIO = 1.75;
const MIN_FARMER_SPIKE_LITERS = 10;
const COLLECTION_SPIKE_RATIO = 1.75;
const MIN_COLLECTION_SPIKE_LITERS = 20;
const DIFFERENCE_DROP_RATIO = 0.5;
const MIN_DIFFERENCE_LITERS = 5;

const SESSION_TITLES = { morning: 'Mu gitondo', evening: 'Nimugoroba' };

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const addDays = (dateIso, days) => {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const daysBefore = (dateIso, days) => {
  const dates = [];
  for (let offset = days; offset >= 1; offset -= 1) dates.push(addDays(dateIso, -offset));
  return dates;
};

const listEvaluationDates = ({ today, daysBack = EVALUATION_DAYS_BACK }) => {
  const dates = [];
  for (let offset = daysBack; offset >= 0; offset -= 1) dates.push(addDays(today, -offset));
  return dates;
};

const getKigaliClock = (now = new Date()) => {
  const date = getAccountingDate(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ACCOUNTING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { date, minutes: value('hour') * 60 + value('minute') };
};

const minutesFromTime = (value, fallback) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
};

const getCenterPeriods = (center) => ({
  morning: {
    start: minutesFromTime(center?.morning_start, 0),
    end: minutesFromTime(center?.morning_end, 0),
  },
  evening: {
    start: minutesFromTime(center?.evening_start, 0),
    end: minutesFromTime(center?.evening_end, 0),
  },
});

const isSessionComplete = ({ date, today, minutes, period, periods }) => {
  if (date < today) return true;
  if (date > today) return false;
  return minutes >= periods[period].end;
};

const isDayComplete = ({ date, today, minutes, periods }) => date < today
  || (date === today && minutes >= periods.evening.end);

// True only for the current collection date while a session is in its
// reminder window: the session has started, the grace period has elapsed, and
// the session has not yet ended. Times are read from the account-configured
// session schedule, never from hard-coded clock times.
const isInReminderWindow = ({ date, today, minutes, period, periods }) => {
  if (date !== today) return false;
  const start = Number(periods[period]?.start || 0);
  const end = Number(periods[period]?.end || 0);
  if (!start || !end || end <= start) return false;
  return minutes >= start + COLLECTION_GRACE_PERIOD_MINUTES && minutes < end;
};

const buildDeliveryIndex = (rows = []) => {
  const index = new Map();
  for (const row of rows) {
    const farmerId = Number(row.farmerId ?? row.farmer_id);
    if (!Number.isSafeInteger(farmerId) || farmerId <= 0) continue;
    const date = String(row.date).slice(0, 10);
    const morning = Math.max(0, Number(row.morning ?? row.valid_volume_morning ?? 0) || 0);
    const evening = Math.max(0, Number(row.evening ?? row.valid_volume_evening ?? 0) || 0);
    if (!index.has(farmerId)) index.set(farmerId, new Map());
    index.get(farmerId).set(date, { morning, evening });
  }
  return index;
};

const getDayVolume = (history, date, period) => Number(history.get(date)?.[period] || 0);

const getBaselineVolumes = (history, date, period, days = LOW_DELIVERY_BASELINE_DAYS) => daysBefore(date, days)
  .map((baselineDate) => getDayVolume(history, baselineDate, period))
  .filter((volume) => volume > 0);

const hasSessionExpectation = (history, date, period, lookback = EXPECTATION_LOOKBACK_DAYS) => daysBefore(date, lookback)
  .some((historyDate) => getDayVolume(history, historyDate, period) > 0);

const getLastDeliveryDate = (history, beforeDate = null) => {
  const dates = [...history.entries()]
    .filter(([date, volumes]) => (!beforeDate || date < beforeDate) && (volumes.morning > 0 || volumes.evening > 0))
    .map(([date]) => date)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
};

const roundLiters = (value) => Math.round(Number(value || 0) * 10) / 10;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sessionTitle = (period) => SESSION_TITLES[period] || period;

const farmerDisplay = (farmer) => ({
  farmerId: Number(farmer.id),
  farmerName: farmer.name,
  farmerNumber: farmer.accountNumber || farmer.account_number || `#${farmer.id}`,
  center: farmer.centerName || null,
  collectorId: farmer.collectorUserId ? Number(farmer.collectorUserId) : null,
  collectorName: farmer.collectorName || null,
});

const buildMissedFarmerAlert = ({ farmer, date, period, lastDeliveryDate }) => {
  const display = farmerDisplay(farmer);
  return {
    type: 'farmer_missed_delivery',
    priority: 'warning',
    farmerId: display.farmerId,
    center: display.center,
    date,
    period,
    reference: null,
    title: 'Nta mata yanditswe ku mworozi',
    titleKey: 'alertTitleMissedDeliveryFarmer',
    messageKey: 'alertMessageMissedDeliveryFarmer',
    nextActionKey: 'alertNextVerifyDelivery',
    params: {
      farmer: display.farmerName,
      number: display.farmerNumber,
      session: sessionTitle(period),
    },
    message: `${display.farmerName} (${display.farmerNumber}) nta mata yanditswe muri iki gihembwe cyo kwakira amata (${sessionTitle(period)}). Reba niba yatanze amata cyangwa wandike impamvu.`,
    details: {
      evidence: 'no_recorded_delivery',
      ...display,
      period,
      lastDeliveryDate: lastDeliveryDate || null,
    },
  };
};

const buildLowDeliveryAlert = ({ farmer, date, period, volume, average, baselineDays, lastDeliveryDate }) => {
  const display = farmerDisplay(farmer);
  const roundedVolume = roundLiters(volume);
  const roundedAverage = roundLiters(average);
  return {
    type: 'low_delivery',
    priority: 'warning',
    farmerId: display.farmerId,
    center: display.center,
    date,
    period,
    reference: null,
    title: "Amata make ugereranyije n'ibisanzwe",
    titleKey: 'alertTitleLowDelivery',
    messageKey: 'alertMessageLowDelivery',
    nextActionKey: 'alertNextReviewVolume',
    params: {
      farmer: display.farmerName,
      number: display.farmerNumber,
      session: sessionTitle(period),
      volume: roundedVolume,
      average: roundedAverage,
      days: baselineDays,
    },
    message: `${display.farmerName}: amata y'iki gihembwe ni ${roundedVolume} L, ugereranyije n'ibisanzwe ${roundedAverage} L (iminsi ${baselineDays}).`,
    details: {
      evidence: 'below_own_average',
      ...display,
      period,
      volume: roundedVolume,
      average: roundedAverage,
      baselineDays,
      lastDeliveryDate: lastDeliveryDate || null,
    },
  };
};

const buildMissedSummaryAlert = ({ centerName, date, period, farmerIds, lastDeliveryDates, farmerNames = [] }) => {
  const count = farmerIds.length;
  const sessionText = period === 'morning' ? "mu gitondo cy'uyu munsi" : "nimugoroba w'uyu munsi";
  const namesText = farmerNames && farmerNames.length > 0 ? ` (${farmerNames.join(', ')})` : '';
  return {
    type: 'missed_delivery',
    priority: 'warning',
    farmerId: null,
    center: centerName,
    date,
    period,
    reference: 'summary',
    title: 'Aborozi batatanze amata muri iki gihembwe',
    titleKey: 'alertTitleMissedDelivery',
    messageKey: 'alertMessageMissedDelivery',
    nextActionKey: 'alertNextReviewCollection',
    params: { count, center: centerName, session: sessionTitle(period) },
    message: `Aborozi ${count} ntibatanze amata ${sessionText}${namesText}.`,
    details: {
      evidence: 'no_recorded_delivery',
      count,
      center: centerName,
      period,
      farmerIds,
      farmerNames,
      lastDeliveryDates,
    },
  };
};

const buildMissingCenterAlert = ({ farmer, lastDeliveryDate }) => {
  const display = farmerDisplay(farmer);
  return {
    type: 'farmer_missing_center',
    priority: 'high',
    farmerId: display.farmerId,
    center: null,
    date: null,
    period: null,
    reference: 'missing_center',
    title: "Umworozi nta kigo cy'ikusanyirizo kibonetse afite",
    titleKey: 'alertTitleMissingCenter',
    messageKey: 'alertMessageMissingCenter',
    nextActionKey: 'alertNextAssignCenter',
    params: { farmer: display.farmerName, number: display.farmerNumber },
    message: `${display.farmerName} nta kigo cy'ikusanyirizo kibonetse afite; nta mata ashobora kwandikwa. Huza umworozi n'ikigo.`,
    details: {
      evidence: 'missing_configuration',
      ...display,
      lastDeliveryDate: lastDeliveryDate || null,
    },
  };
};

const buildMissingCollectorAlert = ({ farmer, lastDeliveryDate, reason }) => {
  const display = farmerDisplay(farmer);
  return {
    type: 'farmer_missing_collector',
    priority: 'high',
    farmerId: display.farmerId,
    center: display.center,
    date: null,
    period: null,
    reference: reason,
    title: 'Umworozi nta mucunda wemejwe afite',
    titleKey: 'alertTitleMissingCollector',
    messageKey: 'alertMessageMissingCollector',
    nextActionKey: 'alertNextAssignCollector',
    params: { farmer: display.farmerName, number: display.farmerNumber, collector: display.collectorName || '' },
    message: `${display.farmerName} nta mucunda wemejwe ufite; nta mata ashobora kwandikwa. Haza umucunda wemejwe kuri uyu mworozi.`,
    details: {
      evidence: 'missing_configuration',
      reason,
      ...display,
      lastDeliveryDate: lastDeliveryDate || null,
    },
  };
};

const buildNoCollectionAlert = ({ centerName, date, period }) => ({
  type: 'no_collection',
  priority: 'high',
  farmerId: null,
  center: centerName,
  date,
  period,
  reference: null,
  title: 'Nta mata yakusanyijwe',
  titleKey: 'alertTitleNoCollection',
  messageKey: 'alertMessageNoCollection',
  nextActionKey: 'alertNextReviewCollection',
  params: { center: centerName, session: sessionTitle(period) },
  message: `${centerName}: nta mata yakusanyijwe muri iki gihembwe (${sessionTitle(period)}).`,
  details: { evidence: 'zero_collection', center: centerName, period },
});

const buildLowCollectionAlert = ({ centerName, date, period, volume, average, baselineDays }) => ({
  type: 'low_collection',
  priority: 'warning',
  farmerId: null,
  center: centerName,
  date,
  period,
  reference: null,
  title: "Ikusanya ry'amata riri hasi",
  titleKey: 'alertTitleLowCollection',
  messageKey: 'alertMessageLowCollection',
  nextActionKey: 'alertNextReviewCollection',
  params: { center: centerName, session: sessionTitle(period), volume: roundLiters(volume), average: roundLiters(average), days: baselineDays },
  message: `${centerName}: amata yakusanyijwe ni ${roundLiters(volume)} L, ugereranyije n'ibisanzwe ${roundLiters(average)} L (iminsi ${baselineDays}).`,
  details: { evidence: 'below_recent_average', center: centerName, period, volume: roundLiters(volume), average: roundLiters(average), baselineDays },
});

const buildFarmerMilkMissingAlert = ({ farmer, date, period }) => {
  const display = farmerDisplay(farmer);
  const sessionText = period === 'morning' ? "uyu munsi mu gitondo" : "uyu munsi nimugoroba";
  return {
    type: 'farmer_milk_missing',
    priority: 'warning',
    farmerId: display.farmerId,
    center: display.center,
    date,
    period,
    reference: null,
    title: 'Nta mata yanditswe ku mworozi',
    titleKey: 'alertTitleFarmerMilkMissing',
    messageKey: 'alertMessageFarmerMilkMissing',
    nextActionKey: 'alertNextRecordMilk',
    params: {
      farmer: display.farmerName,
      number: display.farmerNumber,
      session: sessionTitle(period),
    },
    message: `${display.farmerName} (${display.farmerNumber}): Nta mata yanditswe ${sessionText}. Niba yakiriwe, yandike muri sisitemu.`,
    details: {
      evidence: 'no_record_for_session',
      ...display,
      period,
      session: sessionTitle(period),
    },
  };
};

const buildNoFarmerMilkAlert = ({ centerName, date, period }) => {
  const sessionText = period === 'morning' ? "mu gitondo cy'uyu munsi" : "nimugoroba w'uyu munsi";
  return {
    type: 'no_farmer_milk_recorded',
    priority: 'high',
    farmerId: null,
    center: centerName,
    date,
    period,
    reference: null,
    title: `Byihutirwa: Nta mata yanditswe ${sessionText}`,
    titleKey: 'alertTitleNoFarmerMilk',
    messageKey: 'alertMessageNoFarmerMilk',
    nextActionKey: 'alertNextReviewCollection',
    params: { center: centerName, session: sessionTitle(period) },
    message: `Nta mata y'aborozi yanditswe muri iyi gahunda. Niba hari amata yakiriwe, yandike muri sisitemu.`,
    details: { evidence: 'zero_session_collection', center: centerName, period, session: sessionTitle(period) },
  };
};

const buildOwnerMilkMissingAlert = ({ date, period }) => {
  const sessionText = period === 'morning' ? "mu gitondo cy'uyu munsi" : "nimugoroba w'uyu munsi";
  return {
    type: 'owner_milk_missing',
    priority: 'warning',
    farmerId: null,
    center: null,
    date,
    period,
    reference: 'owner_milk',
    title: 'Amata y’umukoresha nta yanditswe uyu munsi',
    titleKey: 'alertTitleOwnerMilkMissing',
    messageKey: 'alertMessageOwnerMilkMissing',
    nextActionKey: 'alertNextRecordMilk',
    params: { session: sessionTitle(period) },
    message: `Amata y’umukoresha nta yanditswe ${sessionText}. Niba yakiriwe, yandike muri sisitemu.`,
    details: { evidence: 'no_owner_milk_for_session', period, session: sessionTitle(period) },
  };
};

const buildFarmerMilkSpikeAlert = ({ farmer, date, volume, average, baselineDays, increasePercent }) => {
  const display = farmerDisplay(farmer);
  const roundedVolume = roundLiters(volume);
  const roundedAverage = roundLiters(average);
  return {
    type: 'farmer_milk_spike',
    priority: increasePercent >= 150 ? 'high' : 'warning',
    farmerId: display.farmerId,
    center: display.center,
    date,
    period: null,
    reference: null,
    title: "Amata y'umworozi yazamutse cyane",
    titleKey: 'alertTitleFarmerMilkSpike',
    messageKey: 'alertMessageFarmerMilkSpike',
    nextActionKey: 'alertNextReviewVolume',
    params: {
      farmer: display.farmerName,
      number: display.farmerNumber,
      volume: roundedVolume,
      average: roundedAverage,
      days: baselineDays,
      percent: increasePercent,
    },
    message: `${display.farmerName}: amata y'umunsi ni ${roundedVolume} L, ugereranyije n'impuzandengo ya ${roundedAverage} L (iminsi ${baselineDays}). Ongera ugenzure iyi nyandiko.`,
    details: {
      evidence: 'above_own_average',
      ...display,
      volume: roundedVolume,
      average: roundedAverage,
      baselineDays,
      increasePercent,
    },
  };
};

const buildCollectionMilkSpikeAlert = ({ centerName, date, volume, average, baselineDays, increasePercent }) => ({
  type: 'collection_milk_spike',
  priority: increasePercent >= 150 ? 'high' : 'warning',
  farmerId: null,
  center: centerName,
  date,
  period: null,
  reference: null,
  title: "Ikusanya ry'amata ryazamutse cyane",
  titleKey: 'alertTitleCollectionMilkSpike',
  messageKey: 'alertMessageCollectionMilkSpike',
  nextActionKey: 'alertNextReviewCollection',
  params: {
    center: centerName,
    volume: roundLiters(volume),
    average: roundLiters(average),
    days: baselineDays,
    percent: increasePercent,
  },
  message: `${centerName}: amata yakusanyijwe y'umunsi ni ${roundLiters(volume)} L, ugereranyije n'impuzandengo ya ${roundLiters(average)} L (iminsi ${baselineDays}). Ongera ugenzure iyi nyandiko.`,
  details: {
    evidence: 'above_recent_average',
    center: centerName,
    volume: roundLiters(volume),
    average: roundLiters(average),
    baselineDays,
    increasePercent,
  },
});

const buildOwnerFarmerDifferenceDropAlert = ({ date, ownerVolume, farmerVolume, difference, averageDifference, baselineDays, centerName }) => ({
  type: 'owner_farmer_difference_drop',
  priority: 'warning',
  farmerId: null,
  center: centerName || null,
  date,
  period: null,
  reference: null,
  title: "Itandukaniro ry'amata y'umukoresha n'ay'aborozi ryagabanutse",
  titleKey: 'alertTitleOwnerFarmerDifferenceDrop',
  messageKey: 'alertMessageOwnerFarmerDifferenceDrop',
  nextActionKey: 'alertNextReviewMilkDifference',
  params: {
    center: centerName || '',
    ownerVolume: roundLiters(ownerVolume),
    farmerVolume: roundLiters(farmerVolume),
    difference: roundLiters(difference),
    average: roundLiters(averageDifference),
    days: baselineDays,
  },
  message: `Itandukaniro ry'amata y'umukoresha n'ay'aborozi ni ${roundLiters(difference)} L, ugereranyije n'impuzandengo ya ${roundLiters(averageDifference)} L (iminsi ${baselineDays}). Ongera ugenzure inyandiko z'umunsi.`,
  details: {
    evidence: 'difference_below_recent_average',
    center: centerName || null,
    ownerVolume: roundLiters(ownerVolume),
    farmerVolume: roundLiters(farmerVolume),
    difference: roundLiters(difference),
    averageDifference: roundLiters(averageDifference),
    baselineDays,
  },
});

/**
 * Build the operational alert plan for one authorized owner scope.
 *
 * @param {object} input
 * @param {{ isCollector: boolean, ownerUserId: number }} input.scope
 * @param {Array} input.farmers farmers in the authorized scope
 * @param {Array} input.records valid milk rows (farmerId, date, morning, evening)
 * @param {Array} input.ownerRecords valid owner-milk rows (date, volume)
 * @param {Array} input.centers collection center configuration rows
 * @param {{ date: string, minutes: number }} input.clock Kigali clock
 * @param {string[]} input.evaluationDates dates to evaluate (ascending)
 * @param {string} input.historyStart first date covered by `records`
 * @returns {{ alerts: Array, desired: Map<string, object>, states: Map<string, object> }}
 */
const buildOperationalAlertPlan = ({ scope, farmers = [], records = [], ownerRecords = [], centers = [], clock, evaluationDates, historyStart }) => {
  const deliveryIndex = buildDeliveryIndex(records);
  const centerByName = new Map(centers.map((center) => [normalizeName(center.name), center]));
  const alerts = [];
  const desired = new Map();
  const states = new Map();
  const missedByCenterDatePeriod = new Map();
  const expectedByCenterDatePeriod = new Map();
  const centerTotals = new Map();
  const today = clock.date;

  const push = (alert) => {
    alert.dedupeKey = buildAlertDedupeKey({
      type: alert.type,
      farmerId: alert.farmerId,
      center: alert.center,
      date: alert.date,
      period: alert.period,
      reference: alert.reference,
    });
    alerts.push(alert);
    desired.set(alert.dedupeKey, alert);
    return alert;
  };
  const stateKey = (farmerId, date, period) => `${farmerId}|${date}|${period}`;

  for (const farmer of farmers) {
    const farmerId = Number(farmer.id);
    const history = deliveryIndex.get(farmerId) || new Map();
    const center = centerByName.get(normalizeName(farmer.centerName)) || null;
    const periods = getCenterPeriods(center);
    const collectorAssigned = Boolean(farmer.collectorUserId)
      && (farmer.collectorActive === true || farmer.collectorActive === 'true');
    // A collector records their own farmers plus farmers actively assigned to them.
    // A collection center relies on the actively assigned collector.
    const recordable = scope.isCollector ? true : collectorAssigned;
    const lastDeliveryDate = getLastDeliveryDate(history);
    const recentDelivery = Boolean(lastDeliveryDate) && lastDeliveryDate >= addDays(today, -EXPECTATION_LOOKBACK_DAYS);

    // Standing data-quality issues only matter while the farmer was recently active;
    // new farmers without history are not turned into noise.
    if (recentDelivery) {
      if (!center) {
        push(buildMissingCenterAlert({ farmer, lastDeliveryDate }));
      } else if (!scope.isCollector && !collectorAssigned) {
        push(buildMissingCollectorAlert({
          farmer,
          lastDeliveryDate,
          reason: farmer.collectorUserId ? 'collector_inactive' : 'no_collector',
        }));
      }
    }

    if (!center || !recordable) continue;

    // Center-level totals cover every date present in the history window.
    for (const [date, volumes] of history.entries()) {
      if (date < historyStart || date > today) continue;
      for (const period of SESSIONS) {
        const volume = Number(volumes[period] || 0);
        if (volume <= 0) continue;
        const totalKey = `${normalizeName(center.name)}|${date}|${period}`;
        centerTotals.set(totalKey, (centerTotals.get(totalKey) || 0) + volume);
      }
    }

    for (const date of evaluationDates) {
      if (farmer.createdDate && String(farmer.createdDate).slice(0, 10) > date) continue;
      for (const period of SESSIONS) {
        if (!isSessionComplete({ date, today, minutes: clock.minutes, period, periods })) continue;
        const volume = getDayVolume(history, date, period);
        const expectation = hasSessionExpectation(history, date, period);
        const baseline = getBaselineVolumes(history, date, period);
        const averaged = baseline.length >= MIN_LOW_DELIVERY_BASELINE_DAYS ? mean(baseline) : null;
        const low = Boolean(averaged) && volume > 0 && volume <= LOW_DELIVERY_RATIO * averaged;
        states.set(stateKey(farmerId, date, period), {
          sessionComplete: true,
          delivery: volume > 0,
          expectation,
          low,
        });
        const expectedKey = `${normalizeName(center.name)}|${date}|${period}`;
        if (expectation) expectedByCenterDatePeriod.set(expectedKey, (expectedByCenterDatePeriod.get(expectedKey) || 0) + 1);
        if (expectation && volume === 0) {
          const alert = push(buildMissedFarmerAlert({ farmer, date, period, lastDeliveryDate: getLastDeliveryDate(history, date) }));
          const summaryKey = `${center.name}|${date}|${period}`;
          if (!missedByCenterDatePeriod.has(summaryKey)) {
            missedByCenterDatePeriod.set(summaryKey, { centerName: center.name, date, period, farmerIds: [], lastDeliveryDates: [], farmerNames: [] });
          }
          const summary = missedByCenterDatePeriod.get(summaryKey);
          summary.farmerIds.push(farmerId);
          if (farmer && farmer.name) summary.farmerNames.push(farmer.name);
          summary.lastDeliveryDates.push(alert.details.lastDeliveryDate);
          continue;
        }
        if (low) {
          push(buildLowDeliveryAlert({
            farmer,
            date,
            period,
            volume,
            average: averaged,
            baselineDays: baseline.length,
            lastDeliveryDate: getLastDeliveryDate(history, date),
          }));
        }
      }
    }
  }

  for (const { centerName, date, period, farmerIds, lastDeliveryDates, farmerNames } of missedByCenterDatePeriod.values()) {
    push(buildMissedSummaryAlert({ centerName, date, period, farmerIds, lastDeliveryDates, farmerNames }));
  }

  for (const center of centers) {
    const centerKey = normalizeName(center.name);
    const periods = getCenterPeriods(center);
    for (const date of evaluationDates) {
      for (const period of SESSIONS) {
        if (!isSessionComplete({ date, today, minutes: clock.minutes, period, periods })) continue;
        const expected = expectedByCenterDatePeriod.get(`${centerKey}|${date}|${period}`) || 0;
        if (expected === 0) continue;
        const total = centerTotals.get(`${centerKey}|${date}|${period}`) || 0;
        if (total === 0) {
          push(buildNoCollectionAlert({ centerName: center.name, date, period }));
          continue;
        }
        const baseline = daysBefore(date, LOW_DELIVERY_BASELINE_DAYS)
          .map((baselineDate) => centerTotals.get(`${centerKey}|${baselineDate}|${period}`) || 0)
          .filter((volume) => volume > 0);
        if (baseline.length >= MIN_LOW_COLLECTION_BASELINE_DAYS) {
          const average = mean(baseline);
          if (total <= LOW_COLLECTION_RATIO * average) {
            push(buildLowCollectionAlert({ centerName: center.name, date, period, volume: total, average, baselineDays: baseline.length }));
          }
        }
      }
    }
  }

  // During-session missing-milk-record reminders. Evaluated for the current
  // collection date only, and only while a session is in its reminder window
  // (started, grace period elapsed, not yet ended). These are early nudges that
  // resolve automatically when records arrive. They never assume a farmer is
  // absent or that a farmer produced zero litres, and they are separate from the
  // after-session missed-delivery alerts.

  const recordableFarmerByCenter = new Map();
  for (const farmer of farmers) {
    const center = centerByName.get(normalizeName(farmer.centerName)) || null;
    const collectorAssigned = Boolean(farmer.collectorUserId)
      && (farmer.collectorActive === true || farmer.collectorActive === 'true');
    const recordable = scope.isCollector ? true : collectorAssigned;
    if (!center || !recordable) continue;
    const centerKey = normalizeName(center.name);
    recordableFarmerByCenter.set(centerKey, (recordableFarmerByCenter.get(centerKey) || 0) + 1);

    const farmerId = Number(farmer.id);
    const history = deliveryIndex.get(farmerId) || new Map();
    if (farmer.createdDate && String(farmer.createdDate).slice(0, 10) > today) continue;
    const periods = getCenterPeriods(center);
    for (const period of SESSIONS) {
      if (!isInReminderWindow({ date: today, today, minutes: clock.minutes, period, periods })) continue;
      const volume = getDayVolume(history, today, period);
      if (volume > 0) continue;
      push(buildFarmerMilkMissingAlert({ farmer, date: today, period }));
    }
  }

  // Session-level reminder: no farmer milk recorded at all for the current
  // session, for each center that expects assigned farmers.
  for (const center of centers) {
    const centerKey = normalizeName(center.name);
    const expected = Number(recordableFarmerByCenter.get(centerKey) || 0);
    if (expected === 0) continue;
    const periods = getCenterPeriods(center);
    for (const period of SESSIONS) {
      if (!isInReminderWindow({ date: today, today, minutes: clock.minutes, period, periods })) continue;
      const total = centerTotals.get(`${centerKey}|${today}|${period}`) || 0;
      if (total === 0) {
        push(buildNoFarmerMilkAlert({ centerName: center.name, date: today, period }));
      }
    }
  }

  // Owner-milk missing reminder (independent of farmer reminders). Evaluated for
  // the current session only, using the account's configured session window.
  // Owner milk is recorded through the collector-only Owner Ifishi, so a
  // Collection Center account must not receive this reminder.
  if (scope.isCollector && centers.length > 0) {
    const ownerVolumeToday = ownerRecords
      .filter((row) => String(row.date || '').slice(0, 10) === today)
      .reduce((sum, row) => sum + Math.max(0, Number(row.volume ?? 0) || 0), 0);
    if (ownerVolumeToday === 0) {
      const periods = getCenterPeriods(centers[0]);
      for (const period of SESSIONS) {
        if (!isInReminderWindow({ date: today, today, minutes: clock.minutes, period, periods })) continue;
        push(buildOwnerMilkMissingAlert({ date: today, period }));
        break; // At most one session is active at a time.
      }
    }
  }

  // Rapid increases use complete days and each farmer's own recent baseline.
  for (const farmer of farmers) {
    const farmerId = Number(farmer.id);
    const history = deliveryIndex.get(farmerId) || new Map();
    const center = centerByName.get(normalizeName(farmer.centerName)) || null;
    if (!center) continue;
    const periods = getCenterPeriods(center);
    for (const date of evaluationDates) {
      if (farmer.createdDate && String(farmer.createdDate).slice(0, 10) > date) continue;
      if (!isDayComplete({ date, today, minutes: clock.minutes, periods })) continue;
      const dailyVolume = (targetDate) => SESSIONS.reduce((sum, period) => sum + getDayVolume(history, targetDate, period), 0);
      const volume = dailyVolume(date);
      if (volume <= 0) continue;
      const baseline = daysBefore(date, SPIKE_BASELINE_DAYS).map(dailyVolume).filter((value) => value > 0);
      if (baseline.length < MIN_SPIKE_BASELINE_DAYS) continue;
      const average = mean(baseline);
      if (average <= 0) continue;
      if (volume >= average * FARMER_SPIKE_RATIO && volume - average >= MIN_FARMER_SPIKE_LITERS) {
        push(buildFarmerMilkSpikeAlert({
          farmer,
          date,
          volume,
          average,
          baselineDays: baseline.length,
          increasePercent: Math.round(((volume - average) / average) * 100),
        }));
      }
    }
  }

  // Total corrected collection increases are evaluated per center and day.
  for (const center of centers) {
    const centerKey = normalizeName(center.name);
    const periods = getCenterPeriods(center);
    for (const date of evaluationDates) {
      if (!isDayComplete({ date, today, minutes: clock.minutes, periods })) continue;
      const dailyTotal = (targetDate) => SESSIONS.reduce((sum, period) => sum + (centerTotals.get(`${centerKey}|${targetDate}|${period}`) || 0), 0);
      const volume = dailyTotal(date);
      if (volume <= 0) continue;
      const baseline = daysBefore(date, SPIKE_BASELINE_DAYS).map(dailyTotal).filter((value) => value > 0);
      if (baseline.length < MIN_SPIKE_BASELINE_DAYS) continue;
      const average = mean(baseline);
      if (average > 0 && volume >= average * COLLECTION_SPIKE_RATIO && volume - average >= MIN_COLLECTION_SPIKE_LITERS) {
        push(buildCollectionMilkSpikeAlert({
          centerName: center.name,
          date,
          volume,
          average,
          baselineDays: baseline.length,
          increasePercent: Math.round(((volume - average) / average) * 100),
        }));
      }
    }
  }

  // A collector's own milk versus assigned farmer milk should stay stable. Only
  // days where the owner recorded milk count in the baseline, so a missing owner
  // record cannot masquerade as a sudden difference reduction.
  if (scope.isCollector) {
    const ownerDaily = new Map();
    for (const row of ownerRecords) {
      const date = String(row.date || '').slice(0, 10);
      if (!date) continue;
      ownerDaily.set(date, (ownerDaily.get(date) || 0) + Math.max(0, Number(row.volume ?? row.validVolumeLiters ?? row.volumeLiters ?? 0) || 0));
    }
    if (ownerDaily.size) {
      const farmerDaily = new Map();
      for (const row of records) {
        const date = String(row.date || '').slice(0, 10);
        if (!date) continue;
        farmerDaily.set(date, (farmerDaily.get(date) || 0) + Math.max(0, Number(row.morning || 0) || 0) + Math.max(0, Number(row.evening || 0) || 0));
      }
      const centerName = centers.length === 1 ? centers[0].name : null;
      const dayPeriods = { evening: { end: Math.max(1140, ...centers.map((center) => getCenterPeriods(center).evening.end)) } };
      for (const date of evaluationDates) {
        if (!isDayComplete({ date, today, minutes: clock.minutes, periods: dayPeriods })) continue;
        const ownerVolume = ownerDaily.get(date) || 0;
        if (ownerVolume <= 0) continue;
        const difference = ownerVolume - (farmerDaily.get(date) || 0);
        const baseline = daysBefore(date, SPIKE_BASELINE_DAYS)
          .filter((baselineDate) => (ownerDaily.get(baselineDate) || 0) > 0)
          .map((baselineDate) => (ownerDaily.get(baselineDate) || 0) - (farmerDaily.get(baselineDate) || 0));
        if (baseline.length < MIN_SPIKE_BASELINE_DAYS) continue;
        const averageDifference = mean(baseline);
        if (averageDifference > 0 && difference <= averageDifference * DIFFERENCE_DROP_RATIO && averageDifference - difference >= MIN_DIFFERENCE_LITERS) {
          push(buildOwnerFarmerDifferenceDropAlert({
            date,
            ownerVolume,
            farmerVolume: farmerDaily.get(date) || 0,
            difference,
            averageDifference,
            baselineDays: baseline.length,
            centerName,
          }));
        }
      }
    }
  }

  return { alerts, desired, states };
};

module.exports = {
  SESSIONS,
  EXPECTATION_LOOKBACK_DAYS,
  COLLECTION_GRACE_PERIOD_MINUTES,
  EVALUATION_DAYS_BACK,
  LOW_DELIVERY_BASELINE_DAYS,
  MIN_LOW_DELIVERY_BASELINE_DAYS,
  LOW_DELIVERY_RATIO,
  LOW_COLLECTION_RATIO,
  MIN_LOW_COLLECTION_BASELINE_DAYS,
  SPIKE_BASELINE_DAYS,
  MIN_SPIKE_BASELINE_DAYS,
  FARMER_SPIKE_RATIO,
  MIN_FARMER_SPIKE_LITERS,
  COLLECTION_SPIKE_RATIO,
  MIN_COLLECTION_SPIKE_LITERS,
  DIFFERENCE_DROP_RATIO,
  MIN_DIFFERENCE_LITERS,
  normalizeName,
  addDays,
  daysBefore,
  listEvaluationDates,
  getKigaliClock,
  minutesFromTime,
  getCenterPeriods,
  isSessionComplete,
  isInReminderWindow,
  buildDeliveryIndex,
  getLastDeliveryDate,
  buildOperationalAlertPlan,
  roundLiters,
};
