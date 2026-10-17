const ACCOUNTING_TIME_ZONE = 'Africa/Kigali';

const getAccountingDateParts = (value = new Date(), timeZone = ACCOUNTING_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
};

const formatAccountingDate = (year, month, day) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const getMonthDateRange = (year, month) => ({
  startDate: formatAccountingDate(year, month, 1),
  endDate: formatAccountingDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()),
});

const getHalfMonthDateRange = (year, month, periodType) => {
  const monthRange = getMonthDateRange(year, month);
  return periodType === 'first-half'
    ? { startDate: monthRange.startDate, endDate: formatAccountingDate(year, month, 15) }
    : { startDate: formatAccountingDate(year, month, 16), endDate: monthRange.endDate };
};

const getAccountingHalfForDay = (day) => Number(day) <= 15 ? 'first-half' : 'second-half';

const getCurrentAccountingPeriod = (now = new Date(), timeZone = ACCOUNTING_TIME_ZONE) => {
  const { year, month, day } = getAccountingDateParts(now, timeZone);
  const periodType = getAccountingHalfForDay(day);
  return {
    year: String(year),
    month: String(month).padStart(2, '0'),
    day,
    periodType,
    ...getHalfMonthDateRange(year, month, periodType),
  };
};

const getAccountingDate = (now = new Date(), timeZone = ACCOUNTING_TIME_ZONE) => {
  const { year, month, day } = getAccountingDateParts(now, timeZone);
  return formatAccountingDate(year, month, day);
};

module.exports = {
  ACCOUNTING_TIME_ZONE,
  getAccountingDateParts,
  getAccountingDate,
  getAccountingHalfForDay,
  getMonthDateRange,
  getHalfMonthDateRange,
  getCurrentAccountingPeriod,
};