const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';

const {
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
} = require('../../lib/services/password-reset-service.js');
const { getProvider } = require('../../lib/services/email-service.js');
const { loginUser } = require('../../lib/services/auth-service.js');

const secretHash = (value) => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');

const createFixture = () => {
  const user = { id: 12, email: 'user@example.com', passwordHash: '' };
  const rates = new Map();
  let userLookups = 0;
  let token = null;
  const repository = {
    consumeRateLimit: async (key, limit) => {
      const count = (rates.get(key) || 0) + 1;
      rates.set(key, count);
      return count <= limit;
    },
    createCode: async (values) => {
      if (token && Date.now() - token.createdAt < values.resendSeconds * 1000) return false;
      token = { ...values, purpose: 'password_reset_code', attempts: 0, createdAt: Date.now() };
      return true;
    },
    deleteCode: async (codeHash) => {
      if (token?.codeHash === codeHash) token = null;
    },
    exchangeCode: async (values) => {
      if (!token || token.purpose !== 'password_reset_code' || token.expiresAt <= new Date() || token.attempts >= values.maxAttempts) return false;
      if (token.codeHash !== values.codeHash) {
        token.attempts += 1;
        if (token.attempts >= values.maxAttempts) token = null;
        return false;
      }
      token = { ...token, tokenHash: values.resetTokenHash, purpose: 'password_reset_verified', expiresAt: values.resetExpiresAt };
      return true;
    },
    completeReset: async ({ resetTokenHash, passwordHash }) => {
      if (!token || token.purpose !== 'password_reset_verified' || token.tokenHash !== resetTokenHash || token.expiresAt <= new Date()) return false;
      user.passwordHash = passwordHash;
      token = null;
      return true;
    },
  };
  const users = { findUserByEmail: async (email) => { userLookups += 1; return email === user.email ? user : null; } };
  const mailer = { sentCodes: [], languages: [], sendPasswordResetCode: async ({ code, language }) => { mailer.code = code; mailer.sentCodes.push(code); mailer.languages.push(language); } };
  return { user, repository, users, mailer, get token() { return token; }, get userLookups() { return userLookups; } };
};

test('reset request uses generic responses and sends a six-digit code only through the mail adapter', async () => {
  const fixture = createFixture();
  const result = await requestPasswordReset({ email: ' USER@example.com ', language: 'en', ipAddress: '127.0.0.1', ...fixture });
  assert.equal(result.ok, true);
  assert.match(fixture.mailer.code, /^\d{6}$/);
  assert.equal(JSON.stringify(result).includes(fixture.mailer.code), false);
  assert.notEqual(fixture.token.codeHash, fixture.mailer.code);
  assert.deepEqual(fixture.mailer.languages, ['en']);
});

test('unknown addresses receive the same generic response and no email', async () => {
  const fixture = createFixture();
  const result = await requestPasswordReset({ email: 'missing@example.com', ipAddress: '127.0.0.1', ...fixture });
  assert.deepEqual(result, { ok: true, message: 'If an account matches that email, password reset instructions will be sent.' });
  assert.equal(fixture.mailer.code, undefined);
});

test('code checks are six digits, attempt-limited, and exchange a valid code once', async () => {
  const fixture = createFixture();
  await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  await assert.rejects(() => verifyPasswordResetCode({ email: fixture.user.email, code: '123', ipAddress: '127.0.0.1', ...fixture }), /invalid or expired/i);
  await assert.rejects(() => verifyPasswordResetCode({ email: fixture.user.email, code: '000000', ipAddress: '127.0.0.1', ...fixture }), /invalid or expired/i);
  const resetToken = await verifyPasswordResetCode({ email: fixture.user.email, code: fixture.mailer.code, ipAddress: '127.0.0.1', ...fixture });
  assert.equal(typeof resetToken, 'string');
  assert.notEqual(fixture.token.tokenHash, resetToken);
  await assert.rejects(() => verifyPasswordResetCode({ email: fixture.user.email, code: fixture.mailer.code, ipAddress: '127.0.0.1', ...fixture }), /invalid or expired/i);
});

test('five incorrect codes invalidate the challenge', async () => {
  const fixture = createFixture();
  await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => verifyPasswordResetCode({ email: fixture.user.email, code: '000000', ipAddress: '127.0.0.1', ...fixture }), /invalid or expired/i);
  }
  await assert.rejects(() => verifyPasswordResetCode({ email: fixture.user.email, code: fixture.mailer.code, ipAddress: '127.0.0.1', ...fixture }), /invalid or expired/i);
});

test('reset enforces current password rules, consumes the token, and permits login with the new password', async () => {
  const fixture = createFixture();
  fixture.user.passwordHash = await bcrypt.hash('OldPassword123!', 10);
  await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  const resetToken = await verifyPasswordResetCode({ email: fixture.user.email, code: fixture.mailer.code, ipAddress: '127.0.0.1', ...fixture });
  await assert.rejects(() => resetPassword({ resetToken, password: 'short', repository: fixture.repository }), /at least 8 characters/i);
  await resetPassword({ resetToken, password: 'NewPassword123!', repository: fixture.repository });
  const session = {};
  const result = await loginUser({ repository: fixture.users, email: fixture.user.email, password: 'NewPassword123!', session });
  assert.equal(result.user.email, fixture.user.email);
  await assert.rejects(() => resetPassword({ resetToken, password: 'AnotherPassword123!', repository: fixture.repository }), /invalid or expired/i);
});

test('resend cooldown blocks duplicate mail and per-email request limits stop further lookups', async () => {
  const fixture = createFixture();
  await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  const firstCode = fixture.mailer.code;
  await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  assert.equal(fixture.mailer.code, firstCode);
  for (let request = 0; request < 5; request += 1) {
    await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  }
  assert.equal(fixture.mailer.sentCodes.length, 1);
  assert.equal(fixture.userLookups, 5);
});

test('expired codes cannot be exchanged for a reset token', async () => {
  const fixture = createFixture();
  await requestPasswordReset({ email: fixture.user.email, ipAddress: '127.0.0.1', ...fixture });
  fixture.token.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(() => verifyPasswordResetCode({ email: fixture.user.email, code: fixture.mailer.code, ipAddress: '127.0.0.1', ...fixture }), /invalid or expired/i);
});

test('email provider selection prefers Resend and does not silently default to SMTP', () => {
  const previousProvider = process.env.EMAIL_PROVIDER;
  const previousResend = process.env.RESEND_API_KEY;
  const previousSmtpHost = process.env.SMTP_HOST;
  const previousSmtpPort = process.env.SMTP_PORT;
  const previousSmtpUser = process.env.SMTP_USER;
  const previousSmtpPass = process.env.SMTP_PASS;

  try {
    process.env.EMAIL_PROVIDER = '';
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    assert.equal(getProvider(), 'resend');

    process.env.EMAIL_PROVIDER = 'smtp';
    assert.equal(getProvider(), 'smtp');
  } finally {
    if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previousProvider;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousSmtpHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previousSmtpHost;
    if (previousSmtpPort === undefined) delete process.env.SMTP_PORT;
    else process.env.SMTP_PORT = previousSmtpPort;
    if (previousSmtpUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previousSmtpUser;
    if (previousSmtpPass === undefined) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = previousSmtpPass;
  }
});