const defaultRepository = require('../repositories/deductionRepository.js');
const { isIsoDate } = require('./milk-service.js');

const VALID_TYPES = ['Advance', 'Umwenda', 'Other'];
const VALID_STATUSES = ['Active', 'Cleared'];
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const normalizeInput = (input, { creating = false } = {}) => {
  const farmerId = Number(input.farmerId);
  const amount = Number(input.amount);
  if (creating && (!Number.isSafeInteger(farmerId) || farmerId <= 0)) throw badRequest('farmerId is required.');
  if (creating && (!Number.isFinite(amount) || amount <= 0)) throw badRequest('amount must be a positive number.');
  if (!creating && input.amount === undefined) throw badRequest('amount is required.');
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('amount must be a positive number.');
  if (creating && !isIsoDate(input.date)) throw badRequest('date must be a valid date (YYYY-MM-DD).');
  if (!creating && input.date === undefined) throw badRequest('date is required.');
  if (!isIsoDate(input.date)) throw badRequest('date must be a valid date (YYYY-MM-DD).');

  const type = input.type === undefined && !creating ? 'Other' : input.type ?? 'Other';
  const status = input.status === undefined && !creating ? 'Active' : input.status ?? 'Active';
  if (!VALID_TYPES.includes(type)) throw badRequest(`type must be one of: ${VALID_TYPES.join(', ')}.`);
  if (!VALID_STATUSES.includes(status)) throw badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}.`);
  const reason = input.reason === undefined ? null : input.reason;
  const notes = input.notes === undefined ? null : input.notes;
  if (reason !== null && (typeof reason !== 'string' || reason.length > 255)) throw badRequest('reason must be text of at most 255 characters.');
  if (notes !== null && typeof notes !== 'string') throw badRequest('notes must be text.');
  return { farmerId, amount, date: input.date, type, status, reason, notes };
};

const normalizeCursor = (value) => {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(String(value));
  if (!match || !isIsoDate(match[1])) throw badRequest('Invalid cursor.');
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid cursor.');
  return { date: match[1], id };
};

const createDeduction = async ({ ownerUserId, actorId = ownerUserId, input, repository = defaultRepository }) => {
  return repository.createDeduction({ ownerUserId: Number(ownerUserId), actorId: Number(actorId), input: normalizeInput(input, { creating: true }) });
};

const listDeductions = async ({ ownerUserId, farmerId, cursor, limit = 50, repository = defaultRepository }) => {
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw badRequest('limit must be an integer between 1 and 100.');
  const parsedFarmerId = farmerId ? Number(farmerId) : null;
  if (parsedFarmerId !== null && (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0)) throw badRequest('Invalid farmerId.');
  return repository.listDeductions({
    ownerUserId: Number(ownerUserId),
    farmerId: parsedFarmerId,
    cursor: normalizeCursor(cursor),
    limit: pageSize,
  });
};

const getDeduction = async ({ id, ownerUserId, repository = defaultRepository }) => {
  const deductionId = Number(id);
  if (!Number.isSafeInteger(deductionId) || deductionId <= 0) throw badRequest('Invalid deduction ID.');
  return repository.getDeduction(deductionId, Number(ownerUserId));
};

const updateDeduction = async ({ id, ownerUserId, actorId = ownerUserId, input, repository = defaultRepository }) => {
  const deductionId = Number(id);
  if (!Number.isSafeInteger(deductionId) || deductionId <= 0) throw badRequest('Invalid deduction ID.');
  return repository.updateDeduction({
    id: deductionId,
    ownerUserId: Number(ownerUserId),
    actorId: Number(actorId),
    input: normalizeInput(input),
  });
};

const deleteDeduction = async ({ id, ownerUserId, actorId = ownerUserId, repository = defaultRepository }) => {
  const deductionId = Number(id);
  if (!Number.isSafeInteger(deductionId) || deductionId <= 0) throw badRequest('Invalid deduction ID.');
  return repository.deleteDeduction({ id: deductionId, ownerUserId: Number(ownerUserId), actorId: Number(actorId) });
};

module.exports = { VALID_TYPES, VALID_STATUSES, normalizeInput, normalizeCursor, createDeduction, listDeductions, getDeduction, updateDeduction, deleteDeduction };
