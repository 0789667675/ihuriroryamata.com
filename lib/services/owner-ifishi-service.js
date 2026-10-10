const defaultRepository = require('../repositories/collectorMilkRepository.js');
const { isIsoDate } = require('./milk-service.js');
const { getPeriodRange } = require('./monthly-report-service.js');

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const normalizeOwnerId = (value) => {
  const ownerUserId = Number(value);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw badRequest('A valid owner is required.');
  return ownerUserId;
};

const normalizeVolume = (value) => {
  const volumeLiters = Number(value);
  if (!Number.isFinite(volumeLiters) || volumeLiters <= 0) throw badRequest('Milk volume must be greater than zero.');
  return volumeLiters;
};

const normalizeDate = (value, now = new Date()) => {
  if (!isIsoDate(value)) throw badRequest('A valid date (YYYY-MM-DD) is required.');
  if (value > now.toISOString().slice(0, 10)) throw badRequest('Owner Ifishi entries cannot be dated in the future.');
  return value;
};

const projectEntry = (entry) => {
  const validVolumeLiters = Number(entry.validVolumeLiters || 0);
  const assignedFarmerLiters = Number(entry.assignedFarmerLiters || 0);
  const pricePerLiter = Number(entry.pricePerLiter || 0);
  return {
    id: entry.id === null || entry.id === undefined ? null : Number(entry.id),
    date: String(entry.date).slice(0, 10),
    volumeLiters: Number(entry.volumeLiters || 0),
    originalVolumeLiters: Number(entry.originalVolumeLiters || 0),
    validVolumeLiters,
    lostVolumeLiters: Number(entry.lostVolumeLiters || 0),
    pricePerLiter: pricePerLiter > 0 ? pricePerLiter : null,
    grossAmount: entry.grossAmount === null || entry.grossAmount === undefined
      ? validVolumeLiters <= 0 ? 0 : pricePerLiter > 0 ? Number((validVolumeLiters * pricePerLiter).toFixed(2)) : null
      : Number(entry.grossAmount),
    assignedFarmerLiters,
    surplusLiters: Number(Math.max(0, validVolumeLiters - assignedFarmerLiters).toFixed(2)),
    status: entry.status || 'missing',
    adjustmentReason: entry.adjustmentReason || null,
    adjustedAt: entry.adjustedAt || null,
  };
};

const getHistory = async ({ ownerUserId, startDate, endDate, repository = defaultRepository }) => {
  const ownerId = normalizeOwnerId(ownerUserId);
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw badRequest('A valid owner history date range is required.');
  }
  const entries = (await repository.getOwnerIfishiHistory({ ownerUserId: ownerId, startDate, endDate })).map(projectEntry);
  const ownerMilkValueComplete = !entries.some((entry) => entry.id !== null && entry.validVolumeLiters > 0 && entry.grossAmount === null);
  const totals = entries.reduce((sum, entry) => ({
    originalVolumeLiters: sum.originalVolumeLiters + entry.originalVolumeLiters,
    ownerVolumeLiters: sum.ownerVolumeLiters + entry.validVolumeLiters,
    lostVolumeLiters: sum.lostVolumeLiters + entry.lostVolumeLiters,
    ownerMilkGross: sum.ownerMilkGross + (entry.grossAmount || 0),
    assignedFarmerLiters: sum.assignedFarmerLiters + entry.assignedFarmerLiters,
    surplusLiters: sum.surplusLiters + entry.surplusLiters,
  }), { originalVolumeLiters: 0, ownerVolumeLiters: 0, lostVolumeLiters: 0, ownerMilkGross: 0, assignedFarmerLiters: 0, surplusLiters: 0 });
  if (!ownerMilkValueComplete) totals.ownerMilkGross = null;
  else totals.ownerMilkGross = Number(totals.ownerMilkGross.toFixed(2));
  totals.ownerMilkValueComplete = ownerMilkValueComplete;
  return {
    startDate,
    endDate,
    entries,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [
      key,
      typeof value === 'number' ? Number(value.toFixed(2)) : value,
    ])),
  };
};

const getHistoryForPeriod = async ({ ownerUserId, month, year, periodType, repository = defaultRepository, now = new Date() }) => {
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12
    || !Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2100
    || !['first-half', 'second-half'].includes(periodType)) {
    throw badRequest('Choose a valid accounting month, year, and half-month period.');
  }
  const [startDate, endDate] = getPeriodRange({ periodType, month: monthNumber, year: yearNumber, now });
  return getHistory({ ownerUserId, startDate, endDate, repository });
};

const getPrice = async (repository, ownerUserId, date) => {
  const result = await repository.getPriceAtDate({ ownerUserId, date });
  const pricePerLiter = Number(result?.pricePerLiter);
  if (!Number.isFinite(pricePerLiter) || pricePerLiter <= 0) {
    throw Object.assign(new Error('Set an effective owner milk price for this date before recording milk.'), {
      statusCode: 409,
      code: 'OWNER_MILK_PRICE_MISSING',
    });
  }
  return pricePerLiter;
};

const createEntry = async ({ ownerUserId, actorId = ownerUserId, date, volumeLiters, repository = defaultRepository, now = new Date() }) => {
  const ownerId = normalizeOwnerId(ownerUserId);
  const normalizedDate = normalizeDate(date, now);
  const volume = normalizeVolume(volumeLiters);
  const pricePerLiter = await getPrice(repository, ownerId, normalizedDate);
  return repository.createOwnerEntry({
    ownerUserId: ownerId,
    actorId: Number(actorId),
    date: normalizedDate,
    volumeLiters: volume,
    pricePerLiter,
  });
};

const correctEntry = async ({ ownerUserId, actorId = ownerUserId, id, date, volumeLiters, repository = defaultRepository, now = new Date() }) => {
  const ownerId = normalizeOwnerId(ownerUserId);
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) throw badRequest('A valid owner milk record is required.');
  const normalizedDate = normalizeDate(date, now);
  const volume = normalizeVolume(volumeLiters);
  const pricePerLiter = await getPrice(repository, ownerId, normalizedDate);
  const corrected = await repository.correctOwnerEntry({
    id: recordId,
    ownerUserId: ownerId,
    actorId: Number(actorId),
    date: normalizedDate,
    volumeLiters: volume,
    pricePerLiter,
  });
  return corrected;
};

module.exports = { getHistory, getHistoryForPeriod, createEntry, correctEntry, projectEntry };