const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const routes = [
  'app/api/cron/notifications/route.js',
  'app/api/cron/subscription-emails/route.js',
  'app/api/cron/subscription-email-outbox/route.js',
];

test('Vercel cron schedules run no more than once per day', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.ok(Array.isArray(config.crons));
  for (const cron of config.crons) {
    const fields = cron.schedule.trim().split(/\s+/);
    assert.equal(fields.length, 5, `${cron.path} must use a five-field cron expression`);
    assert.equal(fields[0], '0', `${cron.path} must run at most once per day`);
    assert.match(fields[1], /^\d{1,2}$/);
    assert.equal(fields[2], '*');
    assert.equal(fields[3], '*');
    assert.equal(fields[4], '*');
  }
  assert.deepEqual(config.crons.map((cron) => cron.path), ['/api/cron/subscription-emails']);
});

test('scheduled jobs accept GET and POST but require the shared CRON_SECRET bearer token', () => {
  for (const routePath of routes) {
    const route = read(routePath);
    assert.match(route, /const secret = process\.env\.CRON_SECRET/);
    assert.match(route, /request\.headers\.get\('authorization'\)/);
    assert.match(route, /timingSafeEqual/);
    assert.match(route, /export async function POST\(request\)/);
    assert.match(route, /export async function GET\(request\)\s*\{\s*return POST\(request\);\s*\}/);
    assert.match(route, /if \(!authorized\(request\)\) return NextResponse\.json\(\{ message: 'Not authorized\.' \}, \{ status: 401 \}\)/);
    assert.doesNotMatch(route, /console\.(log|error)\([^)]*CRON_SECRET/);
  }
});
