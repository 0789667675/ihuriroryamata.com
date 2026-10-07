ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_payments_provider_transaction
  ON subscription_payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

UPDATE subscription_plans
SET is_active = FALSE, updated_at = NOW()
WHERE code IN ('USAGE_20001_40000_MONTHLY', 'USAGE_40001_PLUS_MONTHLY');

INSERT INTO subscription_plans
  (name, code, description, price, currency, billing_period, duration_days, duration_unit,
   billing_interval, min_volume_liters, max_volume_liters, is_active, sort_order)
VALUES
  ('10,001-20,000 L / Monthly', 'USAGE_10001_20000_MONTHLY', 'Collector usage tier', 17000, 'RWF', 'monthly', 30, 'day', 'monthly', 10001, 20000, TRUE, 3),
  ('20,001-35,000 L / Monthly', 'USAGE_20001_35000_MONTHLY', 'Collector usage tier', 20000, 'RWF', 'monthly', 30, 'day', 'monthly', 20001, 35000, TRUE, 4),
  ('35,001+ L / Monthly', 'USAGE_35001_PLUS_MONTHLY', 'Collector usage tier', 25000, 'RWF', 'monthly', 30, 'day', 'monthly', 35001, NULL, TRUE, 5)
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