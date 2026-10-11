import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');
const { renderUkweziPdf, buildUkweziResponseHeaders } = require('@/lib/services/ukwezi-pdf-service.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
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
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query });
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
    if (status >= 500) {
      console.error('[ukwezi/pdf] Failed to generate accounting PDF.', {
        name: error.name || 'UnknownError',
        code: error.code || null,
      });
    }
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to generate Ukwezi PDF. Please retry or contact support.' }, {
      status,
    });
  }
}
