const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  IGIPANDE_CHARGE_AMOUNT,
  buildIgipandeReference,
  getAdditionalIgipandeEarnings,
  isIgipandePeriod,
  allocateIgipandeRecovery,
} = require('../lib/utils/igipande-contribution.js');

test('Igipande contribution applies only to valid Ukwezi periods from 16 November 2026', () => {
  assert.equal(IGIPANDE_CHARGE_AMOUNT, 100);
  assert.equal(isIgipandePeriod('2026-11-01', '2026-11-15'), false);
  assert.equal(isIgipandePeriod('2026-11-16', '2026-11-30'), true);
  assert.equal(isIgipandePeriod('2026-12-01', '2026-12-15'), true);
  assert.equal(isIgipandePeriod('2026-12-16', '2026-12-31'), true);
  assert.equal(isIgipandePeriod('2026-11-17', '2026-11-30'), false);
  assert.equal(2 * IGIPANDE_CHARGE_AMOUNT, 200);
});

test('Igipande reference is farmer and accounting-period specific', () => {
  assert.equal(buildIgipandeReference(41, '2026-11-16', '2026-11-30'), 'igipande-41-2026-11-16-2026-11-30');
  assert.notEqual(
    buildIgipandeReference(41, '2026-11-01', '2026-11-15'),
    buildIgipandeReference(41, '2026-11-16', '2026-11-30')
  );
});

test('Igipande earnings recover oldest contribution balances first, up to available earnings', () => {
  const allocation = allocateIgipandeRecovery({
    availableEarnings: 150,
    contributions: [
      { id: 2, periodStart: '2026-12-01', outstandingBalance: 100 },
      { id: 1, periodStart: '2026-11-16', outstandingBalance: 100 },
    ],
  });
  assert.deepEqual(allocation, {
    recoveries: [{ contributionId: 1, amount: 100 }, { contributionId: 2, amount: 50 }],
    recoveredAmount: 150,
  });
  assert.equal(allocateIgipandeRecovery({ availableEarnings: 0, contributions: [{ id: 1, outstandingBalance: 100 }] }).recoveredAmount, 0);
});

test('Igipande recovery retries ignore processed earnings and apply only later increases', () => {
  assert.equal(getAdditionalIgipandeEarnings({ availableEarnings: 75 }), 75);
  assert.equal(getAdditionalIgipandeEarnings({ availableEarnings: 75, previouslyAvailableEarnings: 75 }), 0);
  assert.equal(getAdditionalIgipandeEarnings({ availableEarnings: 110, previouslyAvailableEarnings: 75 }), 35);
  assert.equal(getAdditionalIgipandeEarnings({ availableEarnings: 60, previouslyAvailableEarnings: 75 }), 0);
});

test('Igipande persistence keys contributions and automatic recovery runs by farmer and Ukwezi period', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/030_igipande_half_month_contributions.sql'), 'utf8');
  assert.match(migration, /UNIQUE\s*\(owner_user_id,\s*farmer_id,\s*period_start\)/i);
  assert.match(migration, /UNIQUE\s*\(run_id,\s*contribution_id\)/i);
  assert.match(migration, /charge_amount NUMERIC\(12,2\) NOT NULL DEFAULT 100 CHECK \(charge_amount = 100\)/i);
  assert.match(migration, /EXTRACT\(DAY FROM period_start\) = 16/i);
  assert.doesNotMatch(migration, /UNIQUE\s*\([^)]*\bmonth\b[^)]*\)/i);
});

test('Igipande contribution processing is registered as a protected daily Vercel Cron', () => {
  const route = fs.readFileSync(path.join(__dirname, '../app/api/cron/igipande-contributions/route.js'), 'utf8');
  const deployment = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /jobId: 'igipande_contributions'/);
  assert.match(route, /getCurrentAccountingPeriod/);
  assert.match(deployment, /"path": "\/api\/cron\/igipande-contributions"[\s\S]*?"schedule": "15 0 \* \* \*"/);
});