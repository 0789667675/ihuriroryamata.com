import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Deductions = require('@/lib/services/deduction-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500
    ? error.message
    : error.code === '42P01' && /deduction_configurations/.test(error.message || '')
      ? 'Deduction setup is incomplete. Apply migration 031_deduction_period_batch_management.sql using the approved database migration process.'
      : fallback,
}, {
  status: error.code === '42P01' && /deduction_configurations/.test(error.message || '')
    ? 503
    : error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const data = await Deductions.listDeductionConfigurations({ ownerUserId: user.id, collectorUserId: user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return respond(error, 'Failed to load deduction configurations.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const configuration = await Deductions.createDeductionConfiguration({
      ownerUserId: user.id,
      collectorUserId: user.id,
      actorId: user.id,
      input: await request.json(),
    });
    return NextResponse.json(configuration, { status: 201 });
  } catch (error) {
    return respond(error, 'Failed to create deduction configuration.');
  }
}