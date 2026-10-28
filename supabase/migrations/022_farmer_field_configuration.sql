-- Per-owner farmer field configuration.
--
-- Controls which supported farmer fields are enabled, required, and their
-- display order in the normal registration form and the farmer import mapping.
-- This is configuration, not schema: no columns are added to or removed from
-- the farmers table. Rows default to the canonical field definitions in
-- lib/imports/farmer-field-config.js when no override exists for an owner.

CREATE TABLE IF NOT EXISTS public.farmer_field_configurations (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_key VARCHAR(50) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, field_key)
);

-- Field configuration is read and written only by authenticated server routes.
-- Do not expose it through the Supabase Data API.
ALTER TABLE public.farmer_field_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.farmer_field_configurations
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT ALL
ON public.farmer_field_configurations
TO service_role;

CREATE INDEX IF NOT EXISTS idx_farmer_field_configurations_owner
ON public.farmer_field_configurations (owner_user_id);

COMMENT ON TABLE public.farmer_field_configurations IS
  'Per-owner farmer field presentation configuration (enabled/required/display order). Does not alter the farmers table.';
