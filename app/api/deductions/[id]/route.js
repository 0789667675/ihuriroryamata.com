import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Deductions = require('@/lib/services/deduction-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const deduction = await Deductions.getDeduction({ id: params.id, ownerUserId: user.id });
    if (!deduction) return NextResponse.json({ message: 'Deduction not found.' }, { status: 404 });
    return NextResponse.json(deduction);
  } catch (error) {
    return respond(error, 'Failed to load deduction.');
  }
}

export async function PUT(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const deduction = await Deductions.updateDeduction({
      id: params.id,
      ownerUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    if (!deduction) return NextResponse.json({ message: 'Deduction not found.' }, { status: 404 });
    return NextResponse.json(deduction);
  } catch (error) {
    return respond(error, 'Failed to update deduction.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const deleted = await Deductions.deleteDeduction({ id: params.id, ownerUserId: user.id, actorId: user.id });
    if (!deleted) return NextResponse.json({ message: 'Deduction not found.' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return respond(error, 'Failed to delete deduction.');
  }
}
