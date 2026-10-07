const defaultRepository = require('../repositories/collectorMilkRepository.js');
const { isIsoDate } = require('./milk-service.js');

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const validateVolume = (value) => {
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0) throw badRequest('Invalid collector milk entry.');
  return volume;
};

const getDaily = async ({ ownerUserId, date, repository = defaultRepository }) => {
  if (!isIsoDate(date)) throw badRequest('date is required.');
  return repository.getByDate({ ownerUserId: Number(ownerUserId), date });
};

const saveDaily = async ({ ownerUserId, actorId = ownerUserId, date, volumeLiters, repository = defaultRepository }) => {
  if (!isIsoDate(date)) throw badRequest('Invalid collector milk entry.');
  const volume = validateVolume(volumeLiters);
  const configuredPrice = await repository.getPriceAtDate({ ownerUserId: Number(ownerUserId), date });
  return repository.upsertDaily({
    ownerUserId: Number(ownerUserId),
    actorId: Number(actorId),
    date,
    volumeLiters: volume,
    pricePerLiter: Number(configuredPrice?.pricePerLiter || 0),
  });
};

const getHistory = async ({ ownerUserId, startDate, endDate, repository = defaultRepository }) => {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw badRequest('A valid history date range is required.');
  }
  const entries = await repository.getForPeriod({ ownerUserId: Number(ownerUserId), startDate, endDate });
  const history = await Promise.all(entries.map(async (entry) => {
    const configuredPrice = await repository.getPriceAtDate({ ownerUserId: Number(ownerUserId), date: entry.date });
    const pricePerLiter = Number(entry.pricePerLiter || configuredPrice?.pricePerLiter || 0);
    return {
      ...entry,
      pricePerLiter,
      grossAmount: Number((entry.effectiveVolumeLiters * pricePerLiter).toFixed(2)),
    };
  }));
  return {
    startDate,
    endDate,
    entries: history,
    originalVolume: Number(history.reduce((sum, entry) => sum + entry.volumeLiters, 0).toFixed(2)),
    lostVolume: Number(history.reduce((sum, entry) => sum + (entry.status === 'cancelled' ? entry.volumeLiters : entry.farmerLostLiters), 0).toFixed(2)),
    totalVolume: Number(history.reduce((sum, entry) => sum + entry.effectiveVolumeLiters, 0).toFixed(2)),
    totalAmount: Number(history.reduce((sum, entry) => sum + entry.grossAmount, 0).toFixed(2)),
  };
};

const voidDaily = async ({ ownerUserId, actorId = ownerUserId, date, reason, repository = defaultRepository }) => {
  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!isIsoDate(date)) throw badRequest('A valid date (YYYY-MM-DD) is required.');
  if (!normalizedReason || normalizedReason.length > 500) throw badRequest('A void reason is required.');
  return repository.voidDaily({
    ownerUserId: Number(ownerUserId),
    date,
    reason: normalizedReason,
    voidedBy: Number(actorId),
  });
};

const getPrices = async ({ ownerUserId, repository = defaultRepository }) => repository.getPrices(Number(ownerUserId));

const addPrice = async ({ ownerUserId, actorId = ownerUserId, pricePerLiter, effectiveDate, repository = defaultRepository }) => {
  const price = Number(pricePerLiter);
  if (!Number.isFinite(price) || price <= 0 || !isIsoDate(effectiveDate)) {
    throw badRequest('A valid price and effective date are required.');
  }
  return repository.addPrice({
    ownerUserId: Number(ownerUserId),
    actorId: Number(actorId),
    pricePerLiter: price,
    effectiveDate,
  });
};

module.exports = { getDaily, saveDaily, getHistory, voidDaily, getPrices, addPrice, validateVolume };
