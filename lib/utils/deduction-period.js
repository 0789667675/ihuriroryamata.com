const { getHalfMonthDateRange, getMonthDateRange } = require('./accounting-period.js');

const DEDUCTION_FREQUENCIES = ['PERIOD', 'MONTHLY', 'ONE_TIME'];

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getUkweziPeriodKind = (periodStart, periodEnd) => {
  if (!isValidDate(periodStart) || !isValidDate(periodEnd)) return null;
  const year = Number(periodStart.slice(0, 4));
  const month = Number(periodStart.slice(5, 7));
  if (getHalfMonthDateRange(year, month, 'first-half').startDate === periodStart
    && getHalfMonthDateRange(year, month, 'first-half').endDate === periodEnd) return 'PERIOD';
  if (getHalfMonthDateRange(year, month, 'second-half').startDate === periodStart
    && getHalfMonthDateRange(year, month, 'second-half').endDate === periodEnd) return 'PERIOD';
  const monthRange = getMonthDateRange(year, month);
  return monthRange.startDate === periodStart && monthRange.endDate === periodEnd ? 'MONTHLY' : null;
};

const validateDeductionPeriod = ({ periodStart, periodEnd, frequency, effectiveStartDate }) => {
  const periodKind = getUkweziPeriodKind(periodStart, periodEnd);
  if (!periodKind) throw Object.assign(new Error('Choose a valid Ukwezi half-month or full-month period.'), { statusCode: 400 });
  if (!DEDUCTION_FREQUENCIES.includes(frequency)) throw Object.assign(new Error('Choose a supported deduction frequency.'), { statusCode: 400 });
  if (frequency === 'PERIOD' && periodKind !== 'PERIOD') throw Object.assign(new Error('This deduction configuration requires a half-month Ukwezi period.'), { statusCode: 400 });
  if (frequency === 'MONTHLY' && periodKind !== 'MONTHLY') throw Object.assign(new Error('This deduction configuration requires a full-month Ukwezi period.'), { statusCode: 400 });
  if (effectiveStartDate && (!isValidDate(effectiveStartDate) || effectiveStartDate > periodStart)) {
    throw Object.assign(new Error('The deduction configuration is not effective for this period.'), { statusCode: 400 });
  }
  return periodKind;
};

const calculateDeductionRecovery = ({ chargeAmount, availableEarnings }) => {
  const charge = Number(chargeAmount);
  const earnings = Number(availableEarnings);
  if (!Number.isFinite(charge) || charge <= 0 || !Number.isFinite(earnings)) {
    throw Object.assign(new Error('Deduction charge and available earnings must be valid amounts.'), { statusCode: 400 });
  }
  const recoveredAmount = Number(Math.min(charge, Math.max(0, earnings)).toFixed(2));
  return { recoveredAmount, outstandingAmount: Number((charge - recoveredAmount).toFixed(2)) };
};

module.exports = { DEDUCTION_FREQUENCIES, isValidDate, getUkweziPeriodKind, validateDeductionPeriod, calculateDeductionRecovery };