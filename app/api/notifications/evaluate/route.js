import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');
const Audit = require('@/lib/services/audit-service.js');

export const runtime = 'nodejs';

// Lazy, bounded evaluation: the workspace triggers this while loading, and this
// in-process guard prevents a client from re-running it on every page view.
// Evaluation is idempotent and safe to retry, so the guard is only a cost control.
const THROTTLE_MS = 60 * 1000;
const evaluationState = () => {
  if (!globalThis.__milkNotificationEvaluation) globalThis.__milkNotificationEvaluation = new Map();
  return globalThis.__milkNotificationEvaluation;
};

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    const state = evaluationState();
    const previous = state.get(user.id);
    if (previous && Date.now() - previous < THROTTLE_MS) {
      return NextResponse.json({ success: true, data: { skipped: true, createdCount: 0, resolvedCount: 0, reopenedCount: 0, refreshedCount: 0 } });
    }
    state.set(user.id, Date.now());
    let data;
    try {
      data = await Notifications.evaluateOperationalAlerts({ ownerUserId: user.id, accountType: user.accountType, now: new Date() });
    } catch (error) {
      state.delete(user.id);
      throw error;
    }
    try {
      await Audit.createAuditLog({
        entityType: 'notification_evaluation',
        entityId: 0,
        action: 'evaluated',
        details: {
          center: null,
          notificationsCreated: data.createdCount,
          notificationsResolved: data.resolvedCount,
          notificationsReopened: data.reopenedCount,
        },
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
