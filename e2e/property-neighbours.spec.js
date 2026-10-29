import { test, expect } from '@playwright/test';
import { createInitialProjectState } from '../shared/projectState.js';

// Synthetic geometry only. Hosted coverage of the actual card → recipe →
// stage/export path; the real reference-data result is reviewed separately.
function fixture() {
  const p = createInitialProjectState();
  const layer = (id, x, properties) => ({ id, role: 'claims', type: 'geojson', visible: true,
    name: id, sourceName: `${id}.geojson`, displayName: 'Project Claims', legend: { enabled: true, label: 'Project Claims' },
    style: { fill: '#cccccc', fillOpacity: 0.2, stroke: '#999999' },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry: { type: 'Polygon',
      coordinates: [[[x,50],[x+.02,50],[x+.02,50.02],[x,50.02],[x,50]]] } }] } });
  p.layers = [layer('Example_property_claims', -120, { PROJECT_NAME: 'Example Property', CLAIM_NAME: 'Provided label' }),
    layer('Neighbour_claims', -119.975, { CLAIM_NAME: 'Neighbour label' })];
  p.layout.primaryLayerId = p.layers[0].id;
  p.layout.accentColor = '#c8a538'; p.layout.titleBgColor = '#143d52';
  p.layout.subtitle = 'Illustrative data'; p.layout.footerText = 'Supplied source note';
  return p;
}

test('property template prepopulates supplied content and survives restore', async ({ page }) => {
  const p = fixture();
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript((payload) => {
    if (sessionStorage.getItem('property-fixture')) return;
    localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload, projectId: null, projectName: '' }));
    sessionStorage.setItem('property-fixture', '1');
  }, p);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await page.getByRole('radio', { name: /Property & Neighbours/ }).click();
  await expect(page.locator('.template-zone').getByRole('heading', { name: 'Example Property', exact: true })).toBeVisible();
  await expect(page.locator('.legend-card')).toContainText('Example property claims');
  await expect(page.locator('.legend-card')).toContainText('Neighbour claims');
  await expect(page.locator('.legend-card')).not.toContainText('Project Claims');
  const placement = await page.locator('.template-zone').filter({ has: page.getByRole('heading', { name: 'Example Property', exact: true }) }).evaluate((el) => ({ top: parseFloat(el.style.top), left: parseFloat(el.style.left) }));
  expect(placement).toEqual({ top: 18, left: 18 });
  await expect.poll(() => page.evaluate(() => {
    const el = document.querySelector('.legend-card');
    return el && el.scrollHeight <= el.clientHeight + 1;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mapviewer.draft.v1')).payload.layout.exportRatio)).toBe('landscape');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mapviewer.draft.v1')).payload);
  expect(saved.layers[0].geojson).toEqual(p.layers[0].geojson);
  expect(saved.layers[0].style.fill).toBe('#c8a538');
  expect(saved.layers[0].fx.label.field).toBe('CLAIM_NAME');
  expect(saved.layout.titleBgColor).toBe('#143d52');
  await page.goto('/?intent=resume');
  await expect(page.locator('.template-zone').getByRole('heading', { name: 'Example Property', exact: true })).toBeVisible();
});

test('free-size Preview refreshes tiles across the enlarged stage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const p = fixture();
  await page.addInitScript((payload) => {
    localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload, projectId: null, projectName: '' }));
  }, p);
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-tile').first()).toBeAttached();
  const before = await page.locator('.leaflet-container').first().evaluate((el) => el.clientWidth);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(() => page.locator('.leaflet-container').first().evaluate((el) => el.clientWidth)).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => {
    const map = document.querySelector('.leaflet-container').getBoundingClientRect();
    return Math.max(...[...document.querySelectorAll('.leaflet-tile')].map((el) => el.getBoundingClientRect().right)) >= map.right;
  })).toBe(true);
});
