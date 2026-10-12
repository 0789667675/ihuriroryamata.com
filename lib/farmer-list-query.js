/** @param {{ userAccountType: string, userId: number, selectedCollectorId?: string, farmerSearch?: string, farmerCenter?: string, sortBy?: string, sortDirection?: string, cursor?: string | null, limit?: number }} options */
const buildFarmerListQuery = ({ userAccountType, userId, selectedCollectorId, farmerSearch, farmerCenter, sortBy, sortDirection, cursor, limit = 50 }) => {
  const params = new URLSearchParams({ limit: String(limit) });

  if (userAccountType === 'COLLECTOR') {
    params.set('collectorUserId', String(userId));
  } else if (userAccountType === 'COLLECTION_CENTER' && selectedCollectorId) {
    params.set('collectorUserId', String(selectedCollectorId));
  }

  const safeSearch = typeof farmerSearch === 'string' ? farmerSearch.trim() : '';
  if (safeSearch) params.set('search', safeSearch);

  const safeCenter = typeof farmerCenter === 'string' ? farmerCenter.trim() : '';
  if (safeCenter) params.set('center', safeCenter);

  if (sortBy) {
    params.set('sortBy', sortBy);
    params.set('sortDirection', sortDirection === 'desc' ? 'desc' : 'asc');
  }

  if (cursor) params.set('cursor', String(cursor));

  return params;
};

module.exports = { buildFarmerListQuery };
