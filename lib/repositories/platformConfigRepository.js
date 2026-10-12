const { query, getPool } = require('../postgres.js');
const { randomBytes } = require('node:crypto');

const listPlans = async () => {
  const { rows } = await query('SELECT * FROM subscription_plans ORDER BY is_active DESC, sort_order ASC, id ASC');
  return rows;
};

const getCollectionCenterPricing = async () => {
  const { rows: configRows } = await query(
    `SELECT monthly_amount, first_volume_boundary_liters, currency, updated_at
     FROM collection_center_subscription_config WHERE is_active = TRUE ORDER BY id ASC LIMIT 1`
  );
  const { rows: planRows } = await query("SELECT * FROM subscription_plans WHERE code = 'COLLECTION_CENTER_MONTHLY' LIMIT 1");
  return { config: configRows[0] || null, plan: planRows[0] || null };
};

const updateCollectionCenterPricing = async ({ actorId, amount, boundary }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: configs } = await client.query(
      `UPDATE collection_center_subscription_config
       SET monthly_amount = $1, first_volume_boundary_liters = $2, updated_by = $3, updated_at = NOW()
       WHERE is_active = TRUE RETURNING id`,
      [amount, boundary, actorId]
    );
    if (!configs.length) {
      await client.query(
        `INSERT INTO collection_center_subscription_config
         (monthly_amount, first_volume_boundary_liters, currency, is_active, updated_by)
         VALUES ($1, $2, 'RWF', TRUE, $3)`,
        [amount, boundary, actorId]
      );
    }
    const { rows: plans } = await client.query(
      `UPDATE subscription_plans SET price = $1, min_volume_liters = $2, updated_at = NOW()
       WHERE code = 'COLLECTION_CENTER_MONTHLY' RETURNING *`,
      [amount, boundary]
    );
    const plan = plans[0];
    if (!plan) {
      const error = new Error('Collection Center plan not found.');
      error.code = 'CENTER_PLAN_NOT_FOUND';
      throw error;
    }
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('subscription_plan', $1, 'collection_center_pricing_updated', $2::jsonb, $3, $3)`,
      [plan.id, JSON.stringify({ amount, boundary }), actorId]
    );
    await client.query('COMMIT');
    return {
      config: { monthly_amount: amount, first_volume_boundary_liters: boundary, currency: 'RWF' },
      plan,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateCollectorTiers = async ({ actorId, tiers }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ids = tiers.map((tier) => tier.id).filter((id) => id !== null);
    const existingRows = ids.length
      ? await client.query(`SELECT id, code, name, price, min_volume_liters, max_volume_liters, is_active
        FROM subscription_plans WHERE id = ANY($1::bigint[]) AND LEFT(code, 6) = 'USAGE_'
        FOR UPDATE`, [ids])
      : { rows: [] };
    if (existingRows.rows.length !== ids.length) {
      throw Object.assign(new Error('One or more Collector pricing tiers are unavailable.'), { statusCode: 409 });
    }
    const existingById = new Map(existingRows.rows.map((row) => [Number(row.id), row]));
    for (const tier of tiers) {
      const next = {
        name: tier.name,
        price: tier.price,
        minVolumeLiters: tier.minVolumeLiters,
        maxVolumeLiters: tier.maxVolumeLiters,
        isActive: tier.isActive,
      };
      let planId;
      let previous = null;
      if (tier.id !== null) {
        const current = existingById.get(tier.id);
        planId = current.id;
        previous = {
          name: current.name,
          price: Number(current.price),
          minVolumeLiters: Number(current.min_volume_liters),
          maxVolumeLiters: current.max_volume_liters === null ? null : Number(current.max_volume_liters),
          isActive: current.is_active,
        };
        if (JSON.stringify(previous) === JSON.stringify(next)) continue;
        await client.query(
          `UPDATE subscription_plans SET name = $1, price = $2, min_volume_liters = $3,
           max_volume_liters = $4, is_active = $5, sort_order = $6, updated_at = NOW()
           WHERE id = $7`,
          [next.name, next.price, next.minVolumeLiters, next.maxVolumeLiters, next.isActive, tier.sortOrder, planId]
        );
      } else {
        const code = `USAGE_CUSTOM_${randomBytes(10).toString('hex').toUpperCase()}_MONTHLY`;
        const { rows } = await client.query(
          `INSERT INTO subscription_plans
           (name, code, price, currency, billing_period, duration_days, duration_unit,
            billing_interval, min_volume_liters, max_volume_liters, is_active, sort_order)
           VALUES ($1, $2, $3, 'RWF', 'monthly', 30, 'day', 'monthly', $4, $5, $6, $7)
           RETURNING id`,
          [next.name, code, next.price, next.minVolumeLiters, next.maxVolumeLiters, next.isActive, tier.sortOrder]
        );
        planId = rows[0].id;
      }
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('subscription_plan', $1, $2, $3::jsonb, $4, $4)`,
        [planId, previous ? 'collector_tier_updated' : 'collector_tier_created', JSON.stringify({ previous, current: next }), actorId]
      );
    }
    const { rows } = await client.query(
      `SELECT * FROM subscription_plans WHERE LEFT(code, 6) = 'USAGE_'
       ORDER BY is_active DESC, sort_order ASC, id ASC`
    );
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getSubscriptionPolicy = async () => {
  const { rows } = await query('SELECT * FROM subscription_policy_settings WHERE id = 1 LIMIT 1');
  return rows[0] || null;
};

const updateSubscriptionPolicy = async ({ actorId, policy }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      'SELECT * FROM subscription_policy_settings WHERE id = 1 FOR UPDATE'
    );
    const previous = existingRows[0] || null;
    const { rows } = await client.query(
      `INSERT INTO subscription_policy_settings
       (id, initial_access_days, grace_period_days, enforcement_time, time_zone, updated_by, updated_at)
       VALUES (1, $1, $2, $3, 'Africa/Kigali', $4, NOW())
       ON CONFLICT (id) DO UPDATE SET initial_access_days = EXCLUDED.initial_access_days,
         grace_period_days = EXCLUDED.grace_period_days, enforcement_time = EXCLUDED.enforcement_time,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [policy.initialAccessDays, policy.gracePeriodDays, policy.enforcementTime, actorId]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('subscription_policy', 1, 'subscription_policy_updated', $1::jsonb, $2, $2)`,
      [JSON.stringify({ previous, current: rows[0] }), actorId]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  listPlans,
  getCollectionCenterPricing,
  updateCollectionCenterPricing,
  updateCollectorTierPrices: updateCollectorTiers,
  updateCollectorTiers,
  getSubscriptionPolicy,
  updateSubscriptionPolicy,
};
