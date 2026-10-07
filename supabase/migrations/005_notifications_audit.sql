ALTER TABLE notifications
  ALTER COLUMN priority TYPE VARCHAR(30) USING priority::text;

CREATE INDEX IF NOT EXISTS idx_notifications_owner_created
  ON notifications (owner_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread
  ON notifications (owner_user_id, is_read, created_at DESC);
