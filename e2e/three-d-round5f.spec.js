import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

// Exploration Maps 3D round 5F: the geology setters repaint at once (B5), bracket callouts always export or say why
// not (B6), a standalone block section's details card in the free side of the frame, bracket callouts with a domain
// heading and hole chip on alternate sides (item 32), wall labels inside their unit's band (34), a see-through terrain
// that keeps its colours (36) and the fade at the bottom of the block (37).

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 300_000 }); // full-size exports and layer ZIPs under SwiftShader

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
// The texts drawn while fn runs on off-screen canvases (the export's and the faces'), with where they were drawn in
// the canvas's pixels, their alignment and width.
const drawnOf = (page, fn) => page.evaluate(async (src) => {
  const out = [], P = CanvasRenderingContext2D.prototype, f = P.fillText;
  P.fillText = function (t, x, y, ...a) {
    if (!this.canvas.isConnected) { const m = this.getTransform(); out.push({ t: String(t), x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, w: this.measureText(t).width * Math.hypot(m.a, m.b), align: this.textAlign, W: this.canvas.width }); }
    return f.call(this, t, x, y, ...a);
  };
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
// A page helper: the RGBA pixels of a PNG data URL.
const PIXELS = `async (url) => { const im = new Image(); im.src = url; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return { w: im.width, h: im.height, d: g.getImageData(0, 0, im.width, im.height).data }; }`;

test('B5: a geology setter alone repaints the figure and the section on screen, with no other setter after it', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D; await E.setGeology({ enabled: true, faces: 'all', section: true });
    E.showView('section'); await E.layersReady();
    const screen = () => document.getElementById('section').toDataURL();
    const before = { screen: screen(), png: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    await E.setGeology({ anisotropy: 15 }); // only the anisotropy
    const after = { screen: screen(), png: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    await E.setGeology({ search: 300 }); const searched = screen();
    return { screen: before.screen !== after.screen, png: before.png !== after.png, sec: before.sec !== after.sec, search: searched !== after.screen, used: E.getState().geology.anisotropy };
  });
  expect(r).toEqual({ screen: true, png: true, sec: true, search: true, used: 15 });
});

test('B6: every bracket exports, through surface changes and grouping; a callout left off says why', async ({ page }) => {
  await open3d(page);
  const RELEASE = ['Result ID,Hole ID,From (m),To (m),Published length,Grade,Unit,Analyte,Parent result,Approved text,Release date,Source,Approval status',
    'R15U,EX-015,20,80,60.0,0.62,%,Cu,,,2026-10-15,T1,Approved', 'R15L,EX-015,200,330,130.0,0.44,%,Cu,,,2026-10-15,T1,Approved',
    'R21U,EX-021,30,90,60.0,0.71,%,Cu,,,2026-10-15,T1,Approved', 'R21L,EX-021,220,380,160.0,0.55,%,Cu,,,2026-10-15,T1,Approved'].join('\n');
  const st = await page.evaluate(async (rel) => {
    const E = window.EM3D; E.addFiles([...E.getProject().files.map(({ name, text }) => ({ name, text })), { name: 'release.csv', text: rel, role: 'published' }]); await E.layersReady();
    // Grouping on: a bracket callout stays on its hole (it used to join a group card, which the column can drop).
    await E.applyPreset('blockSection', { holes: ['EX-015', 'EX-021'] }); await E.setTags({ autoGroup: true, groupRadius: 2000 });
    return E.getState();
  }, RELEASE);
  expect(st.callouts.mode).toBe('published'); expect(st.callouts.shown).toHaveLength(4);
  for (const surface of [1, 0.6, 0.25]) {
    const r = await page.evaluate(async (s) => {
      const E = window.EM3D; E.setStyle({ surface: s }); await E.layersReady();
      const zip = await E.exportLayers({ svg: true }); return { zip, hidden: E.getState().layout.callouts };
    }, surface);
    const svg = new TextDecoder().decode(unzipSync(Buffer.from(r.zip.split(',')[1], 'base64'))['annotations.svg']);
    for (const t of ['60.0 m @', '130.0 m @', '160.0 m @']) expect(svg).toContain(`>${t}<`);
    for (const t of ['0.62% Cu', '0.71% Cu', '0.44% Cu', '0.55% Cu']) expect(svg).toContain(`>${t}<`); // both upper and both lower domains
    expect(r.hidden).toEqual([]);
    const settings = JSON.parse(new TextDecoder().decode(unzipSync(Buffer.from(r.zip.split(',')[1], 'base64'))['figure-settings.json']));
    expect(settings.layout.callouts).toEqual([]); // the layers' settings carry the report
  }
  // In the left column, callouts that do not fit are left off, and listed with the reason.
  const col = await page.evaluate(async () => {
    const E = window.EM3D; await E.setBlock(null); E.setStyle({ coPlacement: 'column', calloutMode: 'calculated', coCount: 12 }); await E.setHolesShown(null); E.setFigureSize('square'); await E.layersReady();
    const t = []; const P = CanvasRenderingContext2D.prototype, f = P.fillText; P.fillText = function (x, ...a) { if (!this.canvas.isConnected) t.push(String(x)); return f.call(this, x, ...a); };
    // What a drawing leaves off is not the figure's work: the rest of the state is the same before and after it.
    const work = () => { const { layout: _l, step: _s, ...rest } = E.getState(); return JSON.stringify(rest); }, w0 = work();
    try { E.exportPNG({ view: '3d' }); } finally { P.fillText = f; }
    const s = E.getState(); return { shown: s.callouts.shown.map((c) => c.line1), hidden: s.layout.callouts, t, same: work() === w0 };
  });
  const missing = col.shown.filter((l) => !col.t.some((x) => x.startsWith(l.split(' from')[0])));
  expect(col.hidden.length).toBe(missing.length);
  col.hidden.forEach((h) => expect(h.why).toMatch(/no room in the callout column|behind the camera/));
  expect(col.same).toBe(true);
});

test('a standalone block section keeps its details card in the free side of the frame, clear of the block', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async (holes) => {
    const E = window.EM3D; E.setFigureSize('release'); await E.applyPreset('blockSection', { holes });
    const cam = E.getState().camera;
    await E.setMapUse({ use: 'standalone', what: 'Target zone · block section', date: 'October 2026', sources: 'Company database' });
    return { before: cam, after: E.getState().camera };
  }, HOLES);
  expect(r.after.pan).not.toEqual(r.before.pan); // framed again, the block moved over
  const d = await drawnOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  const head = d.find((x) => x.t === 'Target zone · block section');
  expect(head).toBeTruthy();
  // Under the card (from its first line to the right edge, and down it), the scene layer is empty: no block there.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers())).split(',')[1], 'base64'));
  const share = await page.evaluate(async ({ png, head: h, pixels }) => {
    const { w, h: H, d } = await (0, eval)(pixels)(`data:image/png;base64,${png}`);
    let n = 0, on = 0; for (let y = Math.max(0, Math.round(h.y - 20)); y < Math.min(H, h.y + 500); y += 3) for (let x = Math.round(h.x); x < w - 10; x += 3) { n++; if (d[(y * w + x) * 4 + 3] > 128) on++; }
    return on / n;
  }, { png: Buffer.from(zip['scene.png']).toString('base64'), head, pixels: PIXELS });
  expect(share).toBeLessThan(0.01);
  // Back to a presentation figure: framed again as the preset frames it.
  const back = await page.evaluate(async () => (await window.EM3D.setMapUse({ use: 'presentation' })).camera);
  back.pan.forEach((v, i) => expect(Math.abs(v - r.before.pan[i])).toBeLessThan(2)); expect(Math.abs(back.zoom - r.before.zoom)).toBeLessThan(3);
});

