import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

const authorized = (request) => {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  if (!secret || !supplied.startsWith('Bearer ')) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const configuredReminderDays = () => {
  const raw = process.env.SUBSCRIPTION_REMINDER_DAYS || '';
  if (!raw.trim()) return [];
  const values = raw.split(',').map((value) => value.trim());
  const days = values.map(Number);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 90)) {
    throw Object.assign(new Error('SUBSCRIPTION_REMINDER_DAYS must be a comma-separated list of days from 1 to 90.'), { code: 'SUBSCRIPTION_REMINDER_CONFIG_INVALID' });
  }
  return [...new Set(days)];
};

export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ message: 'Not authorized.' }, { status: 401 });
  try {
    const reminderDays = configuredReminderDays();
    const result = await Subscriptions.runSubscriptionEmailJob({ reminderDays });
    return NextResponse.json({ ...result, remindersConfigured: reminderDays.length > 0 });
  } catch (error) {
    return NextResponse.json({ message: error.code === 'SUBSCRIPTION_REMINDER_CONFIG_INVALID' ? error.message : 'Subscription email job failed.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
