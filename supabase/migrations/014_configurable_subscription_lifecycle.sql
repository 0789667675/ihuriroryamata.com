CREATE TABLE IF NOT EXISTS subscription_policy_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  initial_access_days INTEGER NOT NULL DEFAULT 15 CHECK (initial_access_days BETWEEN 1 AND 90),
  grace_period_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_period_days BETWEEN 0 AND 90),
  enforcement_time TIME NOT NULL DEFAULT TIME '00:00',
  time_zone VARCHAR(64) NOT NULL DEFAULT 'Africa/Kigali' CHECK (time_zone = 'Africa/Kigali'),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_policy_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS access_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS current_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS next_plan_id BIGINT REFERENCES subscription_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS next_period_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_period_ends_at TIMESTAMPTZ;

ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS plan_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE user_subscriptions us
SET access_started_at = COALESCE(us.access_started_at, us.trial_started_at, u.created_at),
    payment_due_at = COALESCE(us.payment_due_at,
      ((date_trunc('day', COALESCE(us.trial_started_at, u.created_at) AT TIME ZONE policy.time_zone)
        + (policy.initial_access_days + policy.grace_period_days) * INTERVAL '1 day'
        + (policy.enforcement_time - TIME '00:00')) AT TIME ZONE policy.time_zone))
FROM users u CROSS JOIN subscription_policy_settings policy
WHERE us.user_id = u.id AND policy.id = 1;

UPDATE user_subscriptions us
SET selected_plan_snapshot = jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name, 'price', p.price, 'currency', p.currency,
      'minVolumeLiters', p.min_volume_liters, 'maxVolumeLiters', p.max_volume_liters
    )
FROM subscription_plans p
WHERE p.id = us.plan_id AND us.selected_plan_snapshot IS NULL;

UPDATE user_subscriptions us
SET current_plan_snapshot = jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name, 'price', us.current_price, 'currency', us.currency,
      'minVolumeLiters', p.min_volume_liters, 'maxVolumeLiters', us.volume_limit_liters
    )
FROM subscription_plans p
WHERE p.id = us.plan_id AND us.status = 'active' AND us.current_plan_snapshot IS NULL;

UPDATE subscription_payments sp
SET plan_snapshot = jsonb_build_object(
  'id', p.id, 'code', p.code, 'name', p.name, 'price', sp.amount, 'currency', sp.currency,
  'minVolumeLiters', p.min_volume_liters, 'maxVolumeLiters', p.max_volume_liters,
  'billingPeriod', sp.billing_period, 'periodStartedAt', sp.period_started_at, 'periodEndsAt', sp.period_ends_at
)
FROM subscription_plans p
WHERE sp.plan_id = p.id AND sp.plan_snapshot = '{}'::jsonb;

UPDATE user_subscriptions
SET status = CASE WHEN payment_due_at <= NOW() THEN 'suspended'::subscription_status ELSE 'pending'::subscription_status END,
    updated_at = NOW()
WHERE status = 'trial';

ALTER TABLE IF EXISTS subscription_email_events
  DROP CONSTRAINT IF EXISTS subscription_email_events_event_type_check;

ALTER TABLE IF EXISTS subscription_email_events
  ADD CONSTRAINT subscription_email_events_event_type_check
  CHECK (event_type IN ('payment_confirmation', 'subscription_reminder', 'subscription_expired', 'subscription_usage_exceeded'));

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_access_deadline
  ON user_subscriptions (payment_due_at) WHERE status IN ('pending', 'trial');