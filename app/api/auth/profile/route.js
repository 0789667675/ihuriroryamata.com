import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { repository } = require('@/lib/repositories/userRepository.js');
const Accounts = require('@/lib/services/account-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({
  ok: false,
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    const profile = await repository.getAccountProfile(user.id);
    if (!profile) return NextResponse.json({ ok: false, message: 'Account profile not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, user: profile });
  } catch (error) {
    return respond(error, 'Failed to load account settings.');
  }
}

export async function PUT(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    const input = await request.json();
    const result = await Accounts.updateProfile({
      userId: user.id,
      input,
      baseUrl: process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || null,
      language: input.language,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.emailChangePending ? 202 : 200 });
  } catch (error) {
    return respond(error, 'Failed to save account settings.');
  }
}