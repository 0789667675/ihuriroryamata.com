const test = require('node:test');
const assert = require('node:assert/strict');

const hasDatabase = Boolean(process.env.DATABASE_URL);

// This test exercises the real PostgreSQL schema inside a transaction that is
// always rolled back. It is skipped unless a database URL is explicitly
// supplied, so the normal unit-test run remains self-contained.
test('notification read state persists, is idempotent, and stays owner-scoped in PostgreSQL', { skip: !hasDatabase }, async () => {
  const { getPool } = require('../lib/postgres.js');
  const NotificationRepository = require('../lib/repositories/notificationRepository.js');
  const pool = getPool();
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const { rows: users } = await client.query('SELECT id FROM users ORDER BY id ASC LIMIT 2');
    assert.ok(users.length >= 2, 'the integration database must contain at least two users');

    const ownerA = Number(users[0].id);
    const ownerB = Number(users[1].id);
    const suffix = `${process.pid}-${Date.now()}`;
    const centerA = `notification-read-test-${suffix}-a`;
    const centerB = `notification-read-test-${suffix}-b`;

    const insertNotification = async (ownerUserId, center, label) => {
      const { rows } = await client.query(
        `INSERT INTO notifications
           (notification_type, title, message, collection_center, owner_user_id, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        ['db_integration_test', `Read persistence ${label}`, 'Temporary transactional integration-test row.', center, ownerUserId, `db-integration-${suffix}-${label}`]
      );
      return rows[0];
    };

    const runQuery = (text, values) => client.query(text, values);
    const notificationA = await insertNotification(ownerA, centerA, 'a');
    const notificationB = await insertNotification(ownerB, centerB, 'b');

    const unreadBefore = await NotificationRepository.getUnreadCount({ ownerUserId: ownerA, center: centerA, runQuery });
    assert.equal(unreadBefore, 1);

    const firstRead = await NotificationRepository.markNotificationRead({ id: notificationA.id, ownerUserId: ownerA, runQuery });
    assert.equal(firstRead.isRead, true);
    assert.equal(firstRead.id, notificationA.id);

    const persistedA = await client.query('SELECT is_read FROM notifications WHERE id = $1', [notificationA.id]);
    assert.equal(persistedA.rows[0].is_read, true);

    const persistedB = await client.query('SELECT is_read FROM notifications WHERE id = $1', [notificationB.id]);
    assert.equal(persistedB.rows[0].is_read, false);

    const unreadAfter = await NotificationRepository.getUnreadCount({ ownerUserId: ownerA, center: centerA, runQuery });
    assert.equal(unreadAfter, 0);

    const repeatedRead = await NotificationRepository.markNotificationRead({ id: notificationA.id, ownerUserId: ownerA, runQuery });
    assert.equal(repeatedRead.isRead, true);
    const duplicateCount = await client.query('SELECT COUNT(*)::integer AS total FROM notifications WHERE id = $1', [notificationA.id]);
    assert.equal(duplicateCount.rows[0].total, 1);

    const crossOwnerRead = await NotificationRepository.markNotificationRead({ id: notificationB.id, ownerUserId: ownerA, runQuery });
    assert.equal(crossOwnerRead, null);
    const persistedBAfterCrossOwner = await client.query('SELECT is_read FROM notifications WHERE id = $1', [notificationB.id]);
    assert.equal(persistedBAfterCrossOwner.rows[0].is_read, false);
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end().catch(() => undefined);
  }
});
