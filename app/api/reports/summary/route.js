import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');
const settlementRepository = require('@/lib/repositories/farmerSettlementRepository.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(params.entries());
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query, settlementRepository });
    return NextResponse.json(report);
  } catch (error) {
    console.error('[API 500 ERROR in GET /api/reports/summary]:', error);
    const status = error.statusCode || (
      error.code === 'SUBSCRIPTION_EXPIRED' ? 403 :
      error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 :
      500
    );
    const code = error.code || (status === 503 ? 'SERVICE_UNAVAILABLE' : status === 403 ? 'FORBIDDEN' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR');
    const message = error.statusCode && error.statusCode < 500 ? error.message : 'Failed to load report.';
    return NextResponse.json(
      {
        ok: false,
        error: error.message || message,
        message,
        code,
      },
      { status }
    );
  }
}
