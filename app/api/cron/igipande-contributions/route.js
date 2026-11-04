import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

const Reports = require('@/lib/services/monthly-report-service.js');
const { query } = require('@/lib/postgres.js');
const { getCurrentAccountingPeriod } = require('@/lib/utils/accounting-period.js');
const settlementRepository = require('@/lib/repositories/farmerSettlementRepository.js');
const { withJobRun } = require('@/lib/repositories/jobRunRepository.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const authorized = (request) => {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  if (!secret || !supplied.startsWith('Bearer ')) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const runIgipandeJob = async () => {
  const now = new Date();
  const period = getCurrentAccountingPeriod(now);
  if (period.startDate < '2026-11-16') return { accountsProcessed: 0, contributionsEnabled: false };

  const { rows: accounts } = await query(
    `SELECT id FROM users
     WHERE account_type IN ('COLLECTOR', 'COLLECTION_CENTER')
     ORDER BY id ASC`
  );
  let accountsProcessed = 0;
  const processedContributions = new Map();
  let failedAccounts = 0;

  for (const account of accounts) {
    try {
      const report = await Reports.getSummary({
        ownerUserId: Number(account.id),
        actorId: Number(account.id),
        query: { year: period.year, month: period.month, periodType: period.periodType },
        settlementRepository,
        now,
      });
      accountsProcessed += 1;
      for (const farmer of report.settlementAccounting?.farmers || []) {
        if (Number(farmer.settlement?.igipandeCharge || 0) <= 0) continue;
        const farmerId = Number(farmer.farmerId);
        const recoveredAmount = Number(farmer.settlement.igipandeRecoveryAmount || 0);
        processedContributions.set(farmerId, Math.max(recoveredAmount, processedContributions.get(farmerId) || 0));
      }
    } catch {
      failedAccounts += 1;
    }
  }

  if (failedAccounts) {
    throw Object.assign(new Error('Igipande contribution processing failed for one or more accounts.'), {
      code: 'IGIPANDE_JOB_PARTIAL_FAILURE',
    });
  }

  return {
    accountsProcessed,
    contributionRows: processedContributions.size,
    recoveredAmount: [...processedContributions.values()].reduce((total, amount) => total + amount, 0),
    periodStart: period.startDate,
    periodEnd: period.endDate,
  };
};

export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ message: 'Not authorized.' }, { status: 401 });
  try {
    const vercelCron = Boolean(request.headers.get('x-vercel-cron'))
      || /vercel-cron/i.test(request.headers.get('user-agent') || '');
    const result = await withJobRun({
      jobId: 'igipande_contributions',
      trigger: vercelCron ? 'vercel_cron' : 'external',
      run: runIgipandeJob,
    });
    if (result.skipped) return NextResponse.json({ success: false, skipped: true, reason: result.reason });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ message: 'Igipande contribution job failed.' }, {
      status: error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500,
    });
  }
}

export async function GET(request) {
  return POST(request);
}