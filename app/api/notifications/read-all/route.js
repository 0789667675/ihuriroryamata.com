import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

export async function PATCH(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const center = new URL(request.url).searchParams.get('center');
    await Notifications.markAllRead({ ownerUserId: user.id, center });
    return NextResponse.json({ success: true, message: 'All notifications marked as read.' });
  } catch {
    return NextResponse.json({ success: false, message: 'Failed to mark notifications as read.' }, { status: 500 });
  }
}
