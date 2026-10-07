import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Milk = require('@/lib/services/milk-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const result = await Milk.getDailyCollection({
      ownerUserId: user.id,
      collectorUserId: user.accountType === 'COLLECTOR' ? String(user.id) : params.get('collectorUserId') || '',
      date: params.get('date') || new Date().toISOString().slice(0, 10),
      centerId: params.get('centerId'),
      center: params.get('center') || params.get('collectionCenter'),
      cursor: params.get('cursor'),
      limit: params.get('limit') || 50,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to load daily collection.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
