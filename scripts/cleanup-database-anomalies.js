if (!process.env.DATABASE_URL) {
  try {
    const { loadEnvConfig } = require('@next/env');
    loadEnvConfig(process.cwd());
  } catch {}
}

const postgres = require('../lib/postgres.js');
const pool = postgres.getPool ? postgres.getPool() : (postgres.connect ? postgres : postgres.pool);

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running database cleanup...');
    // 1. Purge missed-delivery notification spam
    const notifResult = await client.query(`
      DELETE FROM public.notifications 
      WHERE title LIKE 'Amata nta yanditswe ku%' 
         OR message LIKE '%ntabyo kuga%' 
         OR message LIKE '%amata ntabyo%'
         OR notification_type = 'farmer_missed_delivery'
    `);
    console.log(`Deleted ${notifResult.rowCount} spam notification rows.`);

    // 2. Purge rogue TOTAL summary farmers
    const farmerResult = await client.query(`
      DELETE FROM public.farmers 
      WHERE UPPER(TRIM(name)) IN ('TOTAL', 'IGITERANYO', 'SUBTOTAL')
         OR UPPER(TRIM(name)) LIKE 'TOTAL%'
         OR UPPER(TRIM(name)) LIKE 'IGITERANYO%'
    `);
    console.log(`Deleted ${farmerResult.rowCount} rogue summary farmer rows.`);
  } finally {
    client.release();
    if (pool.end) await pool.end();
  }
}

run().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
