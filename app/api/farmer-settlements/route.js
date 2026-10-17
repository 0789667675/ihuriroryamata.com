import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { query } = require('@/lib/postgres.js');
const { getFarmerTotals } = require('@/lib/repositories/reportRepository.js');
const settlementRepository = require('@/lib/repositories/farmerSettlementRepository.js');
const { createSettlementRecord, confirmSettlement, hasValidSaccoAccount } = require('@/lib/services/farmer-settlement-service.js');
const { requireCollector, assertAssignedCollector, parsePositiveId, parsePositiveAmount, parsePeriod } = require('@/lib/services/farmer-settlement-access.js');
const { getCurrentAccountingPeriod } = require('@/lib/utils/accounting-period.js');

export const runtime = 'nodejs';

const statusFor = (error) => error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500);
const settlementErrorResponse = (error) => {
  if (error.code === '42P01' || error.code === '42703') {
    return NextResponse.json({ ok: false, code: 'SETTLEMENT_SCHEMA_UNAVAILABLE', message: 'Settlement information is temporarily unavailable.' }, { status: 503 });
  }
  const status = statusFor(error);
  if (status >= 500) {
    return NextResponse.json({ ok: false, code: 'SETTLEMENTS_UNAVAILABLE', message: 'Settlement information is temporarily unavailable.' }, { status });
  }
  return NextResponse.json({ ok: false, message: error.message || 'Unable to process the settlement request.' }, { status });
};

