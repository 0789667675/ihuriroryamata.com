const test = require('node:test');
const assert = require('node:assert/strict');
const MilkLoss = require('../lib/services/milk-loss-service.js');
const MilkAdjustmentRepository = require('../lib/repositories/milkAdjustmentRepository.js');
const { calculateLossAmounts, calculateSessionLosses } = MilkAdjustmentRepository;
const ReportRepository = require('../lib/repositories/reportRepository.js');
const Reports = require('../lib/services/monthly-report-service.js');

const farmerMilkRecord = ({ id, farmerId = id, morning = 0, evening = 0, amount = (morning + evening) * 400, ...extra }) => ({
  id,
  owner_user_id: 42,
  farmer_id: farmerId,
  is_owner_milk: false,
  volume_morning: morning,
  volume_evening: evening,
  volume_liters: morning + evening,
  original_volume_morning: morning,
  original_volume_evening: evening,
  original_volume_liters: morning + evening,
  valid_volume_morning: morning,
  valid_volume_evening: evening,
  valid_volume_liters: morning + evening,
  amount,
  original_amount: amount,
  valid_amount: amount,
  status: 'valid',
  ...extra,
});

const makeAdjustmentPool = ({ records, adjustments = [] }) => {
  const state = { records, adjustments, queries: [], updates: [], audits: [] };
  const query = async (text, values = []) => {
    state.queries.push({ text, values });
    if (text.includes('SELECT * FROM milk_collection_adjustments')) {
      return { rows: state.adjustments.map((adjustment) => ({ ...adjustment })) };
    }
    if (text.includes('SELECT mr.*')) {
      const period = values[3];
      return { rows: state.records.filter((row) => {
        if (row.is_owner_milk || row.farmer_id == null) return false;
        const morning = Number(row.original_volume_morning ?? row.volume_morning ?? 0);
        const evening = Number(row.original_volume_evening ?? row.volume_evening ?? 0);
        return period === 'morning' ? morning > 0 : period === 'evening' ? evening > 0 : morning + evening > 0;
      }) };
    }
    if (text.includes('original_volume_liters = COALESCE')) return { rows: [] };
    if (text.includes('valid_volume_morning = $1')) {
      const record = state.records.find((row) => row.id === values[9]);
      Object.assign(record, {
        valid_volume_morning: values[0],
        valid_volume_evening: values[1],
        valid_volume_liters: values[2],
        valid_amount: values[3],
        lost_volume_liters: values[4],
        status: values[5],
        loss_percentage: values[6],
        adjustment_reason: values[7],
        adjusted_by: values[8],
      });
      state.updates.push({ id: record.id, values });
      return { rows: [] };
    }
    if (text.includes('INSERT INTO milk_collection_adjustments')) {
      const adjustment = {
        id: state.adjustments.length + 1,
        adjustment_type: values[4],
        loss_percentage: values[5],
        original_volume_liters: values[6],
        lost_volume_liters: values[7],
        valid_volume_liters: values[8],
        reason: values[9],
        adjusted_by: values[10],
        period: values[3],
      };
      state.adjustments.push(adjustment);
      return { rows: [{ ...adjustment }] };
    }
    if (text.includes('UPDATE milk_collection_adjustments SET')) {
      const adjustment = state.adjustments.find((row) => row.id === values[7]);
      Object.assign(adjustment, {
        adjustment_type: values[0],
        loss_percentage: values[1],
        original_volume_liters: values[2],
        lost_volume_liters: values[3],
        valid_volume_liters: values[4],
        reason: values[5],
        adjusted_by: values[6],
      });
      return { rows: [{ ...adjustment }] };
    }
    if (text.includes("INSERT INTO audit_logs") && text.includes("'milk_collection_adjustment'")) {
      state.audits.push({ action: values[1], details: JSON.parse(values[2]), actorId: values[3] });
    }
    return { rows: [] };
  };
  const client = { query, release: () => {} };
  return { state, poolProvider: () => ({ connect: async () => client, query }) };
};

