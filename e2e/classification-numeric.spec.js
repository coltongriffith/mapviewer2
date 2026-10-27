/* global EMAP */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInitialProjectState } from '../shared/projectState.js';

const raw = [0, 0.5, 10, '<0.005', '>100', '0,52', '   '];
function project() {
  const p = createInitialProjectState();
  p.layout = { ...p.layout, basemap: 'blank', title: 'Synthetic numeric classification', subtitle: '', footerEnabled: false, insetEnabled: false };
  p.layers = [{ id: 'soil', name: 'Synthetic soils', type: 'points', role: 'soil_samples', visible: true, legend: true,
    style: { markerSize: 16, markerColor: '#222222', markerFill: '#eeeeee' },
    classification: { field: 'Au', mode: 'graduated', classes: [{ max: 1, color: '#ef4444' }, { max: null, color: '#7e22ce' }] },
    geojson: { type: 'FeatureCollection', features: raw.map((Au, i) => ({ type: 'Feature', properties: { Au }, geometry: { type: 'Point', coordinates: [-120.7 + i * 0.001, 50.6] } })) } }];
  return p;
}
async function open(page) {
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.addInitScript(payload => { localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload })); }, project());
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => !!window.EMAP);
  await page.evaluate(async () => { await EMAP.ready(); await EMAP.setView({ center: { lat: 50.6, lng: -120.697 }, zoom: 15 }); });
  await page.evaluate(() => document.fonts.ready);
}
async function controls(page) {
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  if (await edit.isVisible() && await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.locator('.layer-item').filter({ hasText: 'Synthetic soils' }).filter({ visible: true }).first().click();
  await expect(page.getByLabel('Attribute')).toBeVisible();
}
const classification = page => page.evaluate(() => EMAP.getProject().layers[0].classification);
for (const phone of [false, true]) {
  test(`numeric classification preserves raw values and upgrades only on request (${phone ? 'phone' : 'desktop'})`, async ({ page }) => {
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await open(page); await controls(page);
    expect((await classification(page)).numericPolicy).toBeUndefined();
    await page.getByLabel('Legend label').first().fill('Edited legacy label');
    expect((await classification(page)).numericPolicy).toBeUndefined();
    await page.getByRole('button', { name: 'Rebuild using plain numbers' }).click();
    await expect(page.getByText(/4 of 7 values excluded from ranges/)).toBeVisible();
    expect((await classification(page)).numericPolicy).toBe('finite-decimal-v1');
    expect(await page.evaluate(() => EMAP.getProject().layers[0].geojson.features.map(f => f.properties.Au))).toEqual(raw);
    // The policy survives a project round-trip, rather than existing only in UI state.
    await page.evaluate(async () => EMAP.loadProject(EMAP.getProject(), { discard: true }));
    expect((await classification(page)).numericPolicy).toBe('finite-decimal-v1');
    await controls(page);
    await page.getByRole('button', { name: 'Use unique values' }).click();
    expect((await classification(page)).classes.some(c => c.value === '<0.005')).toBe(true);
    await page.getByLabel('Method', { exact: true }).selectOption('graduated');
    await expect(page.getByText(/4 of 7 values excluded from ranges/)).toBeVisible();
    expect(errors).toEqual([]);
    if (process.env.E2E_RENDER_DIR) { mkdirSync(process.env.E2E_RENDER_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.E2E_RENDER_DIR, `${phone ? 'phone' : 'desktop'}-controls.png`) }); }
  });
}

test('unchanged legacy classified map PNG export parity fixture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const png = await page.evaluate(async () => (await EMAP.exportPNG({ as: 'dataUrl', band: false, draft: false, pixelRatio: 1 })).data);
  expect(png).toMatch(/^data:image\/png;base64,/);
  expect((await classification(page)).numericPolicy).toBeUndefined();
  if (process.env.E2E_RENDER_DIR) { mkdirSync(process.env.E2E_RENDER_DIR, { recursive: true }); writeFileSync(join(process.env.E2E_RENDER_DIR, 'legacy.png'), Buffer.from(png.split(',')[1], 'base64')); }
});
