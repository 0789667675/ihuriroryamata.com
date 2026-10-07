import { NextResponse } from 'next/server';

const { COOKIE_NAME, sessionCookieOptions } = require('@/lib/security/session.js');

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
