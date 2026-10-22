import { test, expect } from '@playwright/test';

// The homepage's "New in Exploration Maps" figures and the teams page's workspace and gallery figures: each image
// is served (HTTP 200), decodes, has alt text and reserved dimensions, and below the fold it is lazy.

const NEW = ['3d-block-section', 'studio-fig2', '3d-crew-hello', '3d-drill-crew-claims'];

async function checkImages(page, selector, { lazy = true } = {}) {
  const imgs = page.locator(selector);
  const n = await imgs.count();
  expect(n, selector).toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
    const a = await img.evaluate((el) => ({ alt: el.getAttribute('alt'), w: el.getAttribute('width'), h: el.getAttribute('height'), loading: el.getAttribute('loading'), src: el.currentSrc }));
    expect(a.alt?.trim().length, `${a.src} has alt text`).toBeGreaterThan(10);
    expect(a.w, `${a.src} width`).toMatch(/^\d+$/);
    expect(a.h, `${a.src} height`).toMatch(/^\d+$/);
    if (lazy) expect(a.loading, `${a.src} is lazy`).toBe('lazy');
  }
}

test('homepage: the new figures load, with alt text, dimensions and lazy loading', async ({ page }) => {
  const statuses = new Map();
  page.on('response', (r) => { if (/\/gallery\/(3d-|studio-)/.test(r.url())) statuses.set(r.url().split('/').pop(), r.status()); });
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto('/');
  const section = page.locator('#new');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { level: 3 })).toHaveText(['3D drilling figures', 'Studio style 2D maps', 'Share live 3D figures', 'Company workspace']);
  await checkImages(page, '#new img');
  expect(statuses.size).toBeGreaterThanOrEqual(3);
  for (const [file, status] of statuses) expect(status, file).toBe(200);
  // Responsive WebP with a JPG fallback.
  for (const s of await page.locator('#new source[type="image/webp"]').evaluateAll((els) => els.map((el) => el.getAttribute('srcset')))) expect(s).toMatch(/\.webp \d+w, .*@2x\.webp \d+w$/);
  await expect(section.getByRole('link', { name: /Open the 3D maker/ })).toHaveAttribute('href', '/3d');
});

test('teams page: workspace and gallery figures load, with alt text and dimensions', async ({ page }) => {
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto('/teams/');
  await expect(page.locator('#workspace h2')).toHaveText(/Every property's figures and data in one place/);
  for (const t of ['Properties', '3D figures in the workspace', 'Data files and drill data', 'Published versions', 'Sharing and embeds']) await expect(page.locator('#workspace dt', { hasText: t })).toHaveCount(1);
  await checkImages(page, '#workspace img');
  await checkImages(page, '#examples .gallery img');
  await checkImages(page, '.hero-art img', { lazy: false });
});

test('the new image files are served as images', async ({ request }) => {
  for (const name of NEW) {
    for (const file of [`${name}.webp`, `${name}@2x.webp`, `${name}.jpg`]) {
      const r = await request.get(`/gallery/${file}`);
      expect(r.status(), file).toBe(200);
      expect(r.headers()['content-type'], file).toMatch(/^image\/(webp|jpeg)/);
    }
  }
});
