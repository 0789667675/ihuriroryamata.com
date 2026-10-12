import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Config = require('@/lib/services/platform-config-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const authorize = async (request) => {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: NextResponse.json({ message: 'Not authenticated.' }, { status: 401 }) };
  if (user.role !== 'super_admin') return { response: NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 }) };
  return { user };
};

export async function GET(request) {
  try {
    const access = await authorize(request);
    if (access.response) return access.response;
    return NextResponse.json(await Config.getSubscriptionPolicy());
  } catch (error) {
    return NextResponse.json({ message: 'Failed to load subscription policy.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}

export async function PUT(request) {
  try {
    const access = await authorize(request);
    if (access.response) return access.response;
    return NextResponse.json(await Config.updateSubscriptionPolicy({ actorId: access.user.id, input: await request.json() }));
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to update subscription policy.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}