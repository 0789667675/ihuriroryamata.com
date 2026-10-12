const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { registerUser, loginUser, getCurrentUser } = require('../lib/services/auth-service.js');
const { assertUserCanAccessOwnerScopedResource, buildOwnerScope } = require('../lib/security/ownership.js');
const { requireAccountType } = require('../lib/security/account-access.js');
const { createSessionToken } = require('../lib/security/session.js');
const { getAuthenticatedUser, isSubscriptionRecoveryRequest } = require('../lib/security/authenticate.js');
const { createUserWithConnection } = require('../lib/repositories/userRepository.js');

const makeSession = (userId = null) => ({ userId });

const repository = {
  users: new Map(),
  nextId: 1,
  createUser: async ({ name, email, passwordHash, role = 'user', accountType = 'COLLECTOR', ownerUserId = null }) => {
    const user = {
      id: repository.nextId++,
      name,
      email,
      passwordHash,
      role,
      accountType,
      ownerUserId,
      accountStatus: 'active',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    repository.users.set(user.email.toLowerCase(), user);
    return user;
  },
  findUserByEmail: async (email) => repository.users.get(String(email).toLowerCase()) || null,
  findUserById: async (id) => [...repository.users.values()].find((u) => u.id === Number(id)) || null,
};

test.beforeEach(() => {
  repository.users.clear();
  repository.nextId = 1;
});

test('registerUser creates a user with the correct default role and account type', async () => {
  const user = await registerUser({
    repository,
    name: 'Milk User',
    email: 'milk@example.com',
    password: 'StrongPass123!',
    accountType: 'COLLECTOR',
  });

  assert.equal(user.role, 'user');
  assert.equal(user.accountType, 'COLLECTOR');
  assert.ok(user.passwordHash);
  assert.notEqual(user.passwordHash, 'StrongPass123!');
});

test('registration recognizes the configured authoritative Super Admin email', async () => {
  const previousEmail = process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_EMAIL = 'configured-admin@example.com';
  try {
    const user = await registerUser({
      repository,
      name: 'Configured Admin',
      email: 'CONFIGURED-ADMIN@example.com',
      password: 'StrongPass123!',
    });
    assert.equal(user.role, 'super_admin');
  } finally {
    if (previousEmail === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = previousEmail;
  }
});

test('registration validation and duplicate errors retain safe client statuses', async () => {
  await assert.rejects(
    () => registerUser({ repository, email: 'not-an-email', password: 'StrongPass123!' }),
    (error) => error.statusCode === 400 && error.message === 'A valid email is required.'
  );
  await registerUser({ repository, name: 'Milk User', email: 'milk@example.com', password: 'StrongPass123!' });
  await assert.rejects(
    () => registerUser({ repository, name: 'Milk User', email: 'milk@example.com', password: 'StrongPass123!' }),
    (error) => error.statusCode === 400 && error.message === 'User already exists.'
  );
});

test('registration persistence creates configured initial access in the same transaction connection', async () => {
  const statements = [];
  const client = {
    query: async (text, values) => {
      statements.push({ text, values });
      if (text.includes('INSERT INTO users')) {
        return { rows: [{ id: 15, name: 'Milk User', email: 'milk@example.com', role: 'user', accountType: 'COLLECTOR' }] };
      }
      return { rows: [{ id: 99, user_id: 15, status: 'pending', access_started_at: '2026-10-01T10:00:00.000Z', payment_due_at: '2026-10-15T22:00:00.000Z' }] };
    },
  };
  const result = await createUserWithConnection(client, {
    name: 'Milk User',
    email: 'MILK@example.com',
    passwordHash: 'hashed',
    role: 'user',
    accountType: 'COLLECTOR',
    selectedPlanCode: 'USAGE_0_5000_MONTHLY',
  });
  assert.equal(result.subscription.status, 'pending');
  assert.equal(statements.length, 2);
  assert.match(statements[0].text, /email_verified\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, 'active', FALSE\)/);
  assert.match(statements[1].text, /SELECT \$1, 'pending', u\.created_at/);
  assert.match(statements[1].text, /access_started_at, payment_due_at/);
  assert.deepEqual(statements[1].values, [15, 'USAGE_0_5000_MONTHLY']);
  assert.match(statements[1].text, /u\.created_at AT TIME ZONE policy\.time_zone/);
  assert.match(statements[1].text, /policy\.initial_access_days \+ policy\.grace_period_days/);
});

test('unverified accounts can sign in without being marked email-verified', async () => {
  const unverifiedUsers = new Map();
  const unverifiedRepository = {
    findUserByEmail: async (email) => unverifiedUsers.get(String(email).toLowerCase()) || null,
    createUser: async ({ name, email, passwordHash, role, accountType }) => {
      const user = { id: 81, name, email, passwordHash, role, accountType, emailVerified: false, accountStatus: 'active' };
      unverifiedUsers.set(String(email).toLowerCase(), user);
      return user;
    },
  };
  await registerUser({ repository: unverifiedRepository, name: 'Pending User', email: 'pending@example.com', password: 'StrongPass123!' });

  const session = makeSession();
  const result = await loginUser({ repository: unverifiedRepository, email: 'pending@example.com', password: 'StrongPass123!', session });
  assert.equal(result.user.emailVerified, false);
  assert.equal(session.userId, result.user.id);
});

test('registration does not dispatch verification email or require verification completion', () => {
  const registrationRoute = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'auth', 'register', 'route.js'), 'utf8');
  assert.doesNotMatch(registrationRoute, /sendRegistrationEmailVerification/);
  assert.match(registrationRoute, /verificationRequired: false/);
  assert.match(registrationRoute, /registerUser\(/);
});

