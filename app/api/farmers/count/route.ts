import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Domain = require('@/lib/repositories/domainRepository.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const respondWithError = (error: any, fallback: string) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : fallback },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);
    const params = new URL(request.url).searchParams;
    const collectorUserId = params.get('collectorUserId') || undefined;
    const count = await Domain.countFarmers({
      ownerUserId: user.id,
      collectorUserId,
      center: params.get('center') || undefined,
      search: params.get('search') || undefined,
    });
    return NextResponse.json({ count, ownerUserId: user.id, ...(collectorUserId ? { collectorUserId } : {}) }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return respondWithError(error, 'Failed to count farmers.');
  }
}
