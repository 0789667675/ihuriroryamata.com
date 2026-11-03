import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
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
    const input = await request.json().catch(() => ({}));
    const action = String(input.action || '').toLowerCase();
    if (user.accountType === 'COLLECTION_CENTER') {
      requireAccountType(user, 'COLLECTION_CENTER');
      await requireActiveSubscription(user);
      if (!['approve', 'reject'].includes(action)) {
        return NextResponse.json({ message: 'action must be approve or reject.' }, { status: 400 });
      }
      const result = await Assignments.decideAssignmentRequest({
        requestId: params.id,
        dairyUserId: user.id,
        actorId: user.id,
        decision: action,
        decisionNote: input.decisionNote,
      });
      return NextResponse.json(result);
    }
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    if (action !== 'cancel') return NextResponse.json({ message: 'action must be cancel.' }, { status: 400 });
    const result = await Assignments.cancelAssignmentRequest({
      requestId: params.id,
      collectorUserId: user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return respond(error, 'Failed to update collector assignment request.');
  }
}
