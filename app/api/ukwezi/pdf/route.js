import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');
const { renderUkweziPdf, buildUkweziFilename } = require('@/lib/services/ukwezi-pdf-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(params.entries());
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query });
    const pdf = await renderUkweziPdf({ report, user, query, generatedAt: new Date() });
    const month = query.month || report.rangeStart.slice(5, 7);
    const year = query.year || report.rangeStart.slice(0, 4);
    const filename = buildUkweziFilename({
      accountName: user.name || user.email || 'account',
      year,
      month,
      periodType: query.periodType || 'monthly',
    });

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to generate Ukwezi PDF.' }, {
      status: error.statusCode || 500,
    });
  }
}
