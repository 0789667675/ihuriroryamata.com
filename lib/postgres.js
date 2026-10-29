const { Pool } = require('pg');
const supabaseRootCa = require('./supabase-root-ca-2021.js');

let pool;
let sslFallbackAttempted = false;

const createPool = (rejectUnauthorized) => {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized,
      ca: supabaseRootCa,
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
};

const getPool = () => {
  if (!process.env.DATABASE_URL) {
    const error = new Error('Supabase PostgreSQL DATABASE_URL is not configured.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }

  if (!pool) {
    const defaultReject = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
    pool = createPool(defaultReject);
  }

  return pool;
};

const query = async (text, values = []) => {
  try {
    return await getPool().query(text, values);
  } catch (error) {
    const isSslError = error && (
      error.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      error.code === 'CERT_HAS_EXPIRED' ||
      error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      (typeof error.message === 'string' && /ssl|certificate|cert/i.test(error.message))
    );
    if (isSslError && !sslFallbackAttempted) {
      sslFallbackAttempted = true;
      console.warn('[postgres] SSL verification with pinned CA failed. Falling back to rejectUnauthorized: false.');
      try {
        if (pool) await pool.end();
      } catch {}
      pool = createPool(false);
      return await pool.query(text, values);
    }
    throw error;
  }
};

module.exports = { getPool, query };
