import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { query } = require('@/lib/postgres.js');
const { getFarmerTotals } = require('@/lib/repositories/reportRepository.js');
const settlementRepository = require('@/lib/repositories/farmerSettlementRepository.js');
const { createSettlementRecord, confirmSettlement, hasValidSaccoAccount } = require('@/lib/services/farmer-settlement-service.js');
const { requireOwner, requireOwnerAction, requireCollector, assertOwnerScope, assertAssignedCollector, parsePositiveId, parsePositiveAmount, parsePeriod } = require('@/lib/services/farmer-settlement-access.js');

export const runtime = 'nodejs';

const monthRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`,
  };
};

const readOwnerId = (value) => parsePositiveId(value, 'ownerUserId');
const statusFor = (error) => error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500);

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const action = String(searchParams.get('action') || 'summary').toLowerCase();

    if (action === 'confirmations') {
      requireCollector(user);
      const range = monthRange();
      const { periodStart, periodEnd } = parsePeriod(searchParams.get('periodStart') || range.start, searchParams.get('periodEnd') || range.end);
      const { rows } = await query(
        `SELECT s.id AS "settlementId", s.farmer_id AS "farmerId", f.name AS "farmerName",
           s.owner_user_id AS "ownerUserId", s.amount, s.payment_method AS "paymentMethod",
           s.payment_reference AS "paymentReference", s.period_start AS "periodStart", s.period_end AS "periodEnd",
           s.status, s.approved_at AS "approvedAt", s.reason
         FROM farmer_settlement_records s
         JOIN farmers f ON f.id = s.farmer_id AND f.owner_user_id = s.owner_user_id
         JOIN collector_assignments ca ON ca.dairy_user_id = s.owner_user_id
           AND ca.collector_user_id = $1 AND ca.revoked_at IS NULL
         WHERE f.collector_user_id = $1 AND s.period_start = $2::date AND s.period_end = $3::date AND s.status = 'APPROVED'
         ORDER BY s.approved_at DESC, s.id DESC`,
        [user.id, periodStart, periodEnd]
      );
      return NextResponse.json({ ok: true, periodStart, periodEnd, data: rows });
    }

    requireOwner(user);
    const ownerUserId = readOwnerId(searchParams.get('ownerUserId') || user.id);
    assertOwnerScope(user, ownerUserId);

    if (action === 'debts') {
      const { rows } = await query(
        `SELECT d.*, f.name AS farmer_name FROM farmer_debt_ledgers d
         JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
         WHERE d.owner_user_id = $1 AND d.status IN ('OPEN', 'PARTIALLY_SETTLED') ORDER BY d.period_end DESC, d.id DESC`,
        [ownerUserId]
      );
      return NextResponse.json({ ok: true, data: rows });
    }
    if (action !== 'summary') return NextResponse.json({ ok: false, message: 'Unsupported settlement query.' }, { status: 400 });

    const range = monthRange();
    const { periodStart, periodEnd } = parsePeriod(searchParams.get('periodStart') || range.start, searchParams.get('periodEnd') || range.end);
    const farmers = await getFarmerTotals({ ownerUserId, rangeStart: periodStart, rangeEnd: periodEnd });
    const retainedFarmers = farmers.filter((farmer) => !hasValidSaccoAccount(farmer));
    const { rows: records } = await query(
      `SELECT s.*, f.name AS farmer_name FROM farmer_settlement_records s
       JOIN farmers f ON f.id = s.farmer_id AND f.owner_user_id = s.owner_user_id
       WHERE s.owner_user_id = $1 AND s.period_start = $2::date AND s.period_end = $3::date
       ORDER BY s.created_at DESC, s.id DESC`,
      [ownerUserId, periodStart, periodEnd]
    );
    return NextResponse.json({
      ok: true, periodStart, periodEnd,
      summary: {
        retainedCount: retainedFarmers.length,
        retainedAmount: retainedFarmers.reduce((sum, farmer) => sum + Number(farmer.netAmount || 0), 0),
        approvedCount: records.filter((record) => record.status === 'APPROVED').length,
      },
      retained: retainedFarmers.map((farmer) => ({ ...farmer, retainedAmount: Number(farmer.netAmount || 0) })),
      records,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error.message || 'Unable to load settlements.' }, { status: statusFor(error) });
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, message: 'A JSON object is required.' }, { status: 400 });
    const action = String(body.action || '').toLowerCase();

    if (action === 'confirm') {
      requireCollector(user);
      const settlementId = parsePositiveId(body.settlementId, 'settlementId');
      const farmerId = parsePositiveId(body.farmerId, 'farmerId');
      const { periodStart, periodEnd } = parsePeriod(body.periodStart, body.periodEnd);
      const { rows } = await query(
        `SELECT s.owner_user_id AS "ownerUserId", f.id AS "farmerId", ca.collector_user_id AS "assignedCollectorUserId"
         FROM farmer_settlement_records s JOIN farmers f ON f.id = s.farmer_id AND f.owner_user_id = s.owner_user_id
         JOIN collector_assignments ca ON ca.dairy_user_id = s.owner_user_id
           AND ca.collector_user_id = $1 AND ca.revoked_at IS NULL
         WHERE f.collector_user_id = $1 AND s.id = $2 AND s.farmer_id = $3 AND s.period_start = $4::date AND s.period_end = $5::date
           AND s.status = 'APPROVED' LIMIT 1`,
        [user.id, settlementId, farmerId, periodStart, periodEnd]
      );
      if (!rows[0]) return NextResponse.json({ ok: false, message: 'Settlement not found for your assignment and period.' }, { status: 404 });
      assertAssignedCollector(user, rows[0].assignedCollectorUserId);
      const record = await confirmSettlement({
        repo: settlementRepository, settlementId, collectorUserId: Number(user.id), farmerId,
        ownerUserId: Number(rows[0].ownerUserId), periodStart, periodEnd,
      });
      return NextResponse.json({ ok: true, record });
    }

    requireOwnerAction(user, action);
    const ownerUserId = Number(user.id);
    if (action === 'cash') {
      const farmerId = parsePositiveId(body.farmerId, 'farmerId');
      const amount = parsePositiveAmount(body.amount);
      const { periodStart, periodEnd } = parsePeriod(body.periodStart, body.periodEnd);
      const idempotencyKey = String(body.requestKey || '').trim();
      if (!idempotencyKey || idempotencyKey.length > 120) throw Object.assign(new Error('A requestKey of 1 to 120 characters is required.'), { statusCode: 400 });
      const { rows } = await query(
        `SELECT f.account_number AS "accountNumber" FROM farmers f
         WHERE f.id = $1 AND f.owner_user_id = $2 LIMIT 1`, [farmerId, ownerUserId]
      );
      if (!rows[0]) return NextResponse.json({ ok: false, message: 'Farmer not found for this owner.' }, { status: 404 });
      if (hasValidSaccoAccount(rows[0])) return NextResponse.json({ ok: false, message: 'Cash approval is only available for retained farmers without a valid SACCO account.' }, { status: 409 });
      const payableRows = await getFarmerTotals({ ownerUserId, farmerId, rangeStart: periodStart, rangeEnd: periodEnd });
      const payable = Number(payableRows[0]?.netAmount);
      if (!Number.isFinite(payable) || payable <= 0 || amount > payable) throw Object.assign(new Error('Cash amount exceeds the farmer’s verified payable balance.'), { statusCode: 400 });
      const record = await createSettlementRecord({
        repo: settlementRepository, farmerId, ownerUserId, amount, paymentMethod: 'CASH', paymentType: 'CASH',
        periodStart, periodEnd, reason: 'NO_SACCO_ACCOUNT', notes: body.notes || null,
        approvedBy: Number(user.id), paymentReference: `cash-${ownerUserId}-${idempotencyKey}`,
      });
      return NextResponse.json({ ok: true, record });
    }

    if (action === 'debt') {
      const farmerId = parsePositiveId(body.farmerId, 'farmerId');
      const openingBalance = parsePositiveAmount(body.openingBalance, 'openingBalance');
      const { periodStart, periodEnd } = parsePeriod(body.periodStart, body.periodEnd);
      const requestKey = String(body.requestKey || '').trim();
      if (!requestKey || requestKey.length > 120) throw Object.assign(new Error('A requestKey of 1 to 120 characters is required.'), { statusCode: 400 });
      const ledger = await settlementRepository.createDebtLedgerEntry({
        farmerId, ownerUserId, openingBalance, remainingBalance: openingBalance, periodStart, periodEnd,
        reason: body.reason || 'DEBT', notes: body.notes || null, createdBy: Number(user.id), requestKey,
      });
      return NextResponse.json({ ok: true, ledger });
    }

    if (action === 'debt-repayment') {
      const debtId = parsePositiveId(body.debtId, 'debtId');
      const amount = parsePositiveAmount(body.amount);
      const requestKey = String(body.requestKey || '').trim();
      if (!requestKey || requestKey.length > 120) throw Object.assign(new Error('A requestKey of 1 to 120 characters is required.'), { statusCode: 400 });
      const result = await settlementRepository.repayDebt({
        debtId, ownerUserId, amount, actorId: Number(user.id), requestKey,
        reason: body.reason || 'PARTIAL_RECOVERY',
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, message: 'Unsupported settlement action.' }, { status: 400 });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : statusFor(error);
    return NextResponse.json({ ok: false, message: error.message || 'Unable to process settlement action.' }, { status });
  }
}
