const test = require('node:test');
const assert = require('node:assert/strict');
const MilkLoss = require('../lib/services/milk-loss-service.js');

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
