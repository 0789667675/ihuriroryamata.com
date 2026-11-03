const defaultRepository = require('../repositories/collectorAssignmentRepository.js');
const Domain = require('../repositories/domainRepository.js');

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const requireDairy = async (dairyUserId, getAccount = Domain.getAccount) => {
  const account = await getAccount(Number(dairyUserId));
  if (!account || account.account_type !== 'COLLECTION_CENTER') {
    throw Object.assign(new Error('Only a COLLECTION_CENTER account can manage collector assignments.'), { code: 'NOT_A_DAIRY_ACCOUNT', statusCode: 403 });
  }
  if (account.account_status === 'suspended') {
    throw Object.assign(new Error('That collection center account is suspended.'), { code: 'DAIRY_ACCOUNT_SUSPENDED', statusCode: 403 });
  }
};

const requireCollector = async (collectorUserId, getAccount = Domain.getAccount) => {
  const account = await getAccount(Number(collectorUserId));
  if (!account || account.account_type !== 'COLLECTOR') {
    throw Object.assign(new Error('Only a COLLECTOR account can request a collection center link.'), { code: 'NOT_A_COLLECTOR_ACCOUNT', statusCode: 403 });
  }
  if (account.account_status === 'suspended') {
    throw Object.assign(new Error('That collector account is suspended.'), { code: 'COLLECTOR_ACCOUNT_SUSPENDED', statusCode: 403 });
  }
};

const parseId = (value, message, code) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error(message), { statusCode: 400, code });
  return id;
};

const parseNote = (value, message) => {
  if (value === undefined || value === null) return null;
  const note = String(value).trim();
  if (!note) return null;
  if (note.length > 500) throw Object.assign(new Error(message), { statusCode: 400, code: 'NOTE_TOO_LONG' });
  return note;
};

const parseRequestStatus = (status, fallback = null) => {
  if (status === undefined || status === null || status === '') return fallback;
  const normalized = String(status).toLowerCase();
  if (normalized === 'all') return null;
  if (!REQUEST_STATUSES.includes(normalized)) {
    throw Object.assign(new Error('status must be pending, approved, rejected, cancelled, or all.'), { statusCode: 400, code: 'INVALID_REQUEST_STATUS' });
  }
  return normalized;
};

const listAssignments = async ({ dairyUserId, centerId = null, sortDirection = 'asc', repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const direction = String(sortDirection || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) throw Object.assign(new Error('sortDirection must be asc or desc.'), { statusCode: 400 });
  const parsedCenterId = centerId === null || centerId === undefined || centerId === '' ? null : Number(centerId);
  if (parsedCenterId !== null && (!Number.isSafeInteger(parsedCenterId) || parsedCenterId <= 0)) {
    throw Object.assign(new Error('Invalid collection center id.'), { statusCode: 400 });
  }
  return repository.getAssignments(Number(dairyUserId), parsedCenterId, direction);
};

const assignCollector = async ({ dairyUserId, actorId = dairyUserId, collectorUserId, collectorEmail = null, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const id = parseId(collectorUserId, 'A valid collector account is required.', 'INVALID_COLLECTOR_ID');
  const input = {
    dairyUserId: Number(dairyUserId),
    assignedBy: Number(actorId),
    collectorUserId: id,
  };
  const email = String(collectorEmail || '').trim();
  if (email) input.collectorEmail = email;
  return repository.assignCollector(input);
};

const revokeAssignment = async ({ dairyUserId, actorId = dairyUserId, collectorUserId, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const id = parseId(collectorUserId, 'Invalid collector id.', 'INVALID_COLLECTOR_ID');
  return repository.revokeAssignment({ dairyUserId: Number(dairyUserId), collectorUserId: id, actorId: Number(actorId) });
};

const suspendAssignment = async ({ dairyUserId, actorId = dairyUserId, collectorUserId, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const id = parseId(collectorUserId, 'Invalid collector id.', 'INVALID_COLLECTOR_ID');
  return repository.suspendAssignment({ dairyUserId: Number(dairyUserId), collectorUserId: id, actorId: Number(actorId) });
};

const requestAssignment = async ({ collectorUserId, dairyUserId, requestNote = null, repository = defaultRepository, getAccount }) => {
  const collectorId = parseId(collectorUserId, 'Invalid collector id.', 'INVALID_COLLECTOR_ID');
  const dairyId = parseId(dairyUserId, 'A valid collection center account is required.', 'INVALID_DAIRY_ID');
  await requireCollector(collectorId, getAccount);
  return repository.requestAssignment({
    dairyUserId: dairyId,
    collectorUserId: collectorId,
    requestedBy: collectorId,
    requestNote: parseNote(requestNote, 'Request note must be 500 characters or fewer.'),
  });
};

const listCollectorRequests = async ({ collectorUserId, status = null, repository = defaultRepository, getAccount }) => {
  const collectorId = parseId(collectorUserId, 'Invalid collector id.', 'INVALID_COLLECTOR_ID');
  await requireCollector(collectorId, getAccount);
  return repository.getCollectorRequests({ collectorUserId: collectorId, status: parseRequestStatus(status, null) });
};

const listDairyRequests = async ({ dairyUserId, status = 'pending', repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  return repository.getDairyRequests({ dairyUserId: Number(dairyUserId), status: parseRequestStatus(status, 'pending') });
};

const decideAssignmentRequest = async ({ requestId, dairyUserId, actorId = dairyUserId, decision, decisionNote = null, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const id = parseId(requestId, 'Invalid request id.', 'INVALID_REQUEST_ID');
  const normalizedDecision = String(decision || '').toLowerCase();
  if (!['approve', 'reject'].includes(normalizedDecision)) {
    throw Object.assign(new Error('Decision must be approve or reject.'), { statusCode: 400, code: 'INVALID_DECISION' });
  }
  return repository.decideRequest({
    requestId: id,
    dairyUserId: Number(dairyUserId),
    actorId: Number(actorId),
    decision: normalizedDecision,
    decisionNote: parseNote(decisionNote, 'Decision note must be 500 characters or fewer.'),
  });
};

const cancelAssignmentRequest = async ({ requestId, collectorUserId, repository = defaultRepository, getAccount }) => {
  const collectorId = parseId(collectorUserId, 'Invalid collector id.', 'INVALID_COLLECTOR_ID');
  await requireCollector(collectorId, getAccount);
  return repository.cancelRequest({
    requestId: parseId(requestId, 'Invalid request id.', 'INVALID_REQUEST_ID'),
    collectorUserId: collectorId,
    actorId: collectorId,
  });
};

module.exports = {
  requireDairy,
  requireCollector,
  listAssignments,
  assignCollector,
  revokeAssignment,
  suspendAssignment,
  requestAssignment,
  listCollectorRequests,
  listDairyRequests,
  decideAssignmentRequest,
  cancelAssignmentRequest,
};
