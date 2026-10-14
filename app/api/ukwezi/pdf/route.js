import { NextResponse } from 'next/server';
const { randomUUID } = require('node:crypto');

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');
const settlementRepository = require('@/lib/repositories/farmerSettlementRepository.js');
const { renderUkweziPdf, buildUkweziResponseHeaders } = require('@/lib/services/ukwezi-pdf-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const requestedLanguage = new URL(request.url).searchParams.get('language') === 'en' ? 'en' : 'rw';
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(params.entries());
    const month = Number(query.month);
    const year = Number(query.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100
        || !['first-half', 'second-half'].includes(query.periodType)) {
      return NextResponse.json({ message: 'Choose a valid month, year, and Ukwezi accounting period.' }, { status: 400 });
    }
    query.language = query.language === 'en' ? 'en' : 'rw';
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query, settlementRepository });
    const pdf = await renderUkweziPdf({ report, user, query, generatedAt: new Date() });
    const headers = buildUkweziResponseHeaders({
      accountName: user.name || user.email || 'account',
      year,
      month,
      periodType: query.periodType,
    });

    return new NextResponse(pdf, {
      status: 200,
      headers,
    });
  } catch (error) {
    const status = error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500);
    const requestId = status >= 500 ? randomUUID() : null;
    if (status >= 500) {
      console.error('[ukwezi/pdf] Failed to generate accounting PDF.', {
        requestId,
        name: error.name || 'UnknownError',
        code: error.code || null,
        message: error.message || null,
        stack: error.stack || null,
      });
    }
    const message = status >= 500
      ? requestedLanguage === 'en'
        ? `Ukwezi PDF could not be generated. Contact support with reference ${requestId}.`
        : `PDF ntiyashoboye gukorwa. Menyesha ushinzwe sisitemu ukoresheje kode ${requestId}.`
      : error.message || 'Choose a valid month, year, and Ukwezi accounting period.';
    return NextResponse.json({ message, requestId, code: error.code || (status >= 500 ? 'UKWEZI_PDF_GENERATION_FAILED' : 'UKWEZI_PDF_INVALID_REQUEST') }, {
      status,
    });
  }
}
