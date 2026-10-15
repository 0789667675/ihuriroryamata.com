const isPublicAccountTypeEnabled = (user, environment = process.env.NODE_ENV) =>
  environment !== 'production'
  || user?.role === 'super_admin'
  || user?.accountType === 'COLLECTOR'
  || user?.accountType === 'COLLECTION_CENTER';

const isAuthenticatedAccountTypeEnabled = (user, environment = process.env.NODE_ENV, allowExistingCollectionCenter = false) =>
  isPublicAccountTypeEnabled(user, environment)
  || (allowExistingCollectionCenter && user?.role === 'user' && user?.accountType === 'COLLECTION_CENTER');

const accountTypeUnavailable = () => Object.assign(
  new Error('Collection Center accounts are not available in this public release.'),
  { statusCode: 403, code: 'ACCOUNT_TYPE_UNAVAILABLE' }
);

const assertPublicAccountType = (user) => {
  if (user && !isPublicAccountTypeEnabled(user)) throw accountTypeUnavailable();
  return user;
};

const requireAccountType = (user, allowedAccountTypes) => {
  const allowed = Array.isArray(allowedAccountTypes) ? allowedAccountTypes : [allowedAccountTypes];
  if (user && !isAuthenticatedAccountTypeEnabled(user, process.env.NODE_ENV, true)) throw accountTypeUnavailable();
  if (!user || user.role !== 'user' || !allowed.includes(user.accountType)) {
    throw Object.assign(new Error('This account type cannot access this feature.'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_FORBIDDEN',
    });
  }
  return user;
};

module.exports = { isPublicAccountTypeEnabled, isAuthenticatedAccountTypeEnabled, assertPublicAccountType, requireAccountType };