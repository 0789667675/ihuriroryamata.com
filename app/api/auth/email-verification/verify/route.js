import { NextResponse } from 'next/server';

const Accounts = require('@/lib/services/account-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json(await Accounts.verifyRegistrationEmail({ token: body.token }));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error.statusCode && error.statusCode < 500 ? error.message : 'Unable to verify this email address.',
      ...(error.code ? { code: error.code } : {}),
    }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}