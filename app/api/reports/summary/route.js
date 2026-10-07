import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(params.entries());
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to load report.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
