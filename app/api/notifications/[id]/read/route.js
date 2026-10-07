import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const notification = await Notifications.markNotificationRead({ id: params.id, ownerUserId: user.id });
    if (!notification) return NextResponse.json({ success: false, message: 'Notification not found.' }, { status: 404 });
    return NextResponse.json({ success: true, data: notification });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.statusCode ? error.message : 'Failed to mark notification as read.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
