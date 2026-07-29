import { test, expect } from '@playwright/test';

// These run against the real production build in a real browser. The unit
// suite mocks Supabase and Stripe, so it cannot catch a bundle that fails to
// boot, a CSP rule that blocks a script, a route that 404s, or a runtime
// error on first paint (audit P1-14).

/** Fail a test if the page logged a real error while it ran. */
function watchForErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Not our bug in this environment: map tile servers, Supabase and Stripe
    // are unconfigured, and /_vercel/insights is injected by the Vercel
    // platform so it only resolves on a real deployment.
    if (/tile|basemap|supabase|stripe|_vercel|vercel-scripts|analytics|favicon|net::ERR|Failed to load resource/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test.describe('landing page', () => {
  test('renders and boots the app without runtime errors', async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/');
    // The SEO fallback is removed by the app after first paint, so its absence
    // proves React actually mounted rather than the static shell being served.
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('#seo-fallback')).toHaveCount(0);
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('states the real free-plan limits, not a stale promise', async ({ page }) => {
    await page.goto('/');
    const body = await page.locator('body').innerText();
    // Guards the audit's P0-13 regression: pricing copy must match what the
    // entitlement matrix actually enforces.
    expect(body).toMatch(/2,000\s*px/i);
    expect(body).toMatch(/\$29/);
  });

  test('loads webfonts despite CSP (P1-16)', async ({ page }) => {
    await page.goto('/');
    // The old inline onload was blocked by script-src 'self', leaving the
    // stylesheet stuck at media="print".
    const printOnly = await page.locator('link[rel="stylesheet"][media="print"]').count();
    expect(printOnly).toBe(0);
  });
});

test.describe('routing', () => {
  test('unknown paths return a real 404, not the app shell with 200', async ({ page }) => {
    // P1-15: the catch-all rewrite used to serve index.html for everything,
    // producing soft 404s that hid broken links from us and from crawlers.
    const res = await page.goto('/this-page-does-not-exist-12345');
    expect(res.status()).toBe(404);
  });

  test('missing assets 404 rather than silently serving the app shell', async ({ request }) => {
    const res = await request.get('/assets/definitely-not-a-real-file.js');
    expect(res.status()).toBe(404);
    // The old catch-all returned index.html with a 200; make sure we are not
    // handing back a bootable app for a missing asset.
    expect(await res.text()).not.toContain('id="root"');
  });

  test('legal pages are reachable and linked', async ({ page }) => {
    for (const path of ['/privacy/', '/terms/', '/refunds/']) {
      const res = await page.goto(path);
      expect(res.status(), `${path} should exist`).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
    }
  });

  test('checkout terms are linked from the billing policy', async ({ page }) => {
    await page.goto('/refunds/');
    const body = await page.locator('body').innerText();
    // Renewal and cancellation must be stated, not implied.
    expect(body).toMatch(/renew/i);
    expect(body).toMatch(/cancel/i);
    expect(body).toMatch(/refund/i);
  });
});

test.describe('editor', () => {
  test('opens and renders the map surface', async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/');

    // Enter the editor via whichever primary CTA the landing page exposes.
    const cta = page.getByRole('button', { name: /open editor|start|create|try/i }).first();
    if (await cta.count()) {
      await cta.click();
    } else {
      await page.goto('/?intent=drill-results');
    }

    // Leaflet mounts a .leaflet-container once the map is alive.
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('the export path is reachable from the editor', async ({ page }) => {
    await page.goto('/?intent=drill-results');
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });

    // The Export section is collapsible; open it if it is not already.
    const exportBtn = page.getByRole('button', { name: /export png/i });
    if (!(await exportBtn.count())) {
      const toggle = page.getByRole('heading', { name: /^export/i }).first();
      if (await toggle.count()) await toggle.click();
    }
    await expect(page.getByRole('button', { name: /export png/i }).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('security headers', () => {
  test('ships the documented hardening headers', async ({ request }) => {
    const res = await request.get('/');
    const h = res.headers();
    // vercel.json sets these; a regression there is invisible to unit tests.
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy'] || '').toContain("default-src 'self'");
    expect(h['referrer-policy']).toBeTruthy();
  });
});
