import { NextResponse } from 'next/server';

const { getAuthenticatedUser, requireAccountType } = require('@/lib/security/authenticate.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Assignments = require('@/lib/services/collector-assignment-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function PATCH(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTION_CENTER');
    await requireActiveSubscription(user);
    const input = await request.json().catch(() => ({}));
    const action = String(input.action || '').toLowerCase();
    if (action === 'suspend') {
      const suspended = await Assignments.suspendAssignment({
        dairyUserId: user.id,
        actorId: user.id,
        collectorUserId: params.collectorUserId,
      });
      if (!suspended) return NextResponse.json({ message: 'That collector is not actively linked to this collection center.' }, { status: 404 });
      return NextResponse.json({ suspended: true });
    }
    if (action === 'revoke') {
      const removed = await Assignments.revokeAssignment({
        dairyUserId: user.id,
        actorId: user.id,
        collectorUserId: params.collectorUserId,
      });
      if (!removed) return NextResponse.json({ message: 'That collector is not linked to this collection center.' }, { status: 404 });
      return NextResponse.json({ removed: true });
    }
    return NextResponse.json({ message: 'action must be suspend or revoke.' }, { status: 400 });
  } catch (error) {
    return respond(error, 'Failed to update collector assignment.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTION_CENTER');
    await requireActiveSubscription(user);
    const removed = await Assignments.revokeAssignment({ dairyUserId: user.id, actorId: user.id, collectorUserId: params.collectorUserId });
    if (!removed) return NextResponse.json({ message: 'That collector is not linked to this collection center.' }, { status: 404 });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return respond(error, 'Failed to revoke collector assignment.');
  }
}
