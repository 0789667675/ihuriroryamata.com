ALTER TABLE collector_assignments
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE collector_assignments
  DROP CONSTRAINT IF EXISTS collector_assignments_dairy_user_id_collector_user_id_key;

DROP INDEX IF EXISTS uq_collector_assignments_collector;

CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_assignments_active_collector
  ON collector_assignments (collector_user_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_assignments_active_pair
  ON collector_assignments (dairy_user_id, collector_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_collector_assignments_history
  ON collector_assignments (dairy_user_id, collector_user_id, created_at, revoked_at);