import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Milk = require('@/lib/services/milk-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.statusCode && error.statusCode < 500 && error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR']);
    await requireActiveSubscription(user);

    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ message: 'The reviewed list is too large. Import at most 100 milk rows per request.', code: 'IMPORT_TOO_LARGE' }, { status: 413 });
    }
    const body = await request.json().catch(() => null);
    // Multi-day register scans may send `entries` (one per farmer per register date).
    const reviewedRows = body && (Array.isArray(body.rows) ? body.rows : Array.isArray(body.entries) ? body.entries : null);
    if (!body || !reviewedRows) {
      return NextResponse.json({ message: 'A list of reviewed milk rows is required.', code: 'IMPORT_ROWS_REQUIRED' }, { status: 400 });
    }
    const result = await Milk.importMilkRecords({
      ownerUserId: user.id,
      actorId: user.id,
      collectorUserId: user.id,
      date: body.date,
      batchKey: body.batchKey,
      scannedAt: body.scannedAt,
      source: body.source || 'ocr_register_scan',
      session: body.session,
      rows: reviewedRows,
    });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return respondWithError(error, 'Failed to import milk records.');
  }
}
