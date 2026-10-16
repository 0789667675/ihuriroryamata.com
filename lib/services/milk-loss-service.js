const defaultRepository = require('../repositories/milkAdjustmentRepository.js');

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400, code: 'BAD_REQUEST' });

const validateLossInput = ({ ownerUserId, collectionCenterId, date, period, lossPercentage, reason, adjustedBy }) => {
  if (!ownerUserId || Number.isNaN(Number(ownerUserId))) throw badRequest('Owner user ID is required.');
  if (!collectionCenterId || Number.isNaN(Number(collectionCenterId))) throw badRequest('Collection center is required.');
  if (!date) throw badRequest('Event date is required.');
  if (!['morning', 'evening', 'all'].includes(period)) throw badRequest('Period must be morning, evening, or all.');
  const pct = Number(lossPercentage);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw badRequest('Loss percentage must be between 0 and 100.');
  if (!reason || !reason.trim()) throw badRequest('A reason is required.');
  if (!adjustedBy || Number.isNaN(Number(adjustedBy))) throw badRequest('Actor ID is required.');
  return { ownerUserId: Number(ownerUserId), collectionCenterId: Number(collectionCenterId), date,
    period, lossPercentage: pct, reason: reason.trim(), adjustedBy: Number(adjustedBy) };
};

const createOrCorrectLossEvent = async (input, repository = defaultRepository) => {
  const params = validateLossInput(input);
  const result = await repository.applyCollectionAdjustment({
    ownerUserId: params.ownerUserId,
    collectionCenterId: params.collectionCenterId,
    date: params.date,
    period: params.period,
    lossPercentage: params.lossPercentage,
    reason: params.reason,
    adjustedBy: params.adjustedBy,
  });
  return result;
};

const getLossEvent = async ({ ownerUserId, collectionCenterId, date, period = 'all' }, repository = defaultRepository) => {
  if (!ownerUserId || !collectionCenterId || !date) throw badRequest('Owner, center, and date are required.');
  return await repository.getCollectionAdjustment({
    ownerUserId: Number(ownerUserId),
    collectionCenterId: Number(collectionCenterId),
    date,
    period,
  });
};

module.exports = { createOrCorrectLossEvent, getLossEvent, validateLossInput };
