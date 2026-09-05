import { test, expect } from '@playwright/test';

test('fresh homepage keeps map and export engines off the network', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.locator('.lm-h1')).toBeVisible();
  expect(requests.filter((url) => /\/assets\/(App-|vendor-leaflet-|vendor-geo-|vendor-export-)/.test(url))).toEqual([]);
  await page.getByRole('banner').getByRole('button', { name: 'Start a map', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('company claims reach investor export and a failed email can be retried', async ({ page }, testInfo) => {
  // Synthetic failure only: never send a real email, even against a preview
  // with Supabase configured. Local builds exercise the unconfigured case.
  await page.route('**/auth/v1/otp*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error_code: 'over_email_send_rate_limit', msg: 'Test delivery failure' }) }));
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/companies/got/');
  await page.getByRole('link', { name: /Open interactive version/ }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.getByRole('button', { name: /Use investor layout/ })).toBeVisible();
  await page.getByRole('button', { name: /Use investor layout/ }).click();
  await page.screenshot({ path: testInfo.outputPath('investor-onboarding.png') });
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Work email')).toBeVisible();
  await page.getByLabel('Work email').fill('growth-test@example.com');
  await page.getByRole('button', { name: 'Email sign-in link & download PNG' }).click();
  await expect(page.getByRole('alert')).toContainText('couldn’t send your sign-in link');
  await page.getByRole('button', { name: 'Retry email' }).click();
  await expect(page.getByRole('alert')).toContainText('couldn’t send your sign-in link');
});

test('drill-results acquisition opens file import immediately', async ({ page }) => {
  await page.goto('/?intent=drill-results');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(/upload|file/i);
});

test('tenure acquisition CTA opens the monitor directly', async ({ page }) => {
  await page.goto('/mineral-tenure-monitoring/');
  await page.getByRole('link', { name: 'Monitor my claims →' }).click();
  await expect(page).toHaveURL(/\/tenure-monitor/);
  await expect(page.locator('.lm-h1')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /tenure|monitor/i }).first()).toBeVisible();
});

test('static pages preserve acquisition when the reader opens the app in another tab', async ({ page, context }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/mining-map-software/?utm_source=partner&utm_campaign=first_maps');
  const first = await page.evaluate(() => window.emAcquisition.get());
  expect(first.utm_source).toBe('partner');
  const next = await context.newPage();
  await next.goto('/?utm_source=blog&utm_campaign=internal');
  await expect(next.locator('.lm-h1')).toBeVisible();
  expect(await next.evaluate(() => window.emAcquisition.get())).toEqual(first);
});
