const normalizeQuery = (value = '') => String(value || '').trim().toLowerCase();

const getOwnerKey = (item) => {
  if (item == null) return null;
  const values = [item.ownerUserId, item.owner_user_id, item.ownerId];
  const ownerValue = values.find((value) => value !== undefined && value !== null && value !== '');
  return ownerValue === undefined || ownerValue === null || ownerValue === '' ? null : Number(ownerValue);
};

const scoreMatch = (value, query) => {
  const text = String(value || '').trim();
  if (!text || !query) return 0;
  const lower = text.toLowerCase();
  if (lower === query) return 100;
  const index = lower.indexOf(query);
  if (index >= 0) return Math.max(10, 50 - index);
  return 0;
};

const sortByScore = (items, query, { ownerUserId, limit = 5 } = {}) => items
  .filter((item) => {
    const currentOwnerId = getOwnerKey(item);
    return ownerUserId === undefined || ownerUserId === null || currentOwnerId === null || Number(currentOwnerId) === Number(ownerUserId);
  })
  .map((item) => {
    const baseText = [
      item.name,
      item.location,
      item.collectionCenter,
      item.phone,
      item.nationalId,
      item.accountNumber,
      item.title,
      item.message,
      item.notification_type,
    ].filter(Boolean).join(' ');
    return { item, score: scoreMatch(baseText, query) };
  })
  .filter(({ score }) => score > 0)
  .sort((left, right) => right.score - left.score)
  .slice(0, limit)
  .map(({ item }) => item);

const searchGlobalData = ({ query, ownerUserId, limit = 5, farmers = [], centers = [], notifications = [] }) => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return { farmers: [], centers: [], notifications: [], total: 0 };
  }

  const farmResults = sortByScore(farmers, normalizedQuery, { ownerUserId, limit });
  const centerResults = sortByScore(centers, normalizedQuery, { ownerUserId, limit });
  const notificationResults = sortByScore(notifications, normalizedQuery, { ownerUserId, limit });

  return {
    farmers: farmResults,
    centers: centerResults,
    notifications: notificationResults,
    total: farmResults.length + centerResults.length + notificationResults.length,
  };
};

module.exports = {
  normalizeQuery,
  scoreMatch,
  searchGlobalData,
};
