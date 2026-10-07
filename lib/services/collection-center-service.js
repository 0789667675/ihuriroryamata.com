const defaultRepository = require('../repositories/domainRepository.js');

const DEFAULT_CONFIG = {
  pricePerLiter: 0,
  transportRatePerLiter: 0,
  morningStart: '06:30:00',
  morningEnd: '09:00:00',
  eveningStart: '17:30:00',
  eveningEnd: '19:00:00',
};

const normalizeTime = (value, field) => {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) throw new Error('Invalid collection time format.');
  const [hour, minute, second = '00'] = text.split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) throw new Error('Invalid collection time format.');
  return text.length === 5 ? `${text}:00` : text;
};

const normalizePrice = (value, field, { positive = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0)) {
    throw new Error(positive ? 'Invalid price per liter.' : `Invalid ${field}.`);
  }
  return number;
};

const normalizeConfig = (input, { creating = false } = {}) => {
  const config = {};
  if (creating || (input.pricePerLiter !== undefined && input.pricePerLiter !== '')) {
    config.pricePerLiter = input.pricePerLiter === undefined || input.pricePerLiter === ''
      ? DEFAULT_CONFIG.pricePerLiter
      : normalizePrice(input.pricePerLiter, 'price per liter', { positive: true });
  }
  if (creating || input.transportRatePerLiter !== undefined) {
    config.transportRatePerLiter = input.transportRatePerLiter === undefined || input.transportRatePerLiter === ''
      ? DEFAULT_CONFIG.transportRatePerLiter
      : normalizePrice(input.transportRatePerLiter, 'transport rate per liter');
  }
  for (const field of ['morningStart', 'morningEnd', 'eveningStart', 'eveningEnd']) {
    if (creating || input[field] !== undefined) {
      const value = input[field] === undefined || input[field] === '' ? DEFAULT_CONFIG[field] : normalizeTime(input[field], field);
      config[field] = value;
    }
  }
  const effective = creating ? { ...DEFAULT_CONFIG, ...config } : config;
  if (effective.morningStart && effective.morningEnd && effective.morningStart >= effective.morningEnd) {
    throw new Error('Morning start must be before morning end.');
  }
  if (effective.eveningStart && effective.eveningEnd && effective.eveningStart >= effective.eveningEnd) {
    throw new Error('Evening start must be before evening end.');
  }
  if (effective.morningEnd && effective.eveningStart && effective.morningEnd >= effective.eveningStart) {
    throw new Error('Morning end must be before evening start.');
  }
  return config;
};

const listCenters = async ({ ownerUserId, repository = defaultRepository }) => repository.listCenters(Number(ownerUserId));

const listAccessibleCenters = async ({ ownerUserId, accountType, repository = defaultRepository }) => {
  if (accountType === 'COLLECTOR') return repository.listCollectorCenters(Number(ownerUserId));
  return repository.listCenters(Number(ownerUserId));
};

const createCenter = async ({ ownerUserId, actorId = ownerUserId, input, repository = defaultRepository }) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new Error('A collection center name is required.');
  const config = normalizeConfig(input, { creating: true });
  try {
    return await repository.createCenter({ ownerUserId: Number(ownerUserId), actorId: Number(actorId), input: { name, ...config } });
  } catch (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('A collection center with this name already exists for your account.'), { statusCode: 409 });
    }
    throw error;
  }
};

const updateCenter = async ({ id, ownerUserId, actorId = ownerUserId, input, repository = defaultRepository }) => {
  const centerId = Number(id);
  if (!Number.isSafeInteger(centerId) || centerId <= 0) throw new Error('Invalid center.');
  const config = normalizeConfig(input);
  if (!Object.keys(config).length) return repository.getCenter(centerId, Number(ownerUserId));
  return repository.updateCenter({ id: centerId, ownerUserId: Number(ownerUserId), actorId: Number(actorId), input: config });
};

const listPrices = async ({ ownerUserId, repository = defaultRepository }) => repository.listCenterPrices(Number(ownerUserId));

const addPrice = async ({ ownerUserId, actorId = ownerUserId, input, repository = defaultRepository, today = new Date().toISOString().slice(0, 10) }) => {
  const pricePerLiter = normalizePrice(input.pricePerLiter, 'price per liter', { positive: true });
  let centerId = input.collectionCenterId === undefined || input.collectionCenterId === '' ? null : Number(input.collectionCenterId);
  if (centerId !== null && (!Number.isSafeInteger(centerId) || centerId <= 0)) throw new Error('Invalid collection center.');
  if (centerId === null) {
    const centers = await repository.listCenters(Number(ownerUserId));
    centerId = centers[0]?.id ?? null;
  }
  if (!centerId) return null;
  const effectiveDate = input.effectiveDate || today;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(effectiveDate);
  const parsedDate = dateMatch && new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
  if (!parsedDate || parsedDate.toISOString().slice(0, 10) !== effectiveDate) {
    throw new Error('Invalid effective date.');
  }
  return repository.addCenterPrice({
    ownerUserId: Number(ownerUserId),
    actorId: Number(actorId),
    input: { collectionCenterId: centerId, pricePerLiter, effectiveDate },
  });
};

module.exports = {
  DEFAULT_CONFIG,
  normalizeTime,
  normalizeConfig,
  listCenters,
  listAccessibleCenters,
  createCenter,
  updateCenter,
  listPrices,
  addPrice,
};
