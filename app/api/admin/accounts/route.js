import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Admin = require('@/lib/services/platform-admin-service.js');

export const runtime = 'nodejs';

const requireAdmin = async (request) => {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: NextResponse.json({ message: 'Not authenticated.' }, { status: 401 }) };
  if (user.role !== 'super_admin') return { response: NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 }) };
  return { user };
};

const errorResponse = (error) => NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to load platform accounts.' }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await Admin.listAccounts({
      page: params.get('page') || 1,
      limit: params.get('limit') || 20,
      search: params.get('search') || '',
      status: params.get('status') || '',
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
