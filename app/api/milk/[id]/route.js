import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Milk = require('@/lib/services/milk-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const record = await Milk.getMilkRecord({ id: params.id, ownerUserId: user.id });
    if (!record) return NextResponse.json({ message: 'Milk record not found.' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return respondWithError(error, 'Failed to load milk record.');
  }
}

export async function PUT(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const input = await request.json();
    const record = await Milk.updateMilkRecord({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
      date: input.date,
      volumeMorning: input.volumeMorning,
      volumeEvening: input.volumeEvening,
    });
    if (!record) return NextResponse.json({ message: 'Milk record not found.' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return respondWithError(error, 'Failed to update milk record.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const input = await request.json().catch(() => ({}));
    const voided = await Milk.voidMilkRecord({ id: params.id, ownerUserId: user.id, actorId: user.id, reason: input.reason });
    if (!voided) return NextResponse.json({ message: 'Milk record not found.' }, { status: 404 });
    return NextResponse.json(voided);
  } catch (error) {
    return respondWithError(error, 'Failed to void milk record.');
  }
}
