import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const CollectorMilk = require('@/lib/services/collector-milk-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await CollectorMilk.getHistory({
      ownerUserId: user.id,
      startDate: params.get('startDate'),
      endDate: params.get('endDate'),
    }));
  } catch (error) {
    return NextResponse.json({ message: error.statusCode ? error.message : 'Failed to load collector milk history.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
