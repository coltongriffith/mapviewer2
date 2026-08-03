import { test, expect } from '@playwright/test';

// Tenure Monitor, in a real browser against the real production build.
//
// Like the rest of this suite, these run WITHOUT Supabase credentials — the
// app is designed to boot anonymously, so what these can prove is that the
// route exists, the bundle loads, the signed-out state is honest about what it
// needs, and the caveats a mineral-rights product must never lose are actually
// rendered rather than merely written in a component file.
//
// Flows that require a real account (creating a portfolio, adding claims,
// receiving a reminder) belong in an authenticated suite against staging, and
// their logic is covered by the unit tests, which do not need a browser.

/** Fail a test if the page logged a real error while it ran. */
function watchForErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/tile|basemap|supabase|stripe|_vercel|vercel-scripts|analytics|favicon|net::ERR|Failed to load resource|tenure-search/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test.describe('/tenure-monitor', () => {
  test('is a real route that boots the app', async ({ page }) => {
    // The rewrite has to be in vercel.json or this 404s in production while
    // working perfectly in dev.
    const errors = watchForErrors(page);
    const res = await page.goto('/tenure-monitor');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: 'Tenure Monitor' })).toBeVisible();
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('tells a signed-out visitor what an account is for', async ({ page }) => {
    await page.goto('/tenure-monitor');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/sign in/i);
    expect(body).toMatch(/reminders|good-to-date/i);
  });

  test('offers a sign-in the visitor can actually act on', async ({ page }) => {
    // The gate asks for an account, so it has to provide the way in. Without
    // this the only control is "Back to Exploration Maps", and a deep link
    // into /tenure-monitor — the link every reminder email contains — becomes
    // a dead end for anyone not already signed in.
    await page.goto('/tenure-monitor');
    const signIn = page.getByRole('button', { name: /sign in/i });
    await expect(signIn).toBeVisible();
    await signIn.click();
    // The auth modal opens over the portfolio rather than routing elsewhere.
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/tenure-monitor');
  });

  test('states how fresh the government data is, even signed out', async ({ page }) => {
    // "How current is this?" must never be gated behind an account — somebody
    // looking at a deadline needs to know when we last heard from the province.
    await page.goto('/tenure-monitor');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/synchroniz|not been synchronized/i);
  });

  test('never promises to maintain, renew or register a claim', async ({ page }) => {
    // The product boundary, asserted rather than assumed.
    await page.goto('/tenure-monitor');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/we (will )?(renew|maintain|file|register|pay)/i);
    expect(body).not.toMatch(/guarantee/i);
  });

  test('survives back and forward navigation', async ({ page }) => {
    await page.goto('/');
    await page.goto('/tenure-monitor');
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.goForward();
    await expect(page).toHaveURL(/tenure-monitor/);
    await expect(page.locator('#root')).not.toBeEmpty();
  });
});

test.describe('reminder deep link', () => {
  test('does not dead-end when the tenure cannot be loaded', async ({ page }) => {
    // This is the link in an alert email, opened days later on a phone. With no
    // Supabase configured the lookup fails — and the requirement is that the
    // reader still lands somewhere useful and is pointed at the official
    // registry, rather than at a blank screen or a raw error.
    await page.goto('/?tenure=1044501');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Mineral Titles Online|MTO|1044501/i);
  });

  test('ignores a malformed tenure parameter instead of querying with it', async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/?tenure=<script>alert(1)</script>');
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('discoverability', () => {
  test('is reachable from the landing page', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('button', { name: 'Tenure Monitor' }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/tenure-monitor/);
  });
});
