const { verifySessionToken, COOKIE_NAME } = require('./session.js');
const { isPublicAccountTypeEnabled } = require('./account-access.js');
const { repository } = require('../repositories/userRepository.js');
const { requireActiveSubscription } = require('./subscription-access.js');

const isSubscriptionRecoveryRequest = (request) => {
  const pathname = new URL(request.url).pathname;
  const method = String(request.method || 'GET').toUpperCase();
  if (pathname === '/api/auth/me' || pathname === '/api/auth/profile') return true;
  if (pathname === '/api/subscription' || pathname === '/api/subscription/usage') return method === 'GET';
  if (pathname === '/api/subscription/payments') return method === 'GET' || method === 'POST';
  if (/^\/api\/subscription\/payments\/\d+$/.test(pathname)) return method === 'GET';
  if (pathname === '/api/notifications' || pathname === '/api/notifications/unread-count') return method === 'GET';
  if (/^\/api\/notifications\/\d+\/read$/.test(pathname)) return method === 'PATCH';
  if (pathname === '/api/notifications/read-all') return method === 'PATCH';
  return false;
};

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
  const authenticatedUser = await normalizeAuthenticatedUser(user);
  return isPublicAccountTypeEnabled(authenticatedUser) ? authenticatedUser : null;
};

const getAuthenticatedUser = async (request) => {
  const token = request.cookies?.get(COOKIE_NAME)?.value;
  const user = await getAuthenticatedUserFromToken(token);
  if (!user || user.role === 'super_admin' || !request.url) return user;
  if (!isSubscriptionRecoveryRequest(request)) await requireActiveSubscription(user);
  return user;
};

const getAuthenticatedUserFromCookieStore = async (cookieStore) => {
  const cookie = cookieStore && typeof cookieStore.get === 'function'
    ? cookieStore.get(COOKIE_NAME)?.value
    : undefined;
  return getAuthenticatedUserFromToken(cookie);
};

module.exports = { getAuthenticatedUser, getAuthenticatedUserFromCookieStore, getAuthenticatedUserFromToken, isSubscriptionRecoveryRequest };
