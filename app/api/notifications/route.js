import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ success: false, message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const data = await Notifications.getNotifications({
      ownerUserId: user.id,
      center: params.get('center'),
      status: params.get('status'),
      priority: params.get('priority'),
      limit: params.get('limit'),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return respond(error, 'Failed to load notifications.');
  }
}
