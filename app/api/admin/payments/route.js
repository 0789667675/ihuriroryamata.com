import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Payments = require('@/lib/repositories/subscriptionRepository.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') || 50);
    const status = params.get('status') || null;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({ message: 'limit must be between 1 and 100.' }, { status: 400 });
    }
    if (status && !['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
      return NextResponse.json({ message: 'Unsupported payment status.' }, { status: 400 });
    }
    const payments = await Payments.getAdminPaymentHistory({ limit, status });
    return NextResponse.json({ payments });
  } catch (error) {
    return NextResponse.json({ message: 'Failed to load payment history.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
