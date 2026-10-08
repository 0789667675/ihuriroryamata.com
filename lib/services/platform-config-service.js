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

  const pricesByCode = new Map();
  for (const tier of input.tiers) {
    const code = String(tier?.code || '');
    const price = Number(tier?.price);
    if (!COLLECTOR_TIER_CODES.includes(code) || pricesByCode.has(code)) {
      throw badRequest('Invalid or duplicate Collector pricing tier.');
    }
    if (!Number.isSafeInteger(price) || price <= 0) throw badRequest('Tier prices must be positive whole RWF amounts.');
    pricesByCode.set(code, price);
  }
  if (COLLECTOR_TIER_CODES.some((code) => !pricesByCode.has(code))) {
    throw badRequest('All five Collector pricing tiers are required.');
  }

  const tiers = COLLECTOR_TIER_CODES.map((code) => ({ code, price: pricesByCode.get(code) }));
  return repository.updateCollectorTierPrices({ actorId: parsedActorId, tiers });
};

module.exports = { getPlans, getCollectionCenterPricing, updateCollectionCenterPricing, updateCollectorTierPrices };
