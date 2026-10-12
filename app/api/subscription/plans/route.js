import { NextResponse } from 'next/server';

const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await Subscriptions.getPublicSubscriptionConfiguration(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ message: 'Subscription pricing is temporarily unavailable.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}