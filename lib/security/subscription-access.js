const defaultRepository = require('../repositories/subscriptionRepository.js');

const SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED';

const requireActiveSubscription = async (user, repository = defaultRepository) => {
  if (!user) return;

  if (user.role === 'super_admin') return;

  const subscription = await repository.getSubscription(user.id);

  if (subscription && ['suspended', 'expired'].includes(subscription.effective_status)) {
    throw Object.assign(new Error('Subscription access is suspended. Confirm a monthly payment to restore access.'), {
      statusCode: 403,
      code: SUBSCRIPTION_EXPIRED,
    });
  }
};

module.exports = { requireActiveSubscription, SUBSCRIPTION_EXPIRED };