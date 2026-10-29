import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });

    let center = new URL(request.url).searchParams.get('center');
    if (!center || center === 'undefined' || center === 'null' || center === '[object Object]' || typeof center !== 'string' || !center.trim()) {
      center = null;
    } else {
      center = center.trim();
    }

    try {
      const unreadCount = await Notifications.getUnreadCount({ ownerUserId: user.id, center });
      return NextResponse.json({ success: true, data: { unreadCount: Number(unreadCount) || 0 } });
    } catch {
      return NextResponse.json({ success: true, data: { unreadCount: 0 } });
    }
  } catch (error) {
    return NextResponse.json({ success: true, data: { unreadCount: 0 } }, { status: 200 });
  }
}
