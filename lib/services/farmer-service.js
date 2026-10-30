const defaultRepository = require('../repositories/domainRepository.js');
const {
  CANONICAL_FARMER_FIELDS,
  defaultFieldConfig,
  fieldLimit,
  MAX_LENGTHS,
  resolveFieldConfig,
} = require('../imports/farmer-field-config.js');

/**
 * Canonical farmer fields shared by normal registration and import.
 * Derived from the single field-definition source so both workflows validate
 * and present the same fields. `location` is handled separately by the
 * repository and is not part of the import/registration field contract.
 */
const CANONICAL_FIELD_KEYS = CANONICAL_FARMER_FIELDS
  .filter((field) => !field.system)
  .map((field) => field.key);

const DEFAULT_CONFIG = defaultFieldConfig().filter((field) => !field.system);
const STRING_LIMITS = Object.fromEntries(
  DEFAULT_CONFIG.filter((field) => field.enabled).map((field) => [field.key, fieldLimit(field.key)]),
);
const FARMER_FIELDS = Object.keys(STRING_LIMITS);
const FARMER_SORT_FIELDS = ['name', 'nationalId', 'collectionCenter'];
const getOwnerFieldConfig = async (ownerUserId, repository = defaultRepository) => {
  if (!ownerUserId || !repository || typeof repository.listFarmerFieldConfigurations !== 'function') {
    return DEFAULT_CONFIG;
  }
  try {
    const stored = await repository.listFarmerFieldConfigurations(ownerUserId);
    if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_CONFIG;
    return resolveFieldConfig(stored).filter((field) => !field.system);
  } catch {
    return DEFAULT_CONFIG;
  }
};

