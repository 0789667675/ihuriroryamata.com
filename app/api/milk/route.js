import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Milk = require('@/lib/services/milk-service.js');
const Farmers = require('@/lib/services/farmer-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
  ...(error.existingRecordId ? { existingRecordId: error.existingRecordId } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const params = new URL(request.url).searchParams;
    const result = await Milk.listMilkRecords({
      ownerUserId: user.id,
      collectorUserId: user.accountType === 'COLLECTOR' ? user.id : null,
      search: params.get('search') || params.get('q') || '',
      farmerId: params.get('farmerId'),
      center: params.get('center') || params.get('collectionCenter') || '',
      startDate: params.get('startDate'),
      endDate: params.get('endDate'),
      cursor: params.get('cursor'),
      limit: params.get('limit') || 50,
    });
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error, 'Failed to load milk records.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const input = await request.json();
    let farmerId = input.farmerId;
    if (!farmerId && input.farmerData?.name) {
      const farmer = await Farmers.createFarmer({ ownerUserId: user.id, actorId: user.id, input: input.farmerData });
      farmerId = farmer.id;
    }
    const result = await Milk.recordMilk({
      ownerUserId: user.id,
      actorId: user.id,
      collectorUserId: user.accountType === 'COLLECTOR' ? user.id : undefined,
      farmerId,
      date: input.date,
      volumeMorning: input.volumeMorning,
      volumeEvening: input.volumeEvening,
    });
    return NextResponse.json(result.record, { status: result.statusCode });
  } catch (error) {
    return respondWithError(error, 'Failed to create milk record.');
  }
}
