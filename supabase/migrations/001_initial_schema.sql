-- Milk System PostgreSQL schema for Supabase
-- This migration is aligned with the existing product logic and the owner_user_id-based access model.
-- The authoritative platform account is not hardcoded here; it is configured through environment variables.

CREATE TYPE user_role AS ENUM ('user', 'super_admin');
CREATE TYPE user_account_status AS ENUM ('active', 'suspended', 'not_approved');
CREATE TYPE user_account_type AS ENUM ('COLLECTOR', 'COLLECTION_CENTER');
CREATE TYPE milk_status AS ENUM ('valid', 'adjusted', 'cancelled');
CREATE TYPE subscription_status AS ENUM ('pending', 'trial', 'active', 'suspended', 'expired', 'cancelled');
CREATE TYPE notification_priority AS ENUM ('low', 'warning', 'critical');

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  account_type user_account_type NOT NULL DEFAULT 'COLLECTOR',
  account_status user_account_status NOT NULL DEFAULT 'active',
  national_id VARCHAR(50),
  account_number VARCHAR(255),
  phone VARCHAR(50),
  language VARCHAR(10) NOT NULL DEFAULT 'rw',
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at TIMESTAMPTZ,
  profile_picture TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users (email_verified);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users (account_status);

CREATE TABLE IF NOT EXISTS farmers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  national_id VARCHAR(50),
  account_number VARCHAR(255),
  location VARCHAR(255),
  collection_center VARCHAR(255),
  collector_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farmers_owner_user ON farmers (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_farmers_collector_user ON farmers (collector_user_id);
CREATE INDEX IF NOT EXISTS idx_farmers_location ON farmers (location);
CREATE INDEX IF NOT EXISTS idx_farmers_collection_center ON farmers (collection_center);
CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_owner_name ON farmers (owner_user_id, name);

CREATE TABLE IF NOT EXISTS collection_centers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  price_per_liter NUMERIC(10,2) NOT NULL DEFAULT 0,
  transport_rate_per_liter NUMERIC(10,2) NOT NULL DEFAULT 0,
  morning_start TIME NOT NULL DEFAULT '06:30:00',
  morning_end TIME NOT NULL DEFAULT '09:00:00',
  evening_start TIME NOT NULL DEFAULT '17:30:00',
  evening_end TIME NOT NULL DEFAULT '19:00:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_centers_owner_user ON collection_centers (owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_centers_owner_name ON collection_centers (owner_user_id, name);

CREATE TABLE IF NOT EXISTS collection_center_prices (
  id BIGSERIAL PRIMARY KEY,
  collection_center_id BIGINT NOT NULL REFERENCES collection_centers(id) ON DELETE CASCADE,
  price_per_liter NUMERIC(10,2) NOT NULL DEFAULT 0,
  effective_date DATE NOT NULL,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_center_prices_center_effective ON collection_center_prices (collection_center_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_center_prices_owner_user ON collection_center_prices (owner_user_id);

CREATE TABLE IF NOT EXISTS collection_sessions (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collector_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_date DATE NOT NULL,
  period VARCHAR(20) NOT NULL DEFAULT 'daily',
  collection_center_id BIGINT NOT NULL REFERENCES collection_centers(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, collection_date, period, collection_center_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_sessions_collector ON collection_sessions (collector_user_id, collection_date);

CREATE TABLE IF NOT EXISTS milk_records (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_session_id BIGINT REFERENCES collection_sessions(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  day INTEGER NOT NULL,
  volume_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  volume_morning NUMERIC(12,2) NOT NULL DEFAULT 0,
  volume_evening NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_per_liter NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status milk_status NOT NULL DEFAULT 'valid',
  original_volume_liters NUMERIC(12,2),
  lost_volume_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_volume_liters NUMERIC(12,2),
  original_amount NUMERIC(12,2),
  valid_amount NUMERIC(12,2),
  loss_percentage NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (farmer_id, month, year, day)
);

CREATE INDEX IF NOT EXISTS idx_milk_records_owner_date ON milk_records (owner_user_id, date);
CREATE INDEX IF NOT EXISTS idx_milk_records_farm_date ON milk_records (farmer_id, date);
CREATE INDEX IF NOT EXISTS idx_milk_records_month_year ON milk_records (date, month, year);

CREATE TABLE IF NOT EXISTS deductions (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  type VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Active',
  reason VARCHAR(255),
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deductions_owner_farmer_date ON deductions (owner_user_id, farmer_id, date);
CREATE INDEX IF NOT EXISTS idx_deductions_date_farmer ON deductions (date, farmer_id);

CREATE TABLE IF NOT EXISTS farmer_payments (
  id BIGSERIAL PRIMARY KEY,
  farmer_id BIGINT NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  period_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farmer_payments_owner_farmer_period ON farmer_payments (owner_user_id, farmer_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  notification_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  farmer_id BIGINT REFERENCES farmers(id) ON DELETE SET NULL,
  collection_center VARCHAR(255),
  collection_date DATE,
  period VARCHAR(50),
  priority notification_priority NOT NULL DEFAULT 'warning',
  owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key VARCHAR(255) NOT NULL,
  details JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_owner_user ON notifications (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (owner_user_id, is_read);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications (owner_user_id, dedupe_key);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_owner_created ON audit_logs (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status subscription_status NOT NULL DEFAULT 'pending',
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  plan_id BIGINT,
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  current_period_started_at TIMESTAMPTZ,
  current_period_ends_at TIMESTAMPTZ,
  intro_periods_used INTEGER NOT NULL DEFAULT 0,
  current_price NUMERIC(10,2),
  currency VARCHAR(10) DEFAULT 'RWF',
  tier_code VARCHAR(50),
  volume_limit_liters NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  intro_price NUMERIC(10,2),
  intro_periods INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
  billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',
  duration_days INTEGER,
  duration_unit VARCHAR(20) NOT NULL DEFAULT 'day',
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'monthly',
  metadata JSONB,
  min_volume_liters NUMERIC(12,2),
  max_volume_liters NUMERIC(12,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id BIGINT NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  payment_method VARCHAR(100),
  provider VARCHAR(100),
  provider_reference VARCHAR(255),
  mobile_money_phone VARCHAR(30),
  failure_reason VARCHAR(255),
  completed_at TIMESTAMPTZ,
  period_started_at TIMESTAMPTZ,
  period_ends_at TIMESTAMPTZ,
  price_type VARCHAR(50) NOT NULL DEFAULT 'standard',
  billing_period VARCHAR(30) NOT NULL DEFAULT 'monthly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_user ON subscription_payments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_usage_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id BIGINT NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  period_started_at TIMESTAMPTZ NOT NULL,
  period_ends_at TIMESTAMPTZ NOT NULL,
  actual_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  projected_monthly_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  tier_code VARCHAR(50) NOT NULL,
  tier_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collector_milk_prices (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_per_liter NUMERIC(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, effective_date)
);

CREATE TABLE IF NOT EXISTS collector_milk_records (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_date DATE NOT NULL,
  volume_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_per_liter NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'valid',
  valid_volume_liters NUMERIC(12,2),
  voided_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  void_reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, collection_date)
);

CREATE TABLE IF NOT EXISTS collector_assignments (
  id BIGSERIAL PRIMARY KEY,
  dairy_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collector_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dairy_user_id, collector_user_id)
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  purpose VARCHAR(50) NOT NULL DEFAULT 'email_verification',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  purpose VARCHAR(50) NOT NULL DEFAULT 'password_reset',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_change_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pending_email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_store (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSONB NOT NULL,
  expires TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_store_expires ON session_store (expires);

-- Owner-based isolation is the authoritative access rule.
-- This project intentionally avoids creating a new role hierarchy beyond the existing USER / SUPER_ADMIN model.
