import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

// Exploration Maps 3D round 5G: the block section's side title (page "side"), a section image fitted to a face by
// known points, the watermark band, the export's pixel size, and logo background removal. Each is off until asked,
// and the exports without them are the figure as before.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 300_000 }); // full-size exports under SwiftShader

// Exports are compared byte for byte, so a page keeps the first font stylesheet it was given (as round 5E).
async function open3d(page) {
  let css = null;
  await page.route('https://fonts.googleapis.com/css2?**', async (route) => {
    if (!css) { const r = await route.fetch(); const { 'content-encoding': _e, 'content-length': _l, ...headers } = r.headers(); css = { status: r.status(), headers, body: await r.body() }; }
    await route.fulfill(css);
  });
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto('/3d');
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(() => window.EM3D.layersReady());
}
// The texts drawn on off-screen canvases (the export's) while fn runs, as in three-d-round5e.spec.js.
const textsOf = (page, fn) => page.evaluate(async (src) => {
  const out = [], P = CanvasRenderingContext2D.prototype, f = P.fillText;
  P.fillText = function (t, ...a) { if (!this.canvas.isConnected) out.push(String(t)); return f.call(this, t, ...a); };
  try { await (0, eval)(src)(); } finally { P.fillText = f; }
  return out;
}, fn.toString());
const pngSize = (url) => { const b = Buffer.from(url.split(',')[1], 'base64'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const withLogs = (page) => page.evaluate(async () => {
  const E = window.EM3D, ids = E.getState().project.holeIds;
  const lith = ['HoleID,From,To,Lith,Description', ...ids.flatMap((id) => [`${id},0,60,COV,Cover`, `${id},60,140,PHY,Phyllic alteration`, `${id},140,700,BIO,Early biotite`])].join('\n');
  E.addFiles([...E.getProject().files.map(({ name, text }) => ({ name, text })), { name: 'lithology.csv', text: lith }]);
  await E.layersReady();
});
const HOLES = ['EX-009', 'EX-015', 'EX-021', 'EX-027'];

test('side title: the company line, title, subtitle and info line at the left, the logo and legend on the page', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  await withLogs(page);
  const st = await page.evaluate(async (holes) => {
    const E = window.EM3D; E.setBrand({ company: 'Example Resources Corp · TSXV: EX', title: 'TARGET ZONE', subtitle: 'Section A–A′ · four holes' }); E.setFigureSize('slide');
    return E.applyPreset('blockSection', { holes, block: { page: 'side', info: '3D cutaway · Example Ridge' } });
  }, HOLES);
  expect(st.block).toMatchObject({ page: 'side', info: '3D cutaway · Example Ridge' });
  expect(st.wallLabels.filter((l) => l.size === 'heading')).toHaveLength(0); // no heading on the block under a side title
  const t = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(t).toEqual(expect.arrayContaining(['EXAMPLE RESOURCES CORP · TSXV: EX', 'TARGET ZONE', 'Section A–A′ · four holes', '3D cutaway · Example Ridge']));
  expect(t).toContain('Lithology'); // the legend card, on the page
  // The default info line names the view; "" leaves it out.
  await page.evaluate(() => window.EM3D.setBlock({ info: null }));
  expect((await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }))).some((x) => /^3D cutaway · looking (N|NE|E|SE|S|SW|W|NW)$/.test(x))).toBe(true);
  await page.evaluate(() => window.EM3D.setBlock({ info: '' }));
  expect((await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }))).some((x) => /^3D cutaway/.test(x))).toBe(false);
  // A heading added on the block stays hidden under the side title: the same figure.
  expect(await page.evaluate(async () => { const E = window.EM3D, before = E.exportPNG({ view: '3d' }); E.addWallLabel({ size: 'heading', text: 'TARGET ZONE' }); await E.layersReady(); return E.exportPNG({ view: '3d' }) === before; })).toBe(true);
  // Back to the bare page: no title block.
  expect(await page.evaluate(async () => (await window.EM3D.setBlock({ page: 'bare' })).block.page)).toBe('bare');
  const t2 = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(t2).not.toContain('Section A–A′ · four holes'); // (the company's name stays, as the side face's word mark)
  expect(await page.evaluate(() => window.EM3D.setBlock({ page: 'top' }).then(() => null, (e) => e.message))).toMatch(/"side"/);
  // In the Layout step: the page choice and the info line.
  await page.evaluate(() => { window.EM3D.showStep('layout'); return window.EM3D.setBlock({ page: 'side' }); });
  await expect(page.locator('#block-ui [data-bs="page"]')).toHaveValue('side');
  await page.locator('#block-ui [data-bi]').fill('From the layout step'); await page.locator('#block-ui [data-bi]').dispatchEvent('change');
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).block.info).toBe('From the layout step');
  expect(errors).toEqual([]);
});

