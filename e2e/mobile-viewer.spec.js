import { test, expect } from '@playwright/test';

// On a phone, claims from a company page or a registry search open in the
// claims viewer (map, list, claim details, hand-off), not the editor. Desktop
// keeps the editor.

const PHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

const square = (lng, lat, d = 0.02) => ({
  type: 'Polygon',
  coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]],
});
const claim = (id, name, ha, due, lng, lat) => ({
  type: 'Feature',
  geometry: square(lng, lat),
  properties: { TENURE_NUMBER_ID: id, CLAIM_NAME: name, OWNER_NAME: 'EXAMPLE MINING LTD.', AREA_IN_HECTARES: ha, GOOD_TO_DATE: due, TITLE_TYPE_DESCRIPTION: 'Mineral' },
});

async function phone(browser) {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173', ...PHONE });
  const page = await context.newPage();
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  return { context, page };
}

test('a company page opens the claims viewer on a phone', async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto('/companies/got/');
  await page.getByRole('link', { name: /Open this company's claims map/ }).click();

  const viewer = page.getByRole('region', { name: 'Claims viewer' });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByRole('heading', { level: 1 })).not.toBeEmpty();
  await expect(viewer).toContainText(/\d+ claims · /);
  await expect(page.locator('.mobile-editor-banner')).toHaveCount(0);

  // List → a claim → its details, framed on the map.
  await viewer.getByRole('button', { name: 'List', exact: true }).click();
  await viewer.locator('.mcv-row').first().click();
  const details = viewer.getByRole('region', { name: 'Claim details' });
  await expect(details).toContainText(/Good to \d{4}-\d{2}-\d{2}/);
  await expect(details.getByRole('link', { name: /Verify in Mineral Titles Online/ })).toHaveAttribute('href', /mtonline\.gov\.bc\.ca/);
  await details.getByRole('button', { name: 'Close claim details' }).click();
  await expect(details).toHaveCount(0);

  // The editor is one choice away.
  await viewer.getByRole('button', { name: 'Edit on desktop' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit this map on a computer' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit on this phone' }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.mobile-editor-banner')).toBeVisible();
  await context.close();
});

test('a registry search on a phone opens the claims viewer', async ({ browser }) => {
  const { context, page } = await phone(browser);
  const features = [
    claim('1000001', 'NORTH 1', 500.5, '2026-12-01', -128.10, 56.10),
    claim('1000002', 'NORTH 2', 250, '2031-06-30', -128.08, 56.10),
  ];
  await page.route('**/api/claims?*', (route) => route.fulfill({ json: { type: 'FeatureCollection', features, resolution: { status: 'resolved' }, meta: {} } }));
  await page.goto('/');
  await page.getByPlaceholder('Enter a claim number, property name, or owner').fill('Example Mining');
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();

  await page.getByText('Select All').first().click();
  await page.getByRole('button', { name: /^Add .* to map/ }).click();

  const viewer = page.getByRole('region', { name: 'Claims viewer' });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Example Mining Ltd.');
  await expect(viewer).toContainText('2 claims · British Columbia');
  await expect(viewer.locator('.mcv-map path.leaflet-interactive')).toHaveCount(2);

  // The list groups by good-to date and filters by name or number.
  await viewer.getByRole('button', { name: 'List', exact: true }).click();
  await expect(viewer.getByRole('heading', { name: /Good for 1\+ years · 1/ })).toBeVisible();
  await viewer.getByLabel('Filter claims').fill('1000002');
  await expect(viewer.locator('.mcv-row')).toHaveCount(1);
  await expect(viewer.locator('.mcv-row')).toContainText('NORTH 2');
  await viewer.locator('.mcv-row').click();
  const details = viewer.getByRole('region', { name: 'Claim details' });
  await expect(details.getByRole('heading', { name: 'NORTH 2' })).toBeVisible();
  await expect(details).toContainText('Example Mining Ltd.');
  await expect(details).toContainText('Tenure 1000002');
  await context.close();
});

test('a long result list on a phone can be added without scrolling or ticking', async ({ browser }) => {
  const { context, page } = await phone(browser);
  const features = Array.from({ length: 18 }, (_, i) => claim(String(1000100 + i), `ROW ${i + 1}`, 200, '2031-06-30', -128 + i * 0.021, 56.1));
  await page.route('**/api/claims?*', (route) => route.fulfill({ json: { type: 'FeatureCollection', features, resolution: { status: 'resolved' }, meta: {} } }));
  await page.goto('/');
  await page.getByPlaceholder('Enter a claim number, property name, or owner').fill('Example Mining');
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();

  const add = page.getByRole('button', { name: /^Add all 18 claims to map|^Add all \d+ areas to map \(18 claims\)/ });
  await expect(add).toBeEnabled();
  await expect(add).toBeInViewport({ ratio: 1 });
  await add.click();
  const viewer = page.getByRole('region', { name: 'Claims viewer' });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer).toContainText('18 claims');
  await context.close();
});

