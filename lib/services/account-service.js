const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { repository: defaultRepository, normalizeEmail } = require('../repositories/userRepository.js');
const { passwordResetRepository } = require('../repositories/passwordResetRepository.js');
const { createAuditLog: defaultAudit } = require('./audit-service.js');
const defaultEmailService = require('./email-service.js');
const { validatePassword } = require('./auth-service.js');

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const serviceUnavailable = (message) => Object.assign(new Error(message), { statusCode: 503, code: 'EMAIL_DELIVERY_UNAVAILABLE' });

const getSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error('Session security is not configured.'), { code: 'SESSION_SECRET_NOT_CONFIGURED' });
  }
  return secret;
};

const hashToken = (token) => crypto.createHmac('sha256', getSecret()).update(token).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizedPhone = (value) => String(value || '').trim().replace(/[\s-]/g, '');

const normalizeProfile = (input, existing) => {
  const name = input.name === undefined ? existing.name : String(input.name).trim();
  const email = normalizeEmail(input.email === undefined ? existing.email : input.email);
  const phone = input.phone === undefined ? String(existing.phone || '') : String(input.phone).trim();
  const nationalId = input.nationalId === undefined ? existing.nationalId : String(input.nationalId || '').trim();
  const accountNumber = input.accountNumber === undefined ? existing.accountNumber : String(input.accountNumber || '').trim();
  const profilePicture = input.profilePicture === undefined ? existing.profilePicture : input.profilePicture;

  if (!name || name.length > 255) throw badRequest('A name of at most 255 characters is required.');
  if (!emailPattern.test(email) || email.length > 255) throw badRequest('A valid email address is required.');
  if (phone && !/^(?:\+?250|0)7\d{8}$/.test(normalizedPhone(phone))) throw badRequest('Enter a valid Rwanda mobile phone number.');
  if (nationalId && String(nationalId).length > 50) throw badRequest('National ID must be at most 50 characters.');
  if (accountNumber && String(accountNumber).length > 255) throw badRequest('Account number must be at most 255 characters.');
  if (profilePicture !== null && profilePicture !== undefined
      && (typeof profilePicture !== 'string' || profilePicture.length > 10 * 1024 * 1024)) {
    throw badRequest('Profile picture must be text up to 10 MB.');
  }
  return {
    name,
    email,
    phone: phone ? normalizedPhone(phone) : null,
    nationalId: nationalId || null,
    accountNumber: accountNumber || null,
    profilePicture: profilePicture || null,
  };
};

const updateProfile = async ({ userId, input = {}, baseUrl, language = 'rw', repository = defaultRepository, rateLimits = passwordResetRepository, mailer = defaultEmailService, audit = defaultAudit }) => {
  const profile = await repository.getAccountProfile(userId);
  if (!profile) throw Object.assign(new Error('Not authenticated.'), { statusCode: 401 });
  const normalized = normalizeProfile(input, profile);
  const profileRateKey = hashToken(`profile:${userId}`);
  if (!await rateLimits.consumeRateLimit(profileRateKey, 10, 60 * 60)) {
    throw Object.assign(new Error('Too many profile updates. Try again later.'), { statusCode: 429 });
  }

  const emailChanged = normalized.email !== normalizeEmail(profile.email);
  if (emailChanged) {
    if (profile.role === 'super_admin') {
      throw Object.assign(new Error('The platform administrator email cannot be changed from account settings.'), { statusCode: 403, code: 'SUPER_ADMIN_EMAIL_CHANGE_BLOCKED' });
    }
    const emailRateKey = hashToken(`email-change:${userId}`);
    if (!await rateLimits.consumeRateLimit(emailRateKey, 5, 60 * 60)) {
      throw Object.assign(new Error('Too many email change requests. Try again later.'), { statusCode: 429 });
    }
    const existing = await repository.findUserByEmail(normalized.email);
    if (existing && Number(existing.id) !== Number(userId)) {
      throw Object.assign(new Error('Email is already in use.'), { statusCode: 409, code: 'EMAIL_IN_USE' });
    }
    if (!baseUrl) throw serviceUnavailable('Email changes are not configured.');
    const token = crypto.randomBytes(32).toString('base64url');
    const verificationUrl = new URL('/verify-email-change', baseUrl);
    verificationUrl.hash = token;
    await repository.createEmailChangeToken(userId, normalized.email, hashToken(token), new Date(Date.now() + 24 * 60 * 60 * 1000));
    try {
      await mailer.sendEmailChangeConfirmation({
        oldEmail: profile.email,
        pendingEmail: normalized.email,
        name: profile.name,
        link: verificationUrl.toString(),
        language: language === 'en' ? 'en' : 'rw',
      });
    } catch {
      await repository.deleteEmailChangeTokensByUser(userId).catch(() => undefined);
      throw serviceUnavailable('Email change confirmation could not be sent.');
    }
  }

  const updated = await repository.updateAccountProfile(userId, normalized);
  if (!updated) throw Object.assign(new Error('Account profile not found.'), { statusCode: 404 });
  await audit({ ownerUserId: Number(userId), actorId: Number(userId), entityType: 'auth', entityId: Number(userId), action: 'profile_updated', details: { emailChangePending: emailChanged } });
  if (emailChanged) {
    await audit({ ownerUserId: Number(userId), actorId: Number(userId), entityType: 'auth', entityId: Number(userId), action: 'email_change_requested', details: {} });
  }
  return { user: updated, emailChangePending: emailChanged, pendingEmail: emailChanged ? normalized.email : null };
};

const changePassword = async ({ userId, currentPassword, newPassword, repository = defaultRepository, audit = defaultAudit }) => {
  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) {
    throw badRequest('Current password and new password are required.');
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) throw badRequest(passwordError);
  const user = await repository.findUserById(userId);
  if (!user) throw Object.assign(new Error('Not authenticated.'), { statusCode: 401 });
  const currentHash = user.passwordHash || user.password_hash || '';
  if (!await bcrypt.compare(currentPassword, currentHash)) {
    throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 401, code: 'CURRENT_PASSWORD_INCORRECT' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await repository.updateUserPassword(userId, passwordHash);
  if (!updated) throw Object.assign(new Error('Account not found.'), { statusCode: 404 });
  await audit({ ownerUserId: Number(userId), actorId: Number(userId), entityType: 'auth', entityId: Number(userId), action: 'password_changed', details: {} });
  return { ok: true };
};

const verifyEmailChange = async ({ token, repository = defaultRepository, audit = defaultAudit }) => {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100) {
    throw Object.assign(new Error('Invalid or expired email change link.'), { statusCode: 400, code: 'INVALID_EMAIL_CHANGE_TOKEN' });
  }
  const user = await repository.completeEmailChange(hashToken(token));
  if (!user) throw Object.assign(new Error('Invalid or expired email change link.'), { statusCode: 400, code: 'INVALID_EMAIL_CHANGE_TOKEN' });
  await audit({ ownerUserId: Number(user.id), actorId: Number(user.id), entityType: 'auth', entityId: Number(user.id), action: 'email_changed', details: {} });
  return { ok: true, user };
};

module.exports = { normalizeProfile, updateProfile, changePassword, verifyEmailChange };