ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_purpose
  ON password_reset_tokens (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  identifier_hash VARCHAR(64) PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0
);