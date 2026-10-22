import { test, expect } from '@playwright/test';

// Exploration Maps 3D round 5H, on a block section: thick bars in the release palette, a colour per hole, elevation
// ticks on the block's edge, A and A′ at the section's ends, one pill for a common pad, the release legend, incl. lines
// without "from N m" and a flat scale bar. Each is off until set, and with them off the figure is as before.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 300_000 }); // exports under SwiftShader

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
const ALL = { hist: { style: 'thick', palette: 'release' }, colors: { 'BS-077': '#3f9a3c', 'BS-078': '#1fb0c6' }, ticks: 'elevation', ends: true, pad: true, legend: { geology: 'GEOLOGY (AFTER TOWER)' }, inclFrom: false, scale: 'flat' };
const OFF = { hist: { style: 'spikes', palette: 'orange' }, colors: null, ticks: 'depth', ends: false, pad: false, legend: null, inclFrom: true, scale: 'face', scaleNote: null };
// Tower-like data: 077 and 078 from one pad, a third hole away from it, four units, Au every 2 m with an upper and a lower
// domain, and the release table with incl. results; then the block-section preset on 077 and 078 with callout brackets.
const tower = (page, warm = true) => page.evaluate(async ([ALL, OFF, warm]) => {
  const E = window.EM3D, E0 = 412300, N0 = 6421800, Z0 = 1290;
  const holes = [{ id: 'BS-077', e: E0, n: N0, dip: -50, len: 420 }, { id: 'BS-078', e: E0 + 3, n: N0 + 2, dip: -70, len: 460 }, { id: 'BS-061', e: E0 - 140, n: N0 + 120, dip: -60, len: 380 }];
  const dom = { 'BS-077': [[38, 58.3, 3.13], [150, 284, 0.65]], 'BS-078': [[62, 112.3, 1.07], [226, 340.5, 0.44]], 'BS-061': [[80, 120, 0.4]] };
  const az = 226 * Math.PI / 180, unit = (x, y, z) => { const t = (Z0 - z) + 0.12 * (x - E0) + 0.08 * (y - N0); return t < 40 ? 'CHC' : t < 75 ? 'DUR' : t < 250 ? 'NIC' : 'NWD'; };
  const as = ['HoleID,From,To,Au_gpt'], li = ['HoleID,From,To,Lith'];
  holes.forEach((h, k) => {
    for (let d = 2; d < h.len - 2; d += 2) { const D = dom[h.id].find(([a, b]) => d >= a && d < b), r = (Math.sin((d * 7.1 + k * 131) * 12.9898) * 43758.5453) % 1; as.push(`${h.id},${d},${d + 2},${(D ? D[2] * (0.6 + Math.abs(r)) : 0.05).toFixed(3)}`); }
    const dp = h.dip * Math.PI / 180; let cur = null, from = 0;
    for (let d = 0; d <= h.len; d += 2) { const c = unit(h.e + Math.sin(az) * Math.cos(dp) * d, h.n + Math.cos(az) * Math.cos(dp) * d, Z0 + Math.sin(dp) * d); if (c !== cur) { if (cur) li.push(`${h.id},${from},${d},${cur}`); cur = c; from = d; } }
    li.push(`${h.id},${from},${h.len},${cur}`);
  });
  const rel = ['Result ID,Hole ID,From (m),To (m),Published length,Grade,Unit,Analyte,Parent result,Approved text,Release date,Source,Approval status',
    '077-U,BS-077,38,58.3,20.3,3.13,g/t,Au,,,2026-10-15,NR,Approved', '077-L,BS-077,150,284,134.0,0.65,g/t,Au,,,2026-10-15,NR,Approved',
    '078-U,BS-078,62,112.3,50.3,1.07,g/t,Au,,,2026-10-15,NR,Approved', '078-L,BS-078,226,340.5,114.5,0.44,g/t,Au,,,2026-10-15,NR,Approved',
    '077-Ui,BS-077,46,54,8.0,7.16,g/t,Au,077-U,,2026-10-15,NR,Approved', '078-Ui,BS-078,70,73.6,3.6,4.15,g/t,Au,078-U,,2026-10-15,NR,Approved', '078-Ui2,BS-078,95,105,10.0,2.29,g/t,Au,078-U,,2026-10-15,NR,Approved'].join('\n');
  E.addFiles([{ name: 'collars.csv', text: ['HoleID,Easting,Northing,Elevation,Depth', ...holes.map((h) => `${h.id},${h.e},${h.n},${Z0},${h.len}`)].join('\n') },
    { name: 'surveys.csv', text: ['HoleID,Depth,Azimuth,Dip', ...holes.flatMap((h) => [`${h.id},0,226,${h.dip}`, `${h.id},${h.len},226,${h.dip}`])].join('\n') },
    { name: 'assays.csv', text: as.join('\n') }, { name: 'lithology.csv', text: li.join('\n') }, { name: 'release.csv', text: rel, role: 'published' }]);
  await E.layersReady();
  E.setStyle({ valueCol: 'Au_gpt', valueLabel: 'Au g/t', bins: [0.4, 1, 3, 10] });
  await E.applyPreset('blockSection', { holes: ['BS-077', 'BS-078'], block: { brackets: 'callout' } });
  // The unit names painted on the faces keep clear of the screen's last drawing, so they can move a little from one
  // drawing to the next (as on main): off here, where exports are compared byte for byte.
  await E.setGeology({ labels: false }); await E.layersReady();
  // Every font face the options draw with, loaded before exports are compared.
  if (warm) { await E.setBlock(ALL); E.exportPNG({ view: '3d' }); await E.setBlock(OFF); E.exportPNG({ view: '3d' }); await document.fonts.ready; }
}, [ALL, OFF, warm]);

