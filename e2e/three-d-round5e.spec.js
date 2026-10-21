import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

// Exploration Maps 3D round 5E: the block section (block.js). The preset sets an opaque block of a few holes with
// geology on its faces, grade bars, plain brackets and the legend, depth ticks and scale on the side face; hidden
// holes lose their traces, IDs and callouts; earlier figures are unchanged.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 300_000 }); // full-size exports and layer ZIPs under SwiftShader

const LEGACY = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
// Figures exported from different states are compared byte for byte, so a page keeps the first font stylesheet it
// was given (as in three-d-round5d.spec.js).
const fontCss = new WeakMap();
async function pinFonts(page) {
  if (fontCss.has(page)) return;
  fontCss.set(page, null);
  await page.route('https://fonts.googleapis.com/css2?**', async (route) => {
    if (!fontCss.get(page)) { const r = await route.fetch(); const { 'content-encoding': _e, 'content-length': _l, ...headers } = r.headers(); fontCss.set(page, { status: r.status(), headers, body: await r.body() }); }
    await route.fulfill(fontCss.get(page));
  });
}
async function open3d(page) {
  await pinFonts(page);
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
// The sample with a three-unit lithology log by depth, so the faces carry geology.
const withLogs = (page) => page.evaluate(async () => {
  const E = window.EM3D, ids = E.getState().project.holeIds;
  const lith = ['HoleID,From,To,Lith,Description', ...ids.flatMap((id) => [`${id},0,60,COV,Cover`, `${id},60,140,PHY,Phyllic alteration`, `${id},140,700,BIO,Early biotite`])].join('\n');
  E.addFiles([...E.getProject().files.map(({ name, text }) => ({ name, text })), { name: 'lithology.csv', text: lith }]);
  await E.layersReady();
});
const HOLES = ['EX-009', 'EX-015', 'EX-021', 'EX-027'];

test('the block section preset sets an opaque block of the chosen holes, its furniture on the side face', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  await withLogs(page);
  // The news-release size (3:2), as the reference figure: the side face has room for the legend.
  const st = await page.evaluate(async (holes) => { window.EM3D.setFigureSize('release'); return window.EM3D.applyPreset('blockSection', { holes }); }, HOLES);
  expect(st.holesShown).toEqual(HOLES);
  expect(st.block).toMatchObject({ furniture: true, traces: 'overlay', brackets: 'plain', page: 'clean', hist: { side: 'face' } });
  expect(st.geology).toMatchObject({ enabled: true, faces: 'all', opacity: 1, labelStyle: 'caps', blend: 1, fade: 0.3 });
  expect(st.tags).toMatchObject({ at: 'collar', style: 'plain', idMode: 'all', emphasis: 'none', histograms: true });
  expect(st.display).toMatchObject({ coPlacement: 'bracket', ribbons: false, inset: false });
  expect(st.terrain.blockStyle).toBe('solid');
  expect(st.wallLabels.filter((l) => l.size === 'heading')).toHaveLength(1);
  expect(st.wallLabels[0].text).toBe('MAIN ZONE\n3D drilling model · illustrative data');
  expect(st.callouts.shown.map((c) => c.holeId).every((id) => HOLES.includes(id))).toBe(true);
  expect(st.camera.azimuth).toBe(322); // 38° round from looking north at the south face
  // The figure: the shown IDs only, plain brackets ("508 m @" over "0.53% Cu"), depth ticks and the legend on the
  // side face, no section letters and no title block.
  const t = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(t.filter((x) => /^EX-\d{3}$/.test(x)).sort()).toEqual(HOLES);
  expect(t.some((x) => /^\d+ m @$/.test(x))).toBe(true);
  expect(t.some((x) => /^[\d.]+% Cu$/.test(x))).toBe(true);
  expect(t.some((x) => /^– \d+ m$/.test(x))).toBe(true);
  expect(t).toContain('Lithology');
  expect(t).not.toContain('A′'); expect(t).not.toContain(st.brand.title);
  // The furniture is drawn in the face's perspective: skewed text in the editable annotations.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ svg: true }))).split(',')[1], 'base64'));
  const svg = new TextDecoder().decode(zip['annotations.svg']);
  expect(svg).toMatch(/transform="matrix\([^"]+\)" xml:space="preserve">Lithology</);
  expect(svg).toMatch(/transform="matrix\([^"]+\)" xml:space="preserve">– \d+ m</);
  expect(svg).toContain('>508 m @<');
  // Turned to look straight at the front face, the side face is edge-on: the legend goes back to the page, unskewed.
  await page.evaluate(() => window.EM3D.setCamera({ azimuth: 0 }));
  const zip2 = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ svg: true }))).split(',')[1], 'base64'));
  const svg2 = new TextDecoder().decode(zip2['annotations.svg']);
  expect(svg2).toMatch(/<text[^>]*>Lithology</); expect(svg2).not.toMatch(/matrix\([^"]+\)" xml:space="preserve">Lithology</);
  expect(svg2).not.toMatch(/>– \d+ m</);
  // Saved and reopened, the look stays.
  const after = await page.evaluate(async () => { const E = window.EM3D, p = JSON.parse(JSON.stringify(E.getProject())); E.clearFiles(); return E.loadProject(p); });
  expect(after.block).toEqual(st.block); expect(after.holesShown).toEqual(HOLES);
  expect(errors).toEqual([]);
});

