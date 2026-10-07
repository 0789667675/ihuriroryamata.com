const defaultRepository = require('../repositories/collectorMilkRepository.js');
const { isIsoDate } = require('./milk-service.js');

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
  return {
    id: entry.id === null || entry.id === undefined ? null : Number(entry.id),
    date: String(entry.date).slice(0, 10),
    volumeLiters: Number(entry.volumeLiters || 0),
    originalVolumeLiters: Number(entry.originalVolumeLiters || 0),
    validVolumeLiters,
    lostVolumeLiters: Number(entry.lostVolumeLiters || 0),
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
  const totals = entries.reduce((sum, entry) => ({
    ownerVolumeLiters: sum.ownerVolumeLiters + entry.validVolumeLiters,
    assignedFarmerLiters: sum.assignedFarmerLiters + entry.assignedFarmerLiters,
    surplusLiters: sum.surplusLiters + entry.surplusLiters,
  }), { ownerVolumeLiters: 0, assignedFarmerLiters: 0, surplusLiters: 0 });
  return {
    startDate,
    endDate,
    entries,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(2))])),
  };
};

const getPrice = async (repository, ownerUserId, date) => {
  const result = await repository.getPriceAtDate({ ownerUserId, date });
  return Number(result?.pricePerLiter || 0);
};

const reloadEntry = async ({ repository, ownerUserId, date, id }) => {
  const history = await getHistory({ ownerUserId, startDate: date, endDate: date, repository });
  return history.entries.find((entry) => entry.id === Number(id)) || null;
};

const createEntry = async ({ ownerUserId, actorId = ownerUserId, date, volumeLiters, repository = defaultRepository, now = new Date() }) => {
  const ownerId = normalizeOwnerId(ownerUserId);
  const normalizedDate = normalizeDate(date, now);
  const volume = normalizeVolume(volumeLiters);
  const pricePerLiter = await getPrice(repository, ownerId, normalizedDate);
  const created = await repository.createOwnerEntry({
    ownerUserId: ownerId,
    actorId: Number(actorId),
    date: normalizedDate,
    volumeLiters: volume,
    pricePerLiter,
  });
  return reloadEntry({ repository, ownerUserId: ownerId, date: normalizedDate, id: created.id });
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
  if (!corrected) return null;
  return reloadEntry({ repository, ownerUserId: ownerId, date: normalizedDate, id: recordId });
};

module.exports = { getHistory, createEntry, correctEntry, projectEntry };