import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const FarmerMerge = require('@/lib/repositories/farmerMergeRepository.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const targetFarmerId = new URL(request.url).searchParams.get('targetFarmerId');
    if (!targetFarmerId) return NextResponse.json({ message: 'Choose a destination farmer.', code: 'FARMER_MERGE_TARGET_REQUIRED' }, { status: 400 });
    const preview = await FarmerMerge.getFarmerMergePreview({
      sourceFarmerId: params.id,
      targetFarmerId,
      ownerUserId: user.id,
      collectorUserId: user.id,
    });
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to inspect farmer merge.', code: error.code || null }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}