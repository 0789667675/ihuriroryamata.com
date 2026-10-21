import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const PlatformHealth = require('@/lib/services/platform-health-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401, headers: NO_STORE });
    if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403, headers: NO_STORE });
    return NextResponse.json(await PlatformHealth.getPlatformHealth(), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { message: 'System health is temporarily unavailable.' },
      { status: error?.code === 'DATABASE_NOT_CONFIGURED' || error?.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500, headers: NO_STORE }
    );
  }
}
