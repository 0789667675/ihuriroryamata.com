const defaultRepository = require('../repositories/milkAdjustmentRepository.js');
const { isIsoDate } = require('./milk-service.js');

const badRequest = (message, code = 'INVALID_MILK_ADJUSTMENT') => Object.assign(new Error(message), { statusCode: 400, code });

const validateAdjustment = ({ collectionCenterId, date, period = 'all', lossPercentage, reason }) => {
  const centerId = Number(collectionCenterId);
  const loss = Number(lossPercentage);
  const validPeriod = ['morning', 'evening', 'all'].includes(period);
  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!Number.isSafeInteger(centerId) || centerId <= 0 || !isIsoDate(date) || !validPeriod
      || !Number.isFinite(loss) || loss < 0 || loss > 100 || !normalizedReason || normalizedReason.length > 500) {
    throw badRequest('Collection center, date, a valid period, loss percentage, and reason are required.');
  }
  return { collectionCenterId: centerId, date, period, lossPercentage: loss, reason: normalizedReason };
};

const getCollectionAdjustment = async ({ ownerUserId, collectionCenterId, date, period = 'all', repository = defaultRepository }) => {
  const normalized = validateAdjustment({ collectionCenterId, date, period, lossPercentage: 0, reason: 'lookup' });
  return repository.getCollectionAdjustment({ ownerUserId: Number(ownerUserId), ...normalized });
};

const applyCollectionAdjustment = async ({ ownerUserId, actorId = ownerUserId, input, repository = defaultRepository }) => {
  const normalized = validateAdjustment(input);
  return repository.applyCollectionAdjustment({
    ownerUserId: Number(ownerUserId),
    adjustedBy: Number(actorId),
    ...normalized,
  });
};

module.exports = { validateAdjustment, getCollectionAdjustment, applyCollectionAdjustment };