test('milk loss rounds calculated litres to half-litre increments without exceeding the original', () => {
  assert.deepEqual(calculateLossAmounts(1.5, 50), { calculatedLossLitres: 0.75, appliedLossLitres: 1 });
  assert.deepEqual(calculateLossAmounts(1.5, 25), { calculatedLossLitres: 0.375, appliedLossLitres: 0.5 });
  assert.deepEqual(calculateLossAmounts(1.5, 75), { calculatedLossLitres: 1.125, appliedLossLitres: 1 });
  assert.deepEqual(calculateLossAmounts(2, 50), { calculatedLossLitres: 1, appliedLossLitres: 1 });
  assert.deepEqual(calculateLossAmounts(1.5, 100), { calculatedLossLitres: 1.5, appliedLossLitres: 1.5 });
  assert.deepEqual(calculateLossAmounts(0.25, 100), { calculatedLossLitres: 0.25, appliedLossLitres: 0.25 });
  assert.deepEqual(calculateLossAmounts(0.25, 50), { calculatedLossLitres: 0.125, appliedLossLitres: 0 });
});

test('whole-day loss rounds combined farmer litres once before splitting sessions', () => {
  const result = calculateSessionLosses({
    morningOriginal: 0.25,
    eveningOriginal: 1.25,
    period: 'all',
    lossPercentage: 50,
    currentMorning: 0.25,
    currentEvening: 1.25,
  });
  assert.equal(result.calculatedLossLitres, 0.75);
  assert.equal(result.appliedLossLitres, 1);
  assert.equal(result.validMorning + result.validEvening, 0.5);

  const capped = calculateSessionLosses({
    morningOriginal: 0.4,
    eveningOriginal: 0,
    period: 'all',
    lossPercentage: 90,
    currentMorning: 0.4,
    currentEvening: 0,
  });
  assert.equal(capped.appliedLossLitres, 0.4);
  assert.equal(capped.validMorning + capped.validEvening, 0);
});

test('repository previews and applies losses only to farmers with milk in the selected session', async () => {
  const { state, poolProvider } = makeAdjustmentPool({ records: [
    farmerMilkRecord({ id: 1, morning: 1.5, evening: 1, amount: 1000, farmer_name: 'Aline' }),
    farmerMilkRecord({ id: 2, morning: 2, evening: 0, amount: 800, farmer_name: 'Bella' }),
    farmerMilkRecord({ id: 3, morning: 0, evening: 0, farmer_name: 'No delivery' }),
    farmerMilkRecord({ id: 4, farmerId: null, morning: 20, amount: 8000, is_owner_milk: true, farmer_name: 'Nyirayo' }),
  ] });
  const preview = await MilkAdjustmentRepository.previewCollectionAdjustment({
    ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15', period: 'morning', lossPercentage: 50, poolProvider,
  });
  assert.equal(preview.affectedRecords, 2);
  assert.equal(preview.appliedLossLitres, 2);
  assert.equal(preview.farmers[0].calculatedLossLitres, 0.75);
  assert.equal(preview.farmers[0].appliedLossLitres, 1);
  assert.equal(preview.ownerMilkExcluded, true);

  const result = await MilkAdjustmentRepository.applyCollectionAdjustment({
    ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15', period: 'morning',
    lossPercentage: 50, reason: 'Accident', adjustedBy: 42, poolProvider,
  });
  const eligibleQuery = state.queries.find(({ text }) => text.includes('SELECT mr.*'));
  assert.match(eligibleQuery.text, /mr\.is_owner_milk = FALSE/);
  assert.match(eligibleQuery.text, /JOIN farmers f ON f\.id = mr\.farmer_id/);
  assert.match(eligibleQuery.text, /CASE WHEN \$4 = 'morning'/);
  assert.equal(eligibleQuery.values[3], 'morning');
  assert.equal(result.affectedRecords, 2);
  assert.equal(result.adjustment.original_volume_liters, 3.5);
  assert.equal(result.adjustment.valid_volume_liters, 1.5);
  assert.equal(result.adjustment.lost_volume_liters, 2);
  assert.equal(result.originalAmount, 1800);
  assert.equal(result.validAmount, 1000);
  assert.deepEqual(state.updates.map(({ values }) => values.slice(0, 3)), [[0.5, 1, 1.5], [1, 0, 1]]);
  assert.equal(state.audits[0].details.farmerAdjustments[0].calculatedLossLitres, 0.75);
  assert.equal(state.audits[0].details.farmerAdjustments[0].appliedLossLitres, 1);
  assert.equal(state.audits[0].actorId, 42);
});

