const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EmailService = require('../lib/services/email-service.js');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('branded email shell carries the official mark, responsive sizing, and Dairy Blue styling', () => {
  const html = EmailService.renderBrandedEmail({ language: 'rw', body: '<p>Ubutumwa bwo kugerageza.</p>' });
  assert.match(html, /brand-logo-512\.png/);
  assert.match(html, /alt="Ihuriro ry&#39;Amata \| Milk System"/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /#1681ab/);
  assert.match(html, /lang="rw"/);
  assert.match(EmailService.renderBrandedEmail({ language: 'en', body: '<p>Message</p>' }), /lang="en"/);
});

test('supported auth and subscription emails use the branded template and preserve secure links', () => {
  const source = read('lib/services/email-service.js');
  for (const method of [
    'sendPasswordResetCode', 'sendRegistrationEmailVerification', 'sendEmailChangeConfirmation',
    'sendPaymentConfirmation', 'sendSubscriptionReminder', 'sendSubscriptionExpired', 'sendSubscriptionUsageExceeded',
  ]) {
    const start = source.indexOf(`const ${method} =`);
    assert.notEqual(start, -1, `${method} should exist`);
    const next = source.indexOf('\nconst ', start + 1);
    assert.match(source.slice(start, next < 0 ? undefined : next), /renderBrandedEmail/);
  }
  assert.match(source, /href="\$\{safeLink\}"/);
  assert.match(source, /const pendingPaymentNote/);
});

test('subscription emails receive the account language with Kinyarwanda as the fallback', () => {
  const repository = read('lib/repositories/subscriptionRepository.js');
  assert.match(repository, /'language', COALESCE\(u\.language, 'rw'\)/);
  assert.match(repository, /SELECT name, email, language FROM users/);
  assert.match(repository, /language: accountRows\[0\]\.language \|\| 'rw'/);
});
