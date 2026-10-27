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

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.farmer_field_configurations
TO authenticated;

GRANT ALL
ON public.farmer_field_configurations
TO service_role;

CREATE INDEX IF NOT EXISTS idx_farmer_field_configurations_owner
ON public.farmer_field_configurations (owner_user_id);

COMMENT ON TABLE public.farmer_field_configurations IS
  'Per-owner farmer field presentation configuration (enabled/required/display order). Does not alter the farmers table.';
