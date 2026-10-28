/** @param {{ userAccountType: string, userId: number, selectedCollectorId?: string, farmerSearch?: string, farmerCenter?: string, sortBy?: string, sortDirection?: string, cursor?: string | null, limit?: number }} options */
const buildFarmerListQuery = ({ userAccountType, userId, selectedCollectorId, farmerSearch, farmerCenter, sortBy, sortDirection, cursor, limit = 50 }) => {
  const params = new URLSearchParams({ limit: String(limit) });

  if (userAccountType === 'COLLECTOR') {
    params.set('collectorUserId', String(userId));
  } else if (userAccountType === 'COLLECTION_CENTER' && selectedCollectorId) {
    params.set('collectorUserId', String(selectedCollectorId));
  }

  const sanitizeParam = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (str === '' || str === 'undefined' || str === 'null' || str === '[object Object]') return '';
    return str;
  };

  const safeSearch = sanitizeParam(farmerSearch);
  if (safeSearch) params.set('search', safeSearch);

  const safeCenter = sanitizeParam(farmerCenter);
  if (safeCenter) params.set('center', safeCenter);

  if (sortBy) {
    params.set('sortBy', sortBy);
    params.set('sortDirection', sortDirection === 'desc' ? 'desc' : 'asc');
  }

  const safeCursor = sanitizeParam(cursor);
  if (safeCursor) params.set('cursor', safeCursor);

  return params;
};

module.exports = { buildFarmerListQuery };
