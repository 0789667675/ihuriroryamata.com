const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const isolatedUrl = process.env.MILK_SYSTEM_TEST_DATABASE_URL || '';
const safeUrl = (() => {
  if (!isolatedUrl) return false;
  try {
    const url = new URL(isolatedUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && decodeURIComponent(url.pathname.slice(1)) === 'milk_system_deduction_control_test_20261104';
  } catch {
    return false;
  }
})();

if (isolatedUrl && !safeUrl) {
  throw new Error('Refusing deduction integration tests unless MILK_SYSTEM_TEST_DATABASE_URL targets the isolated loopback deduction test database.');
}

test('configured deduction batches cap earnings, create debt, deduplicate retries, and keep periods independent', {
  skip: !safeUrl && 'Set MILK_SYSTEM_TEST_DATABASE_URL to the isolated local deduction test database.',
}, async () => {
  const pool = new Pool({ connectionString: isolatedUrl, ssl: false, max: 2 });
  const DeductionRepository = require('../lib/repositories/deductionRepository.js');
  const suffix = crypto.randomUUID();
  let ownerUserId;
  try {
    const identity = await pool.query('SELECT current_database() AS database, inet_server_addr()::text AS address');
    assert.equal(identity.rows[0].database, 'milk_system_deduction_control_test_20261104');
    assert.match(identity.rows[0].address, /^127\.0\.0\.1\//);

    const owner = await pool.query(
      `INSERT INTO users (name, email, password_hash, account_type)
       VALUES ($1, $2, $3, 'COLLECTOR') RETURNING id`,
      ['Synthetic deduction owner', `deduction-${suffix}@example.test`, 'not-a-real-login-hash']
    );
    ownerUserId = Number(owner.rows[0].id);
    const farmerResult = await pool.query(
      `INSERT INTO farmers (name, owner_user_id) VALUES
        ($1, $5), ($2, $5), ($3, $5), ($4, $5) RETURNING id, name`,
      [`Earner ${suffix}`, `No earnings ${suffix}`, `High earnings ${suffix}`, `No deductions ${suffix}`, ownerUserId]
    );
    const farmerIds = Object.fromEntries(farmerResult.rows.map((row) => [row.name.replace(` ${suffix}`, ''), Number(row.id)]));
    farmerIds.High = farmerIds['High earnings'];
    const earningFarmers = [
      { farmerId: farmerIds.Earner, volume: 1, amount: 100 },
      { farmerId: farmerIds['High'], volume: 5, amount: 500 },
    ];
    for (const farmer of earningFarmers) {
      await pool.query(
        `INSERT INTO milk_records (
          farmer_id, owner_user_id, date, month, year, day, volume_liters, price_per_liter, amount,
          status, original_volume_liters, valid_volume_liters, valid_amount, transport_rate_per_liter
        ) VALUES ($1, $2, '2026-11-16', 11, 2026, 16, $3, 100, $4, 'valid', $3, $3, $4, 0)`,
        [farmer.farmerId, ownerUserId, farmer.volume, farmer.amount]
      );
    }

    const poolProvider = () => pool;
    const configuration = await DeductionRepository.createDeductionConfiguration({
      ownerUserId,
      actorId: ownerUserId,
      poolProvider,
      input: {
        name: `Manual period charge ${suffix}`,
        description: 'Synthetic integration fixture',
        amountPerFarmer: 150,
        type: 'Other',
        eligibilityMode: 'ALL',
        eligibleFarmerIds: [],
        frequency: 'PERIOD',
        effectiveStartDate: '2026-11-16',
        executionMode: 'MANUAL',
        isActive: true,
      },
    });
    await pool.query(
      `INSERT INTO deductions (farmer_id, owner_user_id, amount, type, status, reason, date)
       VALUES ($1, $2, 25, 'Other', 'Active', 'Unrelated manual deduction', '2026-11-16')`,
      [farmerIds['No deductions'], ownerUserId]
    );

    const firstBatchInput = {
      ownerUserId,
      actorId: ownerUserId,
      configurationId: configuration.id,
      farmerIds: [farmerIds.Earner, farmerIds['No earnings'], farmerIds.High],
      periodStart: '2026-11-16',
      periodEnd: '2026-11-30',
      requestKey: `integration-${suffix}-first`,
      poolProvider,
    };
    const firstBatch = await DeductionRepository.applyDeductionBatch(firstBatchInput);
    assert.equal(firstBatch.succeeded.length, 3);
    assert.equal(firstBatch.failed.length, 0);
    const byFarmer = new Map(firstBatch.succeeded.map((row) => [row.farmerId, row]));
    assert.deepEqual(
      [byFarmer.get(farmerIds.Earner).chargeAmount, byFarmer.get(farmerIds.Earner).recoveredAmount, byFarmer.get(farmerIds.Earner).outstandingAmount],
      [150, 100, 50]
    );
    assert.deepEqual(
      [byFarmer.get(farmerIds.High).chargeAmount, byFarmer.get(farmerIds.High).recoveredAmount, byFarmer.get(farmerIds.High).outstandingAmount],
      [150, 150, 0]
    );
    assert.deepEqual(
      [byFarmer.get(farmerIds['No earnings']).chargeAmount, byFarmer.get(farmerIds['No earnings']).recoveredAmount, byFarmer.get(farmerIds['No earnings']).outstandingAmount],
      [150, 0, 150]
    );

    const ledger = await DeductionRepository.listFarmerPeriodLedger({
      ownerUserId,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-30',
      limit: 20,
    }, pool.query.bind(pool));
    assert.equal(ledger.data.length, 4);
    assert.equal(ledger.data.find((row) => row.farmerId === farmerIds['No deductions']).status, 'DEDUCTED');
    assert.equal(ledger.data.find((row) => row.farmerId === farmerIds.Earner).status, 'PARTIALLY_DEDUCTED');
    assert.equal(ledger.data.find((row) => row.farmerId === farmerIds['No earnings']).status, 'OUTSTANDING_DEBT');
    assert.equal(ledger.data.find((row) => row.farmerId === farmerIds.Earner).outstandingDebt, 50);
    assert.equal(ledger.summary.farmersListed, 4);
    assert.equal(ledger.summary.farmersWithDeductions, 3);
    assert.equal(ledger.summary.farmersWithoutDeductions, 1);
    assert.equal(ledger.summary.totalNewDeductions, 275);
    assert.equal(ledger.summary.previousOutstandingDebt, 0);
    assert.equal(ledger.summary.debtRecovered, 0);
    assert.equal(ledger.summary.remainingDebt, 200);

    await pool.query(
      `UPDATE farmer_debt_ledgers SET remaining_balance = 30, total_repaid = 20 WHERE id = $1 AND owner_user_id = $2`,
      [byFarmer.get(farmerIds.Earner).debtLedgerId, ownerUserId]
    );
    await pool.query(
      `INSERT INTO farmer_debt_repayments (
         debt_ledger_id, owner_user_id, actor_id, request_key, amount, balance_after, reason, created_at
       ) VALUES ($1, $2, $2, $3, 20, 30, 'Synthetic period repayment', '2026-11-20T12:00:00Z')`,
      [byFarmer.get(farmerIds.Earner).debtLedgerId, ownerUserId, `repayment-${suffix}`]
    );
    const recoveredLedger = await DeductionRepository.listFarmerPeriodLedger({
      ownerUserId,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-30',
      limit: 20,
    }, pool.query.bind(pool));
    assert.equal(recoveredLedger.data.find((row) => row.farmerId === farmerIds.Earner).previousDebt, 0);
    assert.equal(recoveredLedger.data.find((row) => row.farmerId === farmerIds.Earner).debtRepaidInPeriod, 20);
    assert.equal(recoveredLedger.data.find((row) => row.farmerId === farmerIds.Earner).remainingBalance, 30);
    assert.equal(recoveredLedger.summary.previousOutstandingDebt, 0);
    assert.equal(recoveredLedger.summary.debtRecovered, 20);
    assert.equal(recoveredLedger.summary.remainingDebt, 180);

    const configNotDeducted = await DeductionRepository.listFarmerPeriodLedger({
      ownerUserId,
      configurationId: configuration.id,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-30',
      farmerStatus: 'NOT_DEDUCTED',
      limit: 20,
    }, pool.query.bind(pool));
    assert.deepEqual(configNotDeducted.data.map((row) => row.farmerId), [farmerIds['No deductions']]);

    const retry = await DeductionRepository.applyDeductionBatch({ ...firstBatchInput, requestKey: `integration-${suffix}-retry` });
    assert.equal(retry.duplicates.length, 3);
    assert.equal(retry.succeeded.length, 0);

    const invalidFarmerBatch = await DeductionRepository.applyDeductionBatch({
      ...firstBatchInput,
      farmerIds: [farmerIds['No deductions'], farmerIds.Earner, Number.MAX_SAFE_INTEGER],
      requestKey: `integration-${suffix}-atomic`,
    });
    assert.equal(invalidFarmerBatch.succeeded.length, 0);
    assert.equal(invalidFarmerBatch.duplicates.length, 1);
    assert.equal(invalidFarmerBatch.failed.length, 2);
    const rolledBackRows = await pool.query(
      `SELECT COUNT(*)::int AS count FROM deduction_batch_items
       WHERE owner_user_id = $1 AND farmer_id = $2 AND configuration_id = $3 AND period_start = $4::date`,
      [ownerUserId, farmerIds['No deductions'], configuration.id, '2026-11-16']
    );
    assert.equal(rolledBackRows.rows[0].count, 0);

    await DeductionRepository.updateDeductionConfiguration({
      id: configuration.id,
      ownerUserId,
      actorId: ownerUserId,
      poolProvider,
      input: { ...configuration, amountPerFarmer: 200 },
    });
    const historicalAmount = await pool.query(
      'SELECT charge_amount FROM deduction_batch_items WHERE owner_user_id = $1 AND farmer_id = $2 AND configuration_id = $3 AND period_start = $4::date',
      [ownerUserId, farmerIds.Earner, configuration.id, '2026-11-16']
    );
    assert.equal(Number(historicalAmount.rows[0].charge_amount), 150);

    const nextPeriod = await DeductionRepository.applyDeductionBatch({
      ...firstBatchInput,
      farmerIds: [farmerIds.Earner],
      periodStart: '2026-12-01',
      periodEnd: '2026-12-15',
      requestKey: `integration-${suffix}-next-period`,
    });
    assert.equal(nextPeriod.succeeded.length, 1);
    assert.equal(nextPeriod.succeeded[0].chargeAmount, 200);
    const nextPeriodLedger = await DeductionRepository.listFarmerPeriodLedger({
      ownerUserId,
      periodStart: '2026-12-01',
      periodEnd: '2026-12-15',
      limit: 20,
    }, pool.query.bind(pool));
    assert.equal(nextPeriodLedger.data.find((row) => row.farmerId === farmerIds.Earner).previousDebt, 30);
    assert.equal(nextPeriodLedger.data.find((row) => row.farmerId === farmerIds.Earner).remainingBalance, 230);
    assert.equal(nextPeriodLedger.summary.previousOutstandingDebt, 180);
    assert.equal(nextPeriodLedger.summary.remainingDebt, 380);
    const periods = await pool.query(
      `SELECT COUNT(DISTINCT period_start)::int AS count FROM deduction_batch_items
       WHERE owner_user_id = $1 AND farmer_id = $2 AND configuration_id = $3`,
      [ownerUserId, farmerIds.Earner, configuration.id]
    );
    assert.equal(periods.rows[0].count, 2);

    const retiredContributions = await pool.query('SELECT COUNT(*)::int AS count FROM farmer_igipande_contributions');
    assert.equal(retiredContributions.rows[0].count, 0);
  } finally {
    await pool.end();
  }
});