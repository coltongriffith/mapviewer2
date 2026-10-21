import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Exploration Maps 3D export options: a transparent background, the block's drop shadow off, and "Map use"
// (a standalone map's details in the legend). A figure that sets none of them exports exactly as before.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 150_000 });

async function open3d(page) {
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto('/3d');
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(() => window.EM3D.layersReady());
}
const textsOf = (page, fn) => page.evaluate(async (src) => {
  const out = [], P = CanvasRenderingContext2D.prototype, f = P.fillText;
  P.fillText = function (t, ...a) { out.push(String(t)); return f.call(this, t, ...a); };
  try { await (0, eval)(src)(); } finally { P.fillText = f; }
  return out;
}, fn.toString());
// Saved for review when E2E_RENDER_DIR is set.
const keep = (name, url) => { const d = process.env.E2E_RENDER_DIR; if (!d) return; mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), Buffer.from(url.split(',')[1], 'base64')); };
// Pixel statistics of a PNG data URL, decoded in the page: the alpha along the frame's edges and in a box (0-1 of the
// frame), and how many pixels are not fully transparent.
const pixels = (page, url, box = [0, 0, 1, 1]) => page.evaluate(async ([u, b]) => {
  const img = new Image(); img.src = u; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, a = (x, y) => d[(y * W + x) * 4 + 3];
  let edgeMax = 0; for (let x = 0; x < W; x++) edgeMax = Math.max(edgeMax, a(x, 0), a(x, H - 1)); for (let y = 0; y < H; y++) edgeMax = Math.max(edgeMax, a(0, y), a(W - 1, y));
  let opaque = 0, lum = 0, n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) opaque++;
  const [x0, y0, x1, y1] = [b[0] * W, b[1] * H, b[2] * W, b[3] * H].map(Math.round);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; lum += (d[i] + d[i + 1] + d[i + 2]) * d[i + 3] / 255; n++; }
  return { W, H, corners: [a(0, 0), a(W - 1, 0), a(0, H - 1), a(W - 1, H - 1)], edgeMax, opaque, boxLum: lum / n, footer: a(Math.round(W * 0.5), H - 3) };
}, [url, box]);

test('transparent background: clear at the corners and edges, the white export unchanged', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(() => { const E = window.EM3D; return { plain: E.exportPNG({ view: '3d' }), white: E.exportPNG({ view: '3d', background: 'white' }), clear: E.exportPNG({ view: '3d', background: 'transparent' }), sec: E.exportPNG({ view: 'section', background: 'transparent' }), again: E.exportPNG({ view: '3d' }), bad: (() => { try { E.exportPNG({ background: 'pink' }); } catch (e) { return e.message; } return null; })() }; });
  expect(r.white === r.plain).toBe(true); // "white" is the export as it was
  expect(r.again === r.plain).toBe(true); // and a transparent export leaves nothing behind
  expect(r.bad).toMatch(/background must be "white" or "transparent"/);
  const plain = await pixels(page, r.plain), clear = await pixels(page, r.clear), sec = await pixels(page, r.sec);
  expect(plain.corners).toEqual([255, 255, 255, 255]);
  expect(clear.corners).toEqual([0, 0, 0, 0]);
  expect(clear.edgeMax).toBe(0); // no frame fill anywhere along the edge
  expect(clear.footer).toBe(0); // no footer band
  expect(clear.opaque).toBeLessThan(plain.opaque * 0.8);
  expect(clear.opaque).toBeGreaterThan(plain.opaque * 0.15); // the figure itself is there
  expect(sec.corners).toEqual([0, 0, 0, 0]);
  keep('3d-presentation-white.png', r.plain); keep('3d-transparent.png', r.clear); keep('3d-section-transparent.png', r.sec);
  // The layers ZIP takes the same option.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ background: 'transparent' }))).split(',')[1], 'base64'));
  const fig = await pixels(page, `data:image/png;base64,${Buffer.from(zip['figure.png']).toString('base64')}`);
  expect(fig.corners).toEqual([0, 0, 0, 0]);
});

