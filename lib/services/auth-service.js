const bcrypt = require('bcryptjs');

const { repository, normalizeEmail, resetInMemoryUsers } = require('../repositories/userRepository.js');
const { assertUserCanAccessOwnerScopedResource } = require('../security/ownership.js');
const { isPublicAccountTypeEnabled, isAuthenticatedAccountTypeEnabled } = require('../security/account-access.js');
const Subscriptions = require('./subscription-service.js');

const badRequest = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null;
};

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role || 'user',
  accountType: user.accountType || 'COLLECTOR',
  accountStatus: user.accountStatus || 'active',
  emailVerified: user.emailVerified ?? true,
  createdAt: user.createdAt,
  ownerUserId: user.ownerUserId ?? null,
});

const normalizeAccountType = (value) => {
  const raw = String(value || 'COLLECTOR').trim().toUpperCase();
  return raw === 'COLLECTION_CENTER' ? 'COLLECTION_CENTER' : 'COLLECTOR';
};

const registerUser = async ({ repository: userRepository = repository, name, email, password, accountType = 'COLLECTOR', role = 'user', selectedPlanCode = null }) => {
  const normalizedEmail = normalizeEmail(email);
  const passwordError = validatePassword(password);

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw badRequest('A valid email is required.');
  }

  if (passwordError) {
    throw badRequest(passwordError);
  }

  const existing = await userRepository.findUserByEmail(normalizedEmail);
  if (existing) {
    throw badRequest('User already exists.');
  }

  const authoritativeAdminEmail = String(process.env.SUPER_ADMIN_EMAIL || 'snemeyimana@gmail.com').trim().toLowerCase();
  const effectiveRole = normalizedEmail.toLowerCase() === authoritativeAdminEmail ? 'super_admin' : role;
  const effectiveAccountType = normalizeAccountType(accountType);
  if (!isPublicAccountTypeEnabled({ role: effectiveRole, accountType: effectiveAccountType })) {
    throw Object.assign(new Error('Collection Center accounts are not available in this public release.'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_UNAVAILABLE',
    });
  }
  let selectedPlan = null;
  if (selectedPlanCode) {
    selectedPlan = await Subscriptions.getPlanForRequest(selectedPlanCode, undefined, 'monthly');
    if (effectiveAccountType === 'COLLECTION_CENTER' && selectedPlan.code !== 'COLLECTION_CENTER_MONTHLY') {
      throw badRequest('Collection Center accounts use their separate fixed monthly subscription.');
    }
    if (effectiveAccountType === 'COLLECTOR' && selectedPlan.code === 'COLLECTION_CENTER_MONTHLY') {
      throw badRequest('Collector accounts must select a monthly volume tier.');
    }
  }
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await userRepository.createUser({
    name: name || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    passwordHash,
    role: effectiveRole,
    accountType: effectiveAccountType,
    ownerUserId: null,
    selectedPlanCode: selectedPlan?.code || null,
  });

  return {
    ...sanitizeUser(user),
    passwordHash,
    subscription: user.subscription || null,
  };
};

const loginUser = async ({ repository: userRepository = repository, email, password, session }) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Invalid email or password.');
  }

  const user = await userRepository.findUserByEmail(normalizedEmail);
  if (!user) {
    throw new Error('Invalid email or password.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash || user.password_hash || '');
  if (!valid) {
    throw new Error('Invalid email or password.');
  }

  const authoritativeAdminEmail = String(process.env.SUPER_ADMIN_EMAIL || 'snemeyimana@gmail.com').trim().toLowerCase();
  const role = normalizedEmail === authoritativeAdminEmail ? 'super_admin' : user.role || 'user';

  if (role !== 'super_admin' && user.accountStatus === 'suspended') {
    throw new Error('This account is suspended.');
  }
  if (!isAuthenticatedAccountTypeEnabled({ role, accountType: user.accountType || user.account_type || 'COLLECTOR' }, process.env.NODE_ENV, true)) {
    throw Object.assign(new Error('Collection Center accounts are not available in this public release.'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_UNAVAILABLE',
    });
  }

  if (session) {
    session.userId = user.id;
    session.user = { id: user.id, role };
  }

  return {
    user: sanitizeUser({ ...user, role }),
    session,
  };
};

const getCurrentUser = async ({ repository: userRepository = repository, session }) => {
  const userId = session && session.userId ? Number(session.userId) : null;
  if (!userId) {
    throw new Error('Not authenticated.');
  }

  const user = await userRepository.findUserById(userId);
  if (!user) {
    throw new Error('Not authenticated.');
  }

  const safeUser = sanitizeUser(user);
  if (!isAuthenticatedAccountTypeEnabled(safeUser, process.env.NODE_ENV, true)) {
    throw Object.assign(new Error('Collection Center accounts are not available in this public release.'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_UNAVAILABLE',
    });
  }
  return safeUser;
};

const logoutUser = async ({ session }) => {
  if (session) {
    delete session.userId;
    delete session.user;
  }

  return { ok: true };
};

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
  logoutUser,
  sanitizeUser,
  normalizeAccountType,
  validatePassword,
  assertUserCanAccessOwnerScopedResource,
  resetInMemoryUsers,
};
