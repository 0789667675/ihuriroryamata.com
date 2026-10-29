import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { getAccountingDate } = require('@/lib/utils/accounting-period.js');
const Milk = require('@/lib/services/milk-service.js');
const Centers = require('@/lib/services/collection-center-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sanitizeParam = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str === '' || str === 'undefined' || str === 'null' || str === '[object Object]') return '';
  return str;
};

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const params = new URL(request.url).searchParams;
    const date = params.get('date') || getAccountingDate();
    let centerId = sanitizeParam(params.get('centerId'));
    let center = sanitizeParam(params.get('center') || params.get('collectionCenter'));
    const cursor = sanitizeParam(params.get('cursor')) || undefined;
    const limit = params.get('limit') || 50;
    const search = sanitizeParam(params.get('search'));
    const session = sanitizeParam(params.get('session')) || 'all';
    const deliveryStatus = sanitizeParam(params.get('deliveryStatus')) || 'all';
    const sortBy = sanitizeParam(params.get('sortBy')) || undefined;
    const sortDirection = sanitizeParam(params.get('sortDirection')) || undefined;

    if (user.accountType === 'COLLECTION_CENTER' && !centerId && !center) {
      try {
        const accessible = await Centers.listAccessibleCenters({ ownerUserId: user.id, accountType: user.accountType });
        if (accessible && accessible.length > 0) {
          centerId = String(accessible[0].id);
          center = accessible[0].name;
        } else {
          return NextResponse.json({
            farmers: [],
            summary: {
              totalFarmers: 0,
              presentCount: 0,
              missedCount: 0,
              expectedCount: 0,
              deliveredCount: 0,
              missingCount: 0,
              deliveryRate: 0,
              totalMorning: 0,
              totalEvening: 0,
              totalVolume: 0,
              totalAmount: 0,
              pricePerLiter: 0,
              transportRate: 0,
            },
            farmerPagination: { nextCursor: null, hasMore: false },
            center: null,
            centers: [],
            collectorMilk: [],
          });
        }
      } catch {
        return NextResponse.json({
          farmers: [],
          summary: {
            totalFarmers: 0,
            presentCount: 0,
            missedCount: 0,
            expectedCount: 0,
            deliveredCount: 0,
            missingCount: 0,
            deliveryRate: 0,
            totalMorning: 0,
            totalEvening: 0,
            totalVolume: 0,
            totalAmount: 0,
            pricePerLiter: 0,
            transportRate: 0,
          },
          farmerPagination: { nextCursor: null, hasMore: false },
          center: null,
          centers: [],
          collectorMilk: [],
        });
      }
    }

    const result = await Milk.getDailyCollection({
      ownerUserId: user.id,
      accountType: user.accountType,
      collectorUserId: user.accountType === 'COLLECTOR' ? String(user.id) : params.get('collectorUserId') || '',
      date,
      centerId: centerId || undefined,
      center: center || undefined,
      cursor,
      limit,
      search,
      session,
      deliveryStatus,
      sortBy,
      sortDirection,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API 500 ERROR in GET /api/milk/daily]:', error);
    console.error('[milk/daily] Failed to load daily collection.', {
      name: error.name || 'UnknownError',
      code: error.code || null,
      message: error.message || null,
      stack: error.stack || null,
    });
    const statusCode = error.statusCode || (
      error.code === 'SUBSCRIPTION_EXPIRED' ? 403 :
      error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 :
      500
    );
    const code = error.code || (statusCode === 503 ? 'SERVICE_UNAVAILABLE' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR');
    const message = error.statusCode && error.statusCode < 500
      ? error.message
      : 'Failed to load daily collection.';
    return NextResponse.json(
      {
        ok: false,
        error: message,
        message,
        code,
      },
      { status: statusCode }
    );
  }
}
