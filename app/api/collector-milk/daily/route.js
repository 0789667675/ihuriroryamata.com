import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const CollectorMilk = require('@/lib/services/collector-milk-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const date = new URL(request.url).searchParams.get('date');
    return NextResponse.json(await CollectorMilk.getDaily({ ownerUserId: user.id, date }));
  } catch (error) {
    return respond(error, 'Failed to load collector milk.');
  }
}

export async function PUT(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const input = await request.json();
    const record = await CollectorMilk.saveDaily({
      ownerUserId: user.id,
      actorId: user.id,
      date: input.date,
      volumeLiters: input.volumeLiters,
    });
    return NextResponse.json(record);
  } catch (error) {
    return respond(error, 'Failed to save collector milk.');
  }
}