test('item 32: bracket callouts with a domain heading, hole chip and bold result, the holes on alternate sides, none overlapping', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const st = await page.evaluate(async () => {
    const E = window.EM3D; E.setFigureSize('release'); await E.applyPreset('blockSection', { holes: ['EX-015', 'EX-021'] });
    E.setCallout('EX-015', { heading: 'Upper domain' }); E.setCallout('EX-021', { heading: 'Lower domain' });
    return E.setBlock({ brackets: 'callout' });
  });
  expect(st.block.brackets).toBe('callout');
  expect(st.callouts.overrides['EX-015'].heading).toBe('Upper domain');
  const lines = st.callouts.shown.map((c) => ({ id: c.holeId, l1: c.line1.split(' from')[0] }));
  const d = await drawnOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(d.map((x) => x.t)).toEqual(expect.arrayContaining(['UPPER DOMAIN', 'LOWER DOMAIN', 'EX-015', 'EX-021']));
  const mains = lines.map((l) => d.find((x) => x.t === l.l1)); // the result on one line, in bold
  mains.forEach((m) => expect(m).toBeTruthy());
  expect(new Set(mains.map((m) => m.align)).size).toBe(2); // one hole's text to the left (right-aligned), the other's to the right
  // No two callouts' texts overlap.
  const boxOf = (m) => { const x0 = m.align === 'right' ? m.x - m.w : m.x; return [x0, m.y - 25, x0 + m.w, m.y + 25]; };
  const [a, b] = mains.map(boxOf);
  expect(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]).toBe(true);
  // Plain again: the figure as before.
  const plain = await page.evaluate(async () => { const E = window.EM3D; const p = E.exportPNG({ view: '3d' }); await E.setBlock({ brackets: 'plain' }); return p !== E.exportPNG({ view: '3d' }); });
  expect(plain).toBe(true);
});

