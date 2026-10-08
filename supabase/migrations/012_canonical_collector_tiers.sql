INSERT INTO subscription_plans
  (name, code, description, price, currency, billing_period, duration_days, duration_unit,
   billing_interval, min_volume_liters, max_volume_liters, is_active, sort_order)
SELECT tier.name, tier.code, 'Collector usage tier',
  COALESCE(CASE WHEN current_plan.is_active THEN current_plan.price END,
    legacy.price, current_plan.price, tier.default_price), 'RWF', 'monthly', 30, 'day',
  'monthly', tier.min_volume_liters, tier.max_volume_liters, TRUE, tier.sort_order
FROM (VALUES
  ('0-5,000 L / Monthly', 'USAGE_0_5000_MONTHLY', 5000, 0, 5000, 1, NULL),
  ('5,001-10,000 L / Monthly', 'USAGE_5001_10000_MONTHLY', 10000, 5001, 10000, 2, NULL),
  ('10,001-20,000 L / Monthly', 'USAGE_10001_20000_MONTHLY', 17000, 10001, 20000, 3, NULL),
  ('20,001-40,000 L / Monthly', 'USAGE_20001_40000_MONTHLY', 20000, 20001, 40000, 4, 'USAGE_20001_35000_MONTHLY'),
  ('40,001+ L / Monthly', 'USAGE_40001_PLUS_MONTHLY', 25000, 40001, NULL, 5, 'USAGE_35001_PLUS_MONTHLY')
) AS tier(name, code, default_price, min_volume_liters, max_volume_liters, sort_order, legacy_code)
LEFT JOIN subscription_plans legacy ON legacy.code = tier.legacy_code AND legacy.is_active = TRUE
LEFT JOIN subscription_plans current_plan ON current_plan.code = tier.code
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  billing_period = EXCLUDED.billing_period,
  duration_days = EXCLUDED.duration_days,
  duration_unit = EXCLUDED.duration_unit,
  billing_interval = EXCLUDED.billing_interval,
  min_volume_liters = EXCLUDED.min_volume_liters,
  max_volume_liters = EXCLUDED.max_volume_liters,
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

UPDATE subscription_plans
SET is_active = FALSE, updated_at = NOW()
WHERE code IN ('USAGE_20001_35000_MONTHLY', 'USAGE_35001_PLUS_MONTHLY')
  AND is_active = TRUE;