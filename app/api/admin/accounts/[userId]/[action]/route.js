import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Admin = require('@/lib/services/platform-admin-service.js');

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  try {
    const actor = await getAuthenticatedUser(request);
    if (!actor) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (actor.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const result = await Admin.manageAccount({ userId: params.userId, actorId: actor.id, action: params.action, input: body });
    if (!result) return NextResponse.json({ message: 'Account or subscription not found.' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to update account.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
