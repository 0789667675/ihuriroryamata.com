if (!process.env.DATABASE_URL) {
  try {
    const { loadEnvConfig } = require('@next/env');
    loadEnvConfig(process.cwd());
  } catch (err) {
    // Fallback if @next/env is unavailable
  }
}

const { getPool, query } = require('../lib/postgres.js');

(async () => {
  let hostname = 'unknown';
  let port = 'unknown';
  try {
    if (process.env.DATABASE_URL) {
      const parsed = new URL(process.env.DATABASE_URL);
      hostname = parsed.hostname;
      port = parsed.port || '5432';
    }
  } catch {}

  console.log(`Checking connection to Supabase database host: ${hostname}:${port}...`);
  try {
    const result = await query('SELECT 1 as connected');
    console.log(`Database connection succeeded. (Host: ${hostname}:${port}, result: ${result.rows[0].connected})`);
    process.exitCode = 0;
  } catch (error) {
    console.error(`Database connection failed on host "${hostname}:${port}":`);
    console.error(`  Error Code: ${error.code || 'UNKNOWN_CODE'}`);
    console.error(`  Error Message: ${error.message || String(error)}`);
    if (error.stack) {
      console.error(`  Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    if (error.code === 'ENOTFOUND') {
      console.error('  Diagnosis: DNS resolution failed. The hostname could not be resolved.');
    } else if (error.code === '28P01' || (error.message && error.message.includes('password authentication failed'))) {
      console.error('  Diagnosis: Password authentication failed. Check credentials in .env.local.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('  Diagnosis: Connection refused. Check port and whether project is running.');
    } else if (error.message && error.message.includes('paused')) {
      console.error('  Diagnosis: Supabase project is paused. Unpause it in the Supabase Dashboard.');
    }
    process.exitCode = 1;
  } finally {
    try {
      await getPool().end();
    } catch {}
  }
})();
