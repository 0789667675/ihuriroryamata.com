import { NextResponse } from 'next/server';
import { getDatabaseStatus } from '@/lib/db';
import { query } from '@/lib/postgres';
import { getSupabaseStatus } from '@/lib/supabase';

const REQUIRED_MIGRATIONS = [
  '001', '002', '003', '004', '005', '006', '007',
  '008', '009', '010', '011', '012', '013', '014', '015', '016',
];

export async function GET() {
  const database = { ...getDatabaseStatus(), connected: false };
  let migrated = false;
  if (database.configured) {
    try {
      await query('SELECT 1');
      database.connected = true;
      const { rows } = await query(
        'SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])',
        [REQUIRED_MIGRATIONS]
      );
      const appliedVersions = new Set(rows.map((row: { version: string }) => row.version));
      migrated = REQUIRED_MIGRATIONS.every((version) => appliedVersions.has(version));
    } catch {
      // Keep connection details out of the public health response.
    }
  }

  const ok = database.connected && migrated;
  return NextResponse.json({
    ok,
    service: 'milk-system-next',
    database,
    supabase: getSupabaseStatus(),
    migrated,
  }, { status: ok ? 200 : 503 });
}
