import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { createInitialProjectState } from '../shared/projectState.js';

// Synthetic geometry/content only; real-input native PNGs are reviewed separately.
function fixture(ratio = 'landscape') {
  const p = createInitialProjectState();
  Object.assign(p.layout, { primaryLayerId: 'property', exportRatio: ratio,
    title: 'Provided Project', subtitle: 'Technical Results', footerText: 'Supplied source — illustrative QA',
    accentColor: '#c8a538', titleBgColor: '#143d52', referenceOverlays: {} });
  const line = (id, properties) => ({ id, role: 'roads_access', type: 'geojson', visible: true,
    name: id, style: { stroke: '#735b44', strokeWidth: 2 },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties,
      geometry: { type: 'LineString', coordinates: [[-120.03,50.01],[-119.96,50.01]] } }] } });
  p.layers = [{ id: 'property', role: 'claims', type: 'geojson', visible: true,
    name: 'Property claims', style: { fill: '#cccccc', fillOpacity: 0.2 },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: { PROJECT_NAME: 'Provided Property', CLAIM_NAME: 'Supplied tenure' },
      geometry: { type: 'Polygon', coordinates: [[[-120,50],[-119.98,50],[-119.98,50.02],[-120,50.02],[-120,50]]] } }] } },
  line('Named route', { ROAD_NAME_FULL: 'QA Route A', status: 'Unverified' }),
  line('Unnamed route', { ROAD_NAME_FULL: null, status: 'Unverified' }),
  { ...line('Manual route', { ROAD_NAME_FULL: 'Do not relabel' }), userStyled: true,
    fx: { label: { on: false } } }];
  return p;
}

async function seed(page, payload) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('location-fixture')) return;
    localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload: p, projectId: null, projectName: '' }));
    sessionStorage.setItem('location-fixture', '1');
  }, payload);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await page.getByRole('radio', { name: /Location & Access/ }).click();
}

async function draft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  return JSON.parse(raw?.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw)?.payload;
}

test('access card preserves supplied content and manual routes through restore', async ({ page }) => {
  const p = fixture();
  await seed(page, p);
  await expect(page.locator('.template-zone').getByRole('heading', { name: 'Provided Project', exact: true })).toBeVisible();
  await expect(page.locator('.legend-card')).toContainText(p.layout.footerText);
  await expect(page.locator('.legend-card')).not.toContainText('Railways');
  await expect.poll(async () => (await draft(page))?.layout?.locationAccessVersion).toBe(1);
  const saved = await draft(page);
  expect(saved.layout.subtitle).toBe('Location & Access');
  expect(saved.layout.titleBgColor).toBe(p.layout.titleBgColor);
  expect(saved.layout.referenceOverlays.rail).toBeFalsy();
  expect(saved.layers.map((l) => l.geojson)).toEqual(p.layers.map((l) => l.geojson));
  expect(saved.layers[0].fx.label.text).toBe('Provided Property');
  expect(saved.layers[1].fx.label.field).toBe('ROAD_NAME_FULL');
  expect(saved.layers[2].fx?.label).toBeUndefined();
  expect(saved.layers[3]).toEqual(p.layers[3]);
  await page.goto('/?intent=resume');
  await expect(page.locator('.legend-card')).toContainText(p.layout.footerText);
  expect((await draft(page)).layers).toEqual(saved.layers);
});

test('access portrait without a logo keeps valid furniture and visible source note', async ({ page }) => {
  const p = fixture('portrait');
  await seed(page, p);
  await expect.poll(async () => (await draft(page))?.layout?.locationAccessVersion).toBe(1);
  expect((await draft(page)).layout.exportRatio).toBe('portrait');
  const title = page.locator('.template-zone').filter({ has: page.getByRole('heading', { name: 'Provided Project', exact: true }) });
  expect(await title.evaluate((el) => ({ top: parseFloat(el.style.top), left: parseFloat(el.style.left) }))).toEqual({ top: 18, left: 18 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.legend-card')).toContainText(p.layout.footerText);
  await expect.poll(() => page.locator('.legend-card').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await page.getByRole('img', { name: 'Logo', exact: true }).count()).toBe(0);
});
