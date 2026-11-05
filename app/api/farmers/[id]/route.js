import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Farmers = require('@/lib/services/farmer-service.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback, includeServerMessage = false) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : includeServerMessage && error.message ? error.message : fallback },
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
    await requireActiveSubscription(user);
    const farmer = await Farmers.updateFarmer({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    if (!farmer) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    try {
      await Notifications.createFarmerChangedNotification({ farmer, ownerUserId: user.id, action: 'updated' });
    } catch (error) {
      console.error('[farmers] Farmer-updated notification failed.', { code: error.code || null });
    }
    return NextResponse.json(farmer);
  } catch (error) {
    return respondWithError(error, 'Failed to update farmer.', true);
  }
}

export async function DELETE(request, { params }) {
  let user = null;
  try {
    user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);
    const body = await request.json().catch(() => ({}));
    const deleted = await Farmers.deleteFarmer({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
      reason: body.reason,
      confirmationName: body.confirmationName,
    });
    if (!deleted) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json(deleted, { status: 200 });
  } catch (error) {
    const missingRelation = error.code === '42P01'
      ? error.message?.match(/relation "([^"]+)" does not exist/i)?.[1] || null
      : null;
    console.error('[farmers] Permanent deletion failed.', {
      farmerId: params.id,
      ownerUserId: user?.id || null,
      code: error.code || null,
      databaseMessage: error.code ? error.message : null,
      constraint: error.constraint || null,
      table: error.table || null,
      missingRelation,
      rollbackCode: error.rollbackCode || null,
    });
    if (error.code === '23503') {
      return NextResponse.json({
        message: 'Deletion could not reconcile a dependent record. No changes were committed; contact an administrator.',
        code: 'FARMER_DELETE_DEPENDENCY_CONFLICT',
      }, { status: 409 });
    }
    if (error.code === '42P01') {
      return NextResponse.json({
        message: 'A required cleanup table is missing from the database. No changes were committed; contact an administrator.',
        code: 'FARMER_DELETE_SCHEMA_OUT_OF_DATE',
      }, { status: 503 });
    }
    if (error.code && error.code.startsWith('23')) {
      return NextResponse.json({
        message: 'Deletion could not preserve related data constraints. No changes were committed; contact an administrator.',
        code: 'FARMER_DELETE_CONSTRAINT_CONFLICT',
      }, { status: 409 });
    }
    return respondWithError(error, 'Deletion did not complete. No changes were committed; try again or contact an administrator.');
  }
}
