const { Pool } = require('pg');
const supabaseRootCa = require('./supabase-root-ca-2021.js');

let pool;
let sslFallbackAttempted = false;

const getDatabaseHost = () => {
  try {
    if (process.env.DATABASE_URL) {
      return new URL(process.env.DATABASE_URL).hostname;
    }
  } catch {}
  return 'unknown';
};

const createPool = (rejectUnauthorized) => {
  // If rejectUnauthorized is false, connect without pinned CA to accept rotated pooler certs
  const sslConfig = rejectUnauthorized
    ? { rejectUnauthorized: true, ca: supabaseRootCa }
    : { rejectUnauthorized: false };

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig,
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
    // Default to rejectUnauthorized: false for Supabase pooler endpoints to avoid TLS cert chain rejections
    const host = getDatabaseHost();
    const isPooler = host.includes('pooler.supabase.com') || host.includes('supabase.co');
    const defaultReject = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true'
      ? true
      : (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' || isPooler ? false : true);

    pool = createPool(defaultReject);
  }

  return pool;
};

const query = async (text, values = []) => {
  const host = getDatabaseHost();
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
      console.warn(`[postgres] SSL verification with pinned CA failed on host "${host}" (${error.code || error.message}). Falling back to rejectUnauthorized: false.`);
      try {
        if (pool) await pool.end();
      } catch {}
      pool = createPool(false);
      return await pool.query(text, values);
    }

    if (error && error.code) {
      console.error(`[postgres] Database query error on host "${host}" [${error.code}]: ${error.message}`);
    }
    throw error;
  }
};

const poolProxy = {
  getPool,
  query,
  connect: (...args) => getPool().connect(...args),
  end: (...args) => (pool ? pool.end(...args) : Promise.resolve()),
};

module.exports = {
  getPool,
  query,
  pool: poolProxy,
  default: poolProxy,
  connect: (...args) => getPool().connect(...args),
};

