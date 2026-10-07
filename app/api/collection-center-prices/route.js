import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
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
    return NextResponse.json(await Centers.listPrices({ ownerUserId: user.id }));
  } catch (error) {
    return respondWithError(error, 'Failed to load collection center prices.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Permission denied.' }, { status: 403 });
    const price = await Centers.addPrice({
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    if (!price) return NextResponse.json({ message: 'Collection center not found for your account.' }, { status: 404 });
    return NextResponse.json(price, { status: 201 });
  } catch (error) {
    return respondWithError(error, 'Failed to add collection center price.');
  }
}
