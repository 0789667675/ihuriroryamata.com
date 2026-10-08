import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Farmers = require('@/lib/services/farmer-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : fallback },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const farmer = await Farmers.getFarmer({ id: params.id, ownerUserId: user.id });
    if (!farmer) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json(farmer);
  } catch (error) {
    return respondWithError(error, 'Failed to load farmer.');
  }
}

export async function PUT(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const farmer = await Farmers.updateFarmer({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    if (!farmer) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json(farmer);
  } catch (error) {
    return respondWithError(error, 'Failed to update farmer.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const deleted = await Farmers.deleteFarmer({ id: params.id, ownerUserId: user.id, actorId: user.id });
    if (!deleted) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return respondWithError(error, 'Failed to delete farmer.');
  }
}