test('item 34: a unit\'s wall label sits inside its band on that face, says why when it cannot, and stays put with units "fixed"', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async (holes) => {
    const E = window.EM3D; E.setFigureSize('release'); await E.applyPreset('blockSection', { holes });
    const front = E.getState().wallLabels.find((l) => l.size === 'heading').face;
    const id = await E.addWallLabel({ unit: 'BIO', face: front, size: 'title' }); // named after the unit
    const long = await E.addWallLabel({ unit: 'PHY', face: front, size: 'title', text: 'PHYLLIC ALTERATION, SERICITE-QUARTZ-PYRITE, IN A BAND FAR TOO THIN FOR SO LONG A NAME AS THIS ONE, WHICH RUNS ON AND ON' });
    await E.layersReady();
    // Where the labels went is a drawing result (getState().layout), never part of the figure's settings: placing them
    // changes nothing that is saved, undone or compared for unsaved changes.
    const work = () => { const { layout: _l, step: _s, ...rest } = E.getState(); return JSON.stringify(rest); }, w0 = work();
    E.exportPNG({ view: '3d' }); E.exportPNG({ view: '3d' });
    const s = E.getState(), at = s.layout.wallLabels, L = { ...s.wallLabels.find((l) => l.id === id), ...at[id] }, Lp = { ...at[long] };
    const saved = JSON.stringify(E.getProject().settings.wallLabels);
    await E.setBlock({ units: 'fixed' }); const f = { ...E.getState().wallLabels.find((l) => l.id === id), ...E.getState().layout.wallLabels[id] };
    return { L, Lp, fixed: f, same: work() === w0, saved };
  }, HOLES);
  expect(r.L.text).toBe('EARLY BIOTITE');
  expect(r.L.at).toBeTruthy(); expect(r.L.why).toBeUndefined();
  expect(r.L.at.scale).toBeGreaterThan(0.4); expect(Math.abs(r.L.at.rotation)).toBeLessThan(35);
  expect(r.L.at.v).toBeLessThan(0.75); // in the biotite, under the cover and phyllic bands
  expect(r.Lp.at).toBe(null); expect(r.Lp.why).toMatch(/no clear room inside its unit/);
  expect(r.fixed.at).toBeUndefined(); expect(r.fixed.u).toBe(r.L.u); // where it was put
  expect(r.same).toBe(true); expect(r.saved).not.toMatch(/"at"|"why"/); // nothing of the placement saved
});

test('item 34: new logs with the same block and settings place a unit\'s wall label again', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async (holes) => {
    const E = window.EM3D; E.setFigureSize('release'); await E.applyPreset('blockSection', { holes });
    const front = E.getState().wallLabels.find((l) => l.size === 'heading').face, id = await E.addWallLabel({ unit: 'BIO', face: front, size: 'title' });
    await E.layersReady(); E.exportPNG({ view: '3d' }); const before = E.getState().layout.wallLabels[id].at;
    // The biotite starts far deeper in the new logs: the same bounds, units and settings, other data.
    const ids = E.getState().project.holeIds, lith = ['HoleID,From,To,Lith,Description', ...ids.flatMap((h) => [`${h},0,60,COV,Cover`, `${h},60,330,PHY,Phyllic alteration`, `${h},330,700,BIO,Early biotite`])].join('\n');
    E.addFiles([...E.getProject().files.filter((f) => f.name !== 'lithology.csv').map(({ name, text }) => ({ name, text })), { name: 'lithology.csv', text: lith }]);
    await E.layersReady(); E.exportPNG({ view: '3d' });
    return { before, after: E.getState().layout.wallLabels[id].at };
  }, HOLES);
  expect(r.before).toBeTruthy(); expect(r.after).toBeTruthy();
  expect(r.after.v).toBeLessThan(r.before.v - 0.05); // lower down, in the biotite as it now lies
});

