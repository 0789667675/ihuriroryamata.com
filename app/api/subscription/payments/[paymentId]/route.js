import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    const payment = await Subscriptions.reconcilePayment({ paymentId: Number(params.paymentId), userId: user.id });
    if (!payment) return NextResponse.json({ message: 'Payment not found.' }, { status: 404 });
    return NextResponse.json(payment);
  } catch {
    return NextResponse.json({ message: 'Could not check payment status.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  return GET(request, { params });
}
