import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const OwnerIfishi = require('@/lib/services/owner-ifishi-service.js');

export const runtime = 'nodejs';

const allowedUser = (user) => user?.role === 'user' && user.accountType === 'COLLECTOR';
const errorResponse = (error, fallback) => NextResponse.json(
  { message: error.statusCode && error.statusCode < 500 ? error.message : fallback },
  { status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500) }
);

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (!allowedUser(user)) return NextResponse.json({ message: 'Owner Ifishi is available to Collector accounts.' }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const history = await OwnerIfishi.getHistoryForPeriod({
      ownerUserId: user.id,
      month: params.get('month'),
      year: params.get('year'),
      periodType: params.get('periodType'),
    });
    return NextResponse.json({ owner: { name: user.name }, ...history });
  } catch (error) {
    return errorResponse(error, 'Failed to load Owner Ifishi history.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (!allowedUser(user)) return NextResponse.json({ message: 'Owner Ifishi is available to Collector accounts.' }, { status: 403 });
    const input = await request.json();
    const entry = await OwnerIfishi.createEntry({ ownerUserId: user.id, actorId: user.id, date: input.date, volumeLiters: input.volumeLiters });
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to save Owner Ifishi entry.');
  }
}