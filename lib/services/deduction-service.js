const defaultRepository = require('../repositories/deductionRepository.js');
const { isIsoDate } = require('./milk-service.js');
const { DEDUCTION_FREQUENCIES, getUkweziPeriodKind, validateDeductionPeriod } = require('../utils/deduction-period.js');

const VALID_TYPES = ['Igipande', 'Advance', 'Umwenda', 'Other'];
const VALID_STATUSES = ['Active', 'Cleared'];
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const normalizeInput = (input, { creating = false } = {}) => {
  if (!input || typeof input !== 'object') throw badRequest('Deduction input is required.');

  const hasFarmerId = Object.prototype.hasOwnProperty.call(input, 'farmerId');
  const hasAmount = Object.prototype.hasOwnProperty.call(input, 'amount');
  const hasDate = Object.prototype.hasOwnProperty.call(input, 'date');
  const hasType = Object.prototype.hasOwnProperty.call(input, 'type');
  const hasStatus = Object.prototype.hasOwnProperty.call(input, 'status');
  const hasReason = Object.prototype.hasOwnProperty.call(input, 'reason');
  const hasNotes = Object.prototype.hasOwnProperty.call(input, 'notes');

  if (creating) {
    if (!hasFarmerId || input.farmerId === undefined || input.farmerId === null || input.farmerId === '') throw badRequest('farmerId is required.');
    if (!hasAmount || input.amount === undefined || input.amount === null || input.amount === '') throw badRequest('amount is required.');
  } else {
    if (!hasFarmerId || input.farmerId === undefined || input.farmerId === null || input.farmerId === '') throw badRequest('farmerId is required.');
    if (!hasAmount || input.amount === undefined || input.amount === null || input.amount === '') throw badRequest('amount is required.');
    if (!hasDate || input.date === undefined || input.date === null || input.date === '') throw badRequest('date is required.');
    if (!hasType || input.type === undefined || input.type === null || input.type === '') throw badRequest('type is required.');
    if (!hasStatus || input.status === undefined || input.status === null || input.status === '') throw badRequest('status is required.');
    if (!hasReason || input.reason === undefined) throw badRequest('reason is required.');
    if (!hasNotes || input.notes === undefined) throw badRequest('notes is required.');
  }

  const farmerId = Number(input.farmerId);
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(farmerId) || farmerId <= 0) throw badRequest('farmerId is required.');
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('amount must be a positive number.');

  const date = input.date;
  if (!isIsoDate(date)) throw badRequest('date must be a valid date (YYYY-MM-DD).');

  const type = String(input.type ?? 'Other');
  const status = String(input.status ?? 'Active');
  if (!VALID_TYPES.includes(type)) throw badRequest(`type must be one of: ${VALID_TYPES.join(', ')}.`);
  if (!VALID_STATUSES.includes(status)) throw badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}.`);

  const reason = input.reason === undefined ? null : input.reason;
  const notes = input.notes === undefined ? null : input.notes;
  if (reason !== null && (typeof reason !== 'string' || reason.length > 255)) throw badRequest('reason must be text of at most 255 characters.');
  if (notes !== null && typeof notes !== 'string') throw badRequest('notes must be text.');
  return { farmerId, amount, date, type, status, reason, notes };
};

const normalizeCursor = (value, sortBy = 'date', sortDirection = 'desc') => {
  if (!value) return null;
  if (sortBy === 'date' && !String(value).startsWith('d1.')) {
    const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(String(value));
    if (!match || !isIsoDate(match[1])) throw badRequest('Invalid cursor.');
    const id = Number(match[2]);
    if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid cursor.');
    return { date: match[1], id, value: match[1] };
  }
  try {
    const token = String(value);
    if (!token.startsWith('d1.')) throw new Error();
    const cursor = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    if (cursor.sortBy !== sortBy || cursor.sortDirection !== sortDirection || !isIsoDate(cursor.date)
      || !Number.isSafeInteger(cursor.id) || cursor.id <= 0
      || (sortBy === 'amount' ? !Number.isFinite(Number(cursor.value)) : typeof cursor.value !== 'string')) throw new Error();
    return cursor;
  } catch {
    throw badRequest('Invalid cursor.');
  }
};

const normalizeGroupCursor = (value, sortBy, sortDirection) => {
  if (!value) return null;
  try {
    const token = String(value);
    if (!token.startsWith('g1.')) throw new Error();
    const cursor = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    const validValue = sortBy === 'date'
      ? isIsoDate(cursor.value)
      : sortBy === 'amount'
        ? Number.isFinite(Number(cursor.value)) && Number(cursor.value) >= 0
        : typeof cursor.value === 'string';
    if (cursor.sortBy !== sortBy || cursor.sortDirection !== sortDirection || !validValue
      || !Number.isSafeInteger(cursor.farmerId) || cursor.farmerId <= 0) throw new Error();
    return cursor;
  } catch {
    throw badRequest('Invalid grouped deduction cursor.');
  }
};

const createDeduction = async ({ ownerUserId, collectorUserId = null, actorId = ownerUserId, input, repository = defaultRepository }) => {
  return repository.createDeduction({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    actorId: Number(actorId),
    input: normalizeInput(input, { creating: true }),
  });
};

const listDeductions = async ({ ownerUserId, collectorUserId = null, farmerId, type, status, search, sortBy = 'date', sortDirection = 'desc', cursor, limit = 50, repository = defaultRepository }) => {
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw badRequest('limit must be an integer between 1 and 100.');
  const parsedFarmerId = farmerId ? Number(farmerId) : null;
  if (parsedFarmerId !== null && (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0)) throw badRequest('Invalid farmerId.');
  if (type && !VALID_TYPES.includes(type)) throw badRequest('Invalid deduction type.');
  if (status && !VALID_STATUSES.includes(status)) throw badRequest('Invalid deduction status.');
  if (!['date', 'farmerName', 'amount'].includes(sortBy)) throw badRequest('Unsupported deduction sort field.');
  const direction = String(sortDirection || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) throw badRequest('sortDirection must be asc or desc.');
  return repository.listDeductions({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    farmerId: parsedFarmerId,
    type: type || null,
    status: status || null,
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    sortBy,
    sortDirection: direction,
    cursor: normalizeCursor(cursor, sortBy, direction),
    limit: pageSize,
  });
};

const listDeductionGroups = async ({ ownerUserId, collectorUserId = null, farmerId, type, status, search, sortBy = 'date', sortDirection = 'desc', cursor, limit = 50, repository = defaultRepository }) => {
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw badRequest('limit must be an integer between 1 and 100.');
  const parsedFarmerId = farmerId ? Number(farmerId) : null;
  if (parsedFarmerId !== null && (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0)) throw badRequest('Invalid farmerId.');
  if (type && !VALID_TYPES.includes(type)) throw badRequest('Invalid deduction type.');
  if (status && !VALID_STATUSES.includes(status)) throw badRequest('Invalid deduction status.');
  if (!['date', 'farmerName', 'amount'].includes(sortBy)) throw badRequest('Unsupported grouped deduction sort field.');
  const direction = String(sortDirection || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) throw badRequest('sortDirection must be asc or desc.');
  return repository.listFarmerDeductionGroups({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    farmerId: parsedFarmerId,
    type: type || null,
    status: status || null,
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    sortBy,
    sortDirection: direction,
    cursor: normalizeGroupCursor(cursor, sortBy, direction),
    limit: pageSize,
  });
};

const listFarmerPeriodLedger = async ({ ownerUserId, collectorUserId = null, periodStart, periodEnd, configurationId = null, farmerStatus = 'ALL', search = '', cursor = null, limit = 100, repository = defaultRepository }) => {
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw badRequest('limit must be an integer between 1 and 100.');
  if (getUkweziPeriodKind(periodStart, periodEnd) === null) throw badRequest('Choose a valid Ukwezi half-month or full-month period.');
  const statuses = ['ALL', 'DEDUCTED', 'NOT_DEDUCTED', 'PARTIALLY_DEDUCTED', 'OUTSTANDING_DEBT'];
  const status = String(farmerStatus || 'ALL').toUpperCase();
  if (!statuses.includes(status)) throw badRequest('Invalid farmer deduction status.');
  const parsedCursor = cursor ? Number(cursor) : null;
  if (parsedCursor !== null && (!Number.isSafeInteger(parsedCursor) || parsedCursor <= 0)) throw badRequest('Invalid farmer ledger cursor.');
  const parsedConfigurationId = configurationId ? Number(configurationId) : null;
  if (parsedConfigurationId !== null && (!Number.isSafeInteger(parsedConfigurationId) || parsedConfigurationId <= 0)) throw badRequest('Invalid deduction configuration ID.');
  return repository.listFarmerPeriodLedger({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    periodStart,
    periodEnd,
    configurationId: parsedConfigurationId,
    farmerStatus: status,
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    cursor: parsedCursor,
    limit: pageSize,
  });
};

const getDeduction = async ({ id, ownerUserId, collectorUserId = null, repository = defaultRepository }) => {
  const deductionId = Number(id);
  if (!Number.isSafeInteger(deductionId) || deductionId <= 0) throw badRequest('Invalid deduction ID.');
  return collectorUserId !== null && collectorUserId !== undefined
    ? repository.getDeduction(deductionId, Number(ownerUserId), Number(collectorUserId))
    : repository.getDeduction(deductionId, Number(ownerUserId));
};

const updateDeduction = async ({ id, ownerUserId, collectorUserId = null, actorId = ownerUserId, input, repository = defaultRepository }) => {
  const deductionId = Number(id);
  if (!Number.isSafeInteger(deductionId) || deductionId <= 0) throw badRequest('Invalid deduction ID.');
  return repository.updateDeduction({
    id: deductionId,
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    actorId: Number(actorId),
    input: normalizeInput(input),
  });
};

const deleteDeduction = async ({ id, ownerUserId, collectorUserId = null, actorId = ownerUserId, repository = defaultRepository }) => {
  const deductionId = Number(id);
  if (!Number.isSafeInteger(deductionId) || deductionId <= 0) throw badRequest('Invalid deduction ID.');
  return repository.deleteDeduction({
    id: deductionId,
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    actorId: Number(actorId),
  });
};

const normalizeConfiguration = (input) => {
  if (!input || typeof input !== 'object') throw badRequest('Deduction configuration is required.');
  const name = String(input.name || '').trim();
  const description = input.description == null || input.description === '' ? null : String(input.description);
  const amountPerFarmer = Number(input.amountPerFarmer);
  const type = String(input.type || 'Other');
  const eligibilityMode = String(input.eligibilityMode || 'ALL').toUpperCase();
  const frequency = String(input.frequency || '').toUpperCase();
  const effectiveStartDate = input.effectiveStartDate;
  const isActive = input.isActive === undefined ? true : input.isActive;
  const executionMode = String(input.executionMode || 'MANUAL').toUpperCase();
  const eligibleFarmerIds = Array.isArray(input.eligibleFarmerIds) ? input.eligibleFarmerIds.map(Number) : [];
  if (!name || name.length > 120) throw badRequest('Configuration name must be 1 to 120 characters.');
  if (description !== null && description.length > 2000) throw badRequest('Configuration description must be at most 2000 characters.');
  if (!Number.isFinite(amountPerFarmer) || amountPerFarmer <= 0) throw badRequest('Amount per farmer must be positive.');
  if (!VALID_TYPES.includes(type)) throw badRequest(`type must be one of: ${VALID_TYPES.join(', ')}.`);
  if (!['ALL', 'SELECTED'].includes(eligibilityMode)) throw badRequest('Choose all farmers or selected farmers.');
  if (eligibilityMode === 'SELECTED' && (!eligibleFarmerIds.length || eligibleFarmerIds.some((id) => !Number.isSafeInteger(id) || id <= 0))) {
    throw badRequest('Selected-farmer eligibility requires valid farmer IDs.');
  }
  if (!DEDUCTION_FREQUENCIES.includes(frequency)) throw badRequest('Choose a supported deduction frequency.');
  if (!isIsoDate(effectiveStartDate)) throw badRequest('Effective start date must be a valid date (YYYY-MM-DD).');
  if (typeof isActive !== 'boolean') throw badRequest('isActive must be true or false.');
  if (executionMode !== 'MANUAL') throw badRequest('Only manual deductions are supported; configuration never deducts automatically.');
  return { name, description, amountPerFarmer, type, eligibilityMode, eligibleFarmerIds, frequency, effectiveStartDate, isActive, executionMode };
};

const listDeductionConfigurations = async ({ ownerUserId, collectorUserId = null, repository = defaultRepository }) =>
  repository.listDeductionConfigurations({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
  });

const createDeductionConfiguration = async ({ ownerUserId, collectorUserId = null, actorId = ownerUserId, input, repository = defaultRepository }) =>
  repository.createDeductionConfiguration({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    actorId: Number(actorId),
    input: normalizeConfiguration(input),
  });

const updateDeductionConfiguration = async ({ id, ownerUserId, collectorUserId = null, actorId = ownerUserId, input, repository = defaultRepository }) => {
  const configurationId = Number(id);
  if (!Number.isSafeInteger(configurationId) || configurationId <= 0) throw badRequest('Invalid deduction configuration ID.');
  return repository.updateDeductionConfiguration({
    id: configurationId,
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    actorId: Number(actorId),
    input: normalizeConfiguration(input),
  });
};

const applyDeductionBatch = async ({ ownerUserId, collectorUserId = null, actorId = ownerUserId, input, repository = defaultRepository }) => {
  if (!input || typeof input !== 'object') throw badRequest('Deduction batch is required.');
  const configurationId = Number(input.configurationId);
  const farmerIds = Array.isArray(input.farmerIds) ? input.farmerIds.map(Number) : [];
  const requestKey = String(input.requestKey || '').trim();
  if (!Number.isSafeInteger(configurationId) || configurationId <= 0) throw badRequest('A valid deduction configuration is required.');
  if (!farmerIds.length || farmerIds.length > 100 || farmerIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw badRequest('Select between 1 and 100 valid farmers.');
  }
  if (new Set(farmerIds).size !== farmerIds.length) throw badRequest('A farmer may only appear once in a batch.');
  if (!requestKey || requestKey.length > 160) throw badRequest('A valid idempotency request key is required.');
  if (getUkweziPeriodKind(input.periodStart, input.periodEnd) === null) throw badRequest('Choose a valid Ukwezi half-month or full-month period.');
  return repository.applyDeductionBatch({
    ownerUserId: Number(ownerUserId),
    ...(collectorUserId !== null && collectorUserId !== undefined ? { collectorUserId: Number(collectorUserId) } : {}),
    actorId: Number(actorId),
    configurationId,
    farmerIds,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    requestKey,
  });
};

module.exports = { VALID_TYPES, VALID_STATUSES, normalizeInput, normalizeCursor, normalizeGroupCursor, normalizeConfiguration, createDeduction, listDeductions, listDeductionGroups, listFarmerPeriodLedger, listDeductionConfigurations, createDeductionConfiguration, updateDeductionConfiguration, applyDeductionBatch, getDeduction, updateDeduction, deleteDeduction };
