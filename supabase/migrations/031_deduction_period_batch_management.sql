CREATE TABLE IF NOT EXISTS public.deduction_configurations (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (BTRIM(name) <> ''),
  description TEXT,
  amount_per_farmer NUMERIC(12,2) NOT NULL CHECK (amount_per_farmer > 0),
  type VARCHAR(100) NOT NULL DEFAULT 'Other',
  eligibility_mode VARCHAR(20) NOT NULL DEFAULT 'ALL' CHECK (eligibility_mode IN ('ALL', 'SELECTED')),
  eligible_farmer_ids BIGINT[] NOT NULL DEFAULT '{}',
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('PERIOD', 'MONTHLY', 'ONE_TIME')),
  effective_start_date DATE NOT NULL,
  execution_mode VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (execution_mode = 'MANUAL'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (eligibility_mode = 'ALL' OR cardinality(eligible_farmer_ids) > 0)
);

ALTER TABLE public.deductions
  ADD COLUMN IF NOT EXISTS configuration_id BIGINT REFERENCES public.deduction_configurations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_period_start DATE,
  ADD COLUMN IF NOT EXISTS accounting_period_end DATE;

CREATE TABLE IF NOT EXISTS public.deduction_batch_items (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  farmer_id BIGINT NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  configuration_id BIGINT NOT NULL REFERENCES public.deduction_configurations(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  charge_amount NUMERIC(12,2) NOT NULL CHECK (charge_amount > 0),
  recovered_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0 AND recovered_amount <= charge_amount),
  outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0 AND outstanding_amount <= charge_amount),
  deduction_id BIGINT REFERENCES public.deductions(id) ON DELETE SET NULL,
  debt_ledger_id BIGINT REFERENCES public.farmer_debt_ledgers(id) ON DELETE SET NULL,
  request_key VARCHAR(160) NOT NULL,
  reference VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('DEDUCTED', 'PARTIAL', 'OUTSTANDING')),
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, farmer_id, configuration_id, period_start),
  UNIQUE (owner_user_id, request_key, farmer_id),
  UNIQUE (owner_user_id, reference),
  CHECK (period_end >= period_start),
  CHECK (recovered_amount + outstanding_amount = charge_amount)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deductions_configuration_farmer_period
  ON public.deductions (owner_user_id, farmer_id, configuration_id, accounting_period_start)
  WHERE configuration_id IS NOT NULL AND accounting_period_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deduction_configurations_owner_active
  ON public.deduction_configurations (owner_user_id, is_active, effective_start_date DESC);

CREATE INDEX IF NOT EXISTS idx_deduction_batch_items_owner_period
  ON public.deduction_batch_items (owner_user_id, period_start, farmer_id);

ALTER TABLE public.deduction_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deduction_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.deduction_configurations
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY milk_system_deny_data_api_access
ON public.deduction_batch_items
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public.deduction_configurations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.deduction_configurations_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.deduction_batch_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.deduction_batch_items_id_seq TO service_role;