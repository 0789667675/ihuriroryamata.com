const { getPool } = require('../postgres.js');

const safeErrorCode = (value) => String(value || 'JOB_FAILED')
  .replace(/[^A-Za-z0-9_.-]/g, '')
  .slice(0, 120) || 'JOB_FAILED';

const isMissingRunTable = (error) => error && error.code === '42P01';

/**
 * Run a scheduled job under a PostgreSQL advisory lock and persist an honest
 * execution record. If migration 020 has not been applied yet, the job still
 * runs and the lock still prevents overlap; run-history writes are skipped.
 */
const withJobRun = async ({ jobId, run, trigger = 'manual', poolProvider = getPool, now = () => new Date() }) => {
  if (!jobId || typeof run !== 'function') throw new Error('A job id and run function are required.');
  const client = await poolProvider().connect();
  let locked = false;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [jobId]);
    locked = Boolean(rows[0]?.acquired);
    if (!locked) return { skipped: true, reason: 'already_running' };

    const startedAt = now();
    let runId = null;
    try {
      const inserted = await client.query(
        `INSERT INTO platform_job_runs (job_id, status, started_at)
         VALUES ($1, 'running', $2)
         RETURNING id`,
        [jobId, startedAt]
      );
      runId = inserted.rows[0]?.id ?? null;
    } catch (error) {
      if (!isMissingRunTable(error)) throw error;
    }

    try {
      const result = await run();
      if (runId) {
        await client.query(
          `UPDATE platform_job_runs
           SET status = 'succeeded', finished_at = NOW(), summary = $1::jsonb
           WHERE id = $2`,
          [JSON.stringify({ ...(result || {}), trigger }), runId]
        ).catch(() => undefined);
      }
      return { ...(result || {}), runId, startedAt: startedAt.toISOString() };
    } catch (error) {
      if (runId) {
        await client.query(
          `UPDATE platform_job_runs
           SET status = 'failed', finished_at = NOW(), error_code = $1, summary = $2::jsonb
           WHERE id = $3`,
          [safeErrorCode(error.code || error.name), JSON.stringify({ trigger }), runId]
        ).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [jobId]).catch(() => undefined);
    client.release();
  }
};

module.exports = { withJobRun };
