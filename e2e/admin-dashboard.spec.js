import { test, expect } from '@playwright/test';
import { summaryReport } from '../tests/fixtures/summary-report';

// Dedicated configured build; all auth/data responses are local fixtures.
// This exercises real client routing and RPC handling, not production auth.
test.skip(!process.env.E2E_ADMIN, 'Run with playwright.admin.config.js and E2E_ADMIN=1');
async function setup(page, { forbidden = false, failSummary = false } = {}) {
  const calls = [];
  const errors = [];
  let summaryAttempts = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/track', r => r.fulfill({ status: 204 }));
  await page.route('**/api/client-error', r => r.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const fn = path.split('/').at(-1);
    if (path.includes('/rpc/')) calls.push({ fn, params: route.request().postDataJSON() });
    const reply = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (fn === 'admin_get_access') return forbidden ? reply({ code: '42501', message: 'forbidden' },403) : reply(true);
    if (fn === 'admin_get_summary') {
      if (failSummary && summaryAttempts++ === 0) return reply({ code: '503', message: 'Temporary report outage' },503);
      return reply(summaryReport);
    }
    if (fn === 'admin_get_billing_metrics') return reply({ mrr_cents: 5800, paying_subscribers: 2, subscribers: [], invoices: [], upsell_candidates: [], refunds_by_currency: [] });
    if (fn === 'admin_get_session_timeline') return reply({ code: '503', message: 'Timeline temporarily unavailable' },503);
    if (fn === 'user_plans') return reply({ plan: 'pro', source: 'admin', status: 'active' });
    if (fn === 'logout') return route.fulfill({ status: 204 });
    return reply([]);
  });
  await page.addInitScript(() => {
    const user = { id: '00000000-0000-4000-8000-000000000099', email: 'admin@example.test', role: 'authenticated', created_at: '2026-08-01T00:00Z', email_confirmed_at: '2026-08-01T00:00Z', user_metadata: {} };
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now()/1000)+86400 }))}.synthetic-test-signature`;
    localStorage.setItem('sb-example-auth-token', JSON.stringify({ user, access_token: token, refresh_token: 'synthetic-test-refresh', expires_at: Math.floor(Date.now()/1000)+86400, token_type: 'bearer' }));
  });
  return { calls, errors };
}

test('opens the overview without loading the editor; mobile-safe, lazy reports', async ({ page }, info) => {
  const { calls, errors } = await setup(page);
  const scripts = [];
  page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Where they came from' })).toBeVisible();
  expect(scripts.some(url => /\/assets\/(App-|MapCanvas-|vendor-leaflet-|vendor-export-|regionsNA-)/.test(url))).toBe(false);
  expect(calls.filter(c => c.fn.startsWith('admin_')).map(c => c.fn).sort()).toEqual(['admin_get_access','admin_get_summary']);
  const params = calls.find(c => c.fn === 'admin_get_summary').params;
  expect(Object.keys(params).sort()).toEqual(['p_end','p_start','p_tz']);
  expect(Date.parse(params.p_end)).toBeGreaterThan(Date.now()); // today is included
  await expect(page.getByRole('img', { name: 'Real visitors per day' })).toBeVisible();
  await expect(page.getByText('juggernaut exploration')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Nothing (not even a closed tooltip) may widen a phone's layout viewport.
  expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize().width);
  await page.screenshot({ path: info.outputPath('overview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Revenue', exact: true }).click();
  await expect(page.getByText('Estimated ARR · USD')).toBeVisible();
  expect(calls.some(c => c.fn === 'admin_get_billing_metrics')).toBe(true);
  expect(errors).toEqual([]);
});

test('report failures are visible and refresh recovers', async ({ page }) => {
  await setup(page, { failSummary: true });
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toContainText('Temporary report outage');
  await expect(page.getByRole('heading', { name: 'Where they came from' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where they came from' })).toBeVisible();
});

test('a visitor journey opens and timeline failures stay visible', async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Journey', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toContainText('Could not load this timeline');
  expect(calls.find(c => c.fn === 'admin_get_session_timeline')?.params).toEqual({ p_session_id: 'tab-1' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a non-admin cannot load report data', async ({ page }) => {
  const { calls } = await setup(page, { forbidden: true });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  expect(calls.some(c => c.fn === 'admin_get_summary')).toBe(false);
});