test('repository applies morning, evening, and whole-day losses from original session litres', async () => {
  for (const { period, expectedMorning, expectedEvening } of [
    { period: 'morning', expectedMorning: 0.5, expectedEvening: 1.5 },
    { period: 'evening', expectedMorning: 1.5, expectedEvening: 0.5 },
    { period: 'all', expectedMorning: 0.5, expectedEvening: 1 },
  ]) {
    const { state, poolProvider } = makeAdjustmentPool({ records: [farmerMilkRecord({ id: 1, morning: 1.5, evening: 1.5 })] });
    await MilkAdjustmentRepository.applyCollectionAdjustment({
      ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15', period,
      lossPercentage: 50, reason: 'Antibiotics', adjustedBy: 42, poolProvider,
    });
    assert.equal(state.records[0].valid_volume_morning, expectedMorning);
    assert.equal(state.records[0].valid_volume_evening, expectedEvening);
  }
});

test('corrections and reversals recalculate from original milk and preserve other-session milk', async () => {
  const { state, poolProvider } = makeAdjustmentPool({ records: [farmerMilkRecord({ id: 1, morning: 1.5, evening: 2 })] });
  const apply = (lossPercentage) => MilkAdjustmentRepository.applyCollectionAdjustment({
    ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15', period: 'morning',
    lossPercentage, reason: 'Correction', adjustedBy: 42, poolProvider,
  });
  const first = await apply(50);
  const corrected = await apply(25);
  const correctedMorning = state.records[0].valid_volume_morning;
  const correctedEvening = state.records[0].valid_volume_evening;
  const reversed = await apply(0);
  assert.equal(first.corrected, false);
  assert.equal(corrected.corrected, true);
  assert.equal(correctedMorning, 1);
  assert.equal(correctedEvening, 2);
  assert.equal(reversed.corrected, true);
  assert.equal(state.records[0].valid_volume_morning, 1.5);
  assert.equal(state.records[0].valid_volume_evening, 2);
  assert.equal(state.records[0].valid_amount, 1400);
  assert.equal(state.adjustments.length, 1);
  assert.equal(state.audits.length, 3);
  assert.equal(state.audits[2].details.farmerAdjustments[0].remainingValidLitres, 1.5);
});

test('repository prevents overlapping whole-day and session losses', async () => {
  const { poolProvider } = makeAdjustmentPool({
    records: [farmerMilkRecord({ id: 1, morning: 1.5, evening: 1.5 })],
    adjustments: [{ id: 1, period: 'all', loss_percentage: 50 }],
  });
  await assert.rejects(() => MilkAdjustmentRepository.applyCollectionAdjustment({
    ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15', period: 'morning',
    lossPercentage: 50, reason: 'Overlap', adjustedBy: 42, poolProvider,
  }), (error) => error.code === 'MILK_LOSS_SCOPE_OVERLAP');
});

