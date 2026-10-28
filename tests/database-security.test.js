const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('migration 024 removes Data API access and enables deny-by-default RLS', () => {
  const migration = read('supabase/migrations/024_secure_public_data_api.sql');

  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated/i
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated/i
  );
  assert.match(migration, /ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY/i);
  assert.match(
    migration,
    /CREATE POLICY %I ON %I\.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING \(false\) WITH CHECK \(false\)/i
  );
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*?REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated/i
  );
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*?REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated/i
  );
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*?REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated/i
  );
  assert.doesNotMatch(
    migration,
    /DROP TABLE|TRUNCATE|DELETE FROM|DROP COLUMN|DISABLE ROW LEVEL SECURITY/i
  );
});

test('pending table migrations are already server-only and deny Data API roles', () => {
  for (const relative of [
    'supabase/migrations/019_import_batches.sql',
    'supabase/migrations/020_platform_job_runs.sql',
    'supabase/migrations/022_farmer_field_configuration.sql',
  ]) {
    const migration = read(relative);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/i, `${relative} must enable RLS`);
    assert.match(
      migration,
      /CREATE POLICY milk_system_deny_data_api_access[\s\S]*?TO anon, authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/i,
      `${relative} must define the deny-all API policy`
    );
  }
});

test('health requires the security migration and the live verifier is available', () => {
  const health = read('app/api/health/route.ts');
  assert.match(health, /'024'/);

  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts['security:check'], 'node scripts/verify-database-security.js');
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'verify-database-security.js')));
});

test('migration documentation no longer recommends authenticated Data API grants', () => {
  const readme = read('supabase/migrations/README.md');
  assert.match(readme, /does \*\*not\*\* use the Supabase Data API/i);
  assert.match(readme, /\| `authenticated` \| \*\*None\*\* \|/);
  assert.match(readme, /\| `anon` \| \*\*None\*\* \|/);
  assert.match(readme, /Never grant `anon` or `authenticated`/i);
  assert.match(readme, /re-run `024`/i);
});

test('operational source does not query Supabase tables from the browser', () => {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.next-build', '.next-playwright'].includes(entry.name)) continue;
        walk(absolute);
      } else if (/\.(?:js|ts|tsx)$/.test(entry.name)) {
        files.push(absolute);
      }
    }
  };
  walk(path.join(root, 'app'));
  walk(path.join(root, 'components'));
  walk(path.join(root, 'lib'));
  walk(path.join(root, 'utils'));

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\bsupabase\s*\.\s*from\s*\(/,
      `${path.relative(root, file)} must not query Supabase tables directly`
    );
  }
});
