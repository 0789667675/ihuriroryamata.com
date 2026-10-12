const defaultRepository = require('../repositories/platformAdminRepository.js');

const VALID_STATUS_FILTERS = new Set(['none', 'not_approved', 'pending', 'active', 'suspended', 'expired']);
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const listAccounts = async ({ page = 1, limit = 20, search = '', status = '', repository = defaultRepository }) => {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) throw badRequest('page must be a positive integer.');
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw badRequest('limit must be between 1 and 100.');
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus && !VALID_STATUS_FILTERS.has(normalizedStatus)) throw badRequest('Invalid status filter.');
  return repository.listAccounts({ page: parsedPage, limit: parsedLimit, search: String(search || '').trim().slice(0, 100), status: normalizedStatus || null });
};

const getAccountDetails = async ({ userId, repository = defaultRepository }) => {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid userId.');
  return repository.getAccountDetails(id);
};

const getAccountsSummary = async ({ repository = defaultRepository } = {}) => repository.getAccountsSummary();

const manageAccount = async ({ userId, actorId, action, input = {}, repository = defaultRepository }) => {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid userId.');
  const details = await repository.getAccountDetails(id);
  if (!details) return null;
  let result;
  let entityType = 'user_subscription';
  const data = {};

  if (action === 'suspend' || action === 'reactivate') {
    entityType = 'user_account';
    const accountStatus = action === 'suspend' ? 'suspended' : 'active';
    result = await repository.setAccountStatus({ userId: id, accountStatus });
    data.accountStatus = accountStatus;
  } else {
    throw badRequest('Unsupported account action.');
  }

  const auditAction = ({
    suspend: 'customer_suspended',
    reactivate: 'customer_reenabled',
  })[action];
  await repository.writeAdminAudit({
    actorId: Number(actorId),
    userId: id,
    entityType,
    action: auditAction,
    details: { userId: id, ...data },
  });
  return result;
};

module.exports = { VALID_STATUS_FILTERS, listAccounts, getAccountDetails, getAccountsSummary, manageAccount };
