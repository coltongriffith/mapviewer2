import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createInitialProjectState } from '../shared/projectState.js';

// The link an AI connector returns with each map (/map/<id>?download=png)
// opens the share page and downloads the map as a PNG, in the browser.
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client with isolated RPC fixtures');

const base = createInitialProjectState();
const state = {
  ...base,
  layout: { ...base.layout, title: 'Star Copper Project', basemap: 'blank', insetEnabled: false, exportSettings: { ...base.layout.exportSettings, filename: 'star-copper', pixelRatio: 1 } },
  layers: [{
    id: 'claims', name: 'Claims', type: 'polygons', role: 'claims', visible: true,
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-130, 55], [-129.9, 55], [-129.9, 55.1], [-130, 55.1], [-130, 55]]] } }] },
    style: { fill: '#c65322', fillOpacity: 0.3, stroke: '#c65322', strokeWidth: 2 },
    legend: { enabled: true, label: 'Claims' },
  }],
};

// Also covers a map with no saved view on a phone, which used to throw
// "Invalid LatLng (NaN, NaN)" when the panel padding was wider than the map.
test('a ?download=png share link downloads the map as a PNG', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ status: 200, json: fn === 'get_shared_map' ? state : [] });
  });
  const downloadReady = page.waitForEvent('download', { timeout: 60_000 });
  await page.goto('/map/abc123def456?download=png');
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe('star-copper.png');
  const file = testInfo.outputPath('shared.png');
  await download.saveAs(file);
  const png = await readFile(file);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  // Width follows the viewer's map at pixelRatio 1: at least a phone's width.
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(380);
  await expect(page.getByRole('button', { name: 'Download PNG again' })).toBeVisible();
  expect(errors).toEqual([]);
});
