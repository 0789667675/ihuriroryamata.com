const { verifySessionToken, COOKIE_NAME } = require('./session.js');
const { isAuthenticatedAccountTypeEnabled, requireAccountType } = require('./account-access.js');
const { repository } = require('../repositories/userRepository.js');
const { requireActiveSubscription } = require('./subscription-access.js');

const COLLECTION_CENTER_AUTH_PATHS = new Set([
  '/api/auth/me',
  '/api/auth/profile',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/collection-centers',
  '/api/collection-center-prices',
  '/api/collector-assignments',
  '/api/farmers',
  '/api/farmers/import',
  '/api/imports/ocr',
  '/api/imports/extract',
  '/api/milk/daily',
  '/api/notifications',
  '/api/notifications/unread-count',
  '/api/notifications/read-all',
  '/api/subscription',
  '/api/subscription/payments',
  '/api/subscription/usage',
  '/api/farmer-settlements',
  '/api/reports/summary',
  '/api/ukwezi/pdf',
]);

const isCollectionCenterAuthenticationPath = (pathname) => COLLECTION_CENTER_AUTH_PATHS.has(pathname)
  || /^\/api\/(collection-centers|collector-assignments|farmers)\/\d+$/.test(pathname)
  || /^\/api\/notifications\/\d+\/(read|resolve|reopen)$/.test(pathname)
  || /^\/api\/subscription\/payments\/\d+$/.test(pathname);

const isSubscriptionRecoveryRequest = (request) => {
  const pathname = new URL(request.url).pathname;
  const method = String(request.method || 'GET').toUpperCase();
  if (pathname === '/api/auth/me' || pathname === '/api/auth/profile') return true;
  if (pathname === '/api/auth/change-password' || pathname === '/api/auth/logout') return method === 'POST';
  if (pathname === '/api/subscription' || pathname === '/api/subscription/usage') return method === 'GET';
  if (pathname === '/api/subscription/payments') return method === 'GET' || method === 'POST';
  if (/^\/api\/subscription\/payments\/\d+$/.test(pathname)) return method === 'GET' || method === 'POST';
  if (pathname === '/api/reports/summary' || pathname === '/api/ukwezi/pdf' || pathname === '/api/farmer-settlements') return method === 'GET';
  if (pathname === '/api/notifications' || pathname === '/api/notifications/unread-count') return method === 'GET';
  if (/^\/api\/notifications\/\d+\/read$/.test(pathname)) return method === 'PATCH';
  if (pathname === '/api/notifications/read-all') return method === 'PATCH';
  return false;
};

const normalizeAuthenticatedUser = async (user) => {
  if (!user || user.accountStatus === 'suspended') return null;

  const authoritativeAdminEmail = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const normalizedRole = String(user.role || '').trim().toLowerCase();
  const normalizedEmail = String(user.email || '').trim().toLowerCase();
  const role = normalizedRole === 'super_admin' || (authoritativeAdminEmail && normalizedEmail === authoritativeAdminEmail)
    ? 'super_admin'
    : normalizedRole || 'user';

  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role,
    accountType: user.accountType,
    accountStatus: user.accountStatus,
    emailVerified: user.emailVerified !== false,
    language: user.language === 'en' ? 'en' : 'rw',
  };
};

const getAuthenticatedUserFromToken = async (token, { allowExistingCollectionCenter = false } = {}) => {
  const session = verifySessionToken(token);
  if (!session) return null;

  const user = await repository.findUserById(session.id);
  const authenticatedUser = await normalizeAuthenticatedUser(user);
  return isAuthenticatedAccountTypeEnabled(authenticatedUser, process.env.NODE_ENV, allowExistingCollectionCenter) ? authenticatedUser : null;
};

const getAuthenticatedUser = async (request) => {
  const token = request.cookies?.get(COOKIE_NAME)?.value;
  const pathname = request.url ? new URL(request.url).pathname : '';
  const user = await getAuthenticatedUserFromToken(token, { allowExistingCollectionCenter: isCollectionCenterAuthenticationPath(pathname) });
  if (!user || user.role === 'super_admin' || !request.url) return user;
  if (!isSubscriptionRecoveryRequest(request)) await requireActiveSubscription(user);
  return user;
};

const getAuthenticatedUserFromCookieStore = async (cookieStore) => {
  const cookie = cookieStore && typeof cookieStore.get === 'function'
    ? cookieStore.get(COOKIE_NAME)?.value
    : undefined;
  return getAuthenticatedUserFromToken(cookie, { allowExistingCollectionCenter: true });
};

module.exports = { getAuthenticatedUser, getAuthenticatedUserFromCookieStore, getAuthenticatedUserFromToken, isSubscriptionRecoveryRequest, isCollectionCenterAuthenticationPath, requireAccountType };
