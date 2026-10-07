ALTER TABLE milk_records
  ALTER COLUMN farmer_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_owner_milk BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'milk_records_owner_farmer_identity_check'
  ) THEN
    ALTER TABLE milk_records ADD CONSTRAINT milk_records_owner_farmer_identity_check
      CHECK ((is_owner_milk = TRUE AND farmer_id IS NULL) OR (is_owner_milk = FALSE AND farmer_id IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_milk_records_owner_daily
  ON milk_records (owner_user_id, date) WHERE is_owner_milk = TRUE;

INSERT INTO milk_records (
  farmer_id, owner_user_id, collection_session_id, date, month, year, day,
  volume_liters, volume_morning, volume_evening, price_per_liter, amount,
  status, original_volume_liters, lost_volume_liters, valid_volume_liters,
  original_amount, valid_amount, original_volume_morning, original_volume_evening,
  valid_volume_morning, valid_volume_evening, is_owner_milk,
  adjustment_reason, adjusted_by, adjusted_at
)
SELECT NULL, cm.owner_user_id, NULL, cm.collection_date,
  EXTRACT(MONTH FROM cm.collection_date)::integer,
  EXTRACT(YEAR FROM cm.collection_date)::integer,
  EXTRACT(DAY FROM cm.collection_date)::integer,
  cm.volume_liters, cm.volume_liters, 0, cm.price_per_liter,
  cm.volume_liters * cm.price_per_liter,
  CASE WHEN cm.status = 'cancelled' THEN 'cancelled'::milk_status ELSE 'valid'::milk_status END,
  cm.volume_liters,
  CASE WHEN cm.status = 'cancelled' THEN cm.volume_liters ELSE GREATEST(0, cm.volume_liters - COALESCE(cm.valid_volume_liters, cm.volume_liters)) END,
  CASE WHEN cm.status = 'cancelled' THEN 0 ELSE COALESCE(cm.valid_volume_liters, cm.volume_liters) END,
  cm.volume_liters * cm.price_per_liter,
  CASE WHEN cm.status = 'cancelled' THEN 0 ELSE COALESCE(cm.valid_volume_liters, cm.volume_liters) * cm.price_per_liter END,
  cm.volume_liters, 0,
  CASE WHEN cm.status = 'cancelled' THEN 0 ELSE COALESCE(cm.valid_volume_liters, cm.volume_liters) END,
  0, TRUE, cm.void_reason, cm.voided_by, cm.voided_at
FROM collector_milk_records cm
ON CONFLICT (owner_user_id, date) WHERE is_owner_milk = TRUE DO NOTHING;