import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ success: false, message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function PATCH(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const result = await Notifications.reopenNotification({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
    });
    return NextResponse.json({ success: true, data: result.notification, changed: result.changed });
  } catch (error) {
    return respond(error, 'Failed to reopen the notification.');
  }
}
