import { test, expect } from '@playwright/test';

// The signed-in home, in a real browser against the real production build.
//
// These run WITHOUT Supabase credentials, so what they can prove is the part
// that breaks in production while working perfectly in dev: the route exists,
// the rewrite is in vercel.json, the bundle loads, and a signed-out visitor
// gets an explanation rather than an empty shell.
//
// The dashboard's own behaviour — project search, sort, the tenure attention
// card — is covered by tests/dashboard.test.jsx, which does not need a browser.

/** Fail a test if the page logged a real error while it ran. */
function watchForErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/tile|basemap|supabase|stripe|_vercel|vercel-scripts|analytics|favicon|net::ERR|Failed to load resource/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test.describe('/dashboard', () => {
  test('is a real route that boots the app', async ({ page }) => {
    // Without the rewrite this 404s in production and works in dev, which is
    // the worst way for a route to be wrong.
    const errors = watchForErrors(page);
    const res = await page.goto('/dashboard');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

});

test.describe('/dashboard signed out', () => {
  test('offers a way in rather than a blank page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /sign in to see your maps/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in \/ create account/i })).toBeVisible();
  });

  test('lets the visitor get back to the marketing page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /back/i }).click();
    // Back returns to the landing page, which must stay reachable — it is the
    // only route an anonymous visitor has to everything else.
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the marketing page still belongs to anonymous visitors', () => {
  test('serves the landing page at / without redirecting', async ({ page }) => {
    // The redirect to /dashboard is gated on a signed-in user. If that gate
    // ever inverts, every anonymous visitor and every crawler lands on a
    // sign-in card instead of the page the entire SEO effort points at.
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /sign in to see your maps/i })).toHaveCount(0);
  });
});
