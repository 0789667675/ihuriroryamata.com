import { NextResponse } from 'next/server';

const { requestPasswordReset } = require('@/lib/services/password-reset-service.js');

export const runtime = 'nodejs';

const genericResponse = {
  ok: true,
  message: 'If an account matches that email, password reset instructions will be sent.',
};

const getIpAddress = (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || request.headers.get('x-real-ip')
  || 'unknown';

export async function POST(request) {
  try {
    const body = await request.json();
    await requestPasswordReset({ email: body.email, language: body.language, ipAddress: getIpAddress(request) });
    return NextResponse.json(genericResponse);
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: 'Password reset is temporarily unavailable. Please try again later.' },
      { status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500 }
    );
  }
}