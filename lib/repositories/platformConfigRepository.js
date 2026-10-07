const { query, getPool } = require('../postgres.js');

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

const updateCollectorTierPrices = async ({ actorId, tiers }) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const tier of tiers) {
      const { rows: currentRows } = await client.query(
        `SELECT id, price FROM subscription_plans
         WHERE code = $1 AND is_active = TRUE AND billing_period = 'monthly' AND currency = 'RWF'
         FOR UPDATE`,
        [tier.code]
      );
      const current = currentRows[0];
      if (!current) {
        throw Object.assign(new Error(`Collector pricing tier ${tier.code} is unavailable.`), { statusCode: 409 });
      }
      const previousPrice = Number(current.price);
      if (previousPrice === tier.price) continue;

      await client.query('UPDATE subscription_plans SET price = $1, updated_at = NOW() WHERE id = $2', [tier.price, current.id]);
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
         VALUES ('subscription_plan', $1, 'collector_tier_price_updated', $2::jsonb, $3, $3)`,
        [current.id, JSON.stringify({ code: tier.code, previousPrice, price: tier.price }), actorId]
      );
    }
    const { rows } = await client.query(
      `SELECT * FROM subscription_plans WHERE code = ANY($1::text[])
       ORDER BY sort_order ASC, id ASC`,
      [tiers.map((tier) => tier.code)]
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

module.exports = { listPlans, getCollectionCenterPricing, updateCollectionCenterPricing, updateCollectorTierPrices };
