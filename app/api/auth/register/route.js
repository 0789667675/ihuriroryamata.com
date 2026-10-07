import { NextResponse } from 'next/server';

const { registerUser } = require('@/lib/services/auth-service.js');
const { repository } = require('@/lib/repositories/userRepository.js');

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

    const { passwordHash, ...publicUser } = user;
    return NextResponse.json({
      ok: true,
      user: publicUser,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message: error.message,
    }, { status: error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 400 });
  }
}
