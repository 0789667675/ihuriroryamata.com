import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const FarmerMerge = require('@/lib/repositories/farmerMergeRepository.js');

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const body = await request.json().catch(() => ({}));
    const result = await FarmerMerge.mergeFarmers({
      sourceFarmerId: params.id,
      targetFarmerId: body.targetFarmerId,
      ownerUserId: user.id,
      collectorUserId: user.id,
      actorId: user.id,
      reason: body.reason,
      resolutions: body.resolutions,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to merge farmers.', code: error.code || null }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}