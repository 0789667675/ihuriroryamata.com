import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const CollectorMilk = require('@/lib/services/collector-milk-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    return NextResponse.json(await CollectorMilk.getPrices({ ownerUserId: user.id }));
  } catch (error) {
    return NextResponse.json({ message: 'Failed to load collector milk prices.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    if (user.role !== 'user') return NextResponse.json({ message: 'Permission denied.' }, { status: 403 });
    const input = await request.json();
    const price = await CollectorMilk.addPrice({
      ownerUserId: user.id,
      actorId: user.id,
      pricePerLiter: input.pricePerLiter,
      effectiveDate: input.effectiveDate,
    });
    return NextResponse.json(price, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode ? error.message : 'Failed to save collector milk price.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
