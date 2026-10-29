import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Farmers = require('@/lib/services/farmer-service.js');
const Notifications = require('@/lib/services/notification-service.js');
const Centers = require('@/lib/services/collection-center-service.js');

export const runtime = 'nodejs';

const sanitizeParam = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str === '' || str === 'undefined' || str === 'null' || str === '[object Object]') return '';
  return str;
};

const respondWithError = (error: any, fallback: string, route: string = 'GET /api/farmers') => {
  console.error(`[API 500 ERROR in ${route}]:`, error);
  const statusCode = error?.statusCode || (
    error?.code === 'SUBSCRIPTION_EXPIRED' ? 403 :
    error?.code === 'DATABASE_NOT_CONFIGURED' || error?.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 :
    500
  );
  const code = error?.code || (statusCode === 503 ? 'SERVICE_UNAVAILABLE' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR');
  const message = error?.statusCode && error.statusCode < 500 ? error.message : fallback;
  return NextResponse.json(
    {
      ok: false,
      error: error?.message || message,
      message,
      code,
    },
    { status: statusCode }
  );
};

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const params = new URL(request.url).searchParams;
    let center = sanitizeParam(params.get('center') || params.get('collectionCenter'));
    const collectorUserId = user.accountType === 'COLLECTOR'
      ? String(user.id)
      : sanitizeParam(params.get('collectorUserId'));
    const rawCursor = sanitizeParam(params.get('cursor'));
    const cursor = rawCursor || undefined;
    const search = sanitizeParam(params.get('search') || params.get('q'));

    if (user.accountType === 'COLLECTION_CENTER' && !center) {
      try {
        const accessible = await Centers.listAccessibleCenters({ ownerUserId: user.id, accountType: user.accountType });
        if (accessible && accessible.length > 0) {
          center = accessible[0].name;
        } else {
          return NextResponse.json({ data: [], total: 0, hasMore: false, nextCursor: null });
        }
      } catch {
        return NextResponse.json({ data: [], total: 0, hasMore: false, nextCursor: null });
      }
    }

    const result = await Farmers.listFarmers({
      ownerUserId: user.id,
      search,
      center,
      sortBy: sanitizeParam(params.get('sortBy')) || undefined,
      sortDirection: sanitizeParam(params.get('sortDirection')) || undefined,
      cursor,
      limit: params.get('limit') || undefined,
      collectorUserId: collectorUserId || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error, 'Failed to load farmers.', 'GET /api/farmers');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);
    const farmer = await Farmers.createFarmer({
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    try {
      await Notifications.createFarmerChangedNotification({ farmer, ownerUserId: user.id, action: 'created' });
    } catch (error) {
      console.error('[farmers] Farmer-created notification failed.', { name: error instanceof Error ? error.name : 'UnknownError' });
    }
    return NextResponse.json(farmer, { status: 201 });
  } catch (error) {
    return respondWithError(error, 'Failed to create farmer.', 'POST /api/farmers');
  }
}
