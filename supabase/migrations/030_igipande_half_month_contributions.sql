CREATE TABLE IF NOT EXISTS public.farmer_igipande_contributions (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  charge_amount NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (charge_amount = 100),
  recovered_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0 AND recovered_amount <= charge_amount),
  outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (outstanding_amount >= 0 AND outstanding_amount <= charge_amount),
  status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
  reference VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, farmer_id, period_start),
  UNIQUE (owner_user_id, reference),
  CHECK (period_start >= DATE '2026-11-16'),
  CHECK (
    (EXTRACT(DAY FROM period_start) = 1 AND EXTRACT(DAY FROM period_end) = 15
      AND DATE_TRUNC('month', period_start) = DATE_TRUNC('month', period_end))
    OR (EXTRACT(DAY FROM period_start) = 16
      AND period_end = (DATE_TRUNC('month', period_start)::date + INTERVAL '1 month - 1 day')::date)
  ),
  CHECK (reference = 'igipande-' || farmer_id || '-' || period_start::text || '-' || period_end::text),
  CHECK (recovered_amount + outstanding_amount = charge_amount)
);

CREATE TABLE IF NOT EXISTS public.farmer_igipande_period_runs (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  available_earnings NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (available_earnings >= 0),
  recovered_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, farmer_id, period_start),
  CHECK (period_start >= DATE '2026-11-16'),
  CHECK (
    (EXTRACT(DAY FROM period_start) = 1 AND EXTRACT(DAY FROM period_end) = 15
      AND DATE_TRUNC('month', period_start) = DATE_TRUNC('month', period_end))
    OR (EXTRACT(DAY FROM period_start) = 16
      AND period_end = (DATE_TRUNC('month', period_start)::date + INTERVAL '1 month - 1 day')::date)
  )
);

CREATE TABLE IF NOT EXISTS public.farmer_igipande_recoveries (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES public.farmer_igipande_period_runs(id) ON DELETE CASCADE,
  contribution_id BIGINT NOT NULL REFERENCES public.farmer_igipande_contributions(id) ON DELETE CASCADE,
  farmer_id BIGINT NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, contribution_id)
);

CREATE INDEX IF NOT EXISTS idx_farmer_igipande_open_balances
  ON public.farmer_igipande_contributions (owner_user_id, farmer_id, period_start)
  WHERE outstanding_amount > 0;

ALTER TABLE public.farmer_igipande_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farmer_igipande_period_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farmer_igipande_recoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.farmer_igipande_contributions
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY milk_system_deny_data_api_access
ON public.farmer_igipande_period_runs
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY milk_system_deny_data_api_access
ON public.farmer_igipande_recoveries
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public.farmer_igipande_contributions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.farmer_igipande_contributions_id_seq TO service_role;
GRANT SELECT, INSERT ON public.farmer_igipande_period_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.farmer_igipande_period_runs_id_seq TO service_role;
GRANT SELECT, INSERT ON public.farmer_igipande_recoveries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.farmer_igipande_recoveries_id_seq TO service_role;