test('registerUser rejects duplicate email addresses', async () => {
  await registerUser({ repository, name: 'Milk User', email: 'milk@example.com', password: 'StrongPass123!' });

  await assert.rejects(() => registerUser({
    repository,
    name: 'Another User',
    email: 'milk@example.com',
    password: 'StrongPass123!',
  }), /already exists/i);
});

test('loginUser authenticates valid credentials and returns session user data', async () => {
  await registerUser({ repository, name: 'Milk User', email: 'milk@example.com', password: 'StrongPass123!' });

  const session = makeSession();
  const result = await loginUser({ repository, email: 'milk@example.com', password: 'StrongPass123!', session });

  assert.equal(result.user.email, 'milk@example.com');
  assert.equal(session.userId, result.user.id);
  assert.equal(result.user.role, 'user');
});

test('loginUser rejects invalid credentials before creating a session', async () => {
  await registerUser({ repository, name: 'Milk User', email: 'milk@example.com', password: 'StrongPass123!' });

  const session = makeSession();
  await assert.rejects(() => loginUser({
    repository,
    email: 'milk@example.com',
    password: 'WrongPass123!',
    session,
  }), /invalid email or password/i);

  assert.equal(session.userId, null);
});

test('getCurrentUser rejects unauthenticated sessions', async () => {
  await assert.rejects(() => getCurrentUser({
    repository,
    session: makeSession(),
  }), /not authenticated/i);
});

test('owner scope allows the same user to access their own resource and blocks another user', async () => {
  const ownerA = await registerUser({ repository, name: 'Owner A', email: 'a@example.com', password: 'StrongPass123!' });
  const ownerB = await registerUser({ repository, name: 'Owner B', email: 'b@example.com', password: 'StrongPass123!' });

  assert.equal(buildOwnerScope(ownerA.id), `owner_user_id = ${ownerA.id}`);
  assert.doesNotThrow(() => assertUserCanAccessOwnerScopedResource({
    actorId: ownerA.id,
    ownerUserId: ownerA.id,
    resourceName: 'farmers',
    actorRole: 'user',
  }));

  assert.throws(() => assertUserCanAccessOwnerScopedResource({
    actorId: ownerA.id,
    ownerUserId: ownerB.id,
    resourceName: 'farmers',
    actorRole: 'user',
  }), /does not have access/i);
});

test('business account authorization separates Collector and Collection Center access', () => {
  const collector = { id: 42, role: 'user', accountType: 'COLLECTOR' };
  const dairy = { id: 77, role: 'user', accountType: 'COLLECTION_CENTER' };
  const admin = { id: 1, role: 'super_admin', accountType: 'COLLECTOR' };

  assert.equal(requireAccountType(collector, 'COLLECTOR'), collector);
  assert.equal(requireAccountType(dairy, 'COLLECTION_CENTER'), dairy);
  assert.throws(() => requireAccountType(dairy, 'COLLECTOR'), { code: 'ACCOUNT_TYPE_FORBIDDEN', statusCode: 403 });
  assert.throws(() => requireAccountType(collector, 'COLLECTION_CENTER'), { code: 'ACCOUNT_TYPE_FORBIDDEN', statusCode: 403 });
  assert.throws(() => requireAccountType(admin, 'COLLECTOR'), { code: 'ACCOUNT_TYPE_FORBIDDEN', statusCode: 403 });
});

