const { query, getPool } = require('../postgres.js');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role || 'user',
  accountType: user.accountType || 'COLLECTOR',
  accountStatus: user.accountStatus || 'active',
  emailVerified: user.emailVerified ?? true,
  ownerUserId: user.ownerUserId ?? null,
  createdAt: user.createdAt,
});

const createUserWithConnection = async (client, { name, email, passwordHash, role, accountType }) => {
  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash, role, account_type, account_status, email_verified)
     VALUES ($1, $2, $3, $4, $5, 'active', FALSE)
     RETURNING id, name, email, password_hash AS "passwordHash", role,
       account_type AS "accountType", account_status AS "accountStatus",
       email_verified AS "emailVerified", created_at AS "createdAt"`,
    [name, normalizeEmail(email), passwordHash, role, accountType]
  );
  const user = rows[0];
  const { rows: subscriptions } = await client.query(
    `INSERT INTO user_subscriptions (user_id, status, trial_started_at, trial_ends_at, currency)
     VALUES ($1, 'trial', NOW(), NOW() + INTERVAL '15 days', 'RWF')
     RETURNING id, user_id, status, trial_started_at, trial_ends_at, created_at, updated_at`,
    [user.id]
  );
  return { ...user, subscription: subscriptions[0] || null };
};

const repository = {
  async findUserByEmail(email) {
    const normalized = normalizeEmail(email);
    const { rows } = await query(
      `SELECT id, name, email, password_hash AS "passwordHash", role,
       account_type AS "accountType", account_status AS "accountStatus",
       email_verified AS "emailVerified", created_at AS "createdAt"
       FROM users WHERE email = $1 LIMIT 1`,
      [normalized]
    );
    return rows[0] || null;
  },

  async findUserById(id) {
    const { rows } = await query(
      `SELECT id, name, email, password_hash AS "passwordHash", role,
       account_type AS "accountType", account_status AS "accountStatus",
       email_verified AS "emailVerified", created_at AS "createdAt"
       FROM users WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );
    return rows[0] || null;
  },

  async getAccountProfile(id) {
    const { rows } = await query(
      `SELECT id, name, email, phone, national_id AS "nationalId",
       account_number AS "accountNumber", profile_picture AS "profilePicture",
       role, account_type AS "accountType", account_status AS "accountStatus",
       email_verified AS "emailVerified", created_at AS "createdAt"
       FROM users WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );
    return rows[0] || null;
  },

  async updateAccountProfile(id, input) {
    const { rows } = await query(
      `UPDATE users SET name = $1, phone = $2, national_id = $3,
       account_number = $4, profile_picture = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, email, phone, national_id AS "nationalId",
       account_number AS "accountNumber", profile_picture AS "profilePicture",
       role, account_type AS "accountType", account_status AS "accountStatus",
       email_verified AS "emailVerified", created_at AS "createdAt"`,
      [input.name, input.phone, input.nationalId, input.accountNumber, input.profilePicture, Number(id)]
    );
    return rows[0] || null;
  },

  async createEmailChangeToken(userId, pendingEmail, tokenHash, expiresAt) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM email_change_tokens WHERE user_id = $1', [Number(userId)]);
      await client.query(
        `INSERT INTO email_change_tokens (user_id, pending_email, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [Number(userId), pendingEmail, tokenHash, expiresAt]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteEmailChangeTokensByUser(userId) {
    await query('DELETE FROM email_change_tokens WHERE user_id = $1', [Number(userId)]);
  },

  async createRegistrationEmailVerificationToken(userId, tokenHash, expiresAt) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM email_verification_tokens
         WHERE user_id = $1 AND purpose = 'email_verification'`,
        [Number(userId)]
      );
      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'email_verification', $3)`,
        [Number(userId), tokenHash, expiresAt]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteRegistrationEmailVerificationTokensByUser(userId) {
    await query(
      `DELETE FROM email_verification_tokens WHERE user_id = $1 AND purpose = 'email_verification'`,
      [Number(userId)]
    );
  },

  async completeRegistrationEmailVerification(tokenHash) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: tokens } = await client.query(
        `SELECT id, user_id FROM email_verification_tokens
         WHERE token_hash = $1 AND purpose = 'email_verification'
           AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1 FOR UPDATE`,
        [tokenHash]
      );
      const token = tokens[0];
      if (!token) {
        await client.query('COMMIT');
        return null;
      }
      const { rows: users } = await client.query(
        `UPDATE users SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND email_verified = FALSE
         RETURNING id, name, email, role, account_type AS "accountType",
           account_status AS "accountStatus", email_verified AS "emailVerified"`,
        [token.user_id]
      );
      if (!users[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [token.id]);
      await client.query('COMMIT');
      return users[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async completeEmailChange(tokenHash) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: tokens } = await client.query(
        `SELECT id, user_id, pending_email FROM email_change_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1 FOR UPDATE`,
        [tokenHash]
      );
      const token = tokens[0];
      if (!token) {
        await client.query('COMMIT');
        return null;
      }
      const { rows: existing } = await client.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1 FOR KEY SHARE',
        [token.pending_email, token.user_id]
      );
      if (existing[0]) throw Object.assign(new Error('Email is already in use.'), { code: 'EMAIL_IN_USE', statusCode: 409 });
      const { rows: users } = await client.query(
        `UPDATE users SET email = $1, email_verified = TRUE,
           email_verified_at = NOW(), updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email, phone, national_id AS "nationalId",
           account_number AS "accountNumber", profile_picture AS "profilePicture",
           role, account_type AS "accountType", account_status AS "accountStatus",
           email_verified AS "emailVerified", created_at AS "createdAt"`,
        [token.pending_email, token.user_id]
      );
      await client.query('DELETE FROM email_change_tokens WHERE id = $1', [token.id]);
      await client.query('COMMIT');
      return users[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async createUser({ name, email, passwordHash, role = 'user', accountType = 'COLLECTOR', ownerUserId = null }) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const user = await createUserWithConnection(client, { name, email, passwordHash, role, accountType });
      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateUserPassword(userId, passwordHash) {
    const user = await this.findUserById(userId);
    if (!user) {
      return null;
    }
    const { rows } = await query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, name, email, password_hash AS "passwordHash", role,
       account_type AS "accountType", account_status AS "accountStatus",
      email_verified AS "emailVerified", created_at AS "createdAt"`,
      [passwordHash, Number(userId)]
    );
    return rows[0] || null;
  },
};

module.exports = {
  repository,
  normalizeEmail,
  sanitizeUser,
  createUserWithConnection,
  resetInMemoryUsers: () => {},
};