test('every round 5H option drawn on a block section, and the figure as before with them off', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  await tower(page);
  const before = await page.evaluate(() => { const st = window.EM3D.getState(); return { png: window.EM3D.exportPNG({ view: '3d' }), block: st.block, layout: st.layout.block }; });
  expect(before.layout).toEqual({ ticks: [], ends: [], pads: [], scale: null }); // nothing of 5H drawn
  const t0 = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(t0).toEqual(expect.arrayContaining(['BS-077', 'BS-078', 'incl. 8.0 m @ 7.16 g/t Au from 46 m']));
  await page.evaluate((o) => window.EM3D.setBlock(o), ALL);
  const t = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  // The pad's pill in place of the two IDs; A and A′; the release legend; incl. lines without "from"; the flat scale bar.
  expect(t).toEqual(expect.arrayContaining(['077 & 078', 'A', 'A′', 'ASSAY · Au g/t', 'GEOLOGY (AFTER TOWER)', 'Holes 077 & 078 (this release)', 'Published interval (down-hole)',
    'incl. 8.0 m @ 7.16 g/t Au', 'incl. 3.6 m @ 4.15 & 10.0 m @ 2.29 g/t Au', '≥ 10', '0.4 – 1']));
  expect(t.filter((x) => x === 'BS-077')).toHaveLength(2); // the two callout chips only: no collar ID
  expect(t.some((x) => /from \d+ m/.test(x))).toBe(false);
  expect(t.some((x) => /^– \d+ m$/.test(x))).toBe(false); // no depth ticks with elevation ticks
  expect(t.some((x) => /^Scale at block centre · looking \d{3}°, plunge \d+°$/.test(x))).toBe(true);
  const st = await page.evaluate(() => window.EM3D.getState());
  expect(st.block).toMatchObject(ALL);
  const L = st.layout.block;
  expect(L.ticks.length).toBeGreaterThanOrEqual(2); L.ticks.forEach((z) => expect(t).toContain(`${z} m`));
  expect(L.ticks.every((z) => z % 50 === 0 && z > 800 && z < 1290)).toBe(true);
  expect(L.ends.map((e) => e.tag)).toEqual(['A', 'A′']);
  expect(L.pads).toEqual([{ text: '077 & 078', holes: ['BS-077', 'BS-078'] }]);
  expect(L.scale.metres).toBeGreaterThan(0); expect(t).toContain(`${L.scale.metres} m`);
  // Drawing again changes none of the figure's settings (the drawing results are only under layout).
  const again = await page.evaluate(() => { const E = window.EM3D, a = E.getState(); E.exportPNG({ view: '3d' }); const b = E.getState(); delete a.layout; delete b.layout; return JSON.stringify(a) === JSON.stringify(b); });
  expect(again).toBe(true);
  // Texts set for the pill, the legend and the note; no ticks; then every option off: the figure as before.
  await page.evaluate(() => window.EM3D.setBlock({ pad: 'Pad 7', legend: { assay: 'ASSAY (Au g/t)', holes: 'This release' }, scaleNote: 'Flat scale', ticks: 'none' }));
  const t2 = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(t2).toEqual(expect.arrayContaining(['Pad 7', 'ASSAY (Au g/t)', 'This release', 'Flat scale']));
  expect(t2.some((x) => /^– \d+ m$/.test(x))).toBe(false); // no depth ticks either
  expect((await page.evaluate(() => window.EM3D.getState())).layout.block.ticks).toEqual([]);
  const after = await page.evaluate(async (o) => { const E = window.EM3D; await E.setBlock(o); return { png: E.exportPNG({ view: '3d' }), block: E.getState().block }; }, OFF);
  expect(after.block).toEqual(before.block);
  expect(after.png === before.png).toBe(true);
  expect(await page.evaluate(() => window.EM3D.setBlock({ ticks: 'top' }).then(() => null, (e) => e.message))).toMatch(/ticks must be "depth"/);
  expect(errors).toEqual([]);
});

