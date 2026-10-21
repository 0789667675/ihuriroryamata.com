const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const routes = [
  'app/api/cron/notifications/route.js',
  'app/api/cron/subscription-emails/route.js',
];

test('both scheduled jobs accept GET and POST but require the shared CRON_SECRET bearer token', () => {
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