test('a section image fitted by two known points, shown in the picker; stretched again with null', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d');
    g.fillStyle = '#e8b7a2'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#7fb069'; g.fillRect(0, 120, 400, 180); const src = c.toDataURL('image/png');
    await E.setFaceImage('S', src); const stretched = E.exportPNG({ view: '3d' });
    let bad = null; try { await E.fitFaceImage('S', [{ px: [10, 10], d: 0, z: 100 }]); } catch (e) { bad = e.message; }
    const hole = E.getState().project.holeIds[0];
    const s = await E.fitFaceImage('S', [{ px: [0, 0], d: 0, z: 1300 }, { px: [400, 300], d: 400, z: 1000 }]);
    const fitted = E.exportPNG({ view: '3d' });
    const h = await E.fitFaceImage('S', [{ px: [50, 20], hole }, { px: [400, 300], d: 400, z: 900 }]);
    const sec = await E.setFaceImage('section', src, { points: [{ px: [0, 0], d: 0, z: 1300 }, { px: [400, 300], d: 300, z: 1000 }] });
    const back = await E.fitFaceImage('S', null);
    return { bad, info: s.layout.imageFits.S, holeFit: h.layout.imageFits.S, sec: Object.keys(sec.layout.imageFits), painted: sec.geology.facesPainted, back: back.layout.imageFits, differs: fitted !== stretched };
  });
  expect(r.bad).toMatch(/two points or more/);
  expect(r.info).toMatchObject({ metresPerPixel: [1, 1], rms: 0, image: { along: [0, 400], z: [1000, 1300] } });
  expect(r.holeFit.points[0]).toMatchObject({ px: [50, 20], hole: expect.any(String) });
  expect(r.sec).toEqual(['S', 'section']); expect(r.painted).toContain('section');
  expect(Object.keys(r.back)).toEqual(['section']);
  expect(r.differs).toBe(true);
  // The picker: the image on a canvas, a click adds a point, Apply fits it and the face's outline is reported.
  await page.evaluate(() => { window.EM3D.showStep('layout'); document.querySelectorAll('#pane-layout details').forEach((d) => { d.open = true; }); });
  await page.locator('[data-gfit="S"]').click();
  const cv = page.locator('#geo-fit [data-fc]'); await expect(cv).toBeVisible();
  const box = await cv.boundingBox();
  await cv.click({ position: { x: 2, y: 2 } }); await page.locator('#geo-fit [data-fc]').click({ position: { x: box.width - 2, y: box.height - 2 } });
  const rows = page.locator('#geo-fit [data-fp]'); await expect(rows).toHaveCount(2);
  for (const [i, d, z] of [[0, 0, 1300], [1, 200, 1100]]) { for (const [k, v] of [['d', d], ['z', z]]) { const inp = rows.nth(i).locator(`[data-k="${k}"]`); await inp.fill(String(v)); await inp.dispatchEvent('change'); } }
  await page.locator('#geo-fit [data-fa]').click();
  await expect(page.locator('#geo-fit [data-fm]')).toContainText('Fitted:');
  const fit = await page.evaluate(() => window.EM3D.getState().layout.imageFits.S);
  expect(fit.points).toHaveLength(2); expect(fit.metresPerPixel[0]).toBeCloseTo(0.5, 1);
  // The clicks at the canvas's corners land on the image's corners: the whole canvas takes clicks.
  expect(fit.points[0].px.every((v) => v <= 4)).toBe(true); expect(fit.points[1].px[0]).toBeGreaterThan(395); expect(fit.points[1].px[1]).toBeGreaterThan(295);
});

test('a fit by a hole that leaves the data falls back to the stretched image and says so; the render goes on', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d');
    g.fillStyle = '#e8b7a2'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#7fb069'; g.fillRect(0, 120, 400, 180);
    const hole = E.getState().project.holeIds[0];
    await E.setFaceImage('S', c.toDataURL('image/png'), { points: [{ px: [50, 20], hole }, { px: [400, 300], d: 400, z: 900 }] });
    // The collars, surveys and assays again without that hole.
    E.addFiles(E.getProject().files.map(({ name, text }) => ({ name, text: text.split('\n').filter((l) => !l.startsWith(`${hole},`)).join('\n') })));
    await E.layersReady(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const st = E.getState();
    return { hole, still: st.project.holeIds.includes(hole), fit: st.layout.imageFits.S, painted: st.geology.facesPainted, png: E.exportPNG({ view: '3d' }).length > 1000 };
  });
  expect(r.still).toBe(false);
  expect(r.fit.invalid).toContain(`hole "${r.hole}" is not in the data`);
  expect(r.painted).toContain('S'); expect(r.png).toBe(true);
  expect(errors).toEqual([]);
  // A new fit by that hole is still refused when it is given.
  expect(await page.evaluate((hole) => window.EM3D.fitFaceImage('S', [{ px: [0, 0], hole }, { px: [400, 300], d: 400, z: 900 }]).then(() => null, (e) => e.message), r.hole)).toMatch(/is not in the data/);
});

