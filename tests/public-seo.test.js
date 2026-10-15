const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SITE_URL, getPublicRobots, getPublicSitemap } = require('../lib/seo/public-routes.js');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('homepage metadata declares the apex canonical and accurate product description', () => {
  const layout = read('app/layout.tsx');
  const home = read('app/page.tsx');
  const copy = read('lib/i18n/public-copy.ts');

  assert.match(layout, /metadataBase: new URL\('https:\/\/ihuriroryamata\.com'\)/);
  assert.match(layout, /title: "Ihuriro ry'Amata \| Milk System"/);
  assert.match(layout, /url: 'https:\/\/ihuriroryamata\.com\/brand-logo-512\.png'/);
  assert.match(layout, /images: \['https:\/\/ihuriroryamata\.com\/brand-logo-512\.png'\]/);
  assert.match(home, /alternates: \{ canonical: '\/' \}/);
  assert.match(home, /robots: \{ index: true, follow: true \}/);
  assert.doesNotMatch(home, /noindex/i);
  assert.match(layout, /abacunda n’ibigo by’ikusanyirizo gucunga aborozi, ikusanya n’inyandiko z’amata, n’ibaruramari ry’ukwezi/);
  assert.match(copy, /welcomeDescription: 'Ihuriro ry’Amata \(Ihuriroryamata\), rizwi nka Milk System/);
  assert.match(copy, /welcomeDescription: 'Ihuriro ry’Amata \(Ihuriroryamata\), also known as Milk System/);
});

test('robots allows public pages and blocks APIs and the private dashboard', () => {
  const robotsRoute = read('app/robots.ts');
  const robots = getPublicRobots();

  assert.match(robotsRoute, /getPublicRobots/);
  assert.deepEqual(robots.rules, [{ userAgent: '*', allow: '/', disallow: ['/api/', '/dashboard'] }]);
  assert.equal(robots.sitemap, `${SITE_URL}/sitemap.xml`);
  assert.equal(Object.hasOwn(robots, 'host'), false);
});

test('sitemap contains only the canonical public homepage', () => {
  const sitemapRoute = read('app/sitemap.ts');
  const sitemap = getPublicSitemap();

  assert.match(sitemapRoute, /getPublicSitemap/);
  assert.deepEqual(sitemap, [{ url: 'https://ihuriroryamata.com' }]);
  assert.doesNotMatch(JSON.stringify(sitemap), /login|register|dashboard|api|account/i);
});

test('auth and dashboard route groups are excluded from indexing', () => {
  const authLayout = read('app/(auth)/layout.tsx');
  const dashboardLayout = read('app/(dashboard)/layout.tsx');

  for (const layout of [authLayout, dashboardLayout]) {
    assert.match(layout, /robots: \{ index: false, follow: false \}/);
  }
});
