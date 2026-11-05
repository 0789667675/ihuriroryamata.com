ALTER TABLE farmer_debt_repayments
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE;

CREATE INDEX IF NOT EXISTS idx_farmer_debt_repayments_period
  ON farmer_debt_repayments (owner_user_id, period_start, period_end, debt_ledger_id);

CREATE TABLE IF NOT EXISTS farmer_settlement_period_closures (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collector_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  snapshot_hash VARCHAR(64) NOT NULL,
  total_recovered NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_recovered >= 0),
  closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, collector_user_id, period_start, period_end)
);

ALTER TABLE public.farmer_settlement_period_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.farmer_settlement_period_closures
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public.farmer_settlement_period_closures TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.farmer_settlement_period_closures_id_seq TO service_role;

CREATE INDEX IF NOT EXISTS idx_farmer_settlement_period_closures_owner_period
  ON public.farmer_settlement_period_closures (owner_user_id, period_start, period_end);
