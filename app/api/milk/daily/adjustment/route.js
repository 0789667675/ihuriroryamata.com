import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Adjustments = require('@/lib/services/milk-adjustment-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const adjustment = await Adjustments.getCollectionAdjustment({
      ownerUserId: user.id,
      collectionCenterId: params.get('collectionCenterId') || params.get('centerId'),
      date: params.get('date'),
      period: params.get('period') || 'all',
    });
    return NextResponse.json({ adjustment });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode ? error.message : 'Failed to load adjustment.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
