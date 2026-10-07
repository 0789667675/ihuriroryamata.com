CREATE INDEX IF NOT EXISTS idx_deductions_owner_date_id
  ON deductions (owner_user_id, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deductions_owner_farmer_date
  ON deductions (owner_user_id, farmer_id, date DESC);
