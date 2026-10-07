import { NextResponse } from 'next/server';

const { verifyPasswordResetCode } = require('@/lib/services/password-reset-service.js');

export const runtime = 'nodejs';

const COOKIE_NAME = 'milk_password_reset';
const getIpAddress = (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || request.headers.get('x-real-ip')
  || 'unknown';

export async function POST(request) {
  try {
    const body = await request.json();
    const resetToken = await verifyPasswordResetCode({
      email: body.email,
      code: body.code,
      ipAddress: getIpAddress(request),
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, resetToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/password-reset',
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error.statusCode ? error.message : 'Unable to verify that code.',
      ...(error.code === 'INVALID_RESET_CODE' ? { code: error.code } : {}),
    }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}