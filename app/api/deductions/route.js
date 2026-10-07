import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Deductions = require('@/lib/services/deduction-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await Deductions.listDeductions({
      ownerUserId: user.id,
      farmerId: params.get('farmerId'),
      cursor: params.get('cursor'),
      limit: params.get('limit') || 50,
    }));
  } catch (error) {
    return respond(error, 'Failed to load deductions.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const deduction = await Deductions.createDeduction({
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    return NextResponse.json(deduction, { status: 201 });
  } catch (error) {
    return respond(error, 'Failed to create deduction.');
  }
}
