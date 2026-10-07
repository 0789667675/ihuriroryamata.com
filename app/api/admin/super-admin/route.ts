import { NextResponse } from 'next/server';

import { SUPER_ADMIN_EMAIL } from '@/lib/config/site';
const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
  if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
  return NextResponse.json({ email: user.email, role: 'SUPER_ADMIN', configuredEmail: SUPER_ADMIN_EMAIL });
}
