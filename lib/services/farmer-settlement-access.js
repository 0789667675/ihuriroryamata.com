const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const requireOwner = (user) => {
  if (!user || user.role !== 'user' || user.accountType !== 'COLLECTION_CENTER') {
    throw fail('This action is available to collection center owners only.', 403);
  }
  return user;
};

const requireOwnerAction = (user, action) => {
  if (!['cash', 'debt', 'debt-repayment'].includes(action)) throw fail('Unsupported owner settlement action.', 400);
  return requireOwner(user);
};

const requireCollector = (user) => {
  if (!user || user.role !== 'user' || user.accountType !== 'COLLECTOR') {
    throw fail('Payment confirmation is available to collectors only.', 403);
  }
  return user;
};

const assertOwnerScope = (user, ownerUserId) => {
  if (!user || Number(user.id) !== Number(ownerUserId)) throw fail('You do not own this settlement account.', 403);
};

const assertAssignedCollector = (user, assignedCollectorUserId) => {
  requireCollector(user);
  if (!assignedCollectorUserId || Number(user.id) !== Number(assignedCollectorUserId)) {
    throw fail('Settlement not found for your collector assignment.', 404);
  }
};

const parsePositiveId = (value, fieldName) => {
  const valueNumber = Number(value);
  if (!Number.isSafeInteger(valueNumber) || valueNumber <= 0) throw fail(`${fieldName} must be a positive integer.`);
  return valueNumber;
};

const parsePositiveAmount = (value, fieldName = 'amount') => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
    throw fail(`${fieldName} must be a positive amount with at most two decimal places.`);
  }
  return amount;
};

const parsePeriod = (periodStart, periodEnd) => {
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) {
    throw fail('A valid period start and end date are required.');
  }
  return { periodStart, periodEnd };
};

module.exports = { requireOwner, requireOwnerAction, requireCollector, assertOwnerScope, assertAssignedCollector, parsePositiveId, parsePositiveAmount, parsePeriod };
