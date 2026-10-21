import { test, expect } from '@playwright/test';

// The opt-in publication check (export/preflight.js): ordinary exports are
// unchanged; with the check ticked, a figure with a failed imagery tile shows
// its findings before anything downloads, and Export anyway still downloads
// the same file.
test.skip(({ isMobile }) => isMobile, 'Exports are a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  // Imagery tiles answer from here: every tile whose column is a multiple of
  // three fails, the rest are a plain image any export can draw.
  await page.route('https://server.arcgisonline.com/**', (route) => {
    const x = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (Number.isFinite(x) && x % 3 === 0) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG_1PX });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open this map as a live demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cedar Ridge Project', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
});

async function exportPng(page) {
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
}

test('an ordinary export downloads straight away, with no check', async ({ page }) => {
  await expect(page.getByLabel('Publication check before download')).not.toBeChecked();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await exportPng(page);
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole('dialog', { name: 'Publication check' })).toHaveCount(0);
});

test('the publication check lists findings before the download and can be overridden', async ({ page }, testInfo) => {
  await page.getByLabel('Publication check before download').check();
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await exportPng(page);

  const check = page.getByRole('dialog', { name: 'Publication check' });
  await expect(check).toBeVisible({ timeout: 30_000 });
  await expect(check).toContainText(/\d+ warnings? to review before downloading/);
  if (!(await check.locator('details').evaluate((d) => d.open))) await check.getByText('Show details').click();
  await expect(check.getByText(/imagery tiles failed to load and will export blank/)).toBeVisible();
  expect(downloaded).toBe(false);
  if (process.env.F3_SCREENSHOT) await check.screenshot({ path: process.env.F3_SCREENSHOT });
  await page.screenshot({ path: testInfo.outputPath('publication-check.png') });

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await check.getByRole('button', { name: 'Export anyway' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(check).toHaveCount(0);
});
