import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const OCR = require('@/lib/services/ocr-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const attempts = new Map();
const MAX_BODY_BYTES = 13 * 1024 * 1024;

const consumeAttempt = (userId) => {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (attempts.get(userId) || []).filter((timestamp) => timestamp > windowStart);
  if (recent.length >= 12) return false;
  recent.push(now);
  attempts.set(userId, recent);
  if (attempts.size > 500) {
    for (const [key, value] of attempts) {
      if (!value.some((timestamp) => timestamp > windowStart)) attempts.delete(key);
    }
  }
  return true;
};

const errorResponse = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
  ...(error.setup ? { setup: error.setup } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    const configuration = OCR.getOcrConfiguration();
    return NextResponse.json({
      configured: configuration.configured,
      provider: configuration.provider,
      setup: configuration.setup || [],
    });
  } catch (error) {
    return errorResponse(error, 'Failed to check OCR configuration.');
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);
    if (!consumeAttempt(user.id)) {
      return NextResponse.json({
        message: 'Too many scans in a short time. Wait a minute and try again.',
        code: 'OCR_RATE_LIMITED',
      }, { status: 429 });
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ message: 'The image is too large.', code: 'OCR_IMAGE_INVALID' }, { status: 413 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.imageBase64 !== 'string') {
      return NextResponse.json({ message: 'An image is required.', code: 'OCR_IMAGE_INVALID' }, { status: 400 });
    }
    const result = await OCR.extractTextFromImage({ base64: body.imageBase64 });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error, 'The image could not be scanned.');
  }
}
