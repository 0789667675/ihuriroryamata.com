import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Farmers = require('@/lib/services/farmer-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const impact = await Farmers.getFarmerDeletionImpact({ id: params.id, ownerUserId: user.id });
    if (!impact) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json(impact, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to inspect farmer records before deletion.',
      ...(error.code ? { code: error.code } : {}),
    }, { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) });
  }
}