import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

// Tower v3 items 38 and 42 in the 2D editor, driven by clicks: the watermark band under the export (on by default
// for a sample map on the free plan, off when unticked) and the designer layers ZIP (figure, map alone,
// annotations alone on transparency).
test.skip(({ isMobile }) => isMobile, 'Exports are a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 180_000 });

const STATUS = 'DRAFT FOR REVIEW · NOT FOR PUBLICATION';
const bandHeight = (w) => Math.max(24, Math.round(w * 55 / 880));
const keep = (name, path) => { const d = process.env.E2E_RENDER_DIR; if (!d) return; mkdirSync(d, { recursive: true }); copyFileSync(path, join(d, name)); };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    const P = CanvasRenderingContext2D.prototype, f = P.fillText; window.__texts = [];
    P.fillText = function (t, ...a) { window.__texts.push(String(t)); return f.call(this, t, ...a); };
  });
  await page.goto('/?demo=1');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^export$/i }).first().click();
});

// Presses an export button; anonymous, so the export gate's "Download with watermark" follows.
async function download(page, button) {
  const dl = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click({ timeout: 15_000 });
  const d = await dl;
  const path = await d.path();
  await page.locator('.export-hd-close').first().click({ timeout: 3000 }).catch(() => {});
  return { path, name: d.suggestedFilename() };
}
// Width, height and the RGBA of some pixels of a PNG, decoded by the browser.
async function inspect(page, bytes, points = []) {
  return page.evaluate(async ([u, pts]) => {
    const img = new Image(); img.src = u; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const at = ([x, y]) => [...g.getImageData(x < 0 ? img.width + x : x, y < 0 ? img.height + y : y, 1, 1).data];
    let clear = 0; const d = g.getImageData(0, 0, img.width, img.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++;
    return { w: img.width, h: img.height, px: pts.map(at), clearFrac: clear / (img.width * img.height) };
  }, [`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, points]);
}

test('the watermark band: on by default for a sample map, with the client, and off when unticked', async ({ page }) => {
  const toggle = page.getByLabel('Watermark band under the export (draft for review)');
  await expect(toggle).toBeChecked();
  await page.getByLabel('Prepared for').fill('Buckhorn Creek Mining Corp.');
  await page.evaluate(() => { window.__texts = []; });
  const on = await download(page, 'Export PNG');
  keep('2d-watermarked.png', on.path);
  const texts = await page.evaluate(() => window.__texts);
  expect(texts).toContain(STATUS);
  expect(texts).toContain('Exploration');
  expect(texts).toContain('Maps');
  expect(texts.some((t) => t.startsWith('Prepared for Buckhorn Creek Mining Corp. by Exploration Maps.') && t.includes(`© ${new Date().getFullYear()} Exploration Maps`))).toBe(true);
  const a = await inspect(page, readFileSync(on.path), [[-4, -3]]);
  expect(a.px[0].slice(0, 3)).toEqual([252, 251, 247]); // the band's cream, at the bottom right

  await toggle.uncheck();
  await expect(page.getByLabel('Prepared for')).toHaveCount(0);
  await page.evaluate(() => { window.__texts = []; });
  const off = await download(page, 'Export PNG');
  expect(await page.evaluate(() => window.__texts)).not.toContain(STATUS);
  const b = await inspect(page, readFileSync(off.path));
  expect(b.w).toBe(a.w);
  expect(a.h - b.h).toBe(bandHeight(a.w)); // the band adds exactly its height under the figure
});

test('the layers ZIP: the figure, the map alone and the annotations alone, which stack', async ({ page }, testInfo) => {
  await page.getByLabel('Watermark band under the export (draft for review)').uncheck();
  // SVG export is a Pro feature: the free plan's layers carry the PNGs.
  await expect(page.getByLabel(/Layers include annotations\.svg/)).toBeDisabled();
  await page.evaluate(() => { window.__texts = []; });
  const { path, name } = await download(page, 'Download layers (ZIP)');
  expect(name).toBe('buckhorn-creek-property-layers.zip');
  const files = unzipSync(readFileSync(path));
  expect(Object.keys(files)).toEqual(['figure.png', 'map.png', 'annotations.png', 'layers.json']);
  const out = testInfo.outputPath('layers');
  mkdirSync(out, { recursive: true });
  for (const [k, v] of Object.entries(files)) { writeFileSync(join(out, k), v); keep(`2d-layers-${k}`, join(out, k)); }
  const about = JSON.parse(Buffer.from(files['layers.json']).toString());
  expect(about.note).toMatch(/stack \(map below\) to make figure\.png/);
  const [fig, map, notes] = await Promise.all(['figure.png', 'map.png', 'annotations.png'].map((k) => inspect(page, files[k])));
  expect([map.w, map.h]).toEqual([fig.w, fig.h]);
  expect([notes.w, notes.h]).toEqual([fig.w, fig.h]);
  expect(map.clearFrac).toBe(0); // the map layer is opaque
  expect(notes.clearFrac).toBeGreaterThan(0.3); // annotations: mostly transparent
  // The title is drawn for the figure and the annotations, never for the map layer: twice in all.
  const texts = await page.evaluate(() => window.__texts);
  expect(texts.filter((t) => t === 'Buckhorn Creek Property')).toHaveLength(2);

  // With the band on, it goes under figure.png only, so the layers still stack.
  await page.getByLabel('Watermark band under the export (draft for review)').check();
  const withBand = unzipSync(readFileSync((await download(page, 'Download layers (ZIP)')).path));
  const [fig2, map2] = await Promise.all([inspect(page, withBand['figure.png']), inspect(page, withBand['map.png'])]);
  expect(fig2.h - map2.h).toBe(bandHeight(fig2.w));
  expect(map2.h).toBe(map.h);
});
