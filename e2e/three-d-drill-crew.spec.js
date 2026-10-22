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
  expect(r.texts.filter((t) => !r.offTexts.includes(t))).toEqual([]); // nothing added to the legend or anywhere else in the annotations
  expect(r.on.pick).toBe(r.on.hole); // auto stood at a collar with room around it, and keeps it
  const d = await diff(page, plain, r.fig, r.on.screen);
  expect(d.near).toBeGreaterThan(300); // the rig and crew around the projected collar
  expect(d.near).toBeGreaterThan(d.all * 0.9); // and nowhere else
  keep('3d-crew-off.png', plain); keep('3d-crew-auto.png', r.fig);
});

test('the layers ZIP: in the 3D render (scene.png) and the figure; the annotations change only at the rig', async ({ page }) => {
  test.setTimeout(240_000); // two layer ZIPs
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, zipOff = await E.exportLayers(), on = (await E.setCrew({ on: true })).crew;
    return { on, zipOff, zipOn: await E.exportLayers() };
  });
  const zOn = unzipSync(Buffer.from(r.zipOn.split(',')[1], 'base64')), zOff = unzipSync(Buffer.from(r.zipOff.split(',')[1], 'base64'));
  expect((await diff(page, png(zOff['scene.png']), png(zOn['scene.png']), r.on.screen)).near).toBeGreaterThan(300);
  expect((await diff(page, png(zOff['figure.png']), png(zOn['figure.png']), r.on.screen)).near).toBeGreaterThan(300);
  // The annotations change only at the rig: collar rings under its pad give way, its own moves to the rod.
  const an = await diff(page, png(zOff['annotations.png']), png(zOn['annotations.png']), r.on.screen);
  expect(an.near).toBeGreaterThanOrEqual(an.all * 0.9);
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

test('collar rings under the pad give way to the rig; with it off every ring is drawn', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, P = CanvasRenderingContext2D.prototype, f = P.arc;
    const rings = () => { let n = 0; P.arc = function (...a) { n++; return f.apply(this, a); }; try { E.exportPNG({ view: '3d' }); } finally { P.arc = f; } return n; };
    const off = rings(), id = E.getState().project.holeIds[7];
    await E.setCrew({ on: true, at: id, scale: 3 }); const on = rings();
    await E.setCrew({ on: false }); return { off, on, again: rings() };
  });
  expect(r.on).toBeLessThan(r.off);
  expect(r.again).toBe(r.off);
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
    const auto = (await E.setCrew({ at: 'auto', scale: 1, heading: null })).crew, pa = E.getProject();
    await E.setCamera({ azimuth: 200, plunge: 35 }); await E.setCrew({ on: false });
    await E.loadProject(pa); await E.layersReady();
    const autoBack = E.getState().crew;
    const old = structuredClone(p); delete old.settings.crew;
    await E.loadProject(old); await E.layersReady();
    return { id: ids[4], saved: p.settings.crew, back, same: again === before, auto, autoBack, old: E.getState().crew };
  });
  expect(r.saved).toEqual({ on: true, at: r.id, scale: 1.4, heading: 200, chatter: true, life: true });
  expect(r.auto.pick).toBeTruthy();
  expect(r.autoBack).toMatchObject({ at: 'auto', pick: r.auto.pick, hole: r.auto.hole }); // reopened at the collar it chose, whatever the view
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
  const size = page.getByRole('combobox', { name: 'Drill crew size' });
  await expect(size).toHaveValue('1');
  await size.selectOption({ label: 'Large' });
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.scale).toBe(1.6);
  await size.selectOption({ label: 'Small' });
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.scale).toBe(0.6);
  await box.uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.on).toBe(false);
  await expect(page.locator('#crew-ui')).toBeHidden();
});

