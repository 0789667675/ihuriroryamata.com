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

test('supported auth and subscription emails use the shared branded content and plain-text fallback', () => {
  const source = read('lib/services/email-service.js');
  const contentBuilder = source.slice(source.indexOf('const renderEmailContent ='), source.indexOf('const sendWelcomeEmail ='));
  assert.match(contentBuilder, /renderBrandedEmail/);
  assert.match(contentBuilder, /renderPlainTextEmail/);
  for (const method of [
    'sendWelcomeEmail', 'sendPasswordResetCode', 'sendRegistrationEmailVerification', 'sendEmailChangeConfirmation',
    'sendPaymentConfirmation', 'sendSubscriptionReminder', 'sendSubscriptionExpired', 'sendSubscriptionUsageExceeded',
  ]) {
    const start = source.indexOf(`const ${method} =`);
    assert.notEqual(start, -1, `${method} should exist`);
    const next = source.indexOf('\nconst ', start + 1);
    const block = source.slice(start, next < 0 ? undefined : next);
    assert.match(block, /renderEmailContent/, `${method} should share the email layout`);
    assert.match(block, /text:\s*\w+\.text/, `${method} should send a plain-text fallback`);
    assert.match(block, /html:\s*\w+\.html/, `${method} should send branded HTML`);
  }
  assert.match(source, /const pendingPaymentNote/);
});

test('shared email content escapes HTML while keeping readable text and both language shells', () => {
  const content = EmailService.renderEmailContent({
    language: 'en',
    greeting: "Hello <script>alert('x')</script>,",
    paragraphs: ['Your account is ready & waiting.'],
    details: [{ label: 'Amount', value: '5,000 <RWF>' }],
    code: { label: 'Reset code', value: '123456' },
    action: { label: 'Open Milk System', url: 'https://example.test/login?next=/milk' },
  });
  assert.match(content.text, /Hello <script>alert\('x'\)<\/script>,/);
  assert.match(content.text, /Your account is ready & waiting\./);
  assert.match(content.text, /Amount: 5,000 <RWF>/);
  assert.match(content.text, /Reset code: 123456/);
  assert.match(content.text, /Open Milk System: https:\/\/example\.test\/login\?next=\/milk/);
  assert.doesNotMatch(content.html, /<script>/);
  assert.match(content.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.match(content.html, /5,000 &lt;RWF&gt;/);
  assert.match(content.html, /href="https:\/\/example\.test\/login\?next=\/milk"/);
  assert.match(content.html, /max-width:600px/);
  assert.match(content.html, /lang="en"/);
  assert.match(content.html, /@media \(max-width:480px\)/);
  assert.match(EmailService.renderEmailContent({ language: 'rw', paragraphs: ['Ubutumwa.'] }).html, /lang="rw"/);
});

test('registration UI reports the honest verification and welcome delivery state', () => {
  const workspace = read('app/workspace.tsx');
  assert.match(workspace, /api<\{ verificationEmailSent\?: boolean; welcomeEmailSent\?: boolean \}>/);
  assert.match(workspace, /registration\.verificationEmailSent === false/);
  assert.match(workspace, /registration\.welcomeEmailSent === false/);
  assert.match(workspace, /registrationVerificationEmailFailed/);
  assert.match(workspace, /registrationWelcomeEmailFailed/);
  assert.match(workspace, /registrationEmailSent/);
  assert.match(workspace, /onLogin\(result\.user, signInNotice\)/);
});

test('subscription emails receive the account language with Kinyarwanda as the fallback', () => {
  const repository = read('lib/repositories/subscriptionRepository.js');
  assert.match(repository, /'language', COALESCE\(u\.language, 'rw'\)/);
  assert.match(repository, /SELECT name, email, language FROM users/);
  assert.match(repository, /language: accountRows\[0\]\.language \|\| 'rw'/);
});

test('registration sends welcome and verification email in the selected supported locale', () => {
  const route = read('app/api/auth/register/route.js');
  assert.match(route, /const emailLanguage = body\.language === 'en' \? 'en' : 'rw'/);
  assert.equal((route.match(/language: emailLanguage/g) || []).length, 2);
  assert.match(route, /sendRegistrationEmailVerification/);
  assert.match(route, /sendWelcomeEmail/);
  assert.doesNotMatch(route, /language: 'rw'/);
});
