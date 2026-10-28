const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

// Migrations created before the explicit-grant convention (pre-October 2026).
// They are historical records and must not be rewritten. See
// supabase/migrations/README.md.
const GRANDFATHERED_MIGRATIONS = new Set([
  '001_initial_schema.sql',
  '002_farmers_collection_centers.sql',
  '003_milk_collection.sql',
  '004_deductions.sql',
  '005_notifications_audit.sql',
  '006_subscriptions_payments.sql',
  '007_password_reset_security.sql',
  '008_lmbtech_payment_reconciliation.sql',
  '009_subscription_email_outbox.sql',
  '010_owner_ifishi_milk_records.sql',
  '011_collector_assignment_history.sql',
  '012_canonical_collector_tiers.sql',
  '013_milk_transport_rate_snapshots.sql',
  '014_configurable_subscription_lifecycle.sql',
  '015_farmer_settlement_debt.sql',
  '016_farmer_settlement_idempotency.sql',
  '017_subscription_exemptions.sql',
  '018_notification_operations.sql',
]);

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds tables created by a migration, schema-qualified (`public.table`) or not.
// Every table in this repository lives in the `public` schema.
function createdTables(normalizedSql) {
  const tables = [];
  const regex =
    /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\b/gi;
  let match;
  while ((match = regex.exec(normalizedSql)) !== null) {
    tables.push(match[3]);
  }
  return tables;
}

function migrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function readMigration(file) {
  return normalizeSql(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
}

test('every migration that creates a public table defines explicit grants in the same migration', () => {
  const files = migrationFiles();
  assert.ok(files.length > 0, 'expected migration files in supabase/migrations');

  let checkedTables = 0;
  for (const file of files) {
    const sql = readMigration(file);
    const tables = createdTables(sql);
    if (tables.length === 0) continue;

    if (GRANDFATHERED_MIGRATIONS.has(file)) {
      // Historical record predating the convention; leave untouched.
      continue;
    }

    for (const table of tables) {
      const grantRegex = new RegExp(
        `grant\\s+.+?\\s+on\\s+(?:public\\.)?${escapeRegExp(table)}\\s+to\\s+`,
        'i'
      );
      assert.ok(
        grantRegex.test(sql),
        `${file}: table \`${table}\` is created without an explicit GRANT ... TO <role> in the same migration. ` +
          'Add a least-privilege GRANT for service_role (never anon or authenticated).'
      );
      checkedTables++;
    }
  }

  // Assert the test actually exercised something once non-grandfathered migrations exist.
  assert.ok(Number.isInteger(checkedTables));
});

test('no migration grants Data API access to the anon role', () => {
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    for (const statement of sql.split(';')) {
      if (!/^\s*grant\b/i.test(statement)) continue;
      assert.ok(
        !/\bto\s+anon\b/i.test(statement),
        `${file}: grants the \`anon\` role Data API access. ` +
          'Unauthenticated table access is prohibited by the migration convention. ' +
          'Add an explicit exception only if the table is intentionally public.'
      );
    }
  }
});

test('no migration grants Data API access to the authenticated role', () => {
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    for (const statement of sql.split(';')) {
      if (!/^\s*grant\b/i.test(statement)) continue;
      assert.ok(
        !/\bto\s+authenticated\b/i.test(statement),
        `${file}: grants Data API access to authenticated. ` +
          'The Milk System uses server-side DATABASE_URL access only; grant service_role only when required.'
      );
    }
  }
});

test('no migration disables row level security', () => {
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    // Check statement-by-statement so a match cannot span multiple migrations.
    const statements = sql.split(';');
    for (const statement of statements) {
      assert.ok(
        !/alter\s+table\b.*disable\s+row\s+level\s+security/is.test(statement),
        `${file}: disables row level security. RLS must not be disabled.`
      );
    }
  }
});
