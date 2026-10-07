const { Pool } = require('pg');
const supabaseRootCa = require('./supabase-root-ca-2021.js');

let pool;

const getPool = () => {
  if (!process.env.DATABASE_URL) {
    const error = new Error('Supabase PostgreSQL DATABASE_URL is not configured.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true, ca: supabaseRootCa },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  return pool;
};

const query = (text, values = []) => getPool().query(text, values);

module.exports = { getPool, query };
