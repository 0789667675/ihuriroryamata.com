const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';

const Accounts = require('../../lib/services/account-service.js');
const { loginUser } = require('../../lib/services/auth-service.js');

const makeFixture = async () => {
  const user = {
    id: 42,
    name: 'Milk User',
    email: 'user@example.com',
    phone: '0788000000',
    nationalId: 'N-42',
    accountNumber: 'ACC-42',
    profilePicture: null,
    role: 'user',
    accountType: 'COLLECTOR',
    accountStatus: 'active',
    emailVerified: true,
    passwordHash: await bcrypt.hash('CurrentPassword123!', 10),
  };
  let pendingEmailChange = null;
  const auditEntries = [];
  const repository = {
    getAccountProfile: async (id) => Number(id) === user.id ? { ...user } : null,
    findUserByEmail: async (email) => email === user.email ? { ...user } : email === 'taken@example.com' || pendingEmailChange?.pendingEmail === email ? { id: 77, email } : null,
    findUserById: async (id) => Number(id) === user.id ? { ...user } : null,
    updateAccountProfile: async (id, input) => {
      if (Number(id) !== user.id) return null;
      Object.assign(user, {
        name: input.name,
        phone: input.phone,
        nationalId: input.nationalId,
        accountNumber: input.accountNumber,
        profilePicture: input.profilePicture,
      });
      return { ...user };
    },
    updateUserPassword: async (id, passwordHash) => {
      if (Number(id) !== user.id) return null;
      user.passwordHash = passwordHash;
      return { ...user };
    },
    createEmailChangeToken: async (userId, pendingEmail, tokenHash, expiresAt) => {
      pendingEmailChange = { userId: Number(userId), pendingEmail, tokenHash, expiresAt, used: false };
    },
    deleteEmailChangeTokensByUser: async (userId) => {
      if (pendingEmailChange?.userId === Number(userId)) pendingEmailChange = null;
    },
    completeEmailChange: async (tokenHash) => {
      if (!pendingEmailChange || pendingEmailChange.used || pendingEmailChange.tokenHash !== tokenHash || pendingEmailChange.expiresAt <= new Date()) return null;
      user.email = pendingEmailChange.pendingEmail;
      user.emailVerified = true;
      pendingEmailChange.used = true;
      pendingEmailChange = null;
      return { ...user };
    },
  };
  const rateLimits = { consumeRateLimit: async () => true };
  const mailer = { messages: [], sendEmailChangeConfirmation: async (message) => mailer.messages.push(message) };
  const audit = async (entry) => auditEntries.push(entry);
  return { user, repository, rateLimits, mailer, audit, auditEntries, get pendingEmailChange() { return pendingEmailChange; } };
};

test('account profile updates the authenticated user fields without changing account type or role', async () => {
  const fixture = await makeFixture();
  const result = await Accounts.updateProfile({
    userId: fixture.user.id,
    input: { name: '  Updated Name ', email: fixture.user.email, phone: '+250 788 000 001', nationalId: '', accountNumber: 'A-2' },
    rateLimits: fixture.rateLimits,
    repository: fixture.repository,
    audit: fixture.audit,
  });
  assert.equal(result.user.name, 'Updated Name');
  assert.equal(result.user.phone, '+250788000001');
  assert.equal(result.user.nationalId, null);
  assert.equal(result.user.accountNumber, 'A-2');
  assert.equal(result.user.role, 'user');
  assert.equal(result.user.accountType, 'COLLECTOR');
  assert.equal(result.emailChangePending, false);
  assert.equal(fixture.auditEntries[0].action, 'profile_updated');
});

test('profile phone rejects non-Rwanda mobile numbers', async () => {
  const fixture = await makeFixture();
  await assert.rejects(() => Accounts.updateProfile({
    userId: fixture.user.id,
    input: { name: fixture.user.name, email: fixture.user.email, phone: '555-0100' },
    rateLimits: fixture.rateLimits,
    repository: fixture.repository,
    audit: fixture.audit,
  }), /valid Rwanda mobile/i);
});

