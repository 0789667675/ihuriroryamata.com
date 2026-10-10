ALTER TABLE milk_records
  ADD COLUMN IF NOT EXISTS transport_rate_per_liter NUMERIC(10,2);