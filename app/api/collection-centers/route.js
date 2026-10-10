import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Centers = require('@/lib/services/collection-center-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : fallback },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    return NextResponse.json(await Centers.listAccessibleCenters({ ownerUserId: user.id, accountType: user.accountType }));
  } catch (error) {
    return respondWithError(error, 'Failed to load collection centers.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Permission denied.' }, { status: 403 });
    await requireActiveSubscription(user);
    const center = await Centers.createCenter({
      ownerUserId: user.id,
      actorId: user.id,
      accountType: user.accountType,
      input: await request.json(),
    });
    return NextResponse.json(center, { status: 201 });
  } catch (error) {
    return respondWithError(error, 'Failed to create collection center.');
  }
}
