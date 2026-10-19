import { NextResponse } from 'next/server';

import { timingSafeEqual } from 'node:crypto';

const Notifications = require('@/lib/services/notification-service.js');
const { repository: UserRepository } = require('@/lib/repositories/userRepository.js');

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
    const users = await UserRepository.repository.getActiveUsers();
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
    return NextResponse.json({
      success: true,
      evaluated,
      createdCount,
      reopenedCount,
      resolvedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { message: 'Notification evaluation job failed.' },
      { status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500 }
    );
  }
}