test('watermark band and pixel size: off by default, per export, and the same figure without them', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D; E.setBrand({ company: 'Example Resources Corp · TSXV: EX' });
    const plain = E.exportPNG({ view: '3d' }), wm = E.exportPNG({ view: '3d', watermark: { year: 2026 } });
    const isPromise = typeof wm?.then === 'function', url = await wm;
    let bad = null; try { E.exportPNG({ width: 50 }); } catch (e) { bad = e.message; }
    return { isPromise, plain, url, again: E.exportPNG({ view: '3d' }) === plain, scale1: E.exportPNG({ view: '3d', scale: 1 }) === plain, w: E.exportPNG({ view: '3d', width: 3484 }), x2: E.exportPNG({ view: 'section', scale: 2 }), sec: await E.exportPNG({ view: 'section', watermark: true }), bad, size: E.getState().figureSize };
  });
  expect(r.isPromise).toBe(true);
  const [W, Hh] = [r.size.width, r.size.height];
  expect(pngSize(r.plain)).toEqual([W, Hh]);
  expect(pngSize(r.url)).toEqual([W, Hh + Math.round(W * 55 / 880)]);
  expect(pngSize(r.sec)).toEqual([W, Hh + Math.round(W * 55 / 880)]);
  expect(r.again).toBe(true); expect(r.scale1).toBe(true); // the band is per export: the next one is the figure as before
  expect(pngSize(r.w)).toEqual([3484, Math.round(3484 * Hh / W)]);
  expect(pngSize(r.x2)).toEqual([2 * W, 2 * Hh]);
  expect(r.bad).toMatch(/width must be 200-16000 px/);
  const t = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d', watermark: { client: 'Tower Resources', year: 2026 } }));
  expect(t).toEqual(expect.arrayContaining(['Exploration', 'Maps', 'DRAFT FOR REVIEW · NOT FOR PUBLICATION', 'Prepared for Tower Resources by Exploration Maps. Not licensed for use or redistribution without written permission. © 2026 Exploration Maps']));
  // The layers ZIP: the band under figure.png and section.png only; scene.png and annotations.png stay the figure's size.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ watermark: true, scale: 2 }))).split(',')[1], 'base64'));
  const dims = (k) => [Buffer.from(zip[k]).readUInt32BE(16), Buffer.from(zip[k]).readUInt32BE(20)];
  expect(dims('scene.png')).toEqual([2 * W, 2 * Hh]); expect(dims('annotations.png')).toEqual([2 * W, 2 * Hh]);
  expect(dims('figure.png')).toEqual([2 * W, 2 * Hh + Math.round(2 * W * 55 / 880)]);
  // The Export step: a pixel size and the band, for the downloads only; unticked, the download is the figure as before.
  await page.evaluate(() => window.EM3D.showStep('export'));
  await page.selectOption('#export-scale', 'w'); await expect(page.locator('#export-width')).toBeVisible();
  await page.check('#export-wm'); await expect(page.locator('#export-client')).toHaveValue('Example Resources Corp');
  const dl = page.waitForEvent('download'); await page.click('#export-3d');
  const file = await (await dl).path(), b = (await import('node:fs')).readFileSync(file);
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([3484, Math.round(3484 * Hh / W) + Math.round(3484 * 55 / 880)]);
});

test('logo background removal: offered on upload, off until ticked, with a preview', async ({ page }) => {
  await open3d(page);
  const logo = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 240, 100); g.fillStyle = '#1d6b3a'; g.fillRect(30, 20, 60, 60); g.fillStyle = '#fff'; g.fillRect(55, 45, 10, 10); return c.toDataURL('image/png'); });
  await page.evaluate(() => window.EM3D.showStep('brand'));
  await page.setInputFiles('#logo-input', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo.split(',')[1], 'base64') });
  await expect(page.locator('#logo-bg')).toBeVisible();
  await expect(page.locator('#logo-bg-on')).not.toBeChecked();
  await expect(page.locator('#logo-bg-prev canvas')).toHaveCount(1);
  expect((await page.evaluate(() => window.EM3D.getState())).brand.logoBackgroundRemoved).toBe(false);
  const alphaOf = () => page.evaluate(async () => { const src = window.EM3D.getProject().settings.logo.$image, im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [g.getImageData(2, 2, 1, 1).data[3], g.getImageData(im.width * 60 / 240, im.height / 2, 1, 1).data[3]]; });
  expect(await alphaOf()).toEqual([255, 255]);
  await page.check('#logo-bg-on');
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).brand.logoBackgroundRemoved).toBe(true);
  expect(await alphaOf()).toEqual([0, 255]); // the background cleared; the white square inside the logo kept
  await page.uncheck('#logo-bg-on');
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).brand.logoBackgroundRemoved).toBe(false);
  expect(await alphaOf()).toEqual([255, 255]);
  // Through the API; a logo with no flat background is kept as it is.
  const api = await page.evaluate(async (src) => (await window.EM3D.setLogo(src, { removeBackground: true, autoColor: false })).brand.logoBackgroundRemoved, logo);
  expect(api).toBe(true);
});
