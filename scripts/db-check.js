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
  try {
    await query('SELECT 1');
    console.log('Database connection succeeded.');
  } catch (error) {
    console.error('Database connection failed:', error.code || 'UNKNOWN_ERROR');
    process.exitCode = 1;
  } finally {
    try {
      await getPool().end();
    } catch {}
  }
})();
