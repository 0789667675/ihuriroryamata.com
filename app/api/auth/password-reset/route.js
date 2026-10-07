import { NextResponse } from 'next/server';

const { resetPassword } = require('@/lib/services/password-reset-service.js');

export const runtime = 'nodejs';

const COOKIE_NAME = 'milk_password_reset';

export async function POST(request) {
  try {
    const body = await request.json();
    const resetToken = request.cookies.get(COOKIE_NAME)?.value;
    await resetPassword({ resetToken, password: body.password });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/password-reset',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error.statusCode ? error.message : 'Unable to reset password.',
      ...(['INVALID_RESET_CODE', 'INVALID_PASSWORD'].includes(error.code) ? { code: error.code } : {}),
    }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}