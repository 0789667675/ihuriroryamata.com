const { verifySessionToken, COOKIE_NAME } = require('./session.js');
const { repository } = require('../repositories/userRepository.js');

const normalizeAuthenticatedUser = async (user) => {
  if (!user || user.accountStatus === 'suspended') return null;

  const authoritativeAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'snemeyimana@gmail.com').trim().toLowerCase();
  const normalizedRole = String(user.role || '').trim().toLowerCase();
  const normalizedEmail = String(user.email || '').trim().toLowerCase();
  const role = normalizedRole === 'super_admin' || normalizedEmail === authoritativeAdminEmail
    ? 'super_admin'
    : normalizedRole || 'user';

  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role,
    accountType: user.accountType,
    accountStatus: user.accountStatus,
  };
};

const getAuthenticatedUserFromToken = async (token) => {
  const session = verifySessionToken(token);
  if (!session) return null;

  const user = await repository.findUserById(session.id);
  return normalizeAuthenticatedUser(user);
};

const getAuthenticatedUser = async (request) => {
  const token = request.cookies?.get(COOKIE_NAME)?.value;
  return getAuthenticatedUserFromToken(token);
};

const getAuthenticatedUserFromCookieStore = async (cookieStore) => {
  const cookie = cookieStore && typeof cookieStore.get === 'function'
    ? cookieStore.get(COOKIE_NAME)?.value
    : undefined;
  return getAuthenticatedUserFromToken(cookie);
};

module.exports = { getAuthenticatedUser, getAuthenticatedUserFromCookieStore, getAuthenticatedUserFromToken };