test('production public launch accepts Collectors but blocks Collection Center provisioning and access', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSessionSecret = process.env.SESSION_SECRET;
  const originalRepo = require('../lib/repositories/userRepository.js').repository;
  const originalFind = originalRepo.findUserById;
  try {
    delete process.env.NODE_ENV;
    const dairy = await registerUser({ repository, name: 'Local Dairy', email: 'dairy@example.com', password: 'StrongPass123!', accountType: 'COLLECTION_CENTER' });
    process.env.NODE_ENV = 'production';
    const collector = await registerUser({ repository, name: 'Launch Collector', email: 'collector@example.com', password: 'StrongPass123!', accountType: 'COLLECTOR' });
    assert.equal(collector.accountType, 'COLLECTOR');
    const collectorSession = makeSession();
    await loginUser({ repository, email: collector.email, password: 'StrongPass123!', session: collectorSession });
    assert.equal(collectorSession.userId, collector.id);
    await assert.rejects(
      () => registerUser({ repository, name: 'Public Dairy', email: 'public-dairy@example.com', password: 'StrongPass123!', accountType: 'COLLECTION_CENTER' }),
      (error) => error.statusCode === 403 && error.code === 'ACCOUNT_TYPE_UNAVAILABLE'
    );
    const session = makeSession();
    await assert.rejects(
      () => loginUser({ repository, email: dairy.email, password: 'StrongPass123!', session }),
      (error) => error.statusCode === 403 && error.code === 'ACCOUNT_TYPE_UNAVAILABLE'
    );
    assert.equal(session.userId, null);
    assert.throws(() => requireAccountType({ id: dairy.id, role: 'user', accountType: 'COLLECTION_CENTER' }, 'COLLECTION_CENTER'), {
      statusCode: 403,
      code: 'ACCOUNT_TYPE_UNAVAILABLE',
    });

    const superAdmin = await registerUser({ repository, name: 'Platform Admin', email: 'platform-admin@example.com', password: 'StrongPass123!', role: 'super_admin', accountType: 'COLLECTION_CENTER' });
    process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
    originalRepo.findUserById = async (id) => Number(id) === dairy.id ? dairy : Number(id) === superAdmin.id ? superAdmin : null;
    const token = createSessionToken({ id: dairy.id, role: 'user' });
    const authenticated = await getAuthenticatedUser({ cookies: { get: () => ({ value: token }) } });
    assert.equal(authenticated, null);
    const adminToken = createSessionToken({ id: superAdmin.id, role: 'super_admin' });
    const authenticatedAdmin = await getAuthenticatedUser({ cookies: { get: () => ({ value: adminToken }) } });
    assert.equal(authenticatedAdmin.role, 'super_admin');
    assert.equal(authenticatedAdmin.accountType, 'COLLECTION_CENTER');
  } finally {
    originalRepo.findUserById = originalFind;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});

test('middleware fails closed without a session secret and exposes only intended public APIs', () => {
  const middleware = fs.readFileSync(path.join(__dirname, '..', 'middleware.ts'), 'utf8');
  assert.match(middleware, /const secret = process\.env\.SESSION_SECRET;/);
  assert.match(middleware, /if \(!secret \|\| secret\.length < 32\) return false;/);
  assert.doesNotMatch(middleware, /development-session-secret/);
  assert.match(middleware, /PUBLIC_API_PATHS = new Set\(\['\/api\/subscription\/payments\/callback', '\/api\/subscription\/plans'\]\)/);
  assert.match(middleware, /PUBLIC_API_PATHS\.has\(pathname\)/);
});

test('subscription API gate keeps recovery routes open and blocks restricted data APIs', () => {
  const request = (pathname, method = 'GET') => ({ url: `https://milk.example.test${pathname}`, method });
  assert.equal(isSubscriptionRecoveryRequest(request('/api/subscription')), true);
  assert.equal(isSubscriptionRecoveryRequest(request('/api/subscription/payments', 'POST')), true);
  assert.equal(isSubscriptionRecoveryRequest(request('/api/notifications/14/read', 'PATCH')), true);
  assert.equal(isSubscriptionRecoveryRequest(request('/api/notifications/evaluate', 'POST')), false);
  assert.equal(isSubscriptionRecoveryRequest(request('/api/farmers')), false);
});

test('super admin access is allowed only for the single authoritative platform account', async () => {
  const superAdmin = await registerUser({ repository, name: 'Platform Admin', email: 'snemeyimana@gmail.com', password: 'StrongPass123!', role: 'super_admin' });
  const user = await registerUser({ repository, name: 'Normal User', email: 'normal@example.com', password: 'StrongPass123!' });

  assert.doesNotThrow(() => assertUserCanAccessOwnerScopedResource({
    actorId: superAdmin.id,
    ownerUserId: user.id,
    resourceName: 'platform-admin',
    actorRole: 'super_admin',
  }));

  assert.throws(() => assertUserCanAccessOwnerScopedResource({
    actorId: user.id,
    ownerUserId: user.id,
    resourceName: 'platform-admin',
    actorRole: 'user',
  }), /permission/i);
});

test('authenticated super admin stays super_admin even when the account type looks collector-like', async () => {
  const user = {
    id: 77,
    name: 'Platform Admin',
    email: 'platform-admin@example.com',
    role: 'super_admin',
    accountType: 'COLLECTOR',
    accountStatus: 'active',
  };
  const originalRepo = require('../lib/repositories/userRepository.js').repository;
  const originalFind = originalRepo.findUserById;
  originalRepo.findUserById = async (id) => (Number(id) === user.id ? user : null);
  process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
  const request = {
    cookies: {
      get: () => ({ value: createSessionToken({ id: user.id, role: user.role }) }),
    },
  };
  const result = await getAuthenticatedUser(request);
  assert.equal(result.role, 'super_admin');
  assert.equal(result.accountType, 'COLLECTOR');
  originalRepo.findUserById = originalFind;
});
