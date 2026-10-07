import { NextResponse } from 'next/server';

const { loginUser } = require('@/lib/services/auth-service.js');
const { repository } = require('@/lib/repositories/userRepository.js');
const { COOKIE_NAME, createSessionToken, sessionCookieOptions } = require('@/lib/security/session.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await loginUser({
      repository,
      email: body.email,
      password: body.password,
    });

    const response = NextResponse.json({
      ok: true,
      user: result.user,
    });
    response.cookies.set(COOKIE_NAME, createSessionToken({ id: result.user.id, role: result.user.role }), sessionCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error.statusCode && error.statusCode < 500 ? error.message : 'Invalid email or password.',
    }, { status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 401 });
  }
}
