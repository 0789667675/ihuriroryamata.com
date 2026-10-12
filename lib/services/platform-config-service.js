const defaultRepository = require('../repositories/platformConfigRepository.js');
const { DEFAULT_SUBSCRIPTION_TIME_ZONE } = require('../utils/subscription-time.js');

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const getPlans = async ({ repository = defaultRepository } = {}) => repository.listPlans();
const getCollectionCenterPricing = async ({ repository = defaultRepository } = {}) => repository.getCollectionCenterPricing();
const getSubscriptionPolicy = async ({ repository = defaultRepository } = {}) => repository.getSubscriptionPolicy();

const updateCollectionCenterPricing = async ({ actorId, input, repository = defaultRepository }) => {
  const amount = Number(input.monthlyAmount);
  const boundary = Number(input.firstVolumeBoundaryLiters ?? 50000);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(boundary) || boundary < 0) {
    throw badRequest('Invalid Collection Center pricing.');
  }
  return repository.updateCollectionCenterPricing({ actorId: Number(actorId), amount, boundary });
};

const updateCollectorTierPrices = async ({ actorId, input, repository = defaultRepository }) => {
  const parsedActorId = Number(actorId);
  if (!Number.isSafeInteger(parsedActorId) || parsedActorId <= 0) throw badRequest('Invalid pricing administrator.');
  if (!Array.isArray(input?.tiers) || input.tiers.length < 1 || input.tiers.length > 20) {
    throw badRequest('Configure between one and twenty Collector pricing tiers.');
  }

  const ids = new Set();
  const tiers = input.tiers.map((tier) => {
    const id = tier?.id === undefined || tier.id === null || tier.id === '' ? null : Number(tier.id);
    const name = String(tier?.name || '').trim();
    const price = Number(tier?.price);
    const minVolumeLiters = Number(tier?.minVolumeLiters);
    const maxVolumeLiters = tier?.maxVolumeLiters === null ? null : Number(tier?.maxVolumeLiters);
    const isActive = tier?.isActive;
    if ((id !== null && (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)))
      || !name || name.length > 255 || typeof isActive !== 'boolean') {
      throw badRequest('Each tier needs a unique ID, label, and active status.');
    }
    if (id !== null) ids.add(id);
    if (!Number.isSafeInteger(price) || price <= 0) throw badRequest('Tier prices must be positive whole RWF amounts.');
    if (!Number.isSafeInteger(minVolumeLiters) || minVolumeLiters < 0
      || (maxVolumeLiters !== null && (!Number.isSafeInteger(maxVolumeLiters) || maxVolumeLiters < minVolumeLiters))) {
      throw badRequest('Tier volume ranges must use non-negative whole liters.');
    }
    return { id, name, price, minVolumeLiters, maxVolumeLiters, isActive };
  }).sort((left, right) => left.minVolumeLiters - right.minVolumeLiters);

  const activeTiers = tiers.filter((tier) => tier.isActive);
  if (!activeTiers.length) throw badRequest('At least one Collector pricing tier must remain active.');
  for (let index = 1; index < activeTiers.length; index += 1) {
    const previous = activeTiers[index - 1];
    if (previous.maxVolumeLiters === null || activeTiers[index].minVolumeLiters <= previous.maxVolumeLiters) {
      throw badRequest('Active tier volume ranges cannot overlap.');
    }
  }
  let expectedMin = 0;
  activeTiers.forEach((tier, index) => {
    const isLastTier = index === activeTiers.length - 1;
    if (tier.minVolumeLiters !== expectedMin || (isLastTier ? tier.maxVolumeLiters !== null : tier.maxVolumeLiters === null)) {
      throw badRequest('Active tiers must cover volumes from zero without gaps and end with an open range.');
    }
    if (!isLastTier) expectedMin = tier.maxVolumeLiters + 1;
  });
  return repository.updateCollectorTiers({
    actorId: parsedActorId,
    tiers: tiers.map((tier, sortOrder) => ({ ...tier, sortOrder: sortOrder + 1 })),
  });
};

const updateSubscriptionPolicy = async ({ actorId, input, repository = defaultRepository }) => {
  const parsedActorId = Number(actorId);
  const initialAccessDays = Number(input?.initialAccessDays);
  const gracePeriodDays = Number(input?.gracePeriodDays);
  const enforcementTime = String(input?.enforcementTime || '');
  const timeZone = String(input?.timeZone || DEFAULT_SUBSCRIPTION_TIME_ZONE);
  if (!Number.isSafeInteger(parsedActorId) || parsedActorId <= 0) throw badRequest('Invalid policy administrator.');
  if (!Number.isSafeInteger(initialAccessDays) || initialAccessDays < 1 || initialAccessDays > 90) {
    throw badRequest('Initial access must be between 1 and 90 days.');
  }
  if (!Number.isSafeInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 90) {
    throw badRequest('Grace period must be between 0 and 90 days.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(enforcementTime)) throw badRequest('Enforcement time must use HH:MM.');
  if (timeZone !== DEFAULT_SUBSCRIPTION_TIME_ZONE) throw badRequest('Subscription policy uses Africa/Kigali time.');
  return repository.updateSubscriptionPolicy({
    actorId: parsedActorId,
    policy: { initialAccessDays, gracePeriodDays, enforcementTime, timeZone },
  });
};

module.exports = {
  getPlans,
  getCollectionCenterPricing,
  updateCollectionCenterPricing,
  updateCollectorTierPrices,
  updateSubscriptionPolicy,
  getSubscriptionPolicy,
};
