import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Adjustments = require('@/lib/services/milk-adjustment-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const result = await Adjustments.applyCollectionAdjustment({
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    return NextResponse.json(result, { status: result.corrected ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({
      message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to adjust the milk collection day.',
      ...(error.code ? { code: error.code } : {}),
    }, {
      status: error.statusCode || (error.code === 'MILK_DAY_NOT_FOUND' ? 404 : error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
