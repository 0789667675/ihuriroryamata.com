const defaultRepository = require('../repositories/domainRepository.js');

const STRING_LIMITS = {
  name: 255,
  location: 255,
  phone: 50,
  nationalId: 50,
  accountNumber: 255,
  cowType: 255,
  collectionCenter: 100,
};
const FARMER_FIELDS = Object.keys(STRING_LIMITS);

const normalizeText = (value, field, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${field} is required.`);
  if (normalized.length > STRING_LIMITS[field]) throw new Error(`${field} must be at most ${STRING_LIMITS[field]} characters.`);
  return normalized || null;
};

const normalizeFarmerInput = (input, { create = false } = {}) => {
  const normalized = {};
  for (const field of FARMER_FIELDS) {
    normalized[field] = normalizeText(input[field], field, {
      required: create && (field === 'name' || field === 'location'),
    });
  }
  if (input.collectionCenterId !== undefined || input.collection_center_id !== undefined) {
    const rawCenterId = input.collectionCenterId ?? input.collection_center_id;
    if (rawCenterId === null || rawCenterId === '') normalized.collectionCenterId = null;
    else {
      const centerId = Number(rawCenterId);
      if (!Number.isSafeInteger(centerId) || centerId <= 0) throw new Error('A valid collection center is required.');
      normalized.collectionCenterId = centerId;
    }
  }
  if (input.collection_center !== undefined && input.collectionCenter === undefined) {
    normalized.collectionCenter = normalizeText(input.collection_center, 'collectionCenter');
  }
  if (input.collectionCenter !== undefined) {
    normalized.collectionCenter = normalizeText(input.collectionCenter, 'collectionCenter');
  }
  if (input.collectorUserId !== undefined && input.collectorUserId !== null && input.collectorUserId !== '') {
    const collectorId = Number(input.collectorUserId);
    if (!Number.isInteger(collectorId) || collectorId <= 0) throw new Error('A valid collector account is required.');
    normalized.collectorUserId = collectorId;
  } else if (input.collectorUserId === null || input.collectorUserId === '') {
    normalized.collectorUserId = null;
  }
  return normalized;
};

const normalizePaging = ({ search, center, cursor, limit }) => {
  const pageSize = limit === undefined || limit === '' ? 50 : Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('limit must be an integer between 1 and 100.');
  }
  let numericCursor = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    numericCursor = Number(cursor);
    if (!Number.isSafeInteger(numericCursor) || numericCursor <= 0) throw new Error('cursor must be a positive integer.');
  }
  return {
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    center: typeof center === 'string' ? center.trim() : '',
    cursor: numericCursor,
    limit: pageSize,
  };
};

const normalizeCollectorScope = (collectorUserId) => {
  if (collectorUserId === undefined || collectorUserId === null || collectorUserId === '') return null;
  const id = Number(collectorUserId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A valid collector is required.');
  return id;
};

const toHttpError = (error) => {
  if (error.code === '23505') {
    const constraint = String(error.constraint || '');
    if (constraint.includes('national_id')) return Object.assign(new Error('This national ID is already in use.'), { statusCode: 409 });
    if (constraint.includes('account_number')) return Object.assign(new Error('This account number is already in use.'), { statusCode: 409 });
    return Object.assign(new Error('A farmer with these details already exists.'), { statusCode: 409 });
  }
  if (error.code === 'COLLECTION_CENTER_ORGANIZATION_MISMATCH' || error.code === 'COLLECTOR_NOT_ASSIGNED_TO_DAIRY') {
    error.statusCode = 400;
  }
  return error;
};

const listFarmers = async ({ ownerUserId, search, center, cursor, limit, collectorUserId, repository = defaultRepository }) => {
  if (!Number.isInteger(Number(ownerUserId)) || Number(ownerUserId) <= 0) throw new Error('Not authenticated.');
  const paging = normalizePaging({ search, center, cursor, limit });
  const payload = {
    ownerUserId: Number(ownerUserId),
    ...paging,
  };
  const scopedCollectorUserId = normalizeCollectorScope(collectorUserId);
  if (scopedCollectorUserId !== null) payload.collectorUserId = scopedCollectorUserId;
  return repository.listFarmers(payload);
};

const getFarmer = async ({ id, ownerUserId, repository = defaultRepository }) => {
  const farmerId = Number(id);
  if (!Number.isSafeInteger(farmerId) || farmerId <= 0) throw new Error('Invalid farmer id.');
  return repository.getFarmer(farmerId, Number(ownerUserId));
};

const createFarmer = async ({ input, ownerUserId, actorId = ownerUserId, repository = defaultRepository, now }) => {
  try {
    const farmerInput = normalizeFarmerInput(input, { create: true });
    const farmer = await repository.createFarmer({ input: farmerInput, ownerUserId: Number(ownerUserId), actorId: Number(actorId), now });
    try {
      const Notifications = require('./notification-service.js');
      await Notifications.createFarmerChangedNotification({ farmer, ownerUserId: Number(ownerUserId), action: 'created', now });
    } catch {
      // Farmer persistence must not depend on notification availability.
    }
    return farmer;
  } catch (error) {
    throw toHttpError(error);
  }
};

const updateFarmer = async ({ id, input, ownerUserId, actorId = ownerUserId, repository = defaultRepository }) => {
  const farmerId = Number(id);
  if (!Number.isSafeInteger(farmerId) || farmerId <= 0) throw new Error('Invalid farmer id.');
  const existing = await repository.getFarmer(farmerId, Number(ownerUserId));
  if (!existing) return null;
  try {
    const changes = normalizeFarmerInput(input);
    const merged = {};
    for (const field of FARMER_FIELDS) {
      const fieldWasProvided = Object.prototype.hasOwnProperty.call(input, field)
        || (field === 'collectionCenter' && input.collection_center !== undefined);
      merged[field] = fieldWasProvided
        ? changes[field]
        : existing[field] ?? existing[field === 'nationalId' ? 'national_id' : field] ?? null;
    }
      if (changes.collectionCenterId !== undefined) {
        merged.collectionCenterId = changes.collectionCenterId;
        if (changes.collectionCenterId === null) merged.collectionCenter = null;
      }
    if (!merged.name) throw new Error('name is required.');
    if (Object.prototype.hasOwnProperty.call(input, 'collectorUserId')) {
      merged.collectorUserId = changes.collectorUserId;
    }
    const updated = await repository.updateFarmer({ id: farmerId, input: merged, ownerUserId: Number(ownerUserId), actorId: Number(actorId) });
    if (updated) {
      try {
        const Notifications = require('./notification-service.js');
        await Notifications.createFarmerChangedNotification({ farmer: updated, ownerUserId: Number(ownerUserId), action: 'updated' });
      } catch {
        // Farmer persistence must not depend on notification availability.
      }
    }
    return updated;
  } catch (error) {
    throw toHttpError(error);
  }
};

const deleteFarmer = async ({ id, ownerUserId, actorId = ownerUserId, repository = defaultRepository }) => {
  const farmerId = Number(id);
  if (!Number.isSafeInteger(farmerId) || farmerId <= 0) throw new Error('Invalid farmer id.');
  return repository.deleteFarmer({ id: farmerId, ownerUserId: Number(ownerUserId), actorId: Number(actorId) });
};

module.exports = {
  STRING_LIMITS,
  normalizeFarmerInput,
  normalizePaging,
  listFarmers,
  getFarmer,
  createFarmer,
  updateFarmer,
  deleteFarmer,
};
