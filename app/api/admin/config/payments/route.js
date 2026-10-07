import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Provider = require('@/lib/services/payment-provider.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'super_admin') return NextResponse.json({ message: 'Insufficient permissions.' }, { status: 403 });
    return NextResponse.json(Provider.getLmbtechPublicStatus());
  } catch {
    return NextResponse.json({ message: 'Failed to load payment configuration.' }, { status: 500 });
  }
}