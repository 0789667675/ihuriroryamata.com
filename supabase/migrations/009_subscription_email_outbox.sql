CREATE TABLE IF NOT EXISTS subscription_email_events (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id BIGINT NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  payment_id BIGINT REFERENCES subscription_payments(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('payment_confirmation', 'subscription_reminder', 'subscription_expired')),
  event_key VARCHAR(255) NOT NULL UNIQUE,
  recipient VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_email_events_pending
  ON subscription_email_events (available_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_subscription_email_events_owner
  ON subscription_email_events (owner_user_id, created_at DESC);
