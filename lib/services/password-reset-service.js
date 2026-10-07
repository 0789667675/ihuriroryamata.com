const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { validatePassword } = require('./auth-service.js');
const { normalizeEmail, repository: userRepository } = require('../repositories/userRepository.js');
const { passwordResetRepository } = require('../repositories/passwordResetRepository.js');
const emailService = require('./email-service.js');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 10 * 60 * 1000;
const RESEND_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;

const getSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error('Session security is not configured.');
    error.code = 'SESSION_SECRET_NOT_CONFIGURED';
    throw error;
  }
  return secret;
};

const hashSecret = (value) => crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
const genericRequestResult = { ok: true, message: 'If an account matches that email, password reset instructions will be sent.' };
const invalidCodeError = () => Object.assign(new Error('That code is invalid or expired. Request a new code and try again.'), { statusCode: 400, code: 'INVALID_RESET_CODE' });

const requestPasswordReset = async ({ email, ipAddress, language = 'rw', repository = passwordResetRepository, users = userRepository, mailer = emailService }) => {
  const normalizedEmail = normalizeEmail(email);
  const emailKey = hashSecret(`request:email:${normalizedEmail}`);
  const ipKey = hashSecret(`request:ip:${ipAddress || 'unknown'}`);
  const emailAllowed = await repository.consumeRateLimit(emailKey, 5, 60 * 60);
  const ipAllowed = await repository.consumeRateLimit(ipKey, 20, 60 * 60);
  if (!emailAllowed || !ipAllowed || !normalizedEmail.includes('@') || normalizedEmail.length > 255) return genericRequestResult;

  const user = await users.findUserByEmail(normalizedEmail);
  if (!user) return genericRequestResult;

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hashSecret(`code:${normalizedEmail}:${code}`);
  const created = await repository.createCode({
    userId: user.id,
    codeHash,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    resendSeconds: RESEND_SECONDS,
  });
  if (!created) return genericRequestResult;

  try {
    await mailer.sendPasswordResetCode({ email: normalizedEmail, code, language: language === 'en' ? 'en' : 'rw' });
  } catch {
    await repository.deleteCode(codeHash).catch(() => undefined);
  }
  return genericRequestResult;
};

const verifyPasswordResetCode = async ({ email, code, ipAddress, repository = passwordResetRepository, users = userRepository }) => {
  const normalizedEmail = normalizeEmail(email);
  const ipKey = hashSecret(`verify:ip:${ipAddress || 'unknown'}`);
  const allowed = await repository.consumeRateLimit(ipKey, 30, 60 * 60);
  if (!allowed || !/^\d{6}$/.test(String(code || '')) || !normalizedEmail.includes('@')) throw invalidCodeError();
  const user = await users.findUserByEmail(normalizedEmail);
  if (!user) throw invalidCodeError();

  const resetToken = crypto.randomBytes(32).toString('base64url');
  const accepted = await repository.exchangeCode({
    userId: user.id,
    codeHash: hashSecret(`code:${normalizedEmail}:${code}`),
    resetTokenHash: hashSecret(`reset:${resetToken}`),
    resetExpiresAt: new Date(Date.now() + RESET_TTL_MS),
    maxAttempts: MAX_CODE_ATTEMPTS,
  });
  if (!accepted) throw invalidCodeError();
  return resetToken;
};

const resetPassword = async ({ resetToken, password, repository = passwordResetRepository }) => {
  const passwordError = validatePassword(password);
  if (passwordError) throw Object.assign(new Error(passwordError), { statusCode: 400, code: 'INVALID_PASSWORD' });
  if (typeof resetToken !== 'string' || resetToken.length < 40) throw invalidCodeError();
  const passwordHash = await bcrypt.hash(password, 10);
  const completed = await repository.completeReset({
    resetTokenHash: hashSecret(`reset:${resetToken}`),
    passwordHash,
  });
  if (!completed) throw invalidCodeError();
  return { ok: true };
};

module.exports = {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
};