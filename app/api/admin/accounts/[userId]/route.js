import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Admin = require('@/lib/services/platform-admin-service.js');

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    const result = await Admin.getAccountDetails({ userId: params.userId });
    if (!result) return NextResponse.json({ message: 'Account not found.' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode ? error.message : 'Failed to load account.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
