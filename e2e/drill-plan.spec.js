import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { createInitialProjectState } from '../shared/projectState.js';
import { CRS, COLLARS_CSV, SURVEYS_CSV, ASSAYS_CSV, RESULTS_CSV } from '../tests/fixtures/tower-drill.js';

// The 2D drill plan (Tower Fig 2), end to end in the editor: drill files in, the plan built with the collars'
// coordinate system, traces with assay bars, hole-ID pills, a split-colour pad collar, interval tags, legend rows,
// fanned pad traces, the results card, a dragged tag, the PNG export drawing the same, and removing the plan.
test.skip(({ isMobile }) => isMobile, 'The editor inspector and exports are a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });

// A mottled green-brown 256 px tile, so the export reads like imagery without the network.
function tilePng(seed) {
  const n = 256, raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y += 1) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x += 1) {
      const v = Math.sin((x + seed) * 0.07) * Math.cos((y - seed) * 0.05) + Math.sin((x * 0.31 + y * 0.17 + seed) * 0.4) * 0.35;
      const o = y * (n * 3 + 1) + 1 + x * 3;
      raw[o] = 74 + v * 22; raw[o + 1] = 84 + v * 20; raw[o + 2] = 58 + v * 14;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('drill plan: files in, traces, bars, pad, tags, results card, drag, PNG export and removal', async ({ page }) => {
  test.setTimeout(150_000);
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://server.arcgisonline.com/**', (route) => {
    const x = Number(new URL(route.request().url()).pathname.split('/').at(-1)) || 0;
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tilePng(x * 37) });
  });
  await page.addInitScript(() => {
    window.__texts = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__texts.push(String(t)); return f.call(this, t, ...a); };
  });
  const project = createInitialProjectState();
  project.layout = { ...project.layout, basemap: 'satellite', title: 'Rabbit North drill plan', subtitle: 'Holes 077 & 078 (illustrative)', legendItems: [] };
  project.mapView = { center: { lat: 50.5998, lng: -120.6915 }, zoom: 17 };
  const draft = JSON.stringify({ schemaVersion: 1, payload: project, projectId: null, projectName: 'Rabbit North drill plan' });
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('drillplan-seeded')) return;
    localStorage.setItem('mapviewer.draft.v1', value);
    sessionStorage.setItem('drillplan-seeded', '1');
  }, draft);

  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('#ins-tab-annotate').click();
  await page.getByRole('button', { name: /^Drill plan/ }).click();
  const controls = page.getByTestId('drill-plan-controls');
  await expect(controls).toBeVisible();

  // Four tables; each read as the 3D maker would, the release table included.
  await page.getByLabel('Drill files: collars, surveys, assays, published results').setInputFiles([
    { name: 'collars.csv', mimeType: 'text/csv', buffer: Buffer.from(COLLARS_CSV) },
    { name: 'surveys.csv', mimeType: 'text/csv', buffer: Buffer.from(SURVEYS_CSV) },
    { name: 'assays.csv', mimeType: 'text/csv', buffer: Buffer.from(ASSAYS_CSV) },
    { name: 'release.csv', mimeType: 'text/csv', buffer: Buffer.from(RESULTS_CSV) },
  ]);
  await expect(controls.getByLabel(/release\.csv/)).toHaveValue('published');
  const build = controls.getByRole('button', { name: 'Build the drill plan' });
  await expect(build).toBeDisabled(); // easting/northing collars wait for their coordinate system
  await controls.getByLabel('Collar coordinates').selectOption(CRS);
  await build.click();
  await expect(page.getByTestId('drill-plan-status')).toContainText(/9 holes, 560 assay intervals, 9 published results\./);

  // On the stage: a trace per hole, assay bars, toe pills, the pad's split collar and a tag per published interval.
  const stage = page.locator('.map-stage');
  await expect(stage.locator('.drill-plan-layer')).toHaveCount(2);
  await expect(stage.locator('.drill-plan-layer polyline[stroke="#3fbf4f"]')).not.toHaveCount(0);
  await expect(stage.locator('.drill-plan-layer polyline[stroke="#c2255c"]')).not.toHaveCount(0); // a ≥ 10 g/t bar
  await expect(stage.locator('.drill-plan-layer path')).toHaveCount(2);
  for (const t of ['077', '078', '134.0 m @ 0.65 g/t Au', 'LOWER BLUE SKY', 'COMMON DRILL PAD']) await expect(stage.locator('.drill-plan-layer text', { hasText: t }).first()).toBeVisible();
  await expect(stage.locator('.drill-plan-target[data-key^="tag:"]')).toHaveCount(4);
  await expect(page.locator('.legend-card')).toContainText('Hole 077, dip −50° (this release)');
  await expect(page.locator('.legend-card')).toContainText('≥ 10');

  // The pad's traces fanned apart; the results card on.
  await controls.getByLabel(/Fan their traces apart/).check();
  await expect(stage.locator('.drill-plan-layer text', { hasText: 'traces offset for clarity' })).toHaveCount(1);
  await controls.getByLabel('Results card').check();
  await controls.getByLabel('Card title').fill('Blue Sky · Holes 077 & 078');
  await expect(stage.locator('.drill-plan-layer text', { hasText: 'RELEASED 15 OCT 2026' })).toHaveCount(1);
  await expect(stage.locator('.drill-plan-layer text', { hasText: 'NEW' })).toHaveCount(1);

  // A tag dragged by hand stays where it was put.
  const tag = stage.locator('.drill-plan-target[data-key="tag:077-L"]');
  const before = await tag.boundingBox();
  await page.mouse.move(before.x + 20, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 60, before.y + 70, { steps: 6 });
  await page.mouse.up();
  const after = await tag.boundingBox();
  expect(Math.round(after.x - before.x)).toBeGreaterThan(20);
  expect(Math.round(after.y - before.y)).toBeGreaterThan(30);
  await expect(controls.getByRole('button', { name: 'Re-place tags and cards' })).toBeEnabled();

  // The PNG draws the same plan.
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await page.evaluate(() => { window.__texts = []; });
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  const texts = await page.evaluate(() => window.__texts);
  for (const t of ['077', '078', '134.0 m @ 0.65 g/t Au', 'incl. 1.5 m @ 16.70 g/t Au', 'NEW', 'RELEASED 15 OCT 2026', 'Blue Sky · Holes 077 & 078', 'COMMON DRILL PAD', 'Hole 078, dip −70° (this release)']) expect(texts, t).toContain(t);

  // Removing the plan takes it, its legend rows and its layers off the map.
  const offer = page.locator('.export-hd-overlay'); // a free PNG past the pixel cap offers a full-resolution copy
  await offer.waitFor({ timeout: 5_000 }).catch(() => {});
  if (await offer.isVisible()) await offer.getByRole('button', { name: 'Close' }).click();
  await page.locator('#ins-tab-annotate').click();
  await controls.getByRole('button', { name: 'Remove the drill plan' }).click();
  await expect(stage.locator('.drill-plan-layer')).toHaveCount(0);
  await expect(page.locator('.legend-card')).toHaveCount(0);
});