test('farmer loss recalculates owner accounting without changing owner milk value', async () => {
  const accounting = async (farmerVolume, farmerGross) => Reports.calculateCollectorBalanceSheet({
    collectorUserId: 42,
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    farmerTotals: [{
      farmerId: 7,
      accountNumber: '12345678',
      totalVolume: farmerVolume,
      grossAmount: farmerGross,
      totalTransport: 0,
      totalDeductions: 0,
      netAmount: farmerGross,
      milkValueComplete: true,
      transportIsComplete: true,
    }],
    repository: {
      getCollectorEntries: async () => [{
        date: '2026-10-02', volumeLiters: 1.5, effectiveVolumeLiters: 1.5,
        validVolumeLiters: 1.5, originalVolumeLiters: 1.5, pricePerLiter: 400, status: 'valid',
      }],
      getFarmerValidLitersByDate: async () => new Map([['2026-10-02', farmerVolume]]),
      getFarmerValidTotalsByDate: async () => new Map([['2026-10-02', {
        validLiters: farmerVolume, originalLiters: 1.5, lostLiters: 1.5 - farmerVolume, grossAmount: farmerGross,
      }]]),
    },
  });
  const before = await accounting(1.5, 600);
  const after = await accounting(0.5, 200);
  assert.equal(before.nyirayoMilkValue, 600);
  assert.equal(after.nyirayoMilkValue, 600);
  assert.equal(after.farmersMilkValue, 200);
  assert.equal(after.nyirayoMilkDifference, 400);
  assert.equal(after.nyirayoOwnAccountingBalance, 400);
  assert.equal(after.accountRoutedPayable, 0);
  assert.equal(after.ownerListRoutedPayable, 200);
  assert.equal(after.nyirayoTotalWithOwnerList, 600);
});

test('loss-adjusted milk value flows into farmer net pay with existing transport and Umwenda deductions', () => {
  const query = ReportRepository.buildFarmerTotalsQuery({
    ownerUserId: 42,
    rangeStart: '2026-10-01',
    rangeEnd: '2026-10-15',
    farmerId: 7,
  });
  assert.match(query.text, /SUM\(COALESCE\(NULLIF\(mr\.valid_amount, 0\)/);
  assert.match(query.text, /COALESCE\(mr\.valid_volume_liters, mr\.volume_liters, 0\)/);
  assert.match(query.text, /LOWER\(BTRIM\(d\.type\)\) = 'umwenda'/);
  const farmer = ReportRepository.mapFarmerRow({
    farmerId: 7,
    farmerName: 'Aline',
    totalVolume: 0.5,
    originalVolume: 1.5,
    lostVolume: 1,
    grossAmount: 200,
    pricedVolumeAmount: 200,
    unpricedValidCount: 0,
    totalTransport: 50,
    transportIncompleteCount: 0,
    totalDeductions: 25,
    totalOther: 0,
    totalAdvance: 0,
    totalUmwenda: 25,
  });
  assert.equal(farmer.grossAmount, 200);
  assert.equal(farmer.umwendaDeductions, 25);
  assert.equal(farmer.netAmount, 125);
});

function makeRepository(overrides = {}) {
  return {
    applyCollectionAdjustment: async (input) => {
      if (overrides.applyCollectionAdjustment) {
        return overrides.applyCollectionAdjustment(input);
      }
      const pct = Number(input.lossPercentage || 0);
      return {
        adjustment: {
          id: 1,
          loss_percentage: pct,
          original_volume_liters: 100,
          lost_volume_liters: pct === 0 ? 0 : pct === 100 ? 100 : 50,
          valid_volume_liters: pct === 0 ? 100 : pct === 100 ? 0 : 50,
          period: input.period,
          adjustment_type: pct === 100 && input.period === 'all' ? 'cancelled' : 'partial_loss',
        },
        corrected: false,
        previousAdjustment: null,
        originalAmount: 40000,
        validAmount: pct === 0 ? 40000 : pct === 100 ? 0 : 20000,
        affectedRecords: 2,
      };
    },
    getCollectionAdjustment: async () => null,
    ...overrides,
  };
}

test('0% loss event changes no farmer litres', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => ({
      adjustment: {
        id: 1,
        loss_percentage: 0,
        original_volume_liters: 100,
        lost_volume_liters: 0,
        valid_volume_liters: 100,
        period: input.period,
        adjustment_type: 'partial_loss',
      },
      corrected: false,
      previousAdjustment: null,
      originalAmount: 40000,
      validAmount: 40000,
      affectedRecords: 2,
    }),
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'all',
      lossPercentage: 0,
      reason: 'Test 0% loss',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.adjustment.lost_volume_liters, 0);
  assert.equal(result.adjustment.valid_volume_liters, 100);
});

