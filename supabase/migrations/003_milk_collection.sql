ALTER TABLE milk_records
  ADD COLUMN IF NOT EXISTS valid_volume_morning NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS valid_volume_evening NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS original_volume_morning NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS original_volume_evening NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS adjustment_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS adjusted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_milk_records_owner_date_id
  ON milk_records (owner_user_id, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_milk_records_owner_farmer_date
  ON milk_records (owner_user_id, farmer_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_milk_records_session
  ON milk_records (collection_session_id);

CREATE TABLE IF NOT EXISTS milk_collection_adjustments (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_center_id BIGINT NOT NULL REFERENCES collection_centers(id) ON DELETE CASCADE,
  collection_date DATE NOT NULL,
  period VARCHAR(10) NOT NULL DEFAULT 'all' CHECK (period IN ('morning', 'evening', 'all')),
  adjustment_type VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('partial_loss', 'cancelled')),
  loss_percentage NUMERIC(5,2) NOT NULL CHECK (loss_percentage BETWEEN 0 AND 100),
  original_volume_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  lost_volume_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_volume_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NOT NULL,
  adjusted_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, collection_center_id, collection_date, period)
);

CREATE INDEX IF NOT EXISTS idx_milk_adjustments_owner_date
  ON milk_collection_adjustments (owner_user_id, collection_date DESC);
