import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    const usage = await Subscriptions.getCustomerUsage({ userId: user.id });
    if (!usage) return NextResponse.json({ message: 'Subscription not found.' }, { status: 404 });
    return NextResponse.json({ usage });
  } catch (error) {
    return NextResponse.json({ message: 'Failed to load subscription usage.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
