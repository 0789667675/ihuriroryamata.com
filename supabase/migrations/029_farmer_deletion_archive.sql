CREATE TABLE IF NOT EXISTS public.farmer_deletion_archives (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  farmer_id BIGINT NOT NULL,
  farmer_snapshot JSONB NOT NULL,
  reason VARCHAR(500) NOT NULL,
  related_counts JSONB NOT NULL,
  affected_periods JSONB NOT NULL DEFAULT '[]'::jsonb,
  settled_payment_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  deleted_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farmer_deletion_archives_owner_date
  ON public.farmer_deletion_archives (owner_user_id, deleted_at DESC);

ALTER TABLE public.farmer_deletion_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.farmer_deletion_archives
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT SELECT, INSERT ON public.farmer_deletion_archives TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.farmer_deletion_archives_id_seq TO service_role;