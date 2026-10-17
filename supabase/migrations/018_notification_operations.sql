-- Operational notification state: resolution, dismiss/reopen, and audit trail.
-- Existing notification rows remain valid; they default to 'open' and unread.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolution_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resolution_note VARCHAR(500),
  ADD COLUMN IF NOT EXISTS resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_status_check') THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_status_check CHECK (status IN ('open', 'resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_resolution_code_check') THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_resolution_code_check
      CHECK (resolution_code IS NULL OR resolution_code IN (
        'farmer_absent', 'no_milk', 'reported_other', 'pending_verification', 'dismissed',
        'delivery_recorded', 'volume_corrected', 'issue_cleared'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_owner_status_created
  ON notifications (owner_user_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_owner_type_created
  ON notifications (owner_user_id, notification_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_owner_status_type
  ON notifications (owner_user_id, status, notification_type);