test('item 36: a see-through terrain keeps its colours (only the holes show through); a block saved before keeps the plain blend', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async ({ holes, pixels }) => {
    const E = window.EM3D, px = (0, eval)(pixels); E.setFigureSize('release'); await E.applyPreset('blockSection', { holes }); await E.setBlock({ traces: 'tubes' });
    const opaque = E.exportPNG({ view: '3d' });
    E.setStyle({ surface: 0.35 }); await E.layersReady(); const vivid = E.exportPNG({ view: '3d' });
    await E.setBlock({ surface: 'mix' }); const mix = E.exportPNG({ view: '3d' });
    const [o, v, m] = await Promise.all([opaque, vivid, mix].map(px)), diff = (a, b) => { let s = 0; for (let i = 0; i < a.d.length; i += 4) s += Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]); return s / (a.d.length / 4); };
    // A block saved before round 5F (no "surface" setting) reopens with the plain blend.
    // Each reopened the same way: with "mix", with "vivid", and as saved before round 5F (no setting).
    const p = JSON.parse(JSON.stringify(E.getProject())), load = async (b) => { const q = structuredClone(p); q.settings.block = b; const st = await E.loadProject(q); await E.layersReady(); return [E.exportPNG({ view: '3d' }), st.block]; };
    const [mixed] = await load({ ...p.settings.block, surface: 'mix' }), [viv] = await load({ ...p.settings.block, surface: 'vivid' });
    const old = { ...p.settings.block }; delete old.surface; delete old.units; delete old.fadeBottom; const [was, oldBlock] = await load(old);
    return { vividOff: diff(v, o), mixOff: diff(m, o), vividSame: vivid === opaque, old: was === mixed, oldVivid: was === viv, oldBlock };
  }, { holes: HOLES, pixels: PIXELS });
  expect(r.vividSame).toBe(false); // the tubes under the top show through
  expect(r.vividOff * 3).toBeLessThan(r.mixOff); // and the top keeps its colours
  expect(r.old).toBe(true); expect(r.oldVivid).toBe(false); expect(r.oldBlock.surface).toBeUndefined();
});

test('item 37: an optional fade at the bottom of the block, off by default, toward the page or transparent', async ({ page }) => {
  await open3d(page);
  await withLogs(page);
  const r = await page.evaluate(async ({ holes, pixels }) => {
    const E = window.EM3D, px = (0, eval)(pixels); E.setFigureSize('release'); const st = await E.applyPreset('blockSection', { holes });
    await E.setBlock({}); // rebuilt once, as each change below rebuilds
    const off = [E.exportPNG({ view: '3d' }), E.exportPNG({ view: '3d', background: 'transparent' })];
    await E.setBlock({ fadeBottom: 0.4 }); const on = [E.exportPNG({ view: '3d' }), E.exportPNG({ view: '3d', background: 'transparent' })];
    const solid = async (url) => { const { d } = await px(url); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++; return n; };
    const light = async (url) => { const { w, h, d } = await px(url); let s = 0, n = 0; for (let y = Math.round(h * 0.55); y < h * 0.85; y += 2) for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 750) { s += d[i] + d[i + 1] + d[i + 2]; n++; } } return s / Math.max(1, n); };
    await E.setBlock({ fadeBottom: 0 }); const back = E.exportPNG({ view: '3d' });
    let bad = null; try { await E.setBlock({ fadeBottom: 'x' }); } catch (e) { bad = e.message; }
    return { def: st.block.fadeBottom, differs: on[0] !== off[0], solidOff: await solid(off[1]), solidOn: await solid(on[1]), lightOff: await light(off[0]), lightOn: await light(on[0]), back: back === off[0], bad };
  }, { holes: HOLES, pixels: PIXELS });
  expect(r.def).toBe(0);
  expect(r.differs).toBe(true);
  expect(r.solidOn).toBeLessThan(r.solidOff); // transparent: the base fades out to clear
  expect(r.lightOn).toBeGreaterThan(r.lightOff); // on white: the lower block is paler
  expect(r.back).toBe(true);
  expect(r.bad).toMatch(/fadeBottom must be 0/);
});
