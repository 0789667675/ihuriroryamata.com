const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('authenticated header owns the compact language switcher and Account no longer duplicates it', () => {
  const workspace = read('app/workspace.tsx');
  const header = workspace.slice(workspace.indexOf('<div className="topbar-right">'), workspace.indexOf('<div className="notification-menu"'));
  assert.match(header, /topbar-language-switch/);
  assert.match(header, /changeLanguage\('rw'\)/);
  assert.match(header, /changeLanguage\('en'\)/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('account-settings-preferences'), workspace.indexOf('account-settings-preferences') + 1200), /public-language-switch/);
  assert.match(workspace, /const changeLanguage = async \(nextLanguage: 'rw' \| 'en'\)/);
  assert.match(workspace, /await api\('\/api\/auth\/profile', json\('PATCH', \{ language: nextLanguage \}\)\)/);
  assert.match(workspace, /sessionStorage\.setItem\('milk-session-user'/);
});

test('header and Account use the same successful-response logout handler and redirect', () => {
  const workspace = read('app/workspace.tsx');
  const logout = workspace.slice(workspace.indexOf('const logout = async () =>'), workspace.indexOf('const logout = async () =>') + 900);
  assert.match(logout, /await api<\{ ok: boolean \}>\('\/api\/auth\/logout'/);
  assert.match(logout, /if \(!result\?\.ok\) throw/);
  assert.match(logout, /sessionStorage\.removeItem\('milk-session-user'\)/);
  assert.match(logout, /window\.location\.replace\('\/login'\)/);
  assert.match(workspace, /onClick=\{\(\) => void logout\(\)\}/);
  assert.match(workspace, /disabled=\{logoutBusy\}/);
});

test('verification pages consume hash tokens without middleware or server redirects', () => {
  const component = read('components/auth/email-verification.tsx');
  assert.match(component, /window\.location\.hash/);
  assert.match(component, /\/api\/auth\/email-verification\/verify/);
  assert.match(component, /\/api\/auth\/verify-email-change/);
  assert.match(component, /window\.history\.replaceState/);
  assert.match(component, /usePublicLanguage/);

  for (const pagePath of ['app/(auth)/verify-email/page.tsx', 'app/(auth)/verify-email-change/page.tsx']) {
    const page = read(pagePath);
    assert.match(page, /EmailVerification/);
    assert.doesNotMatch(page, /redirect\(/);
    assert.doesNotMatch(page, /getAuthenticatedUserFromCookieStore/);
  }
  const middleware = read('middleware.ts');
  assert.doesNotMatch(middleware, /AUTH_PAGES = new Set\(\[[^\]]*verify-email/);
  assert.match(middleware, /'\/api\/cron'/);
});

test('registration and profile verification links resolve a canonical configured base URL', () => {
  const helper = read('lib/config/public-url.js');
  assert.match(helper, /NEXT_PUBLIC_APP_URL \|\| env\.FRONTEND_URL/);
  assert.match(helper, /if \(env\.NODE_ENV === 'production'\) return null/);
  for (const routePath of ['app/api/auth/register/route.js', 'app/api/auth/profile/route.js', 'app/api/auth/email-verification/request/route.js']) {
    assert.match(read(routePath), /resolvePublicBaseUrl\(\{ request \}\)/);
  }
});
