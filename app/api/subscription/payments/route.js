import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Subscriptions = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

const errorResponse = (error) => {
  if (['PHONE_NUMBER_MISSING', 'PHONE_NUMBER_MISMATCH', 'INVALID_PHONE_NUMBER', 'UNSUPPORTED_PROVIDER', 'BILLING_PERIOD_NOT_SUPPORTED'].includes(error.code)) {
    return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: 400 });
  }
  if (error.code === 'PLAN_NOT_AVAILABLE') return NextResponse.json({ success: false, code: 'PAYMENT_INITIATION_FAILED', message: error.message }, { status: 400 });
  if (['TIER_TOO_LOW', 'TIER_MISMATCH'].includes(error.code)) {
    return NextResponse.json({ success: false, code: 'PAYMENT_INITIATION_FAILED', message: 'The selected plan does not match projected monthly milk volume.', usage: error.usage, requiredTier: error.requiredTier || null, upgradeRequired: true }, { status: 409 });
  }
  if (error.code === 'SUBSCRIPTION_NOT_FOUND') return NextResponse.json({ success: false, code: 'PAYMENT_CONFIGURATION_ERROR', message: error.message }, { status: 404 });
  if (['LMBTECH_CREDENTIALS_MISSING', 'LMBTECH_BASE_URL_INVALID', 'LMBTECH_CALLBACK_URL_MISSING', 'LMBTECH_PAYMENT_DISABLED'].includes(error.code)) {
    return NextResponse.json({ success: false, code: 'PAYMENT_CONFIGURATION_ERROR', message: 'The payment service is not ready right now. Please try again shortly.' }, { status: 503 });
  }
  return NextResponse.json({ success: false, code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'The payment service is temporarily unavailable. Please try again shortly.' }, {
    status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 503,
  });
};

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    return NextResponse.json(await require('@/lib/repositories/subscriptionRepository.js').getPaymentsByUser(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user') return NextResponse.json({ success: false, message: 'Insufficient permissions.' }, { status: 403 });
    const input = await request.json();
    if (Object.hasOwn(input, 'phoneNumber') || Object.hasOwn(input, 'payer_phone')) {
      return NextResponse.json({ success: false, code: 'PHONE_NUMBER_CLIENT_INPUT_NOT_ALLOWED', message: 'Payment uses the phone number saved in your account settings.' }, { status: 400 });
    }
    const result = await Subscriptions.createPendingPayment({
      userId: user.id,
      billingPeriod: input.billingPeriod || input.billing_period || 'monthly',
    });
    const state = result.payment?.status || 'PENDING';
    return NextResponse.json({
      success: true,
      payment: result.payment,
      code: state === 'SUCCESS' ? 'PAYMENT_SUCCESS' : state === 'FAILED' ? 'PAYMENT_FAILED' : state === 'CANCELLED' ? 'PAYMENT_CANCELLED' : result.outcomeUncertain ? 'PAYMENT_OUTCOME_UNCERTAIN' : 'PAYMENT_AWAITING_APPROVAL',
      message: state === 'SUCCESS' ? 'Payment confirmed successfully.' : state === 'FAILED' ? 'Payment could not be completed.' : result.outcomeUncertain ? 'Payment outcome is uncertain. Check its status before retrying.' : result.reused ? 'A payment is already pending. Check its status before starting another.' : 'Payment request submitted. Approve it on your phone.',
    }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
