import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
  ...base,
  testMatch: 'admin-dashboard.spec.js',
  projects: [
    { ...base.projects[0], name: 'admin-desktop' },
    { ...base.projects[0], name: 'admin-mobile', use: { ...base.projects[0].use, ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: { ...base.webServer, command: 'node scripts/serve-like-vercel.mjs', env: { E2E_DIST: 'dist-auth-check' } },
});
