import { defineConfig, devices } from '@playwright/test';

const testPort = Number(process.env.PLAYWRIGHT_PORT || 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${testPort}`;
const baseHost = new URL(baseURL).hostname;
if (!['127.0.0.1', 'localhost'].includes(baseHost)) {
  throw new Error('Playwright must target a localhost-only test server.');
}

const localTestEnv = {
  APP_ENV: 'playwright-test',
  NEXT_DIST_DIR: '.next-playwright',
  SESSION_SECRET: 'playwright-only-session-secret-with-no-production-value',
  DATABASE_URL: 'postgresql://milk_test:milk_test@127.0.0.1:55432/milk_test',
  DIRECT_URL: 'postgresql://milk_test:milk_test@127.0.0.1:55432/milk_test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
  SUPABASE_SECRET_KEY: 'playwright-only-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'playwright-only-placeholder',
  SUPABASE_PUBLISHABLE_KEY: 'playwright-only-placeholder',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'playwright-only-placeholder',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'playwright-only-placeholder',
  EMAIL_PROVIDER: 'mock',
  RESEND_API_KEY: 'playwright-only-no-send',
  RESEND_FROM: 'test@example.invalid',
  LMBTECH_API_KEY: '',
  LMBTECH_API_SECRET: '',
  LMBTECH_ALLOW_REAL_PAYMENTS: 'false',
  NEXT_PUBLIC_APP_URL: baseURL,
  FRONTEND_URL: baseURL,
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${testPort}`,
    url: `${baseURL}/manifest.webmanifest`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: localTestEnv,
  },
});
