import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');
const Audit = require('@/lib/services/audit-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const center = body.center || new URL(request.url).searchParams.get('center');
    const data = await Notifications.evaluateNotifications({ ownerUserId: user.id, center, now: new Date() });
    try {
      await Audit.createAuditLog({
        entityType: 'notification_evaluation',
        entityId: 0,
        action: 'evaluated',
        details: { center: center || null, notificationsCreated: data.notifications.length },
        actorId: user.id,
        ownerUserId: user.id,
      });
    } catch {
      // Notification delivery does not depend on the audit sink.
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Failed to evaluate notifications.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
