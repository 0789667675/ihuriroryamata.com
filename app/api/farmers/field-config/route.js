import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const Domain = require('@/lib/repositories/domainRepository.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const configurations = await Domain.listFarmerFieldConfigurations(user.id);
    return NextResponse.json({ configurations }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return respondWithError(error, 'Failed to load farmer field configuration.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.configurations)) {
      return NextResponse.json({ message: 'A configuration list is required.', code: 'FIELD_CONFIG_REQUIRED' }, { status: 400 });
    }
    const saved = [];
    for (const item of body.configurations) {
      if (!item || !item.fieldKey) continue;
      const savedItem = await Domain.upsertFarmerFieldConfiguration({
        ownerUserId: user.id,
        fieldKey: String(item.fieldKey),
        enabled: item.enabled === true,
        required: item.required === true,
        sortOrder: item.sortOrder || 0,
      });
      if (savedItem) saved.push(savedItem);
    }
    return NextResponse.json({ configurations: saved }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return respondWithError(error, 'Failed to save farmer field configuration.');
  }
}
