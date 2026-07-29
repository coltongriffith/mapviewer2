import { defineConfig, devices } from '@playwright/test';

// Browser smoke tests (audit P1-14).
//
// The unit suite mocks Supabase and Stripe, so it stays green even when the
// real app fails to boot — a broken bundle, a CSP violation, a missing route,
// or a runtime error on first paint would all ship unnoticed. These tests run
// the actual built app in a real browser.
//
// They deliberately do NOT require Supabase or Stripe credentials: the app is
// designed to run anonymously (localStorage-only) without them, so these cover
// the paths that must work for every visitor. Flows that need a real account
// belong in a separate authenticated suite against staging.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
          // PLAYWRIGHT_CHROMIUM_PATH lets an environment with a preinstalled
          // browser (a different build number than this @playwright/test pins)
          // run the suite without downloading one.
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
        },
      },
    },
  ],

  // Serve the real production build, not the dev server — dev hides bundling
  // and CSP problems that only appear in the built output.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    // Not `vite preview`: it ignores vercel.json, so the rewrites, real-404
    // behaviour and security headers would go untested.
    command: 'node scripts/serve-like-vercel.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
