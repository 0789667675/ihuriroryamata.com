const crypto = require('node:crypto');

const defaultRepository = require('../repositories/platformAdminRepository.js');
const defaultUserRepository = require('../repositories/userRepository.js').repository;
const defaultAccountService = require('./account-service.js');
const defaultRateLimits = require('../repositories/passwordResetRepository.js').passwordResetRepository;

const VALID_STATUS_FILTERS = new Set(['none', 'not_approved', 'pending', 'active', 'suspended', 'expired', 'exempt']);
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const resendRateKey = (userId) => crypto.createHash('sha256').update(`admin-resend-verification:${userId}`).digest('hex');

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

const resendVerificationEmail = async ({
  userId,
  actorId = null,
  baseUrl = null,
  repository = defaultRepository,
  userRepository = defaultUserRepository,
  rateLimits = defaultRateLimits,
  accountService = defaultAccountService,
  mailer,
  audit = true,
}) => {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid userId.');
  const details = await repository.getAccountDetails(id);
  const account = details && (details.account || details);
  if (!account) return null;
  if (account.email_verified === true || account.emailVerified === true) {
    throw Object.assign(new Error('Account email is already verified.'), { statusCode: 409, code: 'ALREADY_VERIFIED' });
  }
  if (!account.email) throw badRequest('User has no email address.');
  if (!baseUrl) {
    throw Object.assign(new Error('Email verification is not configured. Set NEXT_PUBLIC_APP_URL or FRONTEND_URL.'), {
      statusCode: 503,
      code: 'PUBLIC_APP_URL_NOT_CONFIGURED',
    });
  }
  const allowed = await rateLimits.consumeRateLimit(resendRateKey(id), 5, 60 * 60);
  if (!allowed) {
    throw Object.assign(new Error('Too many verification emails for this account. Try again later.'), {
      statusCode: 429,
      code: 'RESEND_RATE_LIMITED',
    });
  }
  const result = await accountService.sendRegistrationEmailVerification({
    userId: id,
    baseUrl,
    language: account.language === 'en' ? 'en' : 'rw',
    repository: userRepository,
    ...(mailer ? { mailer } : {}),
  });
  if (result && result.alreadyVerified) {
    throw Object.assign(new Error('Account email is already verified.'), { statusCode: 409, code: 'ALREADY_VERIFIED' });
  }
  const parsedActorId = Number(actorId);
  let auditRecorded = false;
  if (audit && Number.isSafeInteger(parsedActorId) && parsedActorId > 0) {
    try {
      await repository.writeAdminAudit({
        actorId: parsedActorId,
        userId: id,
        entityType: 'auth',
        action: 'email_verification_resent',
        details: { userId: id },
      });
      auditRecorded = true;
    } catch {
      // The provider already accepted the message. Do not report failure here,
      // because a retry could send a duplicate verification email.
      auditRecorded = false;
    }
  }
  return { ok: true, userId: id, email: account.email, auditRecorded };
};

const manageAccount = async ({ userId, actorId, action, input = {}, baseUrl = null, repository = defaultRepository, userRepository, rateLimits, accountService, mailer }) => {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid userId.');
  const details = await repository.getAccountDetails(id);
  if (!details) return null;
  let result;
  let entityType = 'user_subscription';
  let auditHandled = false;
  const data = {};

  if (action === 'suspend' || action === 'reactivate') {
    entityType = 'user_account';
    const accountStatus = action === 'suspend' ? 'suspended' : 'active';
    result = await repository.setAccountStatus({ userId: id, accountStatus });
    data.accountStatus = accountStatus;
  } else if (action === 'resendVerification') {
    entityType = 'auth';
    result = await resendVerificationEmail({
      userId: id,
      actorId,
      baseUrl,
      repository,
      ...(userRepository ? { userRepository } : {}),
      ...(rateLimits ? { rateLimits } : {}),
      ...(accountService ? { accountService } : {}),
      ...(mailer ? { mailer } : {}),
    });
    auditHandled = true;
    data.emailResent = true;
  } else if (action === 'grant-exemption' || action === 'revoke-exemption') {
    const parsedActorId = Number(actorId);
    if (typeof input.reason !== 'string') throw badRequest('An exemption reason of 5 to 255 characters is required.');
    const reason = input.reason.trim();
    if (!Number.isSafeInteger(parsedActorId) || parsedActorId <= 0) throw badRequest('Invalid exemption administrator.');
    if (reason.length < 5 || reason.length > 255) throw badRequest('An exemption reason of 5 to 255 characters is required.');
    const exempt = action === 'grant-exemption';
    result = await repository.setSubscriptionExemption({ userId: id, actorId: parsedActorId, exempt, reason });
    entityType = 'user_subscription';
    data.billingExempt = exempt;
    data.reason = reason;
  } else {
    throw badRequest('Unsupported account action.');
  }

  const auditAction = ({
    suspend: 'customer_suspended',
    reactivate: 'customer_reenabled',
    'grant-exemption': 'subscription_exemption_granted',
    'revoke-exemption': 'subscription_exemption_revoked',
    'resendVerification': 'email_verification_resent',
  })[action];
  if (!auditHandled && !['grant-exemption', 'revoke-exemption'].includes(action)) {
    await repository.writeAdminAudit({
      actorId: Number(actorId),
      userId: id,
      entityType,
      action: auditAction,
      details: { userId: id, ...data },
    });
  }
  return result;
};

module.exports = { VALID_STATUS_FILTERS, listAccounts, getAccountDetails, getAccountsSummary, manageAccount, resendVerificationEmail };
