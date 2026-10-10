import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Assignments = require('@/lib/services/collector-assignment-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : fallback, ...(error.code ? { code: error.code } : {}) }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    return NextResponse.json(await Assignments.listAssignments({ dairyUserId: user.id, centerId: new URL(request.url).searchParams.get('centerId') }));
  } catch (error) {
    return respond(error, 'Failed to load collector assignments.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);
    const input = await request.json();
    const assignment = await Assignments.assignCollector({ dairyUserId: user.id, actorId: user.id, collectorUserId: input.collectorUserId });
    return NextResponse.json(assignment, { status: 201 });
  } catch (error) {
    return respond(error, 'Failed to create collector assignment.');
  }
}
