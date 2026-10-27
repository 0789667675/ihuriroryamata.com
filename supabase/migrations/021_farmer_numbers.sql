-- Permanent, owner-scoped farmer numbers. The number is assigned once and is
-- never derived from a filtered, sorted, or paginated screen position.
ALTER TABLE farmers
  ADD COLUMN IF NOT EXISTS farmer_number BIGINT;

-- Backfill existing farmers deterministically. The oldest row (lowest id) for
-- each owner receives No. 1, the next No. 2, and so on.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY owner_user_id ORDER BY id ASC) AS assigned_number
  FROM farmers
  WHERE farmer_number IS NULL
)
UPDATE farmers AS f
SET farmer_number = numbered.assigned_number
FROM numbered
WHERE f.id = numbered.id;

-- Serialize number allocation for the same owner. The advisory lock is scoped
-- to the transaction and released automatically on commit or rollback.
CREATE OR REPLACE FUNCTION assign_farmer_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.farmer_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(NEW.owner_user_id);
    SELECT COALESCE(MAX(farmer_number), 0) + 1
    INTO NEW.farmer_number
    FROM farmers
    WHERE owner_user_id = NEW.owner_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmers_assign_number ON farmers;
CREATE TRIGGER farmers_assign_number
  BEFORE INSERT ON farmers
  FOR EACH ROW
  EXECUTE FUNCTION assign_farmer_number();

ALTER TABLE farmers
  ALTER COLUMN farmer_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_owner_farmer_number
  ON farmers (owner_user_id, farmer_number);

CREATE INDEX IF NOT EXISTS idx_farmers_owner_number
  ON farmers (owner_user_id, farmer_number);

COMMENT ON COLUMN farmers.farmer_number IS
  'Permanent owner-scoped farmer number used as the stable No. shown in lists and delivery history.';
