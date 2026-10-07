import { NextResponse } from 'next/server';
import { getDatabaseStatus } from '@/lib/db';
import { query } from '@/lib/postgres';
import { getSupabaseStatus } from '@/lib/supabase';

export async function GET() {
  const database = { ...getDatabaseStatus(), connected: false };
  if (database.configured) {
    try {
      await query('SELECT 1');
      database.connected = true;
    } catch {
      // Keep connection details out of the public health response.
    }
  }

  return NextResponse.json({
    ok: database.connected,
    service: 'milk-system-next',
    database,
    supabase: getSupabaseStatus(),
    migrated: true,
  }, { status: database.connected ? 200 : 503 });
}
