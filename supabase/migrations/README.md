# Milk System — Supabase migrations

## Supabase Data API grant change (effective October 30, 2026)

Supabase no longer grants Data API access on newly created tables in the `public`
schema by default. Every migration that creates a new `public` table must therefore
**explicitly define the required Data API privileges in the same migration**.

This rule is enforced by `tests/migration-grants.test.js`, which runs as part of
`npm test`.

## Migration authoring convention

For every new table created in the `public` schema, the migration must follow this
order:

1. `CREATE TABLE [IF NOT EXISTS]` — define the table.
2. `GRANT` — explicit, least-privilege Data API privileges (same migration).
3. `ENABLE ROW LEVEL SECURITY` / policies — only where the project's security
   model calls for it. **This project does not use PostgreSQL RLS anywhere; row
   isolation is enforced at the application layer through `owner_user_id`. Do not
   add RLS without also adding policies and verifying server-side access.**
4. Indexes, constraints, triggers.

### Role grants for this project

All Milk System data access happens through authenticated, server-side API routes
(there is no unauthenticated public Data API usage):

| Role | Privileges | Rationale |
|------|-----------|-----------|
| `authenticated` | `SELECT, INSERT, UPDATE, DELETE` | Signed-in users access tables through the application. Row visibility is controlled by the application-layer `owner_user_id` isolation, not by this grant. |
| `service_role` | `ALL` | Server-side operations (cron jobs, payments, admin actions) that legitimately bypass application row scoping. |
| `anon` | **None by default** | No part of the Milk System exposes unauthenticated Data API access. Granting `anon` requires a deliberate exception and a code-review decision. |

Example migration creating a normal authenticated table:

```sql
CREATE TABLE IF NOT EXISTS public.example_table (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.example_table
TO authenticated;

GRANT ALL
ON public.example_table
TO service_role;

CREATE INDEX IF NOT EXISTS idx_example_table_owner_user
ON public.example_table (owner_user_id);
```

### Existing migrations (001–018)

Migrations `001_initial_schema.sql` through `018_notification_operations.sql` are
historical records created before this convention. They are intentionally left
untouched — do not edit, rewrite, or renumber them.

`019_import_batches.sql` follows the explicit-grant convention above. It stores only
import row status metadata (row numbers, status/error codes/messages, and created farmer
IDs), never source documents or OCR text.

`020_platform_job_runs.sql` follows the same convention. It stores operational
execution metadata for scheduled jobs (job id, status, timestamps, counts, trigger,
and error code), never email bodies, recipients, or secrets. It grants access only
to `service_role`; no `authenticated` or `anon` grant is needed because cron routes
run server-side.

If an existing production table genuinely needs a grant correction, add a **new
forward-only migration** containing only the `GRANT` statements; never modify an
applied migration file.

## How migrations are applied

This repository has no Supabase CLI configuration (`config.toml`) and no automated
migration-generation script. Migration files are hand-authored SQL, applied through
the deployment's approved migration process (database owner reconciles the
`supabase_migrations.schema_migrations` ledger, backs up, and applies the ordered
files). See `docs/system-capabilities-and-gaps.md` for the deployment runbook.