test('desktop keeps the editor for a company page', async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/?claims=GOT&company=Example');
  await expect(page.getByText('Example — Mineral Claims').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Claims viewer' })).toHaveCount(0);
});

// Production, 19–20 Oct (release 165ef81f, '/' on phones): "Cannot use 'in' operator to search for
// '_leaflet_id' in null" adding the claims, then "Cannot read properties of undefined (reading
// '_removePath')" removing the map. Leaflet's default renderer is null where its SVG test
// (SVGSVGElement#createSVGRect) fails; the viewer now picks a renderer that works, or leaves the claims
// off the map (src/utils/leafletRenderers.js).
async function searchOnPhone(browser, { initScript } = {}) {
  const { context, page } = await phone(browser);
  if (initScript) await context.addInitScript(initScript);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const reports = [];
  await page.route('**/api/client-error', (route) => { reports.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
  const features = [
    claim('1000001', 'NORTH 1', 500.5, '2026-12-01', -128.10, 56.10),
    claim('1000002', 'NORTH 2', 250, '2031-06-30', -128.08, 56.10),
  ];
  await page.route('**/api/claims?*', (route) => route.fulfill({ json: { type: 'FeatureCollection', features, resolution: { status: 'resolved' }, meta: {} } }));
  await page.goto('/');
  await page.getByPlaceholder('Enter a claim number, property name, or owner').fill('Example Mining');
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();
  await page.getByText('Select All').first().click();
  await page.getByRole('button', { name: /^Add .* to map/ }).click();
  const viewer = page.getByRole('region', { name: 'Claims viewer' });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  return { context, page, viewer, errors, reports };
}

async function leaveAtOnce(page, viewer) {
  // Straight back out, before the map has settled: the unmount runs map.remove().
  await viewer.getByRole('button', { name: 'New search' }).click();
  await expect(viewer).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

test('the claims viewer opens and closes on a phone without a Leaflet error', async ({ browser }) => {
  const { context, page, viewer, errors, reports } = await searchOnPhone(browser);
  await expect(viewer.locator('.mcv-map path.leaflet-interactive')).toHaveCount(2);
  await leaveAtOnce(page, viewer);
  expect(errors).toEqual([]);
  expect(reports.filter((r) => r.kind !== 'warning')).toEqual([]);
  await context.close();
});

test('a phone browser whose SVG test fails draws the claims on Canvas, and unmounts cleanly', async ({ browser }) => {
  const { context, page, viewer, errors, reports } = await searchOnPhone(browser, {
    initScript: () => { delete SVGSVGElement.prototype.createSVGRect; },
  });
  await expect(viewer).toContainText('2 claims');
  await expect(viewer.locator('.mcv-map canvas')).toHaveCount(1);
  await leaveAtOnce(page, viewer);
  expect(errors).toEqual([]);
  expect(reports.filter((r) => r.kind !== 'warning')).toEqual([]);
  await context.close();
});
