const requireAccountType = (user, allowedAccountTypes) => {
  const allowed = Array.isArray(allowedAccountTypes) ? allowedAccountTypes : [allowedAccountTypes];
  if (!user || user.role !== 'user' || !allowed.includes(user.accountType)) {
    throw Object.assign(new Error('This account type cannot access this feature.'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_FORBIDDEN',
    });
  }
  return user;
};

module.exports = { requireAccountType };