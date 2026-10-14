CREATE TABLE IF NOT EXISTS farmer_settlement_records (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'SACCO', 'DEBT_REPAYMENT')),
  payment_type VARCHAR(40) NOT NULL DEFAULT 'CASH' CHECK (payment_type IN ('CASH', 'SACCO', 'DEBT_REPAYMENT')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  settled_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'CONFIRMED', 'REJECTED', 'PARTIALLY_SETTLED', 'SETTLED')),
  approval_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  confirmed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  actual_payment_at TIMESTAMPTZ,
  period_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reason VARCHAR(255),
  notes TEXT,
  payment_reference VARCHAR(255),
  audit_context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farmer_settlement_owner_farmer_period
  ON farmer_settlement_records (owner_user_id, farmer_id, period_start, period_end);

CREATE UNIQUE INDEX IF NOT EXISTS uq_farmer_settlement_reference
  ON farmer_settlement_records (owner_user_id, farmer_id, payment_type, payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS farmer_debt_ledgers (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_repaid NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reason VARCHAR(255),
  source VARCHAR(50) NOT NULL DEFAULT 'DEBT',
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  audit_context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farmer_debt_owner_farmer_period
  ON farmer_debt_ledgers (owner_user_id, farmer_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_farmer_debt_remaining
  ON farmer_debt_ledgers (owner_user_id, farmer_id, remaining_balance);
