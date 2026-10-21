import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Exploration Maps 3D drill crew: a toy rig and its crew at the drill pad (crew.js). Off by default, so a figure that
// never turns it on exports exactly as before; on, it is in the figure and the layers' 3D render, in one fixed pose.

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
// Saved for review when E2E_RENDER_DIR is set.
const keep = (name, url) => { const d = process.env.E2E_RENDER_DIR; if (!d) return; mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), Buffer.from(url.split(',')[1], 'base64')); };
const png = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
// How many pixels differ between two PNG data URLs inside a box (0-1 of the frame) around a point, and in all.
const diff = (page, a, b, at, r = 0.05) => page.evaluate(async ([a, b, at, r]) => {
  const data = async (u) => { const img = new Image(); img.src = u; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const A = await data(a), B = await data(b), W = A.width, H = A.height;
  let near = 0, all = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) + Math.abs(A.data[i + 3] - B.data[i + 3]) < 24) continue;
    all++; if (Math.abs(x / W - at[0]) < r && Math.abs(y / H - at[1]) < r * W / H) near++;
  }
  return { near, all };
}, [a, b, at, r]);

test('off: the export is the default, byte for byte; on: the rig and crew stand at the collar, not in the legend', async ({ page }) => {
  await open3d(page);
  const st0 = await page.evaluate(() => window.EM3D.getState().crew);
  expect(st0).toEqual({ on: false, at: 'auto', scale: 1, heading: null });
  const plain = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  const r = await page.evaluate(async () => {
    const E = window.EM3D, on = (await E.setCrew({ on: true })).crew, fig = E.exportPNG({ view: '3d' });
    const texts = []; const P = CanvasRenderingContext2D.prototype, f = P.fillText; P.fillText = function (t, ...a) { texts.push(String(t)); return f.call(this, t, ...a); };
    try { E.exportPNG({ view: '3d' }); } finally { P.fillText = f; }
    await E.setCrew({ on: false });
    const offTexts = []; P.fillText = function (t, ...a) { offTexts.push(String(t)); return f.call(this, t, ...a); };
    try { E.exportPNG({ view: '3d' }); } finally { P.fillText = f; }
    return { on, fig, texts, offTexts, after: E.exportPNG({ view: '3d' }), off: E.getState().crew };
  });
  expect(r.after === plain).toBe(true); // on then off leaves nothing behind
  expect(r.off).toMatchObject({ on: false, shown: false });
  expect(r.on).toMatchObject({ on: true, at: 'auto', shown: true });
  expect(r.on.screen.every((v) => v > 0.05 && v < 0.95)).toBe(true);
  expect(r.texts).toEqual(r.offTexts); // nothing in the legend or anywhere else in the annotations
  const d = await diff(page, plain, r.fig, r.on.screen);
  expect(d.near).toBeGreaterThan(300); // the rig and crew around the projected collar
  expect(d.near).toBeGreaterThan(d.all * 0.9); // and nowhere else
  keep('3d-crew-off.png', plain); keep('3d-crew-auto.png', r.fig);
});

test('the layers ZIP: in the 3D render (scene.png) and the figure; the annotations untouched', async ({ page }) => {
  test.setTimeout(240_000); // two layer ZIPs
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, zipOff = await E.exportLayers(), on = (await E.setCrew({ on: true })).crew;
    return { on, zipOff, zipOn: await E.exportLayers() };
  });
  const zOn = unzipSync(Buffer.from(r.zipOn.split(',')[1], 'base64')), zOff = unzipSync(Buffer.from(r.zipOff.split(',')[1], 'base64'));
  expect((await diff(page, png(zOff['scene.png']), png(zOn['scene.png']), r.on.screen)).near).toBeGreaterThan(300);
  expect((await diff(page, png(zOff['figure.png']), png(zOn['figure.png']), r.on.screen)).near).toBeGreaterThan(300);
  expect(Buffer.from(zOn['annotations.png']).equals(Buffer.from(zOff['annotations.png']))).toBe(true);
});

test('at a hole: it moves there and the mast follows the hole; two exports in a row are identical', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, ids = E.getState().project.holeIds;
    const auto = (await E.setCrew({ on: true })).crew, a = E.exportPNG({ view: '3d' });
    const bad = await E.setCrew({ at: 'NOPE-1' }).then(() => null, (e) => e.message);
    const at = (await E.setCrew({ at: ids[2] })).crew;
    const b1 = E.exportPNG({ view: '3d' });
    await new Promise((ok) => setTimeout(ok, 700)); // the live view idles in between
    const b2 = E.exportPNG({ view: '3d' });
    return { id: ids[2], auto, at, a, b1, b2, bad };
  });
  expect(r.bad).toMatch(/no hole "NOPE-1"/);
  expect(r.at).toMatchObject({ at: r.id, hole: r.id, shown: true });
  expect(Math.hypot(r.at.screen[0] - r.auto.screen[0], r.at.screen[1] - r.auto.screen[1])).toBeGreaterThan(0.02);
  expect(r.b1 === r.a).toBe(false);
  expect(r.b2 === r.b1).toBe(true); // a fixed pose: byte-stable
  const d = await diff(page, r.a, r.b1, r.at.screen);
  expect(d.near).toBeGreaterThan(300);
  keep('3d-crew-hole.png', r.b1);
});

test('saved with the figure: it opens again where it was; an older figure opens with it off', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, ids = E.getState().project.holeIds;
    await E.setCrew({ on: true, at: ids[4], scale: 1.4, heading: 200 });
    const before = E.exportPNG({ view: '3d' }), p = E.getProject();
    await E.setCrew({ on: false, at: 'auto', scale: 1, heading: null });
    await E.loadProject(p); await E.layersReady();
    const back = E.getState().crew, again = E.exportPNG({ view: '3d' });
    const old = structuredClone(p); delete old.settings.crew;
    await E.loadProject(old); await E.layersReady();
    return { id: ids[4], saved: p.settings.crew, back, same: again === before, old: E.getState().crew };
  });
  expect(r.saved).toEqual({ on: true, at: r.id, scale: 1.4, heading: 200 });
  expect(r.back).toMatchObject({ on: true, at: r.id, scale: 1.4, heading: 200, shown: true });
  expect(r.same).toBe(true);
  expect(r.old).toMatchObject({ on: false, at: 'auto', shown: false });
});

test('the Layout step: a "Drill crew" toggle and where it stands', async ({ page }) => {
  await open3d(page);
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const box = page.getByRole('checkbox', { name: /Drill crew/ });
  await expect(box).not.toBeChecked();
  await expect(page.locator('#crew-ui')).toBeHidden();
  await box.check();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.shown).toBe(true);
  const where = page.getByRole('combobox', { name: 'Where the drill crew stands' });
  await expect(where).toBeVisible();
  const id = await page.evaluate(() => window.EM3D.getState().project.holeIds[1]);
  await where.selectOption(id);
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.at).toBe(id);
  await box.uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.on).toBe(false);
  await expect(page.locator('#crew-ui')).toBeHidden();
});
