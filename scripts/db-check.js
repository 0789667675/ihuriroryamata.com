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
    if (error.code === 'ENOTFOUND') {
      console.error('Note: Hostname could not be resolved. Ensure you have active network connectivity and that outbound traffic is not blocked.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('Note: Connection refused. Ensure the database server is running and accessible on the specified port.');
    } else if (error.message) {
      console.error('Details:', error.message);
    }
    process.exitCode = 1;
  } finally {
    try {
      await getPool().end();
    } catch {}
  }
})();
