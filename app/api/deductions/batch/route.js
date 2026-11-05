import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Deductions = require('@/lib/services/deduction-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const result = await Deductions.applyDeductionBatch({
      ownerUserId: user.id,
      collectorUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    return NextResponse.json(result, { status: result.failed.length ? 207 : 200 });
  } catch (error) {
    return respond(error, 'Failed to apply deduction batch.');
  }
}