test('thick bars and hole colours change the figure, and it is the same again without them', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  await tower(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, plain = E.exportPNG({ view: '3d' });
    await E.setBlock({ hist: { style: 'thick', palette: 'release' } }); const thick = E.exportPNG({ view: '3d' });
    await E.setBlock({ colors: { 'BS-077': '#3f9a3c' } }); const coloured = E.exportPNG({ view: '3d' });
    await E.setBlock({ hist: { style: 'spikes', palette: 'orange' }, colors: null }); return { thick: thick !== plain, coloured: coloured !== thick, back: E.exportPNG({ view: '3d' }) === plain };
  });
  expect(r).toEqual({ thick: true, coloured: true, back: true });
  expect(errors).toEqual([]);
});

test('the round 5H controls in the Layout step, clicked at the desktop size', async ({ page }) => {
  test.setTimeout(600_000); // each change redraws the block under SwiftShader (several seconds each)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  await tower(page, false);
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const ui = page.locator('#block-ui'), state = () => page.evaluate(() => window.EM3D.getState().block);
  await ui.locator('[data-bh="style"]').selectOption('thick'); await ui.locator('[data-bh="palette"]').selectOption('release');
  await expect.poll(async () => (await state()).hist).toMatchObject({ style: 'thick', palette: 'release' });
  await ui.locator('[data-bc]').check();
  await expect.poll(async () => (await state()).colors).toEqual({ 'BS-077': '#3f9a3c', 'BS-078': '#1fb0c6' });
  await ui.locator('[data-hc="BS-078"]').fill('#ff8800');
  await expect.poll(async () => (await state()).colors['BS-078']).toBe('#ff8800');
  for (const k of ['ends', 'pad', 'legend', 'inclFrom']) await ui.locator(`[data-bo="${k}"]`).check();
  await expect.poll(async () => { const b = await state(); return [b.ends, b.pad, b.legend, b.inclFrom]; }).toEqual([true, true, {}, false]);
  await ui.locator('[data-bs="ticks"]').selectOption('elevation'); await ui.locator('[data-bs="scale"]').selectOption('flat');
  await expect.poll(async () => { const b = await state(); return [b.ticks, b.scale]; }).toEqual(['elevation', 'flat']);
  await ui.locator('[data-bp]').fill('077 & 078 pad'); await ui.locator('[data-bp]').press('Enter'); await ui.locator('[data-bp]').blur();
  await ui.locator('[data-bl="geology"]').fill('GEOLOGY (AFTER TOWER)'); await ui.locator('[data-bl="geology"]').blur();
  await ui.locator('[data-bn]').fill('Scale at block centre'); await ui.locator('[data-bn]').blur();
  await expect.poll(async () => { const b = await state(); return [b.pad, b.legend.geology, b.scaleNote]; }).toEqual(['077 & 078 pad', 'GEOLOGY (AFTER TOWER)', 'Scale at block centre']);
  await ui.locator('[data-bo="pad"]').uncheck(); await ui.locator('[data-bc]').uncheck(); // unticked: gone from the block
  await expect.poll(async () => { const b = await state(); return ['ends', 'pad', 'legend', 'inclFrom', 'colors'].filter((k) => k in b); }).toEqual(['ends', 'legend', 'inclFrom']);
  expect(errors).toEqual([]);
});