test('hidden holes lose their traces, IDs and callouts; every hole again gives back the same figure', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, all = E.exportPNG({ view: '3d' }), sec = E.exportPNG({ view: 'section' });
    const s = await E.setHolesShown(['EX-015', 'EX-021']);
    const some = E.exportPNG({ view: '3d' });
    let bad = null; try { await E.setHolesShown(['EX-999']); } catch (e) { bad = e.message; }
    const back = await E.setHolesShown(null);
    return { callouts: s.callouts.shown.map((c) => c.holeId), cands: s.callouts.candidates.map((c) => c.holeId), pending: s.project.pendingHoles, shown: s.holesShown, bad, differs: some !== all, same: E.exportPNG({ view: '3d' }) === all, secSame: E.exportPNG({ view: 'section' }) === sec, backShown: back.holesShown };
  });
  expect(r.shown).toEqual(['EX-015', 'EX-021']);
  expect(r.callouts.length).toBeGreaterThan(0);
  expect([...r.callouts, ...r.cands].every((id) => ['EX-015', 'EX-021'].includes(id))).toBe(true);
  expect(r.bad).toMatch(/No hole "EX-999"/);
  expect(r).toMatchObject({ differs: true, same: true, secSame: true, backShown: null });
  const t = await textsOf(page, async () => { await window.EM3D.setHolesShown(['EX-015', 'EX-021']); window.EM3D.setTags({ idMode: 'all' }); return window.EM3D.exportPNG({ view: '3d' }); });
  expect([...new Set(t.filter((x) => /^EX-\d{3}$/.test(x)))].sort()).toEqual(['EX-015', 'EX-021']); // at the toe, and on the callouts
  // The picker in the Layout step lists every hole, the shown ones ticked; unticking one hides it.
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await page.locator('[data-block="holes"]').click();
  await expect(page.locator('#block-ui [data-hs]')).toHaveCount(34);
  await page.locator('#block-ui [data-hs][value="EX-021"]').uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).holesShown).toEqual(['EX-015']);
});

test('plain brackets: the length over the grade beside each hole, no chip or "incl." line; cards again on request', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const boxes = await page.evaluate(async (holes) => {
    const E = window.EM3D; await E.applyPreset('blockSection', { holes });
    return E.getState().callouts.shown.map((c) => c.holeId);
  }, HOLES);
  expect(boxes.length).toBeGreaterThan(1);
  const t = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  // Each callout as two lines, length then grade, and no ID chip or "incl." line beside the brackets.
  const lens = t.filter((x) => /^\d+ m @$/.test(x)), grades = t.filter((x) => /^[\d.]+% Cu$/.test(x));
  expect(lens.length).toBe(boxes.length); expect(grades.length).toBe(boxes.length);
  expect(t.some((x) => /^incl\./.test(x))).toBe(false);
  // Back to cards: the round-4 bracket with its chip and card.
  const card = await textsOf(page, async () => { await window.EM3D.setBlock({ brackets: 'card' }); return window.EM3D.exportPNG({ view: '3d' }); });
  expect(card.some((x) => /^\d+ m @ [\d.]+% Cu$/.test(x))).toBe(true);
});

test('an earlier figure keeps its look: the pre-round-4 figure and a version 4 figure, before and after a block section', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async ({ legacy, holes }) => {
    const E = window.EM3D, png = () => [E.exportPNG({ view: '3d' }), E.exportPNG({ view: 'section' })];
    const v4 = JSON.parse(JSON.stringify(E.getProject())); v4.settings.designVersion = 4; delete v4.settings.grid; delete v4.settings.holesShown; delete v4.settings.block;
    await E.loadProject(legacy); await E.layersReady(); const a = png(), st = E.getState();
    await E.loadProject(v4); await E.layersReady(); const b = png();
    // A block section in between loads block.js; neither figure changes after it.
    await E.applyPreset('blockSection', { holes }); await E.layersReady();
    await E.loadProject(legacy); await E.layersReady(); const a2 = png();
    await E.loadProject(v4); await E.layersReady(); const b2 = png();
    return { legacy: [a[0] === a2[0], a[1] === a2[1]], v4: [b[0] === b2[0], b[1] === b2[1]], block: st.block, holesShown: st.holesShown };
  }, { legacy: LEGACY, holes: HOLES });
  expect(r).toEqual({ legacy: [true, true], v4: [true, true], block: null, holesShown: null });
});

test('the geology options: near faces, soft and dashed contacts, a fade and names in capitals', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D; await E.setGeology({ enabled: true, faces: 'far' }); const base = E.exportPNG({ view: '3d' });
    const near = await E.setGeology({ faces: 'near' }); const n = E.exportPNG({ view: '3d' });
    await E.setGeology({ faces: 'far', blend: 1.5, dash: true, fade: 0.4, fadeDir: 'up' }); const soft = E.exportPNG({ view: '3d' });
    await E.setGeology({ blend: 0, dash: false, fade: 0 }); const plain = E.exportPNG({ view: '3d' });
    const errs = []; for (const o of [{ faces: 'side' }, { fadeDir: 'sideways' }, { labelStyle: 'bold' }, { blend: 'x' }]) { try { await E.setGeology(o); } catch (e) { errs.push(e.message); } }
    return { painted: near.geology.facesPainted, nearDiffers: n !== base, softDiffers: soft !== base, plainSame: plain === base, errs };
  });
  expect(r.painted.length).toBe(2);
  expect(r).toMatchObject({ nearDiffers: true, softDiffers: true, plainSame: true });
  expect(r.errs).toHaveLength(4);
  // Unit names painted on the faces in capitals (drawn on the faces' own canvases as the figure is exported).
  const caps = await textsOf(page, async () => { await window.EM3D.setGeology({ labelStyle: 'caps' }); return window.EM3D.exportPNG({ view: '3d' }); });
  expect(caps.some((x) => ['EARLY BIOTITE', 'COVER', 'PHYLLIC ALTERATION'].includes(x))).toBe(true);
});
