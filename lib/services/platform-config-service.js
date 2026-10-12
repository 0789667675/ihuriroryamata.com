const defaultRepository = require('../repositories/platformConfigRepository.js');

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const COLLECTOR_TIER_CODES = [
  'USAGE_0_5000_MONTHLY',
  'USAGE_5001_10000_MONTHLY',
  'USAGE_10001_20000_MONTHLY',
  'USAGE_20001_40000_MONTHLY',
  'USAGE_40001_PLUS_MONTHLY',
];
  const tiers = [
    ['USAGE_0_5000_MONTHLY', 5000],
    ['USAGE_5001_10000_MONTHLY', 10000],
    ['USAGE_10001_20000_MONTHLY', 17000],
    ['USAGE_20001_40000_MONTHLY', 20000],
    ['USAGE_40001_PLUS_MONTHLY', 25000],
  ].map(([code, price]) => ({ code, price }));

const getPlans = async ({ repository = defaultRepository } = {}) => repository.listPlans();
const getCollectionCenterPricing = async ({ repository = defaultRepository } = {}) => repository.getCollectionCenterPricing();

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
  if (!Array.isArray(input?.tiers) || input.tiers.length !== COLLECTOR_TIER_CODES.length) {
    throw badRequest('All five Collector pricing tiers are required.');
  }

  const tiersByCode = new Map();
  for (const tier of input.tiers) {
    const code = String(tier?.code || '');
    const price = Number(tier?.price);
    const minVolumeLiters = Number(tier?.minVolumeLiters);
    const maxVolumeLiters = tier?.maxVolumeLiters === null ? null : Number(tier?.maxVolumeLiters);
    if (!COLLECTOR_TIER_CODES.includes(code) || tiersByCode.has(code)) {
      throw badRequest('Invalid or duplicate Collector pricing tier.');
    }
    if (!Number.isSafeInteger(price) || price <= 0) throw badRequest('Tier prices must be positive whole RWF amounts.');
    if (!Number.isSafeInteger(minVolumeLiters) || minVolumeLiters < 0
      || (maxVolumeLiters !== null && (!Number.isSafeInteger(maxVolumeLiters) || maxVolumeLiters < minVolumeLiters))) {
      throw badRequest('Tier volume ranges must use non-negative whole liters.');
    }
    tiersByCode.set(code, { code, price, minVolumeLiters, maxVolumeLiters });
  }
  if (COLLECTOR_TIER_CODES.some((code) => !tiersByCode.has(code))) {
    throw badRequest('All five Collector pricing tiers are required.');
  }

  let expectedMin = 0;
  const tiers = COLLECTOR_TIER_CODES.map((code, index) => {
    const tier = tiersByCode.get(code);
    const isLastTier = index === COLLECTOR_TIER_CODES.length - 1;
    if (tier.minVolumeLiters !== expectedMin || (isLastTier ? tier.maxVolumeLiters !== null : tier.maxVolumeLiters === null)) {
      throw badRequest('Tier volume ranges must start at zero, have no gaps or overlaps, and leave the final tier open-ended.');
    }
    if (!isLastTier) expectedMin = tier.maxVolumeLiters + 1;
    const format = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
    return {
      ...tier,
      name: tier.maxVolumeLiters === null
        ? `${format(tier.minVolumeLiters)}+ L / Monthly`
        : `${format(tier.minVolumeLiters)}-${format(tier.maxVolumeLiters)} L / Monthly`,
    };
  });
  return repository.updateCollectorTierPrices({ actorId: parsedActorId, tiers });
};

module.exports = { getPlans, getCollectionCenterPricing, updateCollectionCenterPricing, updateCollectorTierPrices };
