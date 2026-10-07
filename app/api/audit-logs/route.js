import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Audit = require('@/lib/services/audit-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') return NextResponse.json({ success: false, message: 'Insufficient permissions.' }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const data = await Audit.listAuditLogs({
      ownerUserId: user.id,
      page: params.get('page') || 1,
      limit: params.get('limit') || 50,
      entityType: params.get('entityType'),
      action: params.get('action'),
      startDate: params.get('startDate'),
      endDate: params.get('endDate'),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to load audit logs.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
