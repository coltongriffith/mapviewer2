import { test, expect } from '@playwright/test';

test('workspaces are noindex while public landing pages and sitemaps stay indexable', async ({ request }) => {
  for (const path of ['/admin', '/admin/', '/account', '/dashboard/projects', '/tenure-monitor', '/map/example', '/workspace', '/workspace/p/rails', '/workspace/star-copper/p/rails', '/invite']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'], path).toContain('noindex');
  }
  for (const path of ['/', '/mineral-tenure-monitoring/', '/drill-results-map/', '/companies/got/', '/sitemap.xml', '/sitemap-companies.xml', '/3d', '/teams/', '/blog/how-to-make-a-3d-drill-hole-figure/']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'] || '', path).not.toContain('noindex');
  }
});

test('/3d is indexable, canonical, and has readable text beside the WebGL figure', async ({ page, request }) => {
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  // Out of private beta: no robots meta, no noindex header, its own canonical.
  const raw = await (await request.get('/3d')).text();
  expect(raw).not.toMatch(/noindex/i);
  expect(raw).toContain('<link rel="canonical" href="https://www.explorationmaps.com/3d">');
  await page.goto('/3d');
  expect(await page.locator('meta[name="robots"]').count()).toBe(0);
  await expect(page).toHaveTitle(/3D Drill Hole Figure/);
  // The About section is in the DOM and visible to someone who scrolls step 1.
  const about = page.locator('#about');
  await expect(about.getByRole('heading', { level: 1 })).toHaveText(/drill hole figures for news releases/);
  await about.scrollIntoViewIfNeeded();
  await expect(about).toBeVisible();
  await expect(about.getByRole('link', { name: /How to make a 3D drill hole figure/ })).toHaveAttribute('href', '/blog/how-to-make-a-3d-drill-hole-figure/');
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent());
  expect(ld['@graph'].find(n => n['@type'] === 'SoftwareApplication').offers.price).toBe('0');
});

test('the IndexNow key file is served as plain text', async ({ request }) => {
  const key = '6d5bb92fcd17d7914e6fd6a69b364a1f';
  const response = await request.get(`/${key}.txt`);
  expect(response.status()).toBe(200);
  expect((await response.text()).trim()).toBe(key);
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
