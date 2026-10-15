import { NextResponse } from 'next/server';

const { registerUser } = require('@/lib/services/auth-service.js');
const { repository } = require('@/lib/repositories/userRepository.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const accountType = String(body.accountType || body.account_type || 'COLLECTOR').toUpperCase();
    const selectedPlanCode = body.selectedPlanCode || body.planCode || null;
    const user = await registerUser({
      repository,
      name: body.name,
      email: body.email,
      password: body.password,
      accountType,
      selectedPlanCode,
    });
    const { passwordHash, ...publicUser } = user;
    return NextResponse.json({
      ok: true,
      user: publicUser,
      verificationRequired: false,
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
