import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Centers = require('@/lib/services/collection-center-service.js');

export const runtime = 'nodejs';

const respondWithError = (error) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to update collection center.' },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function PUT(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Permission denied.' }, { status: 403 });
    const center = await Centers.updateCenter({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    if (!center) return NextResponse.json({ message: 'Collection center not found.' }, { status: 404 });
    return NextResponse.json(center);
  } catch (error) {
    return respondWithError(error);
  }
}
