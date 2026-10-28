#!/usr/bin/env node
'use strict';

/*
 * Read-only live security verification for the Milk System Supabase database.
 *
 * Usage: npm run security:check
 *
 * This intentionally does not modify the database. It checks the security
 * invariants established by migration 024 and exits non-zero when a table or
 * sequence is exposed to the Supabase Data API roles again.
 */

if (!process.env.DATABASE_URL) {
  try {
    const { loadEnvConfig } = require('@next/env');
    loadEnvConfig(process.cwd());
  } catch {
    // Fall through to the normal DATABASE_NOT_CONFIGURED error below.
  }
}

const { getPool, query } = require('../lib/postgres.js');

const API_ROLES = ['anon', 'authenticated'];
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

const normalizeExpression = (value) => String(value || '')
  .toLowerCase()
  .replace(/[()\s]/g, '');

const isDenyExpression = (value) => ['false', '1=0', '0=1'].includes(normalizeExpression(value));

const main = async () => {
  const failures = [];

  const tables = (await query(`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           pg_get_userbyid(c.relowner) AS table_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `)).rows;

  if (tables.length === 0) failures.push('No public tables were found; verify the database connection.');
  for (const table of tables) {
    if (!table.rls_enabled) failures.push(`${table.table_name}: RLS is disabled.`);
  }

  const tableGrants = (await query(`
    SELECT c.relname AS table_name,
           COALESCE(r.rolname, 'PUBLIC') AS grantee,
           p.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) p
    LEFT JOIN pg_roles r ON r.oid = p.grantee
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND (r.rolname IN ('anon', 'authenticated') OR p.grantee = 0)
    ORDER BY c.relname, grantee, p.privilege_type
  `)).rows;
  for (const grant of tableGrants) {
    failures.push(`${grant.table_name}: ${grant.grantee} still has ${grant.privilege_type}.`);
  }

  const sequenceGrants = (await query(`
    SELECT c.relname AS sequence_name,
           COALESCE(r.rolname, 'PUBLIC') AS grantee,
           p.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) p
    LEFT JOIN pg_roles r ON r.oid = p.grantee
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND (r.rolname IN ('anon', 'authenticated') OR p.grantee = 0)
    ORDER BY c.relname, grantee, p.privilege_type
  `)).rows;
  for (const grant of sequenceGrants) {
    failures.push(`${grant.sequence_name}: ${grant.grantee} still has sequence ${grant.privilege_type}.`);
  }

  const apiPolicies = (await query(`
    SELECT tablename, policyname, roles::text AS roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (roles::text LIKE '%anon%' OR roles::text LIKE '%authenticated%')
    ORDER BY tablename, policyname
  `)).rows;
  for (const policy of apiPolicies) {
    const denyAll = isDenyExpression(policy.qual) && isDenyExpression(policy.with_check);
    if (!denyAll) {
      failures.push(`${policy.tablename}: policy ${policy.policyname} is not an explicit deny-all policy.`);
    }
  }

  const defaultGrants = (await query(`
    SELECT d.defaclrole::regrole::text AS owner_role,
           d.defaclobjtype AS object_type,
           COALESCE(r.rolname, 'PUBLIC') AS grantee,
           p.privilege_type
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) p
    LEFT JOIN pg_roles r ON r.oid = p.grantee
    WHERE d.defaclrole = 'postgres'::regrole
      AND n.nspname = 'public'
      AND (r.rolname IN ('anon', 'authenticated') OR p.grantee = 0)
    ORDER BY object_type, grantee, p.privilege_type
  `)).rows;
  for (const grant of defaultGrants) {
    failures.push(`Default privileges for ${grant.owner_role}: ${grant.grantee} still receives ${grant.privilege_type}.`);
  }

  const viewExposure = (await query(`
    SELECT c.relname AS view_name, c.reloptions
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
      AND (
        has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT')
      )
    ORDER BY c.relname
  `)).rows;
  for (const view of viewExposure) {
    const options = Array.isArray(view.reloptions) ? view.reloptions : [];
    if (!options.includes('security_invoker=true')) {
      failures.push(`${view.view_name}: view is exposed without security_invoker=true.`);
    }
  }

  const exposedFunctions = (await query(`
    SELECT p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
    ORDER BY p.proname
  `)).rows;
  for (const fn of exposedFunctions) {
    failures.push(`${fn.function_name}(${fn.arguments}): security-definer function is executable by an API role.`);
  }

  const linterExposure = (await query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
      AND (
        has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT')
      )
    ORDER BY c.relname
  `)).rows;
  for (const table of linterExposure) failures.push(`${table.table_name}: exposed to the Data API with RLS disabled.`);

  const sensitiveColumns = (await query(`
    WITH sensitive_patterns(pattern) AS (
      VALUES ('password'),('passwd'),('pwd'),('passphrase'),('secret'),('secret_key'),('private_key'),
        ('api_key'),('apikey'),('auth_key'),('token'),('jwt'),('access_token'),('refresh_token'),
        ('oauth_token'),('session_token'),('bearer_token'),('auth_code'),('session_id'),('session_key'),
        ('session_secret'),('recovery_code'),('backup_code'),('verification_code'),('otp'),('two_factor'),
        ('2fa_secret'),('2fa_code'),('ssn'),('social_security'),('social_security_number'),
        ('driver_license'),('drivers_license'),('license_number'),('passport_number'),('passport_id'),
        ('national_id'),('tax_id'),('credit_card'),('card_number'),('cvv'),('cvc'),('cvn'),('bank_account'),
        ('account_number'),('routing_number'),('iban'),('swift_code'),('bic'),('health_record'),
        ('medical_record'),('patient_id'),('insurance_number'),('health_insurance'),('medical_insurance'),
        ('treatment'),('mac_address'),('macaddr'),('imei'),('device_uuid'),('pgp_key'),('gpg_key'),('ssh_key'),
        ('certificate'),('license_key'),('activation_key'),('facial_recognition')
    )
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN sensitive_patterns sp ON replace(lower(a.attname), '-', '_') = sp.pattern
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND (
        has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT')
      )
    ORDER BY c.relname, a.attname
  `)).rows;
  for (const column of sensitiveColumns) {
    failures.push(`${column.table_name}.${column.column_name}: sensitive column is exposed to the Data API.`);
  }

  console.log('Database security verification');
  console.log(`  Public tables: ${tables.length}`);
  console.log(`  RLS disabled: ${tables.filter((table) => !table.rls_enabled).length}`);
  console.log(`  Data API table grants: ${tableGrants.length}`);
  console.log(`  Data API sequence grants: ${sequenceGrants.length}`);
  console.log(`  Non-deny API policies: ${apiPolicies.filter((policy) => !(isDenyExpression(policy.qual) && isDenyExpression(policy.with_check))).length}`);
  console.log(`  Default API grants: ${defaultGrants.length}`);
  console.log(`  Exposed views: ${viewExposure.length}`);
  console.log(`  Exposed security-definer functions: ${exposedFunctions.length}`);
  console.log(`  Sensitive exposed columns: ${sensitiveColumns.length}`);

  if (failures.length > 0) {
    console.error('\nFAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: public tables are RLS-protected and the Data API roles have no table/sequence access.');
};

main()
  .catch((error) => {
    console.error('Security verification failed:', error.code || error.name || 'UNKNOWN_ERROR');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      // Ignore pool shutdown errors.
    }
  });
