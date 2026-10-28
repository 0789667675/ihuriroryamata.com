# Milk System — Supabase migrations

## Supabase Data API security model (October 2026 hardening)

The Milk System does **not** use the Supabase Data API (PostgREST), Supabase Auth,
Realtime, or Storage for operational data. Browser requests are authenticated by the
application's own signed `milk_session` cookie, and every database read/write runs in
a trusted, server-side Next.js route through the `DATABASE_URL` PostgreSQL connection.
Tenant isolation is still enforced in the application layer through `owner_user_id`
and the server-side ownership checks.

Because the Data API is not an application data path, `anon` and `authenticated` must
have **no** table or sequence privileges in `public`. Migration
`024_secure_public_data_api.sql` enforces this and enables RLS with an explicit,
restrictive deny-all policy on every public table. The connection owner (`postgres`)
and the trusted `service_role` bypass RLS and retain their existing server-side access.
There are no application views or custom RPC functions that expose these tables.

This rule is enforced by `tests/database-security.test.js` and
`tests/migration-grants.test.js`, which run as part of `npm test`. A live deployment
can be checked with `npm run security:check`.

## Migration authoring convention

For every new table created in the `public` schema, the migration must follow this
order:

1. `CREATE TABLE [IF NOT EXISTS]` — define the table.
2. `ENABLE ROW LEVEL SECURITY` — enable RLS immediately.
3. `CREATE POLICY ... AS RESTRICTIVE FOR ALL TO anon, authenticated
   USING (false) WITH CHECK (false)` — explicit deny for API-facing roles.
4. `GRANT` — only `service_role`, and only when a server-side service-role path
   genuinely needs the table. Never grant `anon` or `authenticated`.
5. Indexes, constraints, triggers.

The server-side `postgres` owner used by `DATABASE_URL` bypasses RLS. Do not use
`FORCE ROW LEVEL SECURITY` on application tables: that would apply RLS to the owner
and break server-side access unless matching owner policies are added.

### Role grants for this project

| Role | Privileges | Rationale |
|------|-----------|-----------|
| `postgres` | Table owner; full server-side access | The application's trusted server-side `DATABASE_URL` connection. Row isolation is enforced by the application before queries are built. |
| `anon` | **None** | No unauthenticated Data API access exists. |
| `authenticated` | **None** | The application does not use Supabase JWT identities or browser-side table access. Signed-in users reach data only through authenticated server routes. |
| `service_role` | Only when explicitly required | Trusted server-only role (BYPASSRLS) for operations that genuinely need it. It must never be exposed to the browser. |

Example migration creating a service-role-only table:

```sql
CREATE TABLE IF NOT EXISTS public.example_table (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.example_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.example_table
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Only if a trusted server-side service-role path needs this table:
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.example_table
TO service_role;

CREATE INDEX IF NOT EXISTS idx_example_table_owner_user
ON public.example_table (owner_user_id);
```

### Existing migrations

Migrations `001_initial_schema.sql` through `018_notification_operations.sql`, plus
`021_farmer_numbers.sql` and `023_tenant_scoped_farmer_unique_indexes.sql`, are
historical records and are intentionally left untouched — do not edit, rewrite, or
renumber them.

The still-pending `019_import_batches.sql`, `020_platform_job_runs.sql`, and
`022_farmer_field_configuration.sql` were aligned with this server-only convention as
part of the same security change: they enable RLS, add the deny-all policy for API
roles, and no longer grant `authenticated` access. Migration
`024_secure_public_data_api.sql` retrofits the same protection to every table that was
already applied in production (`001`-`018`). If a new public table is created outside
this convention, re-run `024`; it is idempotent and safe to re-run.

If an existing production table genuinely needs a grant correction, add a **new
forward-only migration**; never modify an applied migration file.

## How migrations are applied

This repository has no Supabase CLI configuration (`config.toml`) and no automated
migration-generation script. Migration files are hand-authored SQL, applied through
the deployment's approved migration process (database owner reconciles the
`supabase_migrations.schema_migrations` ledger, backs up, and applies the ordered
files). See `docs/system-capabilities-and-gaps.md` for the deployment runbook.
