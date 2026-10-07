const crypto = require('node:crypto');
const { getPool } = require('../postgres.js');

const passwordResetRepository = {
  async consumeRateLimit(identifierHash, limit, windowSeconds) {
    if (crypto.randomInt(0, 128) === 0) {
      await getPool().query("DELETE FROM auth_rate_limits WHERE window_started_at < NOW() - INTERVAL '2 days'");
    }
    const { rows } = await getPool().query(
      `INSERT INTO auth_rate_limits (identifier_hash, window_started_at, request_count)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (identifier_hash) DO UPDATE SET
         request_count = CASE
           WHEN auth_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 second') THEN 1
           ELSE auth_rate_limits.request_count + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.window_started_at <= NOW() - ($2 * INTERVAL '1 second') THEN NOW()
           ELSE auth_rate_limits.window_started_at
         END
       RETURNING request_count`,
      [identifierHash, windowSeconds]
    );
    return Number(rows[0].request_count) <= limit;
  },

  async createCode({ userId, codeHash, expiresAt, resendSeconds }) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!userResult.rows[0]) {
        await client.query('COMMIT');
        return false;
      }
      const activeResult = await client.query(
        `SELECT created_at FROM password_reset_tokens
         WHERE user_id = $1 AND purpose IN ('password_reset_code', 'password_reset_verified')
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [userId]
      );
      const lastCreated = activeResult.rows[0]?.created_at;
      if (lastCreated && Date.now() - new Date(lastCreated).getTime() < resendSeconds * 1000) {
        await client.query('COMMIT');
        return false;
      }
      await client.query(
        `DELETE FROM password_reset_tokens
         WHERE user_id = $1 AND purpose IN ('password_reset_code', 'password_reset_verified')`,
        [userId]
      );
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, purpose, expires_at, attempt_count)
         VALUES ($1, $2, 'password_reset_code', $3, 0)`,
        [userId, codeHash, expiresAt]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async exchangeCode({ userId, codeHash, resetTokenHash, resetExpiresAt, maxAttempts }) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, token_hash, attempt_count FROM password_reset_tokens
         WHERE user_id = $1 AND purpose = 'password_reset_code'
           AND used_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [userId]
      );
      const token = result.rows[0];
      if (!token || Number(token.attempt_count) >= maxAttempts) {
        await client.query('COMMIT');
        return false;
      }
      const stored = Buffer.from(token.token_hash, 'hex');
      const submitted = Buffer.from(codeHash, 'hex');
      const matches = stored.length === submitted.length && crypto.timingSafeEqual(stored, submitted);
      if (!matches) {
        await client.query(
          `UPDATE password_reset_tokens SET attempt_count = attempt_count + 1,
             used_at = CASE WHEN attempt_count + 1 >= $2 THEN NOW() ELSE used_at END
           WHERE id = $1`,
          [token.id, maxAttempts]
        );
        await client.query('COMMIT');
        return false;
      }
      await client.query(
        `UPDATE password_reset_tokens
         SET token_hash = $1, purpose = 'password_reset_verified', expires_at = $2, verified_at = NOW()
         WHERE id = $3`,
        [resetTokenHash, resetExpiresAt, token.id]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteCode(codeHash) {
    const client = await getPool().connect();
    try {
      await client.query('DELETE FROM password_reset_tokens WHERE token_hash = $1 AND purpose = \'password_reset_code\'', [codeHash]);
    } finally {
      client.release();
    }
  },

  async completeReset({ resetTokenHash, passwordHash }) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND purpose = 'password_reset_verified'
           AND used_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [resetTokenHash]
      );
      const token = result.rows[0];
      if (!token) {
        await client.query('COMMIT');
        return false;
      }
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, token.user_id]);
      await client.query('DELETE FROM password_reset_tokens WHERE id = $1', [token.id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = { passwordResetRepository };