const normalizeText = (value, field, { required = false, limit } = {}) => {
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

const normalizeFarmerInput = (input, { create = false, fieldConfig = null } = {}) => {
  const config = Array.isArray(fieldConfig) && fieldConfig.length > 0 ? fieldConfig : DEFAULT_CONFIG;
  const limits = Object.fromEntries(
    config.filter((field) => field.enabled).map((field) => [field.key, fieldLimit(field.key)])
  );
  const requiredKeys = new Set(
    config.filter((field) => field.enabled && field.required).map((field) => field.key)
  );
  const normalized = {};
  for (const field of FARMER_FIELDS) {
    const isRequired = create && (field === 'name' || requiredKeys.has(field));
    const limit = limits[field] !== undefined ? limits[field] : STRING_LIMITS[field];
    normalized[field] = normalizeText(input[field], field, {
      required: isRequired,
      limit,
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
  if (input.farmerNumber !== undefined || input.farmer_number !== undefined) {
    const rawNumber = input.farmerNumber !== undefined ? input.farmerNumber : input.farmer_number;
    if (rawNumber !== null && rawNumber !== '') {
      const parsed = Number(rawNumber);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        normalized.farmerNumber = parsed;
      } else {
        normalized.farmerNumber = null;
      }
    } else {
      normalized.farmerNumber = null;
    }
  }
  return normalized;
};

const normalizePaging = ({ search, center, cursor, limit, sortBy, sortDirection }) => {
  const pageSize = limit === undefined || limit === null || limit === '' ? 50 : Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw Object.assign(new Error('limit must be an integer between 1 and 100.'), { statusCode: 400 });
  }
  const normalizedSortBy = FARMER_SORT_FIELDS.includes(sortBy) ? sortBy : 'id';
  const normalizedSortDirection = ['asc', 'desc'].includes(sortDirection) ? sortDirection : 'desc';
  let normalizedCursor = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const cursorValue = String(cursor);
    if (normalizedSortBy === 'id') {
      normalizedCursor = Number(cursorValue);
      if (!Number.isSafeInteger(normalizedCursor) || normalizedCursor <= 0) throw Object.assign(new Error('cursor must be a positive integer.'), { statusCode: 400 });
    } else {
      try {
        if (!cursorValue.startsWith('s1.')) throw new Error();
        const decoded = JSON.parse(Buffer.from(cursorValue.slice(3), 'base64url').toString('utf8'));
        if (decoded.sortBy !== normalizedSortBy || decoded.sortDirection !== normalizedSortDirection
          || !Number.isSafeInteger(decoded.id) || decoded.id <= 0 || typeof decoded.value !== 'string') throw new Error();
        normalizedCursor = { value: decoded.value, id: decoded.id };
      } catch {
        throw Object.assign(new Error('Invalid farmer list cursor.'), { statusCode: 400 });
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
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('A valid collector is required.'), { statusCode: 400 });
  return id;
};

const toHttpError = (error) => {
  if (error.code === '23505') {
    const constraint = String(error.constraint || '');
    if (constraint.includes('farmer_number')) return Object.assign(new Error('Iyi nimero irasanzwe ikoreshwa n’undi mworozi.'), { statusCode: 409 });
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
    const fieldConfig = await getOwnerFieldConfig(ownerUserId, repository);
    const farmerInput = normalizeFarmerInput(input, { create: true, fieldConfig });
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
    const fieldConfig = await getOwnerFieldConfig(ownerUserId, repository);
    const changes = normalizeFarmerInput(input, { fieldConfig });
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
    if (Object.prototype.hasOwnProperty.call(input, 'farmerNumber') || Object.prototype.hasOwnProperty.call(input, 'farmer_number')) {
      merged.farmerNumber = input.farmerNumber !== undefined ? input.farmerNumber : input.farmer_number;
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

const IMPORT_MAX_ROWS = 500;

const importFarmers = async ({
  rows,
  ownerUserId,
  actorId = ownerUserId,
  batchKey,
  dryRun = false,
  repository = defaultRepository,
}) => {
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('Add at least one farmer to import.'), { statusCode: 400, code: 'IMPORT_EMPTY' });
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw Object.assign(new Error(`Import at most ${IMPORT_MAX_ROWS} farmers at a time.`), { statusCode: 400, code: 'IMPORT_LIMIT' });
  }
  const key = String(batchKey || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(key)) {
    throw Object.assign(new Error('A valid import key is required.'), { statusCode: 400, code: 'IMPORT_KEY_INVALID' });
  }

  const fieldConfig = await getOwnerFieldConfig(ownerUserId, repository);
  const prepared = rows.map((row, index) => {
    const rowNumber = Number.isSafeInteger(Number(row?.rowNumber)) && Number(row.rowNumber) > 0
      ? Number(row.rowNumber)
      : index + 1;
    if (row?.excluded) {
      return { rowNumber, error: true, errorCode: 'EXCLUDED', message: 'Row was excluded during review.' };
    }
    try {
      const input = normalizeFarmerInput(row, { create: true, fieldConfig });
      return { rowNumber, input };
    } catch (error) {
      return {
        rowNumber,
        error: true,
        errorCode: 'VALIDATION_ERROR',
        message: error instanceof Error ? error.message : 'This row is invalid.',
      };
    }
  });

  const result = await repository.createFarmersBatch({
    rows: prepared,
    ownerUserId: Number(ownerUserId),
    actorId: Number(actorId),
    batchKey: key,
    dryRun: Boolean(dryRun),
  });

  if (!dryRun && !result.idempotent && Number(result.created) > 0) {
    try {
      const Notifications = require('./notification-service.js');
      await Notifications.createFarmerImportNotification({
        count: Number(result.created),
        batchId: result.batchId,
        ownerUserId: Number(ownerUserId),
      });
    } catch {
      // Import persistence must not depend on notification availability.
    }
  }
  return result;
};

module.exports = {
  STRING_LIMITS,
  normalizeFarmerInput,
  normalizePaging,
  listFarmers,
  getFarmer,
  createFarmer,
  importFarmers,
  updateFarmer,
  deleteFarmer,
};
