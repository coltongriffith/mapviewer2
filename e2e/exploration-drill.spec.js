import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { createInitialProjectState } from '../shared/projectState.js';

// Synthetic geometry and importer-normalized IDs only. No real assay/result data.
function fixture() {
  const p = createInitialProjectState();
  p.layout.referenceOverlays = {};
  p.layers = [{ id: 'collars', type: 'points', role: 'drillholes', visible: true,
    name: 'qa-collars.csv', sourceName: 'qa-collars.csv', displayName: 'Planned Drillholes',
    legend: { enabled: true, label: 'Planned Drillholes' },
    style: { markerColor: '#143d52', markerFill: '#ffffff', markerSize: 10 },
    geojson: { type: 'FeatureCollection', features: [0,1,2].map((i) => ({ type: 'Feature',
      properties: { _holeid: `QA-0${i+1}`, label: `QA-0${i+1}`, Note: 'Synthetic collar-only QA' },
      geometry: { type: 'Point', coordinates: [-120+i*0.01,50+i*0.01] } })) } }];
  return p;
}

async function draft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  return JSON.parse(raw?.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw)?.payload;
}

async function open(page, payload) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('drill-template-fixture')) return;
    localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload: p, projectId: null, projectName: '' }));
    sessionStorage.setItem('drill-template-fixture', '1');
  }, payload);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await page.getByRole('radio', { name: /Exploration & Drill/ }).click();
}

test('drill card labels supplied collars once, supports history and restores source data', async ({ page }) => {
  const p = fixture();
  await open(page, p);
  await expect(page.locator('.template-zone').getByRole('heading', { name: 'Exploration & Drill', exact: true })).toBeVisible();
  await expect(page.locator('.map-callout')).toHaveCount(3);
  await expect(page.locator('.legend-card')).toContainText('Drill collars');
  await expect(page.locator('.legend-card')).not.toContainText('Planned');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.map-callout')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.map-callout')).toHaveCount(3);
  await page.getByRole('radio', { name: /Exploration & Drill/ }).click();
  await expect(page.locator('.map-callout')).toHaveCount(3);
  await expect.poll(async () => (await draft(page))?.callouts?.length).toBe(3);
  const saved = await draft(page);
  expect(saved.layers[0].geojson).toEqual(p.layers[0].geojson);
  expect(saved.layers[0].style).toEqual(p.layers[0].style);
  expect(saved.callouts.map((c) => c.text).sort()).toEqual(['QA-01','QA-02','QA-03']);
  expect(saved.callouts.every((c) => c.subtext === '')).toBe(true);
  await page.goto('/?intent=resume');
  await expect(page.locator('.map-callout')).toHaveCount(3);
  expect((await draft(page)).layers[0].geojson).toEqual(p.layers[0].geojson);
});

test('portrait drill rail retains provided science, source text and pinned result annotations', async ({ page }) => {
  const p = fixture();
  Object.assign(p.layout, { title: 'Cedar Ridge Project', subtitle: 'Target Generation — Soil Geochemistry & Drilling',
    footerText: 'Aurora Ridge Minerals Corp. | Cedar Ridge Project, BC',
    titleBgColor: '#143d52', accentColor: '#c8a538', exportRatio: 'portrait' });
  p.layers.push({ id: 'soils', role: 'soil_samples', type: 'points', visible: true,
    legend: { enabled: true, label: 'Provided soil samples', group: 'Geochemistry' },
    classification: { field: 'Cu_ppm', mode: 'graduated', classes: [{ max: 50, color: '#f2d435', label: '≤ 50' }, { max: null, color: '#983ab9', label: '> 50' }] },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { Cu_ppm: 30 }, geometry: { type: 'Point', coordinates: [-119.99,50.01] } }] } });
  p.callouts = [{ id: 'provided-result', layerId: 'collars', featureId: '[-120,50]', type: 'boxed',
    text: 'Provided result — illustrative QA', subtext: 'Supplied text, not calculated',
    anchor: { lat: 50, lng: -120 }, offset: { x: 30, y: -20 }, isManualPosition: true }];
  await open(page, p);
  await expect(page.locator('.legend-card')).toContainText(/Geochemistry · Cu_ppm/i);
  await expect.poll(async () => (await draft(page))?.layout?.explorationDrillVersion).toBe(1);
  const saved = await draft(page);
  expect(saved.layers.map((l) => l.geojson)).toEqual(p.layers.map((l) => l.geojson));
  expect(saved.layers[1].classification).toEqual(p.layers[1].classification);
  expect(saved.callouts.find((c) => c.id === 'provided-result')).toEqual(p.callouts[0]);
  expect(saved.layout.titleBgColor).toBe(p.layout.titleBgColor);
  expect(saved.layout.exportRatio).toBe('portrait');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const title = page.getByRole('heading', { name: p.layout.title, exact: true });
  await expect.poll(() => title.evaluate((e) => e.parentElement.scrollHeight <= e.parentElement.clientHeight + 1)).toBe(true);
  const source = page.getByText(p.layout.footerText, { exact: true });
  await expect(source).toBeVisible();
  await expect.poll(() => source.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
  await expect.poll(() => page.locator('.legend-card').evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
});
