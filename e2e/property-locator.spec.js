import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { createInitialProjectState } from '../shared/projectState.js';

// Synthetic QA geometry only, with deliberately distant context in a second
// province. Neither polygon represents a real claim or ownership assertion.
const geometry = (x, y) => ({ type: 'FeatureCollection', features: [{ type: 'Feature',
  properties: { NAME: 'Synthetic QA polygon' }, geometry: { type: 'Polygon',
    coordinates: [[[x, y], [x + .02, y], [x + .02, y + .02], [x, y + .02], [x, y]]] } }] });

async function draft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  return JSON.parse(raw?.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw)?.payload;
}

for (const mobile of [false, true]) {
  test(`property locator retains its subject across context imports and restore (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 });
    const payload = createInitialProjectState();
    payload.layers = [{ id: 'qa-subject', name: 'QA subject', displayName: 'QA subject',
      role: 'claims', type: 'geojson', visible: true, geojson: geometry(-120, 50),
      style: { fill: '#93c5fd', stroke: '#2563eb', fillOpacity: .2 }, legend: { enabled: true, label: 'QA subject' } }];
    payload.layout.primaryLayerId = 'qa-subject';
    await page.addInitScript((project) => {
      if (sessionStorage.getItem('locator-fixture')) return;
      localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload: project, projectId: null, projectName: '' }));
      sessionStorage.setItem('locator-fixture', '1');
    }, payload);
    await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
    await page.goto('/?intent=resume');
    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    if (mobile) await edit.click();
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    await page.getByRole('radio', { name: /Property & Neighbours/ }).check();
    await expect(page.getByText('British Columbia', { exact: true })).toBeVisible();
    const circle = page.locator('svg.inset-svg circle');
    const marker = await circle.evaluate((node) => [node.getAttribute('cx'), node.getAttribute('cy')]);
    await page.getByRole('tab', { name: 'Data', exact: true }).click();
    const chooserEvent = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload shapefile, GeoJSON, KML, CSV or georeferenced image', exact: true }).click();
    const chooser = await chooserEvent;
    await chooser.setFiles({ name: 'qa-context.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(geometry(-115, 52))) });
    await expect(page.getByRole('button', { name: 'Qa Context visibility', exact: true })).toBeVisible();
    await expect.poll(() => circle.evaluate((node) => [node.getAttribute('cx'), node.getAttribute('cy')])).toEqual(marker);
    // The import asynchronously detects Alberta. Wait for autosave to settle,
    // then reload through the real draft reader rather than reseeding it.
    await expect(page.getByText('British Columbia', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Qa Context visibility', exact: true }).click();
    await expect.poll(() => circle.evaluate((node) => [node.getAttribute('cx'), node.getAttribute('cy')])).toEqual(marker);
    await page.getByRole('button', { name: 'Qa Context visibility', exact: true }).click();
    await expect.poll(async () => (await draft(page))?.layers?.length).toBe(2);
    const saved = await draft(page);
    expect(saved.layout.autoInsetRegion.name).toBe('British Columbia');
    expect(saved.layers[0].geojson).toEqual(payload.layers[0].geojson);
    expect(saved.layers[1].geojson).toEqual(geometry(-115, 52));
    await page.goto('/?intent=resume');
    await expect(page.getByText('British Columbia', { exact: true })).toBeVisible();
    await expect.poll(() => circle.evaluate((node) => [node.getAttribute('cx'), node.getAttribute('cy')])).toEqual(marker);
  });
}