test('50% loss event reduces each farmer original litres by 50%', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => ({
      adjustment: {
        id: 1,
        loss_percentage: 50,
        original_volume_liters: 100,
        lost_volume_liters: 50,
        valid_volume_liters: 50,
        period: input.period,
        adjustment_type: 'partial_loss',
      },
      corrected: false,
      previousAdjustment: null,
      originalAmount: 40000,
      validAmount: 20000,
      affectedRecords: 2,
    }),
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'all',
      lossPercentage: 50,
      reason: 'Spillage',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.adjustment.lost_volume_liters, 50);
  assert.equal(result.adjustment.valid_volume_liters, 50);
});

test('100% loss event leaves zero valid litres for all eligible records', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => ({
      adjustment: {
        id: 1,
        loss_percentage: 100,
        original_volume_liters: 100,
        lost_volume_liters: 100,
        valid_volume_liters: 0,
        period: input.period,
        adjustment_type: 'cancelled',
      },
      corrected: false,
      previousAdjustment: null,
      originalAmount: 40000,
      validAmount: 0,
      affectedRecords: 2,
    }),
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'all',
      lossPercentage: 100,
      reason: 'Antibiotics detected',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.adjustment.valid_volume_liters, 0);
  assert.equal(result.adjustment.lost_volume_liters, 100);
  assert.equal(result.adjustment.adjustment_type, 'cancelled');
});

test('Morning-only loss event leaves evening quantities unchanged', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => {
      assert.equal(input.period, 'morning');
      return {
        adjustment: {
          id: 1,
          loss_percentage: 50,
          original_volume_liters: 50,
          lost_volume_liters: 25,
          valid_volume_liters: 25,
          period: 'morning',
          adjustment_type: 'partial_loss',
        },
        corrected: false,
        previousAdjustment: null,
        originalAmount: 20000,
        validAmount: 10000,
        affectedRecords: 2,
      };
    },
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'morning',
      lossPercentage: 50,
      reason: 'Morning spill',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.adjustment.period, 'morning');
});

test('Evening-only loss event leaves morning quantities unchanged', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => {
      assert.equal(input.period, 'evening');
      return {
        adjustment: {
          id: 1,
          loss_percentage: 50,
          original_volume_liters: 50,
          lost_volume_liters: 25,
          valid_volume_liters: 25,
          period: 'evening',
          adjustment_type: 'partial_loss',
        },
        corrected: false,
        previousAdjustment: null,
        originalAmount: 20000,
        validAmount: 10000,
        affectedRecords: 2,
      };
    },
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'evening',
      lossPercentage: 50,
      reason: 'Evening spill',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.adjustment.period, 'evening');
});

test('Whole-day loss event affects both sessions exactly once', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => {
      assert.equal(input.period, 'all');
      return {
        adjustment: {
          id: 1,
          loss_percentage: 100,
          original_volume_liters: 100,
          lost_volume_liters: 100,
          valid_volume_liters: 0,
          period: 'all',
          adjustment_type: 'cancelled',
        },
        corrected: false,
        previousAdjustment: null,
        originalAmount: 40000,
        validAmount: 0,
        affectedRecords: 2,
      };
    },
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'all',
      lossPercentage: 100,
      reason: 'Contamination',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.adjustment.period, 'all');
  assert.equal(result.adjustment.valid_volume_liters, 0);
});

test('Loss percentage must be between 0 and 100', async () => {
  const repo = makeRepository();
  await assert.rejects(
    () => MilkLoss.createOrCorrectLossEvent(
      {
        ownerUserId: 42,
        collectionCenterId: 7,
        date: '2026-10-15',
        period: 'all',
        lossPercentage: 150,
        reason: 'Invalid',
        adjustedBy: 42,
      },
      repo
    ),
    /between 0 and 100/
  );
});

test('Reason is required for loss event', async () => {
  const repo = makeRepository();
  await assert.rejects(
    () => MilkLoss.createOrCorrectLossEvent(
      {
        ownerUserId: 42,
        collectionCenterId: 7,
        date: '2026-10-15',
        period: 'all',
        lossPercentage: 50,
        reason: '',
        adjustedBy: 42,
      },
      repo
    ),
    /reason is required/
  );
});

