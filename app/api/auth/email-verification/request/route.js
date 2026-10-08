import { NextResponse } from 'next/server';

const Accounts = require('@/lib/services/account-service.js');

export const runtime = 'nodejs';

const getIpAddress = (request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || request.headers.get('x-real-ip')
  || 'unknown';

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await Accounts.requestRegistrationEmailVerification({
      email: body.email,
      ipAddress: getIpAddress(request),
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || new URL(request.url).origin,
      language: body.language,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, message: 'Email verification is temporarily unavailable.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : error.statusCode || 500,
    });
  }
}