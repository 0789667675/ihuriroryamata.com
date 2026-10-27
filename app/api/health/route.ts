import { NextResponse } from 'next/server';
import { getDatabaseStatus } from '@/lib/db';
import { query } from '@/lib/postgres';
import { getSupabaseStatus } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUIRED_MIGRATIONS = [
  '001', '002', '003', '004', '005', '006', '007',
  '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018', '019', '020', '021', '022', '023',
];

// A ledger row is not proof that the deployed schema has the columns that the
// notification read/resolve writes depend on. Verify the critical columns too.
const REQUIRED_NOTIFICATION_COLUMNS = [
  'status', 'resolution_code', 'resolution_note', 'resolved_by', 'resolved_at', 'updated_at',
];

export async function GET() {
  const databaseStatus = getDatabaseStatus();
  const database = { configured: databaseStatus.configured, connected: false };
  let migrated = false;
  if (database.configured) {
    try {
      await query('SELECT 1');
      database.connected = true;
      const [{ rows }, { rows: columnRows }] = await Promise.all([
        query(
          'SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])',
          [REQUIRED_MIGRATIONS]
        ),
        query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = ANY($1::text[])`,
          [REQUIRED_NOTIFICATION_COLUMNS]
        ),
      ]);
      const appliedVersions = new Set(rows.map((row: { version: string }) => row.version));
      const notificationColumns = new Set(columnRows.map((row: { column_name: string }) => row.column_name));
      migrated = REQUIRED_MIGRATIONS.every((version) => appliedVersions.has(version))
        && REQUIRED_NOTIFICATION_COLUMNS.every((column) => notificationColumns.has(column));
    } catch {
      // Keep connection details out of the public health response.
    }
  }

  const ok = database.connected && migrated;
  const supabase = getSupabaseStatus();
  return NextResponse.json({
    ok,
    service: 'milk-system-next',
    database,
    // Public liveness does not need the project URL or any provider metadata.
    supabase: { configured: supabase.configured },
    migrated,
  }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
