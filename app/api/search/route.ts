import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Farmers = require('@/lib/services/farmer-service.js');
const Notifications = require('@/lib/services/notification-service.js');
const Centers = require('@/lib/services/collection-center-service.js');
const { searchGlobalData } = require('@/lib/services/global-search.js');

export const runtime = 'nodejs';

const respondWithError = (error: any, fallback: string) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : fallback },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const query = (params.get('q') || params.get('search') || '').trim();
    if (!query) {
      return NextResponse.json({ success: true, data: { farmers: [], centers: [], notifications: [], total: 0 } });
    }

    const [farmersResult, notificationsResult, centersResult] = await Promise.all([
      Farmers.listFarmers({ ownerUserId: user.id, search: query, limit: 5 }),
      Notifications.getNotifications({ ownerUserId: user.id, limit: 20 }),
      Centers.listCenters({ ownerUserId: user.id }),
    ]);

    const data = searchGlobalData({
      ownerUserId: user.id,
      query,
      limit: 5,
      farmers: farmersResult?.data || [],
      notifications: notificationsResult?.data || [],
      centers: centersResult || [],
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return respondWithError(error, 'Failed to perform a global search.');
  }
}
