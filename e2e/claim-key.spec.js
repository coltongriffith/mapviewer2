import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createInitialProjectState } from '../shared/projectState.js';

async function draft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  return JSON.parse(raw?.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw)?.payload;
}
function fixture() {
  const p = createInitialProjectState();
  p.layers = [{ id: 'qa-claims', name: 'QA claims', displayName: 'QA claims', role: 'claims', type: 'polygons', visible: true,
    style: { fill: '#b58b29', stroke: '#574314', fillOpacity: .3 }, legend: { enabled: true, label: 'QA claims' },
    geojson: { type: 'FeatureCollection', features: Array.from({ length: 3 }, (_, i) => {
      const x = -120 + i * .05;
      return { type: 'Feature', id: `source-${i}`, properties: { TENURE_NUMBER_ID: `QA00${i + 1}`, Au: 2.7 },
        geometry: { type: 'Polygon', coordinates: [[[x,50],[x+.03,50],[x+.03,50.03],[x,50.03],[x,50]]] } };
    }) } }];
  p.layout.primaryLayerId = 'qa-claims';
  return p;
}
for (const mobile of [false, true]) {
  test(`compact claim key creates, exports and restores explicit source references (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 });
    const p = fixture();
    await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
    await page.addInitScript((payload) => {
      if (sessionStorage.getItem('key-fixture')) return;
      localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload, projectId: null, projectName: '' }));
      sessionStorage.setItem('key-fixture', '1');
    }, p);
    await page.goto('/?intent=resume');
    if (mobile) await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    await page.getByRole('radio', { name: /Property & Neighbours/ }).check();
    await page.getByRole('tab', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: 'Layers 1 layer', exact: true }).click();
    await page.locator('.layer-item').click();
    await page.getByText('Compact claim key', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Source identifier column', exact: true }).selectOption('TENURE_NUMBER_ID');
    await page.getByRole('button', { name: 'Create claim key', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '3 located' })).toBeVisible();
    await expect.poll(async () => (await draft(page))?.layout?.claimKey?.entries?.length).toBe(3);
    const saved = await draft(page);
    expect(saved.layers[0].geojson).toEqual(p.layers[0].geojson);
    expect(saved.layout.claimKey.entries.map((entry) => entry.identifier)).toEqual(['QA001', 'QA002', 'QA003']);
    if (mobile) await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Image for slides and web PNG', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
    const bytes = await readFile(await (await downloading).path());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(1000);
    await page.goto('/?intent=resume');
    await expect.poll(async () => (await draft(page))?.layout?.claimKey).toEqual(saved.layout.claimKey);
    if (mobile) await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Customize', exact: true }).click();
    await page.getByRole('button', { name: /^Layers(?: 1 layer)?$/ }).click();
    await page.locator('.layer-item').click();
    await page.getByText('Compact claim key', { exact: true }).click();
    await page.getByRole('button', { name: 'Remove claim key', exact: true }).click();
    await expect.poll(async () => (await draft(page))?.layout?.claimKey).toBeNull();
    await page.getByRole('combobox', { name: 'Source identifier column', exact: true }).selectOption('TENURE_NUMBER_ID');
    await page.getByRole('button', { name: 'Create claim key', exact: true }).click();
    await expect.poll(async () => (await draft(page))?.layout?.claimKey).toEqual(saved.layout.claimKey);
  });
}
