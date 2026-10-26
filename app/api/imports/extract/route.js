import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const { extractFile } = require('@/lib/imports/server-extraction.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;

const errorResponse = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.statusCode && error.statusCode < 500 && error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);

    if (Number(request.headers.get('content-length') || 0) > MAX_BYTES + 512 * 1024) {
      return NextResponse.json({ message: 'The selected file is larger than 8 MB.', code: 'FILE_TOO_LARGE' }, { status: 413 });
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ message: 'Choose a file to import.', code: 'FILE_REQUIRED' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) {
      return NextResponse.json({ message: 'The selected file is empty.', code: 'FILE_EMPTY' }, { status: 422 });
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ message: 'The selected file is larger than 8 MB.', code: 'FILE_TOO_LARGE' }, { status: 413 });
    }
    const result = await extractFile({ buffer, name: file.name, mimeType: file.type });
    if (!result) {
      return NextResponse.json({
        message: 'Unsupported file. Use CSV, XLSX, PDF, or a page photo.',
        code: 'FILE_UNSUPPORTED',
      }, { status: 415 });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, 'The file could not be read.');
  }
}
