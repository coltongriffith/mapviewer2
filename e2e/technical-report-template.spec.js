import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createInitialProjectState } from '../shared/projectState.js';

// Illustrative geometry and supplied metadata only, never production/QP data.
function fixture() {
  const p = createInitialProjectState();
  p.layers = [{ id: 'property', role: 'claims', type: 'geojson', visible: true, displayName: 'Claims',
    style: { fill: '#345678', stroke: '#234567' },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'claim-qa', properties: { PROJECT_NAME: 'Illustrative Ridge' },
      geometry: { type: 'Polygon', coordinates: [[[-120, 50], [-119.98, 50], [-119.98, 50.02], [-120, 50.02], [-120, 50]]] } }] } },
  { id: 'samples', role: 'soil_samples', type: 'points', visible: true, userStyled: true,
    classification: { field: 'Cu_ppm', mode: 'numeric', classes: [{ id: 'low', max: 50, color: '#aabbcc' }, { id: 'high', max: null, color: '#112233' }] },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'qa-sample', properties: { Cu_ppm: 25 }, geometry: { type: 'Point', coordinates: [-119.99, 50.01] } }] } }];
  Object.assign(p.layout, { fonts: { ...p.layout.fonts, title: 'Lato' }, accentColor: '#123456',
    subtitle: 'Supplied survey', footerText: 'Illustrative source disclosure', companyName: 'Illustrative Company',
    projectionName: 'NAD83 / UTM Zone 10N' });
  p.distanceLines = [{ id: 'supplied-distance', p1: { lat: 50.002, lng: -119.998 }, p2: { lat: 50.006, lng: -119.99 }, label: 'Supplied caption', style: 'bracket' }];
  return p;
}

async function readDraft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  return JSON.parse(raw?.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw);
}

async function open(page, payload) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript((source) => {
    if (sessionStorage.getItem('technical-report-fixture')) return;
    localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload: source, projectId: null, projectName: '' }));
    sessionStorage.setItem('technical-report-fixture', '1');
  }, payload);
  await page.goto('/?intent=resume');
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  if (await edit.isVisible()) await edit.click();
  await expect(page.getByRole('tab', { name: 'Style', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await page.getByRole('radio', { name: 'Technical Report Coordinate frame, supplied metadata', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Technical report title block', exact: true })).toBeVisible();
  await expect.poll(async () => (await readDraft(page))?.payload?.layout?.technicalReportVersion).toBe(1);
}

test('technical report card prepopulates supplied content without changing science and survives history and restore', async ({ page }) => {
  const source = fixture();
  await open(page, source);
  const strip = page.getByRole('img', { name: 'Technical report title block', exact: true });
  await expect(strip).toContainText('Illustrative Ridge');
  await expect(strip).toContainText('NOT SET');
  await expect(strip).toContainText('NAD83 / UTM Zone 10N');
  await expect(page.locator('.legend-card')).toContainText('Cu_ppm');
  const saved = (await readDraft(page)).payload;
  expect(saved.layers).toEqual(source.layers);
  expect(saved.distanceLines).toEqual(source.distanceLines);
  for (const key of ['companyName', 'fonts', 'accentColor', 'projectionName', 'footerText']) expect(saved.layout[key]).toEqual(source.layout[key]);
  for (const key of ['qpName', 'figureNumber', 'figureRevision', 'mapDate']) expect(saved.layout[key]).toEqual(source.layout[key]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(strip).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(strip).toBeVisible();
  await expect.poll(async () => (await readDraft(page))?.payload?.layout?.technicalReportVersion).toBe(1);
  await page.goto('/?intent=resume');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('Illustrative Ridge');
  expect((await readDraft(page)).payload.layers).toEqual(source.layers);
});

test('mobile no-logo portrait keeps long metadata and exports the same complete title block', async ({ page }) => {
  const source = fixture();
  const title = 'Illustrative Cedar Ridge Project — Regional Geology, Exploration Targets and Drill Collar Locations';
  const company = 'Illustrative Aurora Ridge Exploration and Development Corporation';
  Object.assign(source.layout, { exportRatio: 'portrait', stripTitle: title, companyName: company, logo: null });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, source);
  if (await page.getByRole('button', { name: 'Done', exact: true }).isVisible()) await page.getByRole('button', { name: 'Done', exact: true }).click();
  const strip = page.getByRole('img', { name: 'Technical report title block', exact: true });
  const textLines = await strip.locator('text').allTextContents();
  const combined = textLines.join(' ');
  expect(combined).toContain(title);
  expect(combined).toContain(company);
  expect(combined).not.toContain('…');
  await expect(page.getByRole('img', { name: 'Logo', exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator('.legend-card').evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Image for slides and web PNG', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download with watermark', exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const png = readFileSync(await download.path());
  expect(png.readUInt32BE(16)).toBeLessThan(png.readUInt32BE(20));
  const after = (await readDraft(page)).payload;
  expect(after.layout.stripTitle).toBe(title);
  expect(after.layout.companyName).toBe(company);
  expect(after.layers).toEqual(source.layers);
  expect(after.distanceLines).toEqual(source.distanceLines);
});