// True scale: the rig and crew at real size (a 12 m mast on an 8 m skid, crew 1.8 m tall), heights times the vertical
// exaggeration. An option, not the default: the presets and the default are unchanged (sha256 checked separately).
test('true scale: real size, labelled, still alive in the live view, one fixed pose in exports', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, medium = (await E.setCrew({ on: true })).crew, mFig = E.exportPNG({ view: '3d' });
    const texts = (fn) => { const out = [], P = CanvasRenderingContext2D.prototype, f = P.fillText; P.fillText = function (t, ...a) { out.push(String(t)); return f.call(this, t, ...a); }; try { fn(); } finally { P.fillText = f; } return out; };
    const mTexts = texts(() => E.exportPNG({ view: '3d' }));
    const st = (await E.setCrew({ size: 'true' })).crew, fig = E.exportPNG({ view: '3d' }), tTexts = texts(() => E.exportPNG({ view: '3d' }));
    const p0 = E.getState().crew.people; await new Promise((ok) => setTimeout(ok, 2500)); const p1 = E.getState().crew.people; // the routines run
    const again = E.exportPNG({ view: '3d' });
    await E.setStyle({ verticalExaggeration: 2 }); await E.layersReady(); const ve = E.getState().crew;
    await E.setStyle({ verticalExaggeration: 1 }); await E.layersReady();
    await E.setCrew({ label: false }); const bare = texts(() => E.exportPNG({ view: '3d' })); await E.setCrew({ label: true });
    return { medium, mFig, mTexts, st, fig, tTexts, again, p0, p1, ve, bare };
  });
  expect(r.st).toMatchObject({ on: true, scale: 'true', shown: true, hole: r.medium.hole }); // the same collar as Medium
  expect(r.st.metres.mast).toBeCloseTo(12, 6); expect(r.st.metres.length).toBeCloseTo(8, 6); expect(r.st.metres.person).toBeCloseTo(1.8, 6); expect(r.st.metres.ve).toBe(1);
  expect(r.ve.metres).toMatchObject({ ve: 2 }); expect(r.ve.metres.mast).toBeCloseTo(12, 6); // still 12 m, drawn 24 scene units up like the terrain
  expect(r.tTexts.filter((t) => !r.mTexts.includes(t))).toEqual(['Drill rig, true scale']); // the leader's label, nothing else
  expect(r.bare.filter((t) => !r.mTexts.includes(t))).toEqual([]);
  expect(r.p0.some((p, i) => Math.hypot(p[0] - r.p1[i][0], p[1] - r.p1[i][1]) > 1e-5)).toBe(true); // crew life still runs
  expect(r.again === r.fig).toBe(true); // byte-stable after the crew moved
  expect(r.fig === r.mFig).toBe(false);
  keep('crew-default-medium.png', r.mFig); keep('crew-true-scale.png', r.fig);
});

test('Zoom to crew: a close oblique view of the true-scale pad, saved and exported as framed; a preset goes back', async ({ page }) => {
  await open3d(page);
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const r0 = await page.evaluate(async () => {
    const E = window.EM3D;
    E.setCamera({ zoom: 1000 }); const offZoom = E.getState().camera.zoom; // without the crew: the old range
    await E.setCrew({ on: true, scale: 'true' });
    E.setCamera({ zoom: 1000 }); const blockZoom = E.getState().camera.zoom; // looking at the block, not the crew: the old range
    E.setCamera({ view: 'a' }); const before = E.exportPNG({ view: '3d' });
    await E.setCrew({ on: false }); const noCrew = await E.zoomToCrew().then(() => null, (e) => e.message);
    return { offZoom, blockZoom, before, noCrew };
  });
  expect(r0.offZoom).toBe(250); expect(r0.blockZoom).toBe(250);
  expect(r0.noCrew).toMatch(/Turn the drill crew on/);
  await page.getByRole('checkbox', { name: /Drill crew/ }).check();
  await page.getByRole('combobox', { name: 'Drill crew size' }).selectOption({ label: 'True scale' });
  await expect(page.locator('#crew-hint')).toBeVisible();
  await expect(page.locator('#crew-hint')).toHaveText('At true scale the rig is ~12 m tall — zoom in to see it.');
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).crew.scale).toBe('true');
  await page.getByRole('button', { name: 'Zoom to the drill crew' }).click();
  await page.waitForTimeout(1500); // the flight
  const r = await page.evaluate(async () => {
    const E = window.EM3D, flown = E.exportPNG({ view: '3d' }); E.setCamera(E.getState().camera); // as saved: whole degrees, pan to 10 cm
    const s = E.getState(), close = E.exportPNG({ view: '3d' }), p = E.getProject();
    const span = (q) => Math.max(...q.map((a) => Math.max(...q.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])))));
    E.setCamera({ zoom: s.camera.zoom * 1.6 }); const closer = E.getState().camera.zoom, closerFig = E.exportPNG({ view: '3d' }); E.setCamera({ zoom: s.camera.zoom });
    await E.setCrew({ on: false }); E.setCamera({ view: 'a' }); const reset = E.getState().camera;
    await E.loadProject(p); await E.layersReady(); const back = E.getState(), again = E.exportPNG({ view: '3d' });
    E.setCamera({ view: 'a' }); const preset = E.getState().camera;
    return { cam: s.camera, crew: s.crew, span: span(s.crew.people), flown, close, closer, closerFig, reset, backCam: back.camera, same: again === close, preset };
  });
  expect(r.cam.zoom).toBeGreaterThan(1000); // far past the old 250% limit
  expect(r.cam.pan).toBeTruthy();
  expect(r.crew.screen.every((v) => v > 0.25 && v < 0.85)).toBe(true); // the pad in the middle of the frame
  expect(r.span).toBeGreaterThan(0.12); // the crew spread across a good part of the frame
  expect(r.closer).toBeGreaterThan(r.cam.zoom * 1.5); // and the wheel's range reaches in further
  expect(r.close === r0.before).toBe(false);
  expect(r.reset.zoom).toBeLessThanOrEqual(250); expect(r.reset.pan).toBeUndefined();
  expect(r.backCam).toMatchObject({ zoom: r.cam.zoom, pan: r.cam.pan }); // reopened as framed
  expect(r.same).toBe(true);
  expect(r.preset).toMatchObject({ zoom: 100 }); expect(r.preset.pan).toBeUndefined();
  keep('crew-true-zoom-to-crew.png', r.flown); keep('crew-true-zoom-closer.png', r.closerFig);
});
