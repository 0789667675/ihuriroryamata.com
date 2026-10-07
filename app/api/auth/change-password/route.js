import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Accounts = require('@/lib/services/account-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    const body = await request.json();
    return NextResponse.json(await Accounts.changePassword({
      userId: user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    }));
  } catch (error) {
    return NextResponse.json({ ok: false, message: error.statusCode && error.statusCode < 500 ? error.message : 'Unable to change password.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}