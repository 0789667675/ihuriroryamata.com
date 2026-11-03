import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

const Subscriptions = require('@/lib/services/subscription-service.js');
const { withJobRun } = require('@/lib/repositories/jobRunRepository.js');

export const runtime = 'nodejs';

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
      jobId: 'subscription_email_outbox',
      trigger: vercelCron ? 'vercel_cron' : 'external',
      run: () => Subscriptions.deliverSubscriptionEmails({ limit: 100 }),
    });
    if (result.skipped) {
      return NextResponse.json({ success: false, skipped: true, reason: result.reason });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ message: 'Subscription email outbox job failed.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}

export async function GET(request) {
  return POST(request);
}