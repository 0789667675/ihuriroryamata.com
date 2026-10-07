import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Assignments = require('@/lib/services/collector-assignment-service.js');

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const removed = await Assignments.revokeAssignment({ dairyUserId: user.id, actorId: user.id, collectorUserId: params.collectorUserId });
    if (!removed) return NextResponse.json({ message: 'That collector is not linked to this collection center.' }, { status: 404 });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to revoke collector assignment.', ...(error.code ? { code: error.code } : {}) }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
