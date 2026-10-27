import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Milk = require('@/lib/services/milk-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const searchParams = new URL(request.url).searchParams;
    const result = await Milk.getFarmerDeliveryHistory({
      ownerUserId: user.id,
      collectorUserId: user.accountType === 'COLLECTOR' ? user.id : null,
      farmerId: params.id,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      session: searchParams.get('session') || 'all',
    });
    if (!result) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const statusCode = error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500);
    const message = error.statusCode && error.statusCode < 500
      ? error.message
      : 'Failed to load farmer delivery history.';
    if (statusCode >= 500) {
      console.error('[farmers/delivery-history] Failed to load history.', {
        name: error.name || 'UnknownError',
        code: error.code || null,
      });
    }
    return NextResponse.json({ message }, { status: statusCode });
  }
}
