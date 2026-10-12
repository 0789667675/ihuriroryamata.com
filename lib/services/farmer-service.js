const defaultRepository = require('../repositories/domainRepository.js');

const STRING_LIMITS = {
  name: 255,
  phone: 50,
  nationalId: 50,
  accountNumber: 255,
  cowType: 255,
  collectionCenter: 100,
};
const FARMER_FIELDS = Object.keys(STRING_LIMITS);
const FARMER_SORT_FIELDS = ['name', 'nationalId', 'collectionCenter'];

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
      required: create && field === 'name',
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

const normalizePaging = ({ search, center, cursor, limit, sortBy, sortDirection }) => {
  const pageSize = limit === undefined || limit === '' ? 50 : Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('limit must be an integer between 1 and 100.');
  }
  const normalizedSortBy = FARMER_SORT_FIELDS.includes(sortBy) ? sortBy : 'id';
  const normalizedSortDirection = ['asc', 'desc'].includes(sortDirection) ? sortDirection : 'desc';
  let normalizedCursor = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const cursorValue = String(cursor);
    if (normalizedSortBy === 'id') {
      normalizedCursor = Number(cursorValue);
      if (!Number.isSafeInteger(normalizedCursor) || normalizedCursor <= 0) throw new Error('cursor must be a positive integer.');
    } else {
      try {
        if (!cursorValue.startsWith('s1.')) throw new Error();
        const decoded = JSON.parse(Buffer.from(cursorValue.slice(3), 'base64url').toString('utf8'));
        if (decoded.sortBy !== normalizedSortBy || decoded.sortDirection !== normalizedSortDirection
          || !Number.isSafeInteger(decoded.id) || decoded.id <= 0 || typeof decoded.value !== 'string') throw new Error();
        normalizedCursor = { value: decoded.value, id: decoded.id };
      } catch {
        throw new Error('Invalid farmer list cursor.');
      }
    }
  }
  return {
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    center: typeof center === 'string' ? center.trim() : '',
    cursor: normalizedCursor,
    limit: pageSize,
    sortBy: normalizedSortBy,
    sortDirection: normalizedSortDirection,
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
    if (constraint.includes('farmers_owner_name')) return Object.assign(new Error('A farmer with this name already exists for this account.'), { statusCode: 409 });
    if (constraint.includes('national_id')) return Object.assign(new Error('This national ID is already in use.'), { statusCode: 409 });
    if (constraint.includes('account_number')) return Object.assign(new Error('This account number is already in use.'), { statusCode: 409 });
    return Object.assign(new Error('A farmer with these details already exists.'), { statusCode: 409 });
  }
  if (error.code === '23503') return Object.assign(new Error('The selected collector or collection center is no longer available.'), { statusCode: 409 });
  if (error.code === '23502') return Object.assign(new Error('A required farmer field is missing.'), { statusCode: 400 });
  if (error.code === '23514' || error.code === '22P02') return Object.assign(new Error('The farmer update contains an invalid value.'), { statusCode: 400 });
  if (String(error.code || '').startsWith('08')) return Object.assign(new Error('The database is unavailable while saving this farmer. Please try again.'), { statusCode: 503 });
  if (error.code === 'COLLECTION_CENTER_ORGANIZATION_MISMATCH' || error.code === 'COLLECTOR_NOT_ASSIGNED_TO_DAIRY') {
    error.statusCode = 400;
  }
  return error;
};

const listFarmers = async ({ ownerUserId, search, center, cursor, limit, collectorUserId, sortBy, sortDirection, repository = defaultRepository }) => {
  if (!Number.isInteger(Number(ownerUserId)) || Number(ownerUserId) <= 0) throw new Error('Not authenticated.');
  const paging = normalizePaging({ search, center, cursor, limit, sortBy, sortDirection });
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
      merged.location = existing.location ?? null;
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
