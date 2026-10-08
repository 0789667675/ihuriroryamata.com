import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Farmers = require('@/lib/services/farmer-service.js');

export const runtime = 'nodejs';

const respondWithError = (error: any, fallback: string) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : fallback },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const params = new URL(request.url).searchParams;
    const collectorUserId = user.accountType === 'COLLECTOR' ? String(user.id) : params.get('collectorUserId') || '';
    const result = await Farmers.listFarmers({
      ownerUserId: user.id,
      search: params.get('search') || params.get('q') || '',
      center: params.get('center') || params.get('collectionCenter') || '',
      cursor: params.get('cursor'),
      limit: params.get('limit'),
      collectorUserId: collectorUserId || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error, 'Failed to load farmers.');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const farmer = await Farmers.createFarmer({
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    return NextResponse.json(farmer, { status: 201 });
  } catch (error) {
    return respondWithError(error, 'Failed to create farmer.');
  }
}
