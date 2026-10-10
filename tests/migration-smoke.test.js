const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('migration scaffold preserves the required owner and admin model', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
  const farmerCenterMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '002_farmers_collection_centers.sql'), 'utf8');
  const paymentMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '008_lmbtech_payment_reconciliation.sql'), 'utf8');
  const subscriptionEmailMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '009_subscription_email_outbox.sql'), 'utf8');
  const transportSnapshotMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '013_milk_transport_rate_snapshots.sql'), 'utf8');
  const usersRoute = fs.readFileSync(path.join(root, 'app', 'api', 'admin', 'super-admin', 'route.ts'), 'utf8');
  const farmerRoute = fs.readFileSync(path.join(root, 'app', 'api', 'farmers', 'route.ts'), 'utf8');
  const appFile = fs.readFileSync(path.join(root, 'app', 'page.tsx'), 'utf8');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(schema, /owner_user_id/);
  assert.match(schema, /super_admin/);
  assert.match(paymentMigration, /provider_transaction_id/);
  assert.match(paymentMigration, /USAGE_20001_35000_MONTHLY/);
  assert.match(paymentMigration, /USAGE_35001_PLUS_MONTHLY/);
  assert.match(subscriptionEmailMigration, /CREATE TABLE IF NOT EXISTS subscription_email_events/);
  assert.match(subscriptionEmailMigration, /event_key VARCHAR\(255\) NOT NULL UNIQUE/);
  assert.match(usersRoute, /SUPER_ADMIN_EMAIL/);
  assert.match(farmerCenterMigration, /idx_farmers_owner_id_desc/);
  assert.match(farmerCenterMigration, /gin_trgm_ops/);
  assert.match(farmerRoute, /cursor/);
  assert.match(farmerRoute, /getAuthenticatedUser/);
  assert.match(transportSnapshotMigration, /ADD COLUMN IF NOT EXISTS transport_rate_per_liter NUMERIC\(10,2\)/);
  assert.doesNotMatch(transportSnapshotMigration, /UPDATE|DELETE|TRUNCATE|DROP/i);
  assert.match(appFile, /Milk System — Next.js \+ Supabase PostgreSQL migration/);
});

test('canonical Collector tier migration preserves prices and only deactivates retired codes', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '012_canonical_collector_tiers.sql'), 'utf8');
  for (const code of [
    'USAGE_0_5000_MONTHLY',
    'USAGE_5001_10000_MONTHLY',
    'USAGE_10001_20000_MONTHLY',
    'USAGE_20001_40000_MONTHLY',
    'USAGE_40001_PLUS_MONTHLY',
  ]) assert.ok(migration.includes(code));
  assert.match(migration, /COALESCE\(CASE WHEN current_plan\.is_active THEN current_plan\.price END,\s*legacy\.price, current_plan\.price, tier\.default_price\)/);
  assert.match(migration, /ON CONFLICT \(code\) DO UPDATE/);
  assert.match(migration, /SET is_active = FALSE/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});
