const MINIMUM_UKWEZI_PAYMENT_RWF = 3000;

const isUkweziPaymentEligible = (amount) => {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return false;
  return Number(amount) >= MINIMUM_UKWEZI_PAYMENT_RWF;
};

module.exports = { MINIMUM_UKWEZI_PAYMENT_RWF, isUkweziPaymentEligible };
