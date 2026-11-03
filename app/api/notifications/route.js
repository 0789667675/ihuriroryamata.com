import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Notifications = require('@/lib/services/notification-service.js');
const Audit = require('@/lib/services/audit-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ success: false, message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
const EVALUATION_THROTTLE_MS = 60 * 1000;
const evaluationState = () => {
  if (!globalThis.__milkNotificationEvaluation) globalThis.__milkNotificationEvaluation = new Map();
  return globalThis.__milkNotificationEvaluation;
};
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') {
      const state = evaluationState();
      const previous = state.get(user.id);
      if (!previous || Date.now() - previous >= EVALUATION_THROTTLE_MS) {
        state.set(user.id, Date.now());
        let evaluated;
        try {
          evaluated = await Notifications.evaluateOperationalAlerts({
            ownerUserId: user.id,
            accountType: user.accountType,
            now: new Date(),
            daysBack: Notifications.ON_DEMAND_EVALUATION_DAYS_BACK,
          });
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
              notificationsCreated: evaluated.createdCount,
              notificationsResolved: evaluated.resolvedCount,
              notificationsReopened: evaluated.reopenedCount,
            },
            actorId: user.id,
            ownerUserId: user.id,
          });
        } catch {
          // Current-state reconciliation remains useful if audit storage is unavailable.
        }
      }
    }
    const params = new URL(request.url).searchParams;
    const isSuperAdmin = user.role === 'super_admin';
    const data = await Notifications.getNotifications({
      ownerUserId: user.id,
      isSuperAdmin,
      center: params.get('center'),
      status: params.get('status'),
      priority: params.get('priority'),
      type: params.get('type'),
      state: params.get('state'),
      category: params.get('category'),
      alertGroup: params.get('alertGroup'),
      search: params.get('search') || '',
      sortBy: params.get('sortBy') || 'date',
      sortDirection: params.get('sortDirection') || 'desc',
      limit: params.get('limit'),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return respond(error, 'Failed to load notifications.');
  }
}
