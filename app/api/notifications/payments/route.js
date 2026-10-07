import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const data = await Notifications.getPaymentNotifications({
      ownerUserId: user.id,
      status: params.get('status'),
      priority: params.get('priority'),
      limit: params.get('limit'),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.statusCode ? error.message : 'Failed to load payment notifications.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
