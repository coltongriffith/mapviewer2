import { test, expect } from '@playwright/test';

// /3d reports its use the way the app does (admin "3D & sharing" tab): a page view from /acquisition.js and
// product events to /api/track, without delaying the page.
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.describe.configure({ timeout: 120_000 });

test('opening /3d posts one three_d_opened event and a page view; an export is counted by kind', async ({ page }) => {
  const posts = [];
  // postData, not postDataJSON: a keepalive fetch's body did not come through postDataJSON in this Playwright.
  await page.route('**/api/track', (r) => { posts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 204 }); });
  await page.goto('/3d');
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  const opened = () => posts.filter((p) => p.kind === 'event' && p.event === 'three_d_opened');
  await expect.poll(() => opened().length, { timeout: 15_000 }).toBe(1);
  expect(opened()[0]).toMatchObject({ props: { entry: 'new' }, automated: true }); // playwright is an automated browser
  expect(typeof opened()[0].session_id).toBe('string');
  await expect.poll(() => posts.filter((p) => p.kind === 'pageview' && p.path === '/3d').length).toBe(1);
  // The same tab id for the page view and the event, as in the app.
  expect(posts.find((p) => p.kind === 'pageview').session_id).toBe(opened()[0].session_id);
  // The sample loaded at start is not "data added".
  expect(posts.some((p) => p.event === 'three_d_data_added')).toBe(false);

  await page.evaluate(() => window.EM3D.layersReady());
  await page.evaluate(() => window.EM3D.exportPNG({ view: 'section', download: true }));
  await expect.poll(() => posts.filter((p) => p.event === 'three_d_export_completed').map((p) => p.props.kind)).toEqual(['section']);

  // A reload in the same tab does not count a second open.
  await page.reload();
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.waitForTimeout(3000);
  expect(opened()).toHaveLength(1);
});
