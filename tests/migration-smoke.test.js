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
  assert.match(appFile, /Milk System — Next.js \+ Supabase PostgreSQL migration/);
});
