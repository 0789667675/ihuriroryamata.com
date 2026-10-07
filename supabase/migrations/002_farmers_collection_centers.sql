CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE farmers
  ADD COLUMN IF NOT EXISTS cow_type VARCHAR(255),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE collection_centers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP INDEX IF EXISTS uq_farmers_owner_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_national_id
  ON farmers (national_id) WHERE national_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_account_number
  ON farmers (account_number) WHERE account_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_farmers_owner_id_desc
  ON farmers (owner_user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_farmers_owner_center_id_desc
  ON farmers (owner_user_id, collection_center, id DESC);
CREATE INDEX IF NOT EXISTS idx_farmers_name_trgm
  ON farmers USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_farmers_phone_trgm
  ON farmers USING GIN (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_farmers_national_id_trgm
  ON farmers USING GIN (national_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_farmers_account_number_trgm
  ON farmers USING GIN (account_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_farmers_location_trgm
  ON farmers USING GIN (location gin_trgm_ops);

DROP INDEX IF EXISTS uq_collection_centers_owner_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_centers_owner_name_ci
  ON collection_centers (owner_user_id, LOWER(BTRIM(name)))
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_collection_centers_owner_name
  ON collection_centers (owner_user_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_assignments_collector
  ON collector_assignments (collector_user_id);
CREATE INDEX IF NOT EXISTS idx_center_prices_owner_effective
  ON collection_center_prices (owner_user_id, effective_date DESC, id DESC);
