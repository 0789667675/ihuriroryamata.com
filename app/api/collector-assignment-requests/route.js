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

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const status = new URL(request.url).searchParams.get('status');
    if (user.accountType === 'COLLECTION_CENTER') {
      requireAccountType(user, 'COLLECTION_CENTER');
      return NextResponse.json(await Assignments.listDairyRequests({
        dairyUserId: user.id,
        status: status || 'pending',
      }));
    }
    requireAccountType(user, 'COLLECTOR');
    return NextResponse.json(await Assignments.listCollectorRequests({
      collectorUserId: user.id,
      status: status || null,
    }));
  } catch (error) {
    return respond(error, 'Failed to load collector assignment requests.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const input = await request.json();
    const created = await Assignments.requestAssignment({
      collectorUserId: user.id,
      dairyUserId: input.dairyUserId,
      requestNote: input.requestNote,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return respond(error, 'Failed to create collector assignment request.');
  }
}
