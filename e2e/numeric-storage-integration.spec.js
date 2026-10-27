/* global EMAP */
import { test, expect } from '@playwright/test';
import { inflateSync, strFromU8 } from 'fflate';
import { createInitialProjectState } from '../shared/projectState.js';

const raw = [0.123456789, 1.23456789e-7, '<0.0000005', '>100', '0,52', '   '];
for (const phone of [false, true]) test(`classification upgrade and saved precision survive a new document (${phone ? 'phone' : 'desktop'})`, async ({ page }) => {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const p = createInitialProjectState();
  p.layout = { ...p.layout, basemap: 'blank', title: 'Synthetic 0.123456789', insetEnabled: false };
  p.layers = [{ id: 'soil', name: 'Precision soils', type: 'points', role: 'soil_samples', visible: true,
    classification: { field: 'Au', mode: 'graduated', classes: [{ max: 0.123456789, color: '#ef4444' }, { max: null, color: '#7e22ce' }] },
    geojson: { type: 'FeatureCollection', features: raw.map((Au, i) => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [-120.123456789 + i * 0.001, 50.123456789] }, properties: { Au, SampleID: `LAB-${i}.123456789` } })) } }];
  const original = p.layers[0].geojson.features.map(f => f.properties);
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.addInitScript(payload => { if (!localStorage.getItem('mapviewer.draft.v1')) localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload })); }, p);
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => !!window.EMAP); await page.evaluate(() => EMAP.ready());
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  if (await edit.isVisible()) await edit.click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.locator('.layer-item').filter({ hasText: 'Precision soils' }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Rebuild using plain numbers' }).click();
  await expect(page.getByText(/4 of 6 values excluded from ranges/)).toBeVisible();
  const classification = await page.evaluate(() => EMAP.getProject().layers[0].classification);
  await expect.poll(async () => {
    const text = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
    if (!text?.startsWith('gz1:')) return null;
    return JSON.parse(strFromU8(inflateSync(Buffer.from(text.slice(4), 'base64')))).payload.layers[0].classification;
  }).toEqual(classification);
  expect(await page.evaluate(() => EMAP.getProject().layers[0].geojson.features[0].geometry.coordinates)).toEqual([-120.123456789, 50.123456789]);
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => !!window.EMAP); await page.evaluate(() => EMAP.ready());
  const restored = await page.evaluate(() => EMAP.getProject());
  expect(restored.layers[0].classification).toEqual(classification);
  expect(restored.layers[0].geojson.features.map(f => f.properties)).toEqual(original);
  expect(restored.layout.title).toBe(p.layout.title);
  expect(restored.layers[0].geojson.features[0].geometry.coordinates).toEqual([-120.123457, 50.123457]);
  expect(errors).toEqual([]);
});
