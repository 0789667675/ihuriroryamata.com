export const databaseUrl = process.env.DATABASE_URL ?? '';

export function getDatabaseStatus() {
  return {
    configured: Boolean(databaseUrl),
    provider: 'Supabase PostgreSQL',
  };
}
