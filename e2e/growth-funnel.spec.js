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
  await page.getByRole('link', { name: /Open this company's claims map/ }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.getByRole('button', { name: /Use investor layout/ })).toBeVisible();
  // Visitors can keep a useful map before they are ready to export it.
  await page.getByRole('button', { name: 'Save to a free account' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sign in on this device to save your map');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
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

test('project-file imports keep upload attribution instead of registry attribution', async ({ page }, testInfo) => {
  const layers = [];
  await page.route('**/api/track', route => {
    const payload = route.request().postDataJSON();
    if (payload?.event === 'layer_added') layers.push(payload.props);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/blog/how-to-search-ontario-mining-claims/');
  await page.getByRole('link', { name: 'Upload my claim file →' }).click();
  await expect(page).toHaveURL(/intent=claims-upload.*region=ontario.*utm_campaign=how-to-search-ontario-mining-claims/);
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles({
    name: 'project-boundary.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Illustrative Ontario boundary' }, geometry: { type: 'Polygon', coordinates: [[[-80.6, 48.45], [-80.59, 48.45], [-80.59, 48.46], [-80.6, 48.45]]] } },
    ] })),
  });
  await expect(page.getByRole('dialog')).toContainText('1 feature found');
  await page.getByRole('button', { name: 'Add to map', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Layers', exact: true })).toContainText('project-boundary.geojson');
  await expect.poll(() => layers.some(x => x.source === 'upload' && x.feature_count === 1)).toBe(true);
  if (process.env.CAPTURE_GROWTH_ARTICLE) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every(tile => tile.complete && tile.naturalWidth > 0 && getComputedStyle(tile).opacity === '1'));
    await page.screenshot({ path: testInfo.outputPath('ontario-upload-before.png') });
  }
  await page.getByRole('button', { name: /Use investor layout/ }).click();
  if (process.env.CAPTURE_GROWTH_ARTICLE) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every(tile => tile.complete && tile.naturalWidth > 0 && getComputedStyle(tile).opacity === '1'));
    await page.screenshot({ path: testInfo.outputPath('ontario-upload-after.png') });
  }
});

test('Yukon empty searches offer grant lookup and an optional help request', async ({ page }) => {
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.route('**/api/claims?*', route => route.fulfill({ json: { type: 'FeatureCollection', features: [], resolution: { status: 'resolved' }, meta: {} } }));
  let submitted;
  await page.route('**/api/feedback', route => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { id: 'test-only' } }); });
  await page.goto('/blog/how-to-search-yukon-quartz-claims/');
  await page.locator('.inline-cta').first().getByRole('link').first().click();
  await expect(page.getByText('Quartz claims only.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Claim search' }).fill('Example holder');
  await page.getByRole('textbox', { name: 'Claim search' }).press('Enter');
  await expect(page.getByText(/No quartz claims matched/)).toBeVisible();
  await page.getByRole('button', { name: 'Need help finding this claim?' }).click();
  await expect(page.getByRole('dialog').getByLabel('Your message')).toContainText('Yukon');
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Thanks — got it' })).toBeVisible();
  expect(submitted.context).toMatchObject({ province: 'yt', outcome: 'empty' });
  expect(submitted.message).not.toContain('Example holder');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Try a grant number' }).click();
  await expect(page.getByRole('textbox', { name: 'Grant number' })).toHaveValue('');
});

test('mobile visitors can preview a company map and start saving it', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173', viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.goto('/companies/got/');
  await page.getByRole('link', { name: /Open this company's claims map/ }).click();
  const banner = page.locator('.mobile-editor-banner');
  await expect(banner.getByRole('button', { name: 'Save to an account' })).toBeVisible();
  await banner.getByRole('button', { name: 'Preview map' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-preview', 'true');
  await banner.getByRole('button', { name: 'Save to an account' }).click();
  await expect(page.getByRole('dialog')).toContainText('open it from your dashboard on desktop');
  await context.close();
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
