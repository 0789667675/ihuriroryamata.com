CREATE TABLE IF NOT EXISTS collection_center_subscription_config (
  id BIGSERIAL PRIMARY KEY,
  monthly_amount NUMERIC(10,2) NOT NULL DEFAULT 30000,
  first_volume_boundary_liters NUMERIC(12,2) NOT NULL DEFAULT 50000,
  currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO collection_center_subscription_config (monthly_amount, first_volume_boundary_liters, currency)
SELECT 30000, 50000, 'RWF'
WHERE NOT EXISTS (SELECT 1 FROM collection_center_subscription_config);

INSERT INTO subscription_plans
  (name, code, price, intro_price, intro_periods, currency, billing_period, duration_days,
   duration_unit, billing_interval, min_volume_liters, max_volume_liters, is_active, sort_order)
VALUES
  ('0-5,000 L / Monthly', 'USAGE_0_5000_MONTHLY', 5000, NULL, 0, 'RWF', 'monthly', 30, 'day', 'monthly', 0, 5000, TRUE, 1),
  ('5,001-10,000 L / Monthly', 'USAGE_5001_10000_MONTHLY', 10000, NULL, 0, 'RWF', 'monthly', 30, 'day', 'monthly', 5001, 10000, TRUE, 2),
  ('10,001-20,000 L / Monthly', 'USAGE_10001_20000_MONTHLY', 15000, NULL, 0, 'RWF', 'monthly', 30, 'day', 'monthly', 10001, 20000, TRUE, 3),
  ('20,001-40,000 L / Monthly', 'USAGE_20001_40000_MONTHLY', 20000, NULL, 0, 'RWF', 'monthly', 30, 'day', 'monthly', 20001, 40000, TRUE, 4),
  ('40,001+ L / Monthly', 'USAGE_40001_PLUS_MONTHLY', 25000, NULL, 0, 'RWF', 'monthly', 30, 'day', 'monthly', 40001, NULL, TRUE, 5)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  intro_price = NULL,
  intro_periods = 0,
  currency = EXCLUDED.currency,
  billing_period = EXCLUDED.billing_period,
  duration_days = EXCLUDED.duration_days,
  duration_unit = EXCLUDED.duration_unit,
  billing_interval = EXCLUDED.billing_interval,
  min_volume_liters = EXCLUDED.min_volume_liters,
  max_volume_liters = EXCLUDED.max_volume_liters,
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order;

INSERT INTO subscription_plans
  (name, code, description, price, currency, billing_period, duration_days, duration_unit,
   billing_interval, min_volume_liters, max_volume_liters, is_active, sort_order)
SELECT 'Collection Center Monthly', 'COLLECTION_CENTER_MONTHLY',
  'Backend-managed Collection Center subscription', monthly_amount, currency,
  'monthly', 30, 'day', 'monthly', first_volume_boundary_liters, NULL, TRUE, 50
FROM collection_center_subscription_config WHERE is_active = TRUE ORDER BY id ASC LIMIT 1
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
  is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_user_provider_status
  ON subscription_payments (user_id, provider, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_reference
  ON subscription_payments (provider_reference);
CREATE INDEX IF NOT EXISTS idx_subscription_usage_user_period
  ON subscription_usage_snapshots (user_id, period_started_at DESC);
