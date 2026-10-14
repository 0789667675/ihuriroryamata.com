ALTER TABLE farmer_debt_ledgers
  ADD COLUMN IF NOT EXISTS request_key VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_farmer_debt_request_key
  ON farmer_debt_ledgers (owner_user_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS farmer_debt_repayments (
  id BIGSERIAL PRIMARY KEY,
  debt_ledger_id BIGINT NOT NULL REFERENCES farmer_debt_ledgers(id) ON DELETE CASCADE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  request_key VARCHAR(120) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_farmer_debt_repayments_ledger
  ON farmer_debt_repayments (owner_user_id, debt_ledger_id, created_at DESC);
