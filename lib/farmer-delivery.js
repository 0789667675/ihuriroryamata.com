/**
 * Pure helpers for permanent farmer numbers, daily reconciliation, and farmer
 * delivery history. Keeping the calendar and counting rules here makes them
 * easy to test without a database and keeps the UI and repositories aligned.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (value) => String(value).padStart(2, '0');

const toIsoDate = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const text = String(value).slice(0, 10);
  return DATE_PATTERN.test(text) ? text : '';
};

const isIsoDate = (value) => {
  const text = toIsoDate(value);
  if (!text) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
};

/**
 * Accepts `17`, `No. 17`, `No 17`, `#17`, and `number 17` so the same search
 * box works for the permanent number and for free-text identity search.
 */
const parseFarmerNumber = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/^(?:no\.?|number|#)?\s*0*([1-9]\d{0,9})$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatFarmerNumber = (value) => {
  const parsed = parseFarmerNumber(value);
  return parsed === null ? '' : `No. ${parsed}`;
};

const nonNegativeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/**
 * Delivered ÷ Expected × 100. Zero expected farmers is a valid state and must
 * report 0% rather than NaN or Infinity.
 */
const calculateDeliveryReconciliation = ({ expectedCount, deliveredCount } = {}) => {
  const expected = nonNegativeCount(expectedCount);
  const delivered = nonNegativeCount(deliveredCount);
  const missing = Math.max(0, expected - delivered);
  const deliveryRate = expected > 0
    ? Math.round((delivered / expected) * 10000) / 100
    : 0;
  return { expectedCount: expected, deliveredCount: delivered, missingCount: missing, deliveryRate };
};

const enumerateIsoDates = (startDate, endDate) => {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) return [];
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const recordMorning = (record) => Number(record?.volumeMorning ?? record?.morningLiters ?? 0) || 0;
const recordEvening = (record) => Number(record?.volumeEvening ?? record?.eveningLiters ?? 0) || 0;
const validMorning = (record) => Number(record?.validVolumeMorning ?? record?.volumeMorning ?? record?.morningLiters ?? 0) || 0;
const validEvening = (record) => Number(record?.validVolumeEvening ?? record?.volumeEvening ?? record?.eveningLiters ?? 0) || 0;

const isRecordDelivered = (record, session) => {
  if (!record || String(record.status || 'valid') === 'cancelled') return false;
  const morning = validMorning(record);
  const evening = validEvening(record);
  if (session === 'morning') return morning > 0;
  if (session === 'evening') return evening > 0;
  return morning > 0 || evening > 0;
};

const sessionForRecord = (record) => {
  const morning = recordMorning(record) > 0;
  const evening = recordEvening(record) > 0;
  if (morning && evening) return 'morning-evening';
  if (morning) return 'morning';
  if (evening) return 'evening';
  return 'none';
};

/**
 * Builds one row for every expected calendar day, including days with no milk
 * record. Missing days are derived, never inserted as fake milk records.
 */
const calculateFarmerDeliveryHistory = ({
  farmer,
  records = [],
  startDate,
  endDate,
  today,
  session = 'all',
} = {}) => {
  const todayDate = toIsoDate(today) || new Date().toISOString().slice(0, 10);
  const farmerCreatedDate = toIsoDate(farmer?.createdDate ?? farmer?.createdAt);
  const requestedStart = toIsoDate(startDate) || todayDate;
  const requestedEnd = toIsoDate(endDate) || todayDate;
  const expectedStart = farmerCreatedDate && farmerCreatedDate > requestedStart ? farmerCreatedDate : requestedStart;
  const expectedEnd = requestedEnd > todayDate ? todayDate : requestedEnd;
  const dates = enumerateIsoDates(expectedStart, expectedEnd);
  const recordsByDate = new Map();
  for (const record of records) {
    const date = toIsoDate(record?.date);
    if (date) recordsByDate.set(date, record);
  }

  const days = dates.map((date) => {
    const record = recordsByDate.get(date) || null;
    const morningLiters = recordMorning(record);
    const eveningLiters = recordEvening(record);
    const delivered = isRecordDelivered(record, session);
    return {
      date,
      recordId: record?.id ?? null,
      morningLiters: Number(morningLiters.toFixed(2)),
      eveningLiters: Number(eveningLiters.toFixed(2)),
      totalLiters: Number((morningLiters + eveningLiters).toFixed(2)),
      session: sessionForRecord(record),
      status: delivered ? 'delivered' : record && String(record.status) === 'cancelled' ? 'cancelled' : 'missing',
      deliveryStatus: delivered ? 'delivered' : 'missing',
    };
  });

  const deliveredDays = days.filter((day) => day.deliveryStatus === 'delivered').length;
  const reconciliation = calculateDeliveryReconciliation({ expectedCount: days.length, deliveredCount: deliveredDays });
  const missedDates = days.filter((day) => day.deliveryStatus !== 'delivered').map((day) => day.date);
  return {
    startDate: expectedStart,
    endDate: expectedEnd,
    requestedStartDate: requestedStart,
    requestedEndDate: requestedEnd,
    expectedDays: reconciliation.expectedCount,
    deliveredDays: reconciliation.deliveredCount,
    missingDays: reconciliation.missingCount,
    deliveryRate: reconciliation.deliveryRate,
    missedDates,
    days: [...days].reverse(),
  };
};

module.exports = {
  isIsoDate,
  toIsoDate,
  parseFarmerNumber,
  formatFarmerNumber,
  calculateDeliveryReconciliation,
  enumerateIsoDates,
  calculateFarmerDeliveryHistory,
};
