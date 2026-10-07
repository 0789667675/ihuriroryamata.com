import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });

    const paymentId = Number(params.paymentId);
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return NextResponse.json({ message: 'Invalid payment ID.' }, { status: 400 });
    }
    const payment = await Subscriptions.reconcilePayment({ paymentId });
    if (!payment) return NextResponse.json({ message: 'Payment not found.' }, { status: 404 });
    return NextResponse.json({ payment });
  } catch (error) {
    return NextResponse.json({ message: 'Could not check payment status.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
