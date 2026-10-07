const defaultRepository = require('../repositories/collectorAssignmentRepository.js');
const Domain = require('../repositories/domainRepository.js');

const requireDairy = async (dairyUserId, getAccount = Domain.getAccount) => {
  const account = await getAccount(Number(dairyUserId));
  if (!account || account.account_type !== 'COLLECTION_CENTER') {
    throw Object.assign(new Error('Only a COLLECTION_CENTER account can manage collector assignments.'), { code: 'NOT_A_DAIRY_ACCOUNT', statusCode: 403 });
  }
};

const listAssignments = async ({ dairyUserId, centerId = null, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const parsedCenterId = centerId === null || centerId === undefined || centerId === '' ? null : Number(centerId);
  if (parsedCenterId !== null && (!Number.isSafeInteger(parsedCenterId) || parsedCenterId <= 0)) {
    throw Object.assign(new Error('Invalid collection center id.'), { statusCode: 400 });
  }
  return repository.getAssignments(Number(dairyUserId), parsedCenterId);
};

const assignCollector = async ({ dairyUserId, actorId = dairyUserId, collectorUserId, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const id = Number(collectorUserId);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('A valid collector account is required.'), { statusCode: 400, code: 'INVALID_COLLECTOR_ID' });
  return repository.assignCollector({ dairyUserId: Number(dairyUserId), assignedBy: Number(actorId), collectorUserId: id });
};

const revokeAssignment = async ({ dairyUserId, actorId = dairyUserId, collectorUserId, repository = defaultRepository, getAccount }) => {
  await requireDairy(dairyUserId, getAccount);
  const id = Number(collectorUserId);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Invalid collector id.'), { statusCode: 400, code: 'INVALID_COLLECTOR_ID' });
  return repository.revokeAssignment({ dairyUserId: Number(dairyUserId), collectorUserId: id, actorId: Number(actorId) });
};

module.exports = { requireDairy, listAssignments, assignCollector, revokeAssignment };
