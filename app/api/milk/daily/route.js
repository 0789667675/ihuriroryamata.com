import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Milk = require('@/lib/services/milk-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const params = new URL(request.url).searchParams;
    const date = params.get('date') || new Date().toISOString().slice(0, 10);
    const centerId = params.get('centerId');
    const center = params.get('center') || params.get('collectionCenter');
    const cursor = params.get('cursor');
    const limit = params.get('limit') || 50;
    const search = params.get('search') || '';
    const session = params.get('session') || 'all';

    if (user.accountType === 'COLLECTION_CENTER' && !centerId && !center) {
      return NextResponse.json({ message: 'An active collection center is required. Please select a center.' }, { status: 400 });
    }

    const result = await Milk.getDailyCollection({
      ownerUserId: user.id,
      accountType: user.accountType,
      collectorUserId: user.accountType === 'COLLECTOR' ? String(user.id) : params.get('collectorUserId') || '',
      date,
      centerId,
      center,
      cursor,
      limit,
      search,
      session,
    });
    return NextResponse.json(result);
  } catch (error) {
    const statusCode = error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500);
    const message = error.statusCode && error.statusCode < 500
      ? error.message
      : 'Failed to load daily collection.';
    if (statusCode >= 500) {
      console.error('[milk/daily] Failed to load daily collection.', {
        name: error.name || 'UnknownError',
        code: error.code || null,
      });
    }
    return NextResponse.json({ message }, { status: statusCode });
  }
}
