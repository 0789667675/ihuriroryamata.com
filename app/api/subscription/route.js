import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    const billingPeriod = new URL(request.url).searchParams.get('billingPeriod') || 'monthly';
    const data = await Subscriptions.getCustomerSubscription({ userId: user.id, billingPeriod });
    if (!data) return NextResponse.json({ message: 'Account not found.' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode ? error.message : 'Failed to load subscription.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
