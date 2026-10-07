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
