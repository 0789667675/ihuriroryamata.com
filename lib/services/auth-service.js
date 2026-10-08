const bcrypt = require('bcryptjs');

const { repository, normalizeEmail, resetInMemoryUsers } = require('../repositories/userRepository.js');
const { assertUserCanAccessOwnerScopedResource } = require('../security/ownership.js');

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

const registerUser = async ({ repository: userRepository = repository, name, email, password, accountType = 'COLLECTOR', role = 'user' }) => {
  const normalizedEmail = normalizeEmail(email);
  const passwordError = validatePassword(password);

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('A valid email is required.');
  }

  if (passwordError) {
    throw new Error(passwordError);
  }

  const existing = await userRepository.findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error('User already exists.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const authoritativeAdminEmail = String(process.env.SUPER_ADMIN_EMAIL || 'snemeyimana@gmail.com').trim().toLowerCase();
  const effectiveRole = normalizedEmail.toLowerCase() === authoritativeAdminEmail ? 'super_admin' : role;

  const user = await userRepository.createUser({
    name: name || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    passwordHash,
    role: effectiveRole,
    accountType: normalizeAccountType(accountType),
    ownerUserId: null,
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

  if (user.emailVerified === false || user.email_verified === false) {
    throw Object.assign(new Error('Verify your email before signing in.'), { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' });
  }

  if (user.role !== 'super_admin' && user.accountStatus === 'suspended') {
    throw new Error('This account is suspended.');
  }

  if (session) {
    session.userId = user.id;
    session.user = { id: user.id, role: user.role || 'user' };
  }

  return {
    user: sanitizeUser(user),
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

  return sanitizeUser(user);
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
