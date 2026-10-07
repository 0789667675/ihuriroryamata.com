const defaultRepository = require('../repositories/auditRepository.js');
const { isIsoDate } = require('./milk-service.js');

const SENSITIVE_KEY_PATTERN = /password|passwd|token|secret|authorization|cookie|sessionid/i;
const sanitize = (value, key = '') => {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = SENSITIVE_KEY_PATTERN.test(childKey) ? '[REDACTED]' : sanitize(childValue, childKey);
    }
    return output;
  }
  return value;
};

const listAuditLogs = async ({ ownerUserId, page = 1, limit = 50, entityType, action, startDate, endDate, repository = defaultRepository }) => {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) throw Object.assign(new Error('page must be a positive integer.'), { statusCode: 400 });
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw Object.assign(new Error('limit must be between 1 and 100.'), { statusCode: 400 });
  if ((startDate && !isIsoDate(startDate)) || (endDate && !isIsoDate(endDate))) {
    throw Object.assign(new Error('Invalid date range. Expected YYYY-MM-DD.'), { statusCode: 400 });
  }
  if (startDate && endDate && startDate > endDate) throw Object.assign(new Error('startDate must be on or before endDate.'), { statusCode: 400 });
  return repository.listAuditLogs({
    ownerUserId: Number(ownerUserId),
    page: parsedPage,
    limit: parsedLimit,
    entityType: entityType ? String(entityType).slice(0, 100) : null,
    action: action ? String(action).slice(0, 100) : null,
    startDate: startDate || null,
    endDate: endDate || null,
  });
};

const createAuditLog = async (input) => defaultRepository.createAuditLog({
  ...input,
  details: sanitize(input.details),
});

module.exports = { sanitize, listAuditLogs, createAuditLog };
