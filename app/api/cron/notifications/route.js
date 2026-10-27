import { NextResponse } from 'next/server';

import { timingSafeEqual } from 'node:crypto';

const Notifications = require('@/lib/services/notification-service.js');
const { repository: UserRepository } = require('@/lib/repositories/userRepository.js');
const { withJobRun } = require('@/lib/repositories/jobRunRepository.js');

export const runtime = 'nodejs';

// Authorized only by the platform cron secret (shared with the subscription
// email job). Evaluates missing-milk and operational reminders for every active
// owner account on a schedule, so reminders are created by reliable server-side
// logic rather than only when a workspace page is visited.
const authorized = (request) => {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  if (!secret || !supplied.startsWith('Bearer ')) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ message: 'Not authorized.' }, { status: 401 });
  try {
    const vercelCron = Boolean(request.headers.get('x-vercel-cron'))
      || /vercel-cron/i.test(request.headers.get('user-agent') || '');
    const result = await withJobRun({
      jobId: 'notification_evaluation',
      trigger: vercelCron ? 'vercel_cron' : 'external',
      run: async () => {
        const users = await UserRepository.getActiveUsers();
        let evaluated = 0;
        let createdCount = 0;
        let reopenedCount = 0;
        let resolvedCount = 0;
        for (const user of users) {
          const data = await Notifications.evaluateOperationalAlerts({
            ownerUserId: user.id,
            accountType: user.accountType,
            now: new Date(),
          });
          evaluated += 1;
          createdCount += data.createdCount;
          reopenedCount += data.reopenedCount;
          resolvedCount += data.resolvedCount;
        }
        return { evaluated, createdCount, reopenedCount, resolvedCount };
      },
    });
    if (result.skipped) {
      return NextResponse.json({ success: false, skipped: true, reason: result.reason });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { message: 'Notification evaluation job failed.' },
      { status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500 }
    );
  }
}

// Vercel Cron invokes scheduled routes with GET. External schedulers may keep
// using POST. Both methods require the same CRON_SECRET bearer token.
export async function GET(request) {
  return POST(request);
}
