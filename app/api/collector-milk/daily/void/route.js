import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const CollectorMilk = require('@/lib/services/collector-milk-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const input = await request.json();
    return NextResponse.json(await CollectorMilk.voidDaily({
      ownerUserId: user.id,
      actorId: user.id,
      date: input.date,
      reason: input.reason,
    }));
  } catch (error) {
    const status = error.statusCode || (error.code === 'MILK_DAY_NOT_FOUND' ? 404 : error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500);
    return NextResponse.json({ message: error.statusCode || error.code === 'MILK_DAY_NOT_FOUND' ? error.message : 'Failed to void the collector milk day.' }, { status });
  }
}
