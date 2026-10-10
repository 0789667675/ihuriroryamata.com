const defaultRepository = require('../repositories/platformAdminRepository.js');

const VALID_STATUS_FILTERS = new Set(['none', 'not_approved', 'pending', 'trial', 'active', 'suspended', 'expired']);
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
  } else if (action === 'activate' || action === 'grant-trial' || action === 'extend-trial') {
    if (action === 'extend-trial' && !(typeof input.reason === 'string' && input.reason.trim())) {
      throw badRequest('A reason is required for a manual extension.');
    }
    let extendDays = null;
    if (action === 'grant-trial') {
      const days = input.days === undefined ? 15 : Number(input.days);
      if (days !== 15) throw badRequest('Trials are exactly 15 days.');
    }
    if (action === 'extend-trial') {
      extendDays = input.days === undefined ? 15 : Number(input.days);
      if (!Number.isInteger(extendDays) || extendDays < 1 || extendDays > 3650) {
        throw badRequest('Extension days must be an integer between 1 and 3650.');
      }
    }
    result = await repository.updateUserSubscription({
      userId: id,
      status: action === 'activate' ? 'active' : action === 'extend-trial' ? 'trial' : null,
      extendDays,
      grantTrial: action === 'grant-trial',
    });
    if (!result) return null;
    data.status = result.status;
    if (action === 'extend-trial') {
      data.days = extendDays;
      data.reason = input.reason.trim().slice(0, 500);
    }
  } else {
    throw badRequest('Unsupported account action.');
  }

  const auditAction = ({
    activate: 'customer_activated',
    'grant-trial': 'customer_trial_granted',
    'extend-trial': 'customer_trial_extended',
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
