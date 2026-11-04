const IGIPANDE_START_DATE = '2026-11-16';
const IGIPANDE_CHARGE_AMOUNT = 100;

const buildIgipandeReference = (farmerId, periodStart, periodEnd) =>
  `igipande-${Number(farmerId)}-${periodStart}-${periodEnd}`;

const getAdditionalIgipandeEarnings = ({ availableEarnings, previouslyAvailableEarnings = 0 }) =>
  Number(Math.max(0, (Number(availableEarnings) || 0) - (Number(previouslyAvailableEarnings) || 0)).toFixed(2));

const isIgipandePeriod = (periodStart, periodEnd) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(periodStart)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(periodEnd))) return false;
  if (periodStart < IGIPANDE_START_DATE) return false;
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const startDay = start.getUTCDate();
  const expectedStart = startDay === 1 ? 1 : startDay === 16 ? 16 : null;
  const expectedEnd = startDay === 1 ? 15 : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return expectedStart !== null && start.getUTCFullYear() === end.getUTCFullYear()
    && start.getUTCMonth() === end.getUTCMonth() && end.getUTCDate() === expectedEnd;
};

const allocateIgipandeRecovery = ({ availableEarnings, contributions = [] }) => {
  let remainingEarnings = Math.max(0, Number(availableEarnings) || 0);
  const recoveries = [];
  const orderedContributions = [...contributions].sort((left, right) =>
    String(left.periodStart || left.period_start).localeCompare(String(right.periodStart || right.period_start))
    || Number(left.id || 0) - Number(right.id || 0));

  for (const contribution of orderedContributions) {
    if (remainingEarnings <= 0) break;
    const outstanding = Math.max(0, Number(contribution.outstandingBalance ?? contribution.outstanding_balance) || 0);
    const amount = Number(Math.min(remainingEarnings, outstanding).toFixed(2));
    if (amount <= 0) continue;
    recoveries.push({ contributionId: Number(contribution.id), amount });
    remainingEarnings = Number((remainingEarnings - amount).toFixed(2));
  }

  return {
    recoveries,
    recoveredAmount: Number(recoveries.reduce((sum, recovery) => sum + recovery.amount, 0).toFixed(2)),
  };
};

module.exports = {
  IGIPANDE_START_DATE,
  IGIPANDE_CHARGE_AMOUNT,
  buildIgipandeReference,
  getAdditionalIgipandeEarnings,
  isIgipandePeriod,
  allocateIgipandeRecovery,
};