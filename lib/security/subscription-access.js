const defaultRepository = require('../repositories/subscriptionRepository.js');

const SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED';

const requireActiveSubscription = async (user, repository = defaultRepository) => {
  if (!user) return;

  if (user.role === 'super_admin') return;

  const subscription = await repository.getSubscription(user.id);

  if (subscription && subscription.effective_status === 'expired') {
    throw Object.assign(new Error('Subscription has expired.'), {
      statusCode: 403,
      code: SUBSCRIPTION_EXPIRED,
    });
  }
};

module.exports = { requireActiveSubscription, SUBSCRIPTION_EXPIRED };