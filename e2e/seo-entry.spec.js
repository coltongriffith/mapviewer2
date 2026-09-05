import { test, expect } from '@playwright/test';

test('workspaces are noindex while public landing pages and sitemaps stay indexable', async ({ request }) => {
  for (const path of ['/admin', '/admin/', '/account', '/dashboard/projects', '/tenure-monitor', '/map/example']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'], path).toContain('noindex');
  }
  for (const path of ['/', '/mineral-tenure-monitoring/', '/drill-results-map/', '/companies/got/', '/sitemap.xml', '/sitemap-companies.xml']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'] || '', path).not.toContain('noindex');
  }
});

test('the good-to-date guide opens the tenure monitor from its main action', async ({ page }) => {
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.goto('/blog/how-to-track-bc-mineral-claim-good-to-dates/');
  await page.locator('article .inline-cta').first().getByRole('link', { name: 'Monitor my claims →' }).click();
  await expect(page).toHaveURL(/\/tenure-monitor/);
  await expect(page.getByRole('heading', { name: /tenure|monitor/i }).first()).toBeVisible();
});

test('search-page map images use existing responsive WebP with reserved space', async ({ page }) => {
  const pngRequests = [];
  page.on('request', r => { if (/\/gallery\/.*\.png$/.test(r.url())) pngRequests.push(r.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/blog/exploration-maps-vs-qgis/');
  const hero = page.locator('article .blog-figure img').first();
  await expect(hero).toHaveAttribute('srcset', /\.webp \d+w/);
  await expect.poll(() => hero.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await hero.evaluate(img => ({ src: img.currentSrc, width: img.width, height: img.height }))).toMatchObject({ src: expect.stringMatching(/\.webp$/), width: expect.any(Number), height: expect.any(Number) });
  await expect(hero).toHaveAttribute('width', /\d+/);
  await expect(hero).toHaveAttribute('height', /\d+/);
  expect(pngRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('a mobile search landing offers its matching action before the long guide', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/shapefile-to-map/');
  const action = page.locator('.lp .inline-cta').getByRole('link', { name: 'Upload my data →' });
  await expect(action).toBeInViewport();
  await expect(action).toHaveAttribute('href', /intent=claims-upload/);
  await expect(page.locator('.lp-plan-note')).toContainText('small Exploration Maps credit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
