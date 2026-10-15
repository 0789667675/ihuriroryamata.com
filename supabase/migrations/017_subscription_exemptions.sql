ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exemption_reason VARCHAR(255),
  ADD COLUMN IF NOT EXISTS exemption_granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exemption_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exemption_revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_billing_exempt
  ON user_subscriptions (user_id) WHERE billing_exempt = TRUE;