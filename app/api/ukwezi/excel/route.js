import { NextResponse } from 'next/server';
const { randomUUID } = require('node:crypto');
const XLSX = require('xlsx');

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Reports = require('@/lib/services/monthly-report-service.js');
const settlementRepository = require('@/lib/repositories/farmerSettlementRepository.js');

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
    query.language = requestedLanguage;
    const report = await Reports.getSummary({ ownerUserId: user.id, actorId: user.id, query, settlementRepository });

    const isCollector = user.accountType === 'COLLECTOR';
    const isDairy = user.accountType === 'COLLECTION_CENTER';

    const rawRows = isCollector
      ? (report.farmerPayments || [])
      : isDairy
        ? (report.collectorSettlementRows || [])
        : [];

    // Filter only farmers with verified bank account numbers
    const verifiedFarmers = rawRows.filter((r) => {
      const acct = r.accountNumber || r.phone;
      return acct && String(acct).trim().length > 3 && (Number(r.netAmount || 0) > 0);
    });

    const periodLabel = query.periodType === 'first-half' ? 'H1' : 'H2';
    const rowsForExport = [];

    // Add verified farmer rows
    verifiedFarmers.forEach((farmer, idx) => {
      const name = farmer.farmerName || farmer.name || `Farmer ${idx + 1}`;
      const account = farmer.accountNumber || farmer.phone || '—';
      const phone = farmer.phone || '';
      const amount = Math.round(Number(farmer.netAmount || 0));
      const ref = `MILK-${year}-${String(month).padStart(2, '0')}-${periodLabel}-${String(farmer.farmerNumber ?? idx + 1).padStart(3, '0')}`;
      rowsForExport.push([name, account, phone, amount, ref]);
    });

    // Add single Owner Account line holding the remainder
    const ownerName = user.name || user.email || 'Owner';
    const ownerRemainderAmount = Math.round(
      Number(
        report.nyirayoTotalWithOwnerList
        ?? (report.settlementAccounting?.ownerGrossReconciliation?.totalAfterOperations
        ?? (report.ownerSettlementRow?.netAmount ?? 0))
      )
    );
    const ownerAccount = user.accountNumber || user.phone || '—';
    const ownerPhone = user.phone || '';
    const ownerRef = `MILK-${year}-${String(month).padStart(2, '0')}-${periodLabel}-OWNER`;
    rowsForExport.push([`${ownerName} (Konti ya Nyirayo / Remainder)`, ownerAccount, ownerPhone, ownerRemainderAmount, ownerRef]);

    // Build Excel Workbook
    const workbook = XLSX.utils.book_new();
    const headers = ['Beneficiary Name', 'Account Number', 'Phone Number', 'Amount RWF', 'Payment Reference'];
    const sheetData = [headers, ...rowsForExport];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 30 }, // Beneficiary Name
      { wch: 22 }, // Account Number
      { wch: 18 }, // Phone Number
      { wch: 16 }, // Amount RWF
      { wch: 28 }, // Payment Reference
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bank Payroll');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const safeAccountName = (user.name || user.email || 'account').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `bank-payroll-${safeAccountName}-${year}-${String(month).padStart(2, '0')}-${query.periodType}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    const status = error.statusCode || 500;
    const requestId = status >= 500 ? randomUUID() : null;
    return NextResponse.json(
      { message: error.message || 'Excel could not be generated.', requestId },
      { status }
    );
  }
}
