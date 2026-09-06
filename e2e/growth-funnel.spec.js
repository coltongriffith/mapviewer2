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
  expect(requests.filter((url) => /\/assets\/(vendor-export-|vendor-geo-|vendor-zip-)/.test(url))).toEqual([]);
});

test('sample maps remain demo activity rather than real customer imports', async ({ page }) => {
  const layers = [];
  await page.route('**/api/track', (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.event === 'layer_added') layers.push(payload.props);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/?demo=sample');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect.poll(() => layers.length).toBeGreaterThanOrEqual(2);
  expect(layers.every(layer => layer.source === 'demo')).toBe(true);
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

test('drill-results search entry accepts a CSV and creates a real-data layer', async ({ page }) => {
  const layers = [];
  await page.route('**/api/track', route => {
    const p = route.request().postDataJSON();
    if (p.event === 'layer_added') layers.push(p.props);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/drill-results-map/');
  await page.locator('.lp .inline-cta').getByRole('link', { name: 'Upload my data →' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const input = page.getByRole('dialog').locator('input[type="file"]');
  await expect(input).toHaveAttribute('accept', /\.csv/);
  await input.setInputFiles({ name: 'drill-collars.csv', mimeType: 'text/csv', buffer: Buffer.from('Hole ID,Longitude,Latitude\nDH-01,-125.2,54.1\nDH-02,-125.201,54.102\n') });
  await expect.poll(() => layers.some(x => x.source === 'csv' && x.feature_count === 2)).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Layers', exact: true })).toContainText('drill-collars.csv');
  await expect(page.getByRole('button', { name: /Use investor layout/ })).toBeVisible();
});

test('project-file imports keep upload attribution instead of registry attribution', async ({ page }) => {
  const layers = [];
  await page.route('**/api/track', route => {
    const payload = route.request().postDataJSON();
    if (payload?.event === 'layer_added') layers.push(payload.props);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/?intent=claims-upload');
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles({
    name: 'project-boundary.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Project area' }, geometry: { type: 'Polygon', coordinates: [[[-125.2, 54.1], [-125.19, 54.1], [-125.19, 54.11], [-125.2, 54.1]]] } },
    ] })),
  });
  await expect(page.getByRole('dialog')).toContainText('1 feature found');
  await page.getByRole('button', { name: 'Add to map', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Layers', exact: true })).toContainText('project-boundary.geojson');
  await expect.poll(() => layers.some(x => x.source === 'upload' && x.feature_count === 1)).toBe(true);
});

test('CSV uploads with unfamiliar columns reach the existing column mapper', async ({ page }) => {
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.goto('/?intent=csv');
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles({ name: 'custom-collars.csv', mimeType: 'text/csv', buffer: Buffer.from('Sample,Position A,Position B\nDH-01,-125.2,54.1\nDH-02,-125.201,54.102\n') });
  await expect(page.getByRole('heading', { name: 'Map CSV columns' })).toBeVisible();
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Position A', exact: true }) }).getByRole('combobox').selectOption('x');
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Position B', exact: true }) }).getByRole('combobox').selectOption('y');
  await page.getByRole('button', { name: 'Import drillholes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Layers', exact: true })).toContainText('custom-collars.csv');
});

test('tenure acquisition CTA opens the monitor directly', async ({ page }) => {
  await page.goto('/mineral-tenure-monitoring/');
  await page.locator('.lp .inline-cta').getByRole('link', { name: 'Monitor my claims →' }).click();
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