test('email change stays pending until the one-time confirmation token is verified', async () => {
  const fixture = await makeFixture();
  const result = await Accounts.updateProfile({
    userId: fixture.user.id,
    input: { name: fixture.user.name, email: 'new@example.com', phone: fixture.user.phone },
    baseUrl: 'https://milk.example.com',
    language: 'en',
    rateLimits: fixture.rateLimits,
    mailer: fixture.mailer,
    repository: fixture.repository,
    audit: fixture.audit,
  });
  assert.equal(result.emailChangePending, true);
  assert.equal(result.user.email, 'user@example.com');
  assert.equal(fixture.mailer.messages.length, 1);
  assert.equal(fixture.mailer.messages[0].oldEmail, 'user@example.com');
  assert.equal(fixture.mailer.messages[0].pendingEmail, 'new@example.com');
  assert.equal(fixture.mailer.messages[0].language, 'en');
  const verificationToken = new URL(fixture.mailer.messages[0].link).hash.slice(1);
  assert.ok(verificationToken.length >= 40);
  assert.equal(JSON.stringify(result).includes(verificationToken), false);
  const verified = await Accounts.verifyEmailChange({ token: verificationToken, repository: fixture.repository, audit: fixture.audit });
  assert.equal(verified.user.email, 'new@example.com');
  assert.equal(verified.user.emailVerified, true);
  await assert.rejects(() => Accounts.verifyEmailChange({ token: verificationToken, repository: fixture.repository, audit: fixture.audit }), /invalid or expired/i);
});

test('email change refuses addresses in use and cleans a token when mail delivery fails', async () => {
  const fixture = await makeFixture();
  await assert.rejects(() => Accounts.updateProfile({
    userId: fixture.user.id,
    input: { name: fixture.user.name, email: 'taken@example.com' },
    baseUrl: 'https://milk.example.com',
    rateLimits: fixture.rateLimits,
    repository: fixture.repository,
    mailer: fixture.mailer,
    audit: fixture.audit,
  }), (error) => error.statusCode === 409);
  await assert.rejects(() => Accounts.updateProfile({
    userId: fixture.user.id,
    input: { name: fixture.user.name, email: 'new@example.com' },
    baseUrl: 'https://milk.example.com',
    rateLimits: fixture.rateLimits,
    repository: fixture.repository,
    mailer: { sendEmailChangeConfirmation: async () => { throw new Error('provider unavailable'); } },
    audit: fixture.audit,
  }), (error) => error.statusCode === 503);
  assert.equal(fixture.pendingEmailChange, null);
  assert.equal(fixture.user.email, 'user@example.com');
});

test('change password verifies the current password and the new password authenticates', async () => {
  const fixture = await makeFixture();
  await assert.rejects(() => Accounts.changePassword({
    userId: fixture.user.id,
    currentPassword: 'incorrect',
    newPassword: 'NewPassword123!',
    repository: fixture.repository,
    audit: fixture.audit,
  }), (error) => error.code === 'CURRENT_PASSWORD_INCORRECT');
  await assert.rejects(() => Accounts.changePassword({
    userId: fixture.user.id,
    currentPassword: 'CurrentPassword123!',
    newPassword: 'short',
    repository: fixture.repository,
    audit: fixture.audit,
  }), /at least 8 characters/i);
  await Accounts.changePassword({
    userId: fixture.user.id,
    currentPassword: 'CurrentPassword123!',
    newPassword: 'NewPassword123!',
    repository: fixture.repository,
    audit: fixture.audit,
  });
  const result = await loginUser({ repository: fixture.repository, email: fixture.user.email, password: 'NewPassword123!' });
  assert.equal(result.user.id, fixture.user.id);
});

test('the authoritative Super Admin email cannot be changed from account settings', async () => {
  const fixture = await makeFixture();
  fixture.user.role = 'super_admin';
  await assert.rejects(() => Accounts.updateProfile({
    userId: fixture.user.id,
    input: { name: fixture.user.name, email: 'new-admin@example.com' },
    baseUrl: 'https://milk.example.com',
    rateLimits: fixture.rateLimits,
    repository: fixture.repository,
    mailer: fixture.mailer,
    audit: fixture.audit,
  }), (error) => error.statusCode === 403 && error.code === 'SUPER_ADMIN_EMAIL_CHANGE_BLOCKED');
  assert.equal(fixture.mailer.messages.length, 0);
});