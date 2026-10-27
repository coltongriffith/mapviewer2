/* global EMAP */
import { test, expect } from '@playwright/test';
import { createInitialProjectState } from '../shared/projectState.js';

const point = (Au, i, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-120.7 + i * 0.001, 50.6] }, properties: { Au, Cu: 10, ...extra } });
const longColumn = 'Supplied numeric column with a long source description and an unverified unit label 012345678901234567890123456789';
function fixture() {
  const p = createInitialProjectState();
  p.layout = { ...p.layout, basemap: 'blank', insetEnabled: false, title: 'Synthetic column inspection' };
  p.layers = [{ id: 'first', name: 'Synthetic soils', type: 'points', visible: true,
    classification: { field: 'Au', mode: 'graduated', classes: [{ max: 2, color: '#ef4444' }, { max: null, color: '#7e22ce' }] },
    geojson: { type: 'FeatureCollection', features: [1, 2, 3, 4, '<0.005', '0,52', '', 'ND'].map((v, i) => point(v, i)).concat([
      point(99, 8, { _trace: true }), { ...point(100, 9), geometry: { type: 'MultiPoint', coordinates: [[-120.7, 50.6], [-120.71, 50.6]] } },
    ]) } }, { id: 'second', name: 'Other Point records', type: 'points', visible: true,
    geojson: { type: 'FeatureCollection', features: [point(0.123456789, 0, { '': 7, [longColumn]: 12 }), point(1.23456789e-7, 1, { '': 9, [longColumn]: 24 })] } }];
  return p;
}
async function choose(page, label) {
  await page.getByLabel('Column to inspect').selectOption({ label });
}
for (const phone of [false, true]) test(`read-only Point summary is optional and resets its scope (${phone ? 'phone' : 'desktop'})`, async ({ page }) => {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const errors = [], chunks = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (request.url().includes('/NumericColumnSummary-')) chunks.push(request.url()); });
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.addInitScript(payload => {
    if (!localStorage.getItem('mapviewer.draft.v1')) localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload }));
  }, fixture());
  await page.goto('/?intent=resume');
  await page.waitForFunction(() => !!window.EMAP); await page.evaluate(() => EMAP.ready());
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  if (await edit.isVisible()) await edit.click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  const layerRow = name => page.locator('.layer-item').filter({ hasText: name }).filter({ visible: true }).first();
  await layerRow('Synthetic soils').click();
  const toggle = page.getByText('Inspect numeric columns', { exact: true });
  await expect(toggle).toBeVisible(); expect(chunks).toEqual([]);
  const before = await page.evaluate(() => EMAP.getProject());
  // Native details is keyboard-operable on desktop and in the phone layout.
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Column to inspect')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Observed numeric values' })).toHaveCount(0);
  expect(chunks.length).toBeGreaterThan(0);
  await choose(page, 'Au');
  await expect(page.getByText('4 of 8 Point values are plain finite numbers.')).toBeVisible();
  await expect(page.getByText(/8 Point records of 10 feature records/)).toContainText('1 derived traces, 1 MultiPoint records, 0 other records');
  await expect(page.getByText('Excluded: 1 blank or missing; 1 inequality-marked text; 2 other nonnumeric values.')).toBeVisible();
  await expect(page.getByRole('row', { name: 'P50 2', exact: true })).toBeVisible();
  await choose(page, 'Cu'); await expect(page.getByRole('row', { name: 'P50 10', exact: true })).toBeVisible();
  await layerRow('Other Point records').click();
  await expect(page.getByLabel('Column to inspect')).toHaveCount(0);
  await toggle.click(); await expect(page.getByLabel('Column to inspect')).toHaveValue('');
  await choose(page, 'Au');
  await expect(page.getByRole('row', { name: 'Minimum 1.23456789e-7', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Maximum 0.123456789', exact: true })).toBeVisible();
  await choose(page, '(empty column name)'); await expect(page.getByRole('row', { name: 'P50 7', exact: true })).toBeVisible();
  await choose(page, longColumn); await expect(page.getByRole('row', { name: 'P50 12', exact: true })).toBeVisible();
  const bounds = await page.getByRole('region', { name: 'Numeric column summary' }).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.getByRole('region', { name: 'Numeric column summary' }).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await toggle.click(); await toggle.click(); await expect(page.getByLabel('Column to inspect')).toHaveValue('');
  const after = await page.evaluate(() => EMAP.getProject());
  expect(after).toEqual(before); expect(after.layers[1].classification).toBeUndefined();
  expect(after.layers[0].classification.numericPolicy).toBeUndefined();
  await page.goto('/?intent=resume'); await page.waitForFunction(() => !!window.EMAP); await page.evaluate(() => EMAP.ready());
  const restored = await page.evaluate(() => EMAP.getProject());
  expect(restored.layers.map(l => l.classification)).toEqual(before.layers.map(l => l.classification));
  expect(restored.layers.map(l => l.geojson.features.map(f => f.properties))).toEqual(before.layers.map(l => l.geojson.features.map(f => f.properties)));
  expect(errors).toEqual([]);
});
