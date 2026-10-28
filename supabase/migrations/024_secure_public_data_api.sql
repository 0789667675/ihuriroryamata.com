-- Migration 024: secure the public schema from Supabase Data API access
--
-- Security context
-- ----------------
-- The Milk System reads and writes PostgreSQL only from trusted, server-side
-- Next.js route handlers using DATABASE_URL. The browser authenticates with the
-- application's own signed `milk_session` cookie; Supabase Auth/JWT identities
-- are not used for row access, and no browser code calls the Supabase Data API
-- (PostgREST), Realtime, or Storage for operational data.
--
-- Before this migration, every table in `public` had RLS disabled and the
-- Supabase default ACL granted `anon` and `authenticated` full table privileges.
-- That exposed farmer PII, account credentials, milk records, financial and
-- settlement data, session/token data, and audit data to anyone holding the
-- public anon key.
--
-- This migration is additive and non-destructive:
--   1. Revokes all table and sequence privileges from `anon` and `authenticated`.
--   2. Enables RLS on every existing table in `public`.
--   3. Adds an explicit restrictive deny-all policy for those roles to each table.
--   4. Removes the same roles from future table, sequence, and function default
--      privileges in `public`.
--
-- `postgres` (the table owner used by the server-side application and migration
-- runner) and `service_role` (trusted server-side Supabase role, BYPASSRLS) keep
-- their existing access. No data, tables, columns, functions, views, or business
-- rules are changed. Apply after migrations 019-023 so every pending table is
-- covered. This migration is idempotent and may be re-run after a later
-- migration creates a new public table.

-- 1. Remove Data API privileges from the API-facing roles on existing objects.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 2 and 3. Enable RLS everywhere and add a defensive restrictive deny policy.
-- A restrictive `USING (false)` / `WITH CHECK (false)` policy blocks the roles
-- even if a future grant is accidentally restored. It does not affect the owner
-- (`postgres`) or BYPASSRLS roles such as `service_role`.
DO $$
DECLARE
  table_row record;
  policy_name CONSTANT text := 'milk_system_deny_data_api_access';
BEGIN
  FOR table_row IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_row.schema_name,
      table_row.table_name
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = table_row.schema_name
        AND c.relname = table_row.table_name
        AND p.polname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        policy_name,
        table_row.schema_name,
        table_row.table_name
      );
    END IF;
  END LOOP;
END $$;

-- 4. Ensure future tables/sequences created by the migration owner cannot
-- inherit the Supabase Data API grants that caused this finding.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