test('Changing loss percentage recalculates from original quantities', async () => {
  const calls = [];
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => {
      calls.push(input.lossPercentage);
      return {
        adjustment: {
          id: 1,
          loss_percentage: input.lossPercentage,
          original_volume_liters: 100,
          lost_volume_liters: input.lossPercentage,
          valid_volume_liters: 100 - input.lossPercentage,
          period: input.period,
          adjustment_type: 'partial_loss',
        },
        corrected: calls.length > 1,
        previousAdjustment: calls.length > 1 ? { loss_percentage: calls[0] } : null,
        originalAmount: 40000,
        validAmount: 40000 * (100 - input.lossPercentage) / 100,
        affectedRecords: 2,
      };
    },
  });

  const first = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15',
      period: 'all', lossPercentage: 50, reason: 'Initial', adjustedBy: 42,
    },
    repo
  );
  assert.equal(first.adjustment.lost_volume_liters, 50);

  const second = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15',
      period: 'all', lossPercentage: 70, reason: 'Corrected', adjustedBy: 42,
    },
    repo
  );
  assert.equal(second.adjustment.lost_volume_liters, 70);
  assert.equal(second.corrected, true);
});

test('Retrying same loss event does not duplicate adjustments (idempotent)', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => {
      return {
        adjustment: { id: 1, loss_percentage: input.lossPercentage },
        corrected: true,
        previousAdjustment: { loss_percentage: input.lossPercentage },
        originalAmount: 40000,
        validAmount: 20000,
        affectedRecords: 2,
      };
    },
  });
  const first = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15',
      period: 'all', lossPercentage: 50, reason: 'Test', adjustedBy: 42,
    },
    repo
  );
  const second = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42, collectionCenterId: 7, date: '2026-10-15',
      period: 'all', lossPercentage: 50, reason: 'Test retry', adjustedBy: 42,
    },
    repo
  );
  assert.equal(second.corrected, true);
});

test('Historical prices determine affected and remaining farmer values', async () => {
  const repo = makeRepository({
    applyCollectionAdjustment: async (input) => ({
      adjustment: {
        id: 1,
        loss_percentage: 50,
        original_volume_liters: 100,
        lost_volume_liters: 50,
        valid_volume_liters: 50,
        period: input.period,
        adjustment_type: 'partial_loss',
      },
      corrected: false,
      previousAdjustment: null,
      originalAmount: 40000,
      validAmount: 20000,
      affectedRecords: 2,
    }),
  });
  const result = await MilkLoss.createOrCorrectLossEvent(
    {
      ownerUserId: 42,
      collectionCenterId: 7,
      date: '2026-10-15',
      period: 'all',
      lossPercentage: 50,
      reason: 'Price-based loss',
      adjustedBy: 42,
    },
    repo
  );
  assert.equal(result.validAmount, 20000);
  assert.equal(result.originalAmount, 40000);
});

test('Loss validation rejects negative percentage', async () => {
  const repo = makeRepository();
  await assert.rejects(
    () => MilkLoss.createOrCorrectLossEvent(
      {
        ownerUserId: 42,
        collectionCenterId: 7,
        date: '2026-10-15',
        period: 'all',
        lossPercentage: -10,
        reason: 'Invalid',
        adjustedBy: 42,
      },
      repo
    ),
    /between 0 and 100/
  );
});

test('Loss validation rejects missing center', async () => {
  const repo = makeRepository();
  await assert.rejects(
    () => MilkLoss.createOrCorrectLossEvent(
      {
        ownerUserId: 42,
        collectionCenterId: '',
        date: '2026-10-15',
        period: 'all',
        lossPercentage: 50,
        reason: 'Test',
        adjustedBy: 42,
      },
      repo
    ),
    /Collection center is required/
  );
});

test('Loss validation rejects missing date', async () => {
  const repo = makeRepository();
  await assert.rejects(
    () => MilkLoss.createOrCorrectLossEvent(
      {
        ownerUserId: 42,
        collectionCenterId: 7,
        date: '',
        period: 'all',
        lossPercentage: 50,
        reason: 'Test',
        adjustedBy: 42,
      },
      repo
    ),
    /Event date is required/
  );
});
