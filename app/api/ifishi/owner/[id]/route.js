import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const OwnerIfishi = require('@/lib/services/owner-ifishi-service.js');

export const runtime = 'nodejs';

export async function PUT(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user' || user.accountType !== 'COLLECTOR') {
      return NextResponse.json({ message: 'Owner Ifishi is available to Collector accounts.' }, { status: 403 });
    }
    const input = await request.json();
    const entry = await OwnerIfishi.correctEntry({
      ownerUserId: user.id,
      actorId: user.id,
      id: params.id,
      date: input.date,
      volumeLiters: input.volumeLiters,
    });
    if (!entry) return NextResponse.json({ message: 'Owner milk record not found.' }, { status: 404 });
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to correct Owner Ifishi entry.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}