test('drop shadow: off removes the footprint under the block; transparent leaves it off unless asked', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, on = E.exportPNG({ view: '3d' });
    await E.setStyle({ dropShadow: false }); const off = E.exportPNG({ view: '3d' }), st = E.getState().display.dropShadow;
    await E.setStyle({ dropShadow: true }); const back = E.exportPNG({ view: '3d' });
    return { on, off, back, st, clearOn: E.exportPNG({ view: '3d', background: 'transparent', shadow: true }), clearOff: E.exportPNG({ view: '3d', background: 'transparent' }) };
  });
  expect(r.st).toBe(false);
  expect(r.back === r.on).toBe(true);
  expect(r.off === r.on).toBe(false);
  // Under the block (the lower middle of the frame): lighter without the shadow.
  const box = [0.3, 0.55, 0.75, 0.8], on = await pixels(page, r.on, box), off = await pixels(page, r.off, box);
  expect(off.boxLum).toBeGreaterThan(on.boxLum + 1);
  const con = await pixels(page, r.clearOn), coff = await pixels(page, r.clearOff);
  expect(coff.opaque).toBeLessThan(con.opaque - 2000); // the soft shadow's pixels are gone
  keep('3d-shadow-off.png', r.off); keep('3d-transparent-shadow-on.png', r.clearOn);
  // In the Export step, Transparent turns the shadow off, and it can be ticked back on.
  await page.evaluate(() => window.EM3D.showStep('export'));
  await page.locator('#export-bg').selectOption('transparent');
  await expect(page.locator('#opt-shadow')).not.toBeChecked();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).display.dropShadow).toBe(false);
  await page.locator('#opt-shadow').check();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).display.dropShadow).toBe(true);
});

test('standalone map: its details and notes in the legend, not the footer; presentation exactly as before', async ({ page }) => {
  await open3d(page);
  const before = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  const st = await page.evaluate(() => window.EM3D.getState());
  expect(st.mapInfo).toEqual({ use: 'presentation', what: '', project: '', date: '', sources: '' });
  const foot = st.brand.footnote;
  const plainTexts = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  const callouts = (texts) => texts.filter((t) => / m @ /.test(t) && !t.startsWith('incl.')); // each callout's first line
  expect(plainTexts.filter((t) => t.includes(foot.slice(0, 30))).length).toBe(1); // in the footer
  await page.evaluate(() => window.EM3D.setMapUse({ use: 'standalone', what: 'Drill plan · Main zone, 2026 program', date: 'October 2026', sources: 'Drilling and assays: company database' }));
  const texts = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  for (const t of ['Drill plan · Main zone, 2026 program', 'PROJECT', 'DATE', 'October 2026', 'COORDINATES', 'SOURCES', 'NOTES']) expect(texts, t).toContain(t);
  const all = texts.join(' '); // wrapped values, line by line
  expect(all).toContain('Drilling and assays: company database');
  expect(all).toContain('EXAMPLE RIDGE · Example Resources');
  // The footnote moved into the legend: drawn once, word-wrapped, never also in the footer.
  expect(texts.some((t) => t === foot)).toBe(false);
  expect(texts.filter((t) => t.startsWith('Intervals are core')).length).toBe(1);
  expect(texts).toContain('Made with Exploration Maps'); // the credit line stays in the footer
  // The details sit atop the legend card, which grows in its place: every callout of the presentation figure stays.
  expect(callouts(plainTexts).length).toBeGreaterThan(3);
  expect(callouts(texts)).toEqual(callouts(plainTexts));
  const at = (t) => texts.indexOf(t);
  expect(at('PROJECT')).toBeLessThan(at('Drill hole collar')); // one card: the details, then the legend's entries
  const standalone = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  keep('3d-standalone.png', standalone);
  keep('3d-standalone-transparent.png', await page.evaluate(() => window.EM3D.exportPNG({ view: '3d', background: 'transparent' })));
  // The editable annotations carry the block as live text.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ svg: true }))).split(',')[1], 'base64'));
  expect(new TextDecoder().decode(zip['annotations.svg'])).toContain('Drill plan · Main zone, 2026 program');
  // Saved and reopened; then back to a presentation figure, byte for byte as before.
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.EM3D.getProject())));
  expect(saved.settings.mapInfo.use).toBe('standalone');
  await page.evaluate(() => window.EM3D.setMapUse({ use: 'presentation' }));
  expect(await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' })) === before).toBe(true);
  await page.evaluate(async (p) => { await window.EM3D.loadProject(p); await window.EM3D.layersReady(); }, saved);
  expect((await page.evaluate(() => window.EM3D.getState())).mapInfo.what).toBe('Drill plan · Main zone, 2026 program');
  await expect(page.locator('#mapinfo-ui')).toBeAttached();
  // The Brand step's select switches it from the page.
  await page.evaluate(() => window.EM3D.showStep('brand'));
  await expect(page.locator('#mapinfo-ui')).toBeVisible();
  await page.locator('#map-use').selectOption('presentation');
  await expect(page.locator('#mapinfo-ui')).toBeHidden();
});

test('a figure saved before these options opens as a presentation figure with its shadow, unchanged', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, before = E.exportPNG({ view: '3d' }), p = JSON.parse(JSON.stringify(E.getProject()));
    delete p.settings.mapInfo; delete p.settings.dropShadow;
    E.clearFiles(); await E.loadProject(p); await E.layersReady();
    const s = E.getState(); return { same: E.exportPNG({ view: '3d' }) === before, mapInfo: s.mapInfo, shadow: s.display.dropShadow };
  });
  expect(r.mapInfo.use).toBe('presentation');
  expect(r.shadow).toBe(true);
  expect(r.same).toBe(true);
});
