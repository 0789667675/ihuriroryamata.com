import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const center = new URL(request.url).searchParams.get('center');
    const unreadCount = await Notifications.getUnreadCount({ ownerUserId: user.id, center });
    return NextResponse.json({ success: true, data: { unreadCount } });
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Failed to count unread notifications.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
