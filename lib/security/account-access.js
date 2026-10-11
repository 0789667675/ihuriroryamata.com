const isPublicAccountTypeEnabled = (user, environment = process.env.NODE_ENV) =>
  environment !== 'production' || user?.role === 'super_admin' || user?.accountType === 'COLLECTOR';

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
  assertPublicAccountType(user);
  if (!user || user.role !== 'user' || !allowed.includes(user.accountType)) {
    throw Object.assign(new Error('This account type cannot access this feature.'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_FORBIDDEN',
    });
  }
  return user;
};

module.exports = { isPublicAccountTypeEnabled, assertPublicAccountType, requireAccountType };