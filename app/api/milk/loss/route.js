import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const MilkLoss = require('@/lib/services/milk-loss-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || 500,
});

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);
    const input = await request.json();
    const result = await MilkLoss.createOrCorrectLossEvent({
      ownerUserId: user.id,
      collectionCenterId: input.collectionCenterId,
      date: input.date,
      period: input.period,
      lossPercentage: input.lossPercentage,
      reason: input.reason,
      adjustedBy: user.id,
    });
    return NextResponse.json(result, { status: result.corrected ? 200 : 201 });
  } catch (error) {
    return respondWithError(error, 'Failed to record milk loss event.');
  }
}

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const params = new URL(request.url).searchParams;
    const result = await MilkLoss.getLossEvent({
      ownerUserId: user.id,
      collectionCenterId: params.get('collectionCenterId') || '',
      date: params.get('date') || '',
      period: params.get('period') || 'all',
    });
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error, 'Failed to load milk loss event.');
  }
}
