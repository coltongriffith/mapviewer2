/* global EMAP */
import { test, expect } from '@playwright/test';
import { inflateSync, strFromU8 } from 'fflate';
import { createInitialProjectState } from '../shared/projectState.js';

test('autosaved draft preserves assay values and sample IDs across a real reload', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const properties = { Au: '<0.0000005', Cu: 0.123456789, SampleID: 'LAB-1.123456789',
    nested: { values: [1.23456789e-7, '1.23456789e-7'], geometry: { type: 'Point', coordinates: [1.123456789, 2.123456789] } } };
  const project = createInitialProjectState();
  project.layout = { ...project.layout, basemap: 'blank', title: 'Synthetic precision fixture', insetEnabled: false };
  project.layers = [{ id: 'soil', name: 'Synthetic soils', type: 'points', role: 'soil_samples', visible: true,
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties,
      geometry: { type: 'Point', coordinates: [-120.123456789, 50.123456789] } }, { type: 'Feature', properties: { SampleID: 'extent' },
      geometry: { type: 'Point', coordinates: [-120.13, 50.13] } }] } }];
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.addInitScript(payload => {
    if (!localStorage.getItem('mapviewer.draft.v1')) localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload }));
  }, project);
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => !!window.EMAP);
  await page.evaluate(async () => {
    await EMAP.ready();
    const current = EMAP.getProject();
    current.layout.title = 'Edited 1.123456789';
    await EMAP.loadProject(current, { discard: true });
  });
  await expect.poll(async () => {
    const stored = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
    if (!stored?.startsWith('gz1:')) return null;
    return JSON.parse(strFromU8(inflateSync(Buffer.from(stored.slice(4), 'base64')))).payload.layout.title;
  }).toBe('Edited 1.123456789');
  // Saving does not mutate the original coordinates used by the open map/export.
  expect(await page.evaluate(() => EMAP.getProject().layers[0].geojson.features[0].geometry.coordinates)).toEqual([-120.123456789, 50.123456789]);
  // Loading a project consumes the intent query; explicitly resume the stored
  // draft in a new document instead of opening the public homepage on reload.
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => !!window.EMAP);
  await page.evaluate(() => EMAP.ready());
  const restored = await page.evaluate(() => EMAP.getProject());
  expect(restored.layout.title).toBe('Edited 1.123456789');
  expect(restored.layers[0].geojson.features[0].properties).toEqual(properties);
  expect(restored.layers[0].geojson.features[0].geometry.coordinates).toEqual([-120.123457, 50.123457]);
  expect(errors).toEqual([]);
});
