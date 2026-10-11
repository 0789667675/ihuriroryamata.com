import { NextResponse } from 'next/server';

const { registerUser } = require('@/lib/services/auth-service.js');
const { repository } = require('@/lib/repositories/userRepository.js');
const Accounts = require('@/lib/services/account-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const user = await registerUser({
      repository,
      name: body.name,
      email: body.email,
      password: body.password,
      accountType: body.accountType || body.account_type,
    });
    await Accounts.sendRegistrationEmailVerification({
      userId: user.id,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || new URL(request.url).origin,
      language: body.language,
    });

    const { passwordHash, ...publicUser } = user;
    return NextResponse.json({
      ok: true,
      user: publicUser,
      verificationRequired: true,
    }, { status: 201 });
  } catch (error) {
    const statusCode = error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' || error.code === 'EMAIL_DELIVERY_UNAVAILABLE' ? 503 : 500);
    const isClientError = statusCode >= 400 && statusCode < 500;
    return NextResponse.json({
      ok: false,
      message: isClientError ? error.message : 'Unable to register account.',
      ...(isClientError && error.code ? { code: error.code } : {}),
    }, { status: statusCode });
  }
}
