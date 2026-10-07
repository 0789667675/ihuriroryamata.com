import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Admin = require('@/lib/services/platform-admin-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    return NextResponse.json(await Admin.getAccountsSummary());
  } catch (error) {
    return NextResponse.json({ message: 'Failed to load platform summary.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}