const getAssignedFarmer = async (collectorUserId, farmerId) => {
  const { rows } = await query(
    `SELECT f.id AS "farmerId", f.owner_user_id AS "ownerUserId", f.account_number AS "accountNumber"
     FROM farmers f
     JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
       AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
     WHERE f.id = $1 AND f.collector_user_id = $2 LIMIT 1`,
    [farmerId, collectorUserId]
  );
  return rows[0] || null;
};

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    requireCollector(user);
    const { searchParams } = new URL(request.url);
    const action = String(searchParams.get('action') || 'summary').toLowerCase();

    if (action === 'confirmations') {
      const currentPeriod = getCurrentAccountingPeriod();
      const { periodStart, periodEnd } = parsePeriod(searchParams.get('periodStart') || currentPeriod.startDate, searchParams.get('periodEnd') || currentPeriod.endDate);
      const { rows } = await query(
        `SELECT s.id AS "settlementId", s.farmer_id AS "farmerId", f.name AS "farmerName",
           s.owner_user_id AS "ownerUserId", s.amount, s.payment_method AS "paymentMethod",
           s.payment_reference AS "paymentReference", s.period_start AS "periodStart", s.period_end AS "periodEnd",
           s.status, s.approved_at AS "approvedAt", s.reason
         FROM farmer_settlement_records s
         JOIN farmers f ON f.id = s.farmer_id AND f.owner_user_id = s.owner_user_id
         JOIN collector_assignments ca ON ca.dairy_user_id = s.owner_user_id
           AND ca.collector_user_id = $1 AND ca.revoked_at IS NULL
         WHERE f.collector_user_id = $1 AND s.period_start = $2::date AND s.period_end = $3::date
         ORDER BY s.created_at DESC, s.id DESC`,
        [user.id, periodStart, periodEnd]
      );
      return NextResponse.json({ ok: true, periodStart, periodEnd, data: rows });
    }

    if (action === 'debts') {
      const { rows } = await query(
        `SELECT d.*, f.name AS farmer_name FROM farmer_debt_ledgers d
         JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
         JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
           AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
         WHERE f.collector_user_id = $1 AND d.status IN ('OPEN', 'PARTIALLY_SETTLED')
         ORDER BY d.period_end DESC, d.id DESC`,
        [user.id]
      );
      return NextResponse.json({ ok: true, data: rows });
    }
    return NextResponse.json({ ok: false, message: 'Unsupported settlement query.' }, { status: 400 });
  } catch (error) {
    return settlementErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    requireCollector(user);
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, message: 'A JSON object is required.' }, { status: 400 });
    const action = String(body.action || '').toLowerCase();

    if (action === 'confirm') {
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

    if (action === 'cash') {
      const farmerId = parsePositiveId(body.farmerId, 'farmerId');
      const amount = parsePositiveAmount(body.amount);
      const { periodStart, periodEnd } = parsePeriod(body.periodStart, body.periodEnd);
      const idempotencyKey = String(body.requestKey || '').trim();
      if (!idempotencyKey || idempotencyKey.length > 120) throw Object.assign(new Error('A requestKey of 1 to 120 characters is required.'), { statusCode: 400 });
      const farmer = await getAssignedFarmer(Number(user.id), farmerId);
      if (!farmer) return NextResponse.json({ ok: false, message: 'Farmer not found for your active assignment.' }, { status: 404 });
      if (hasValidSaccoAccount(farmer)) return NextResponse.json({ ok: false, message: 'Cash approval is only available for retained farmers without a valid SACCO account.' }, { status: 409 });
      const ownerUserId = Number(farmer.ownerUserId);
      const payableRows = await getFarmerTotals({ ownerUserId, farmerId, collectorUserId: user.id, assignedCollectorOnly: true, rangeStart: periodStart, rangeEnd: periodEnd });
      const payable = Number(payableRows[0]?.netAmount);
      if (!Number.isFinite(payable) || payable <= 0 || amount > payable) throw Object.assign(new Error('Cash amount exceeds the farmer’s verified payable balance.'), { statusCode: 400 });
      const { rows: existingPayments } = await query(
        `SELECT COALESCE(SUM(amount), 0) AS amount FROM farmer_settlement_records
         WHERE owner_user_id = $1 AND farmer_id = $2 AND payment_type = 'CASH'
           AND period_start = $3::date AND period_end = $4::date
           AND status IN ('APPROVED', 'CONFIRMED')`,
        [ownerUserId, farmerId, periodStart, periodEnd]
      );
      if (amount + Number(existingPayments[0]?.amount || 0) > payable) {
        throw Object.assign(new Error('Cash amount exceeds the farmer’s remaining payable balance.'), { statusCode: 400 });
      }
      const record = await createSettlementRecord({
        repo: settlementRepository, farmerId, ownerUserId, collectorUserId: Number(user.id), amount, paymentMethod: 'CASH', paymentType: 'CASH',
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
      const farmer = await getAssignedFarmer(Number(user.id), farmerId);
      if (!farmer) return NextResponse.json({ ok: false, message: 'Farmer not found for your active assignment.' }, { status: 404 });
      const ownerUserId = Number(farmer.ownerUserId);
      const ledger = await settlementRepository.createDebtLedgerEntry({
        farmerId, ownerUserId, collectorUserId: Number(user.id), openingBalance, remainingBalance: openingBalance, periodStart, periodEnd,
        reason: body.reason || 'DEBT', notes: body.notes || null, createdBy: Number(user.id), requestKey,
      });
      return NextResponse.json({ ok: true, ledger });
    }

    if (action === 'debt-repayment') {
      const debtId = parsePositiveId(body.debtId, 'debtId');
      const amount = parsePositiveAmount(body.amount);
      const requestKey = String(body.requestKey || '').trim();
      if (!requestKey || requestKey.length > 120) throw Object.assign(new Error('A requestKey of 1 to 120 characters is required.'), { statusCode: 400 });
      const { rows: debts } = await query(
        `SELECT d.owner_user_id AS "ownerUserId" FROM farmer_debt_ledgers d
         JOIN farmers f ON f.id = d.farmer_id AND f.owner_user_id = d.owner_user_id
         JOIN collector_assignments ca ON ca.dairy_user_id = f.owner_user_id
           AND ca.collector_user_id = f.collector_user_id AND ca.revoked_at IS NULL
         WHERE d.id = $1 AND f.collector_user_id = $2 LIMIT 1`,
        [debtId, user.id]
      );
      if (!debts[0]) return NextResponse.json({ ok: false, message: 'Debt not found for your active assignment.' }, { status: 404 });
      const result = await settlementRepository.repayDebt({
        debtId, ownerUserId: Number(debts[0].ownerUserId), collectorUserId: Number(user.id), amount, actorId: Number(user.id), requestKey,
        reason: body.reason || 'PARTIAL_RECOVERY',
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, message: 'Unsupported settlement action.' }, { status: 400 });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : statusFor(error);
    return status >= 500 ? settlementErrorResponse(error) : NextResponse.json({ ok: false, message: error.message || 'Unable to process settlement action.' }, { status });
  }
}
