import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';

// Exploration Maps 3D: "Find claims" (the 2D app's registries, /api/claims and /api/bc-claims, mocked here) adds
// the project's claims and their neighbours as area overlays with role "claims" and the registry's credit, and
// insetStyle "claims" draws them as the claim map inset. A figure that does not ask for it is unchanged.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 150_000 });

const LEGACY = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
// Fictional claims round the Example Ridge sample (UTM 9N, NAD83): three of Example Resources over the drilling,
// eight neighbours of two other holders round them.
const UTM9 = '+proj=utm +zone=9 +datum=NAD83 +units=m +no_defs';
const ll = (x, y) => proj4(UTM9, 'WGS84', [x, y]).map((v) => Math.round(v * 1e7) / 1e7);
const tile = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => ll(x, y))];
const claim = (n, owner, box) => ({ type: 'Feature', properties: { TENURE_NUMBER_ID: n, CLAIM_NAME: `ER ${n}`, OWNER_NAME: owner, TITLE_TYPE_DESCRIPTION: 'Mineral', GOOD_TO_DATE: '2028-06-30', AREA_IN_HECTARES: 420.5 }, geometry: { type: 'Polygon', coordinates: tile(...box) } });
const PROJECT = [0, 1, 2].map((i) => claim(1090001 + i, 'Example Resources Ltd.', [411100 + i * 800, 6420800, 411900 + i * 800, 6422800]));
const NEIGHBOURS = [];
[[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].forEach(([i, j], k) => {
  const x0 = 412300 + i * 2400 - 1200, y0 = 6421800 + j * 2000 - 1000;
  NEIGHBOURS.push(claim(1080001 + k, k % 2 ? 'Ridge Metals Corp.' : 'Northern Prospectors Inc.', [x0, y0, x0 + 2400, y0 + 2000]));
});
const fc = (features) => ({ type: 'FeatureCollection', features, meta: { returned: features.length, truncated: false } });

async function open3d(page, calls = []) {
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  // No tiles (real terrain, imagery): the figure keeps its fitted surface, the same in every run.
  await page.route(/^https:\/\/(?!fonts\.)/, (r) => r.abort());
  await page.route('**/api/bc-claims?**', (r) => { calls.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fc([...PROJECT, ...NEIGHBOURS])) }); });
  await page.route('**/api/claims?**', (r) => { calls.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fc(PROJECT)) }); });
  await page.goto('/3d');
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(() => window.EM3D.layersReady());
}
const withCRS = (page) => page.evaluate(async () => { await window.EM3D.setCRS('EPSG:26909'); await window.EM3D.terrainReady(); await window.EM3D.layersReady(); });
// The texts drawn on the figure's canvas while fn runs in the page (an export).
const textsOf = (page, fn) => page.evaluate(async (src) => {
  const out = [], P = CanvasRenderingContext2D.prototype, f = P.fillText;
  P.fillText = function (t, ...a) { out.push(String(t)); return f.call(this, t, ...a); };
  try { await (0, eval)(src)(); } finally { P.fillText = f; }
  return out;
}, fn.toString());
// Pixels of the exported figure's top-right corner (where the inset sits) near each colour given.
const insetPixels = (page, colours) => page.evaluate(async (cs) => {
  const url = window.EM3D.exportPNG({ view: '3d' }), img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const w = Math.round(img.width * 0.25), h = Math.round(img.height * 0.5), d = x.getImageData(img.width - w, 0, w, h).data;
  return cs.map((rgb) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 8 && Math.abs(d[i + 1] - rgb[1]) < 8 && Math.abs(d[i + 2] - rgb[2]) < 8) n++; return n; });
}, colours);
const over = (fg, a, bg = [243, 242, 238]) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test('claims around the model: project in the accent, neighbours grey, the claim map inset and the registry credit', async ({ page }) => {
  const calls = [];
  await open3d(page, calls);
  // Without a coordinate system: a plain message, nothing fetched.
  const noCrs = await page.evaluate(() => window.EM3D.findClaims({ around: true }).then(() => null, (e) => e.message));
  expect(noCrs).toMatch(/^Set the coordinate system first/);
  expect(calls).toHaveLength(0);
  await withCRS(page);
  const before = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  const r = await page.evaluate(() => window.EM3D.findClaims({ around: true, province: 'bc' }));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/\/api\/bc-claims\?bbox=-130\.\d+%2C57\.\d+%2C-130\.\d+%2C57\.\d+$/);
  expect(r).toMatchObject({ registry: 'BC Mineral Titles Online', found: 11, project: 3, neighbours: 8 });
  expect(r.owners[0]).toEqual({ owner: 'Northern Prospectors Inc.', count: 4 });
  const today = new Date().toISOString().slice(0, 10), credit = `Claims: BC Mineral Titles Online, retrieved ${today}`;
  expect(r.credit).toBe(credit);
  const st = await page.evaluate(() => window.EM3D.getState());
  expect(st.tags.insetStyle).toBe('claims');
  expect(st.tags.inset).toEqual({ status: 'ready', message: 'Inset: claim map (11 claims).' });
  expect(st.overlays.map((o) => [o.name, o.role, o.group, o.kind, o.credit, o.features, o.placed])).toEqual([
    ['Project claims (Example Resources Ltd.)', 'claims', 'project', 'fill', credit, 3, true],
    ['Neighbouring claims', 'claims', 'neighbours', 'fill', credit, 8, true],
  ]);
  expect(st.overlays[0].color).toBe(st.brand.accent);
  expect(st.overlays[1].color).toBe('#9aa3a5');
  // On the terrain: hairline outlines only, no fill (the fills are the claim map's).
  expect(st.overlays.map((o) => [o.opacity, o.width])).toEqual([[0, 1.2], [0, 0.8]]);
  // The figure: the claim map's title, tenure numbers where they fit, the credit in the footer.
  const texts = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(texts).toContain('Claims');
  expect(texts).not.toContain('Location of the model');
  expect(texts.filter((t) => /^10[89]00\d\d$/.test(t)).length).toBeGreaterThan(0); // tenure numbers where they fit
  expect(texts.some((t) => t.includes(credit))).toBe(true);
  // Pixels: the project's claims in the accent at 0.35, the neighbours light grey, on the inset's pale ground.
  const [accent, grey, ground] = await insetPixels(page, [over(hex(st.brand.accent), 0.35), over(hex('#9aa3a5'), 0.22), [243, 242, 238]]);
  expect(accent).toBeGreaterThan(300);
  expect(grey).toBeGreaterThan(300);
  expect(ground).toBeGreaterThan(50);
  // The fill opacity control still fills a claim on the terrain; the claim map is drawn the same either way.
  const fill = await page.evaluate(async (id) => { const E = window.EM3D, a = E.exportPNG({ view: '3d' }); await E.updateOverlay(id, { opacity: 0.3 }); const b = E.exportPNG({ view: '3d' }); await E.updateOverlay(id, { opacity: 0 }); return [a !== b, a === E.exportPNG({ view: '3d' })]; }, st.overlays[0].id);
  expect(fill).toEqual([true, true]);
  // Neighbours set out of the inset leave the claim map with the project's claims alone.
  const withNb = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  await page.evaluate((id) => window.EM3D.updateOverlay(id, { inset: false }), st.overlays[1].id);
  expect((await page.evaluate(() => window.EM3D.getState())).tags.inset.message).toBe('Inset: claim map (3 claims).');
  expect(await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' })) !== withNb).toBe(true);
  await page.evaluate((id) => window.EM3D.updateOverlay(id, { inset: true }), st.overlays[1].id);
  // The plan inset again: no claim map, the credit stays with the claims on the terrain.
  await page.evaluate(() => window.EM3D.setStyle({ insetStyle: 'plan' }));
  const plan = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(plan).toContain('Plan of drilling'); expect(plan).not.toContain('Claims');
  expect(plan.some((t) => t.includes(credit))).toBe(true);
  // A standalone map: the registry credit once, among the sources atop the legend, not in the footer.
  await page.evaluate(() => window.EM3D.setMapUse({ use: 'standalone' }));
  const sa = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' })), saAll = sa.join(' ');
  expect(saAll.split(credit).length - 1).toBe(1);
  expect(saAll.indexOf(credit)).toBeGreaterThan(saAll.indexOf('SOURCES'));
  expect(saAll.indexOf(credit)).toBeLessThan(saAll.indexOf('Drill hole collar')); // in the legend card's details block
  await page.evaluate(() => window.EM3D.setMapUse({ use: 'presentation' }));
  // Removed, the claims take their credit with them, and the figure is what it was.
  await page.evaluate(async () => { for (const o of window.EM3D.getState().overlays) await window.EM3D.removeOverlay(o.id); });
  expect(await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' })) === before).toBe(true);
});

test('a search by holder, claim numbers, the Find claims panel, and the editable annotations', async ({ page }) => {
  const calls = [];
  await open3d(page, calls);
  await withCRS(page);
  const r = await page.evaluate(() => window.EM3D.findClaims({ query: 'Example Resources', type: 'company', province: 'bc' }));
  expect(r).toMatchObject({ found: 3, project: 3, neighbours: 0 });
  expect(new URL(calls[0]).searchParams.toString()).toBe('q=Example+Resources&type=company&province=bc');
  const nums = await page.evaluate(() => window.EM3D.findClaims({ query: '1090001, 1090002', type: 'number', province: 'bc' }));
  expect(calls.slice(1).map((u) => new URL(u).searchParams.get('q'))).toEqual(['1090001', '1090002']);
  expect(nums.project).toBe(3); // the mock answers every number with all three; duplicates merged
  expect((await page.evaluate(() => window.EM3D.getState())).overlays).toHaveLength(1); // replaced, not added twice
  // Around the model now: the project's claims kept (their holder), the rest as neighbours, in their holders' colours.
  const around = await page.evaluate(() => window.EM3D.findClaims({ around: true, byOwner: true }));
  expect(around).toMatchObject({ project: 3, neighbours: 8 });
  const names = (await page.evaluate(() => window.EM3D.getState())).overlays.map((o) => [o.name, o.group]);
  expect(names).toEqual([['Project claims (Example Resources Ltd.)', 'project'], ['Claims of Northern Prospectors Inc.', 'neighbours'], ['Claims of Ridge Metals Corp.', 'neighbours'], ['Other claims', 'neighbours']].filter(([n]) => n !== 'Other claims'));
  // Editable annotations carry the claim map and the credit.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ svg: true }))).split(',')[1], 'base64'));
  const svg = new TextDecoder().decode(zip['annotations.svg']);
  expect(svg).toContain('>Claims<'); expect(svg).toContain('Claims: BC Mineral Titles Online, retrieved');
  expect(Object.keys(zip)).toEqual(['figure.png', 'scene.png', 'annotations.png', 'section.png', 'figure-settings.json', 'annotations.svg']);
  // The panel: Find claims opens it, Claims around the model fills it in.
  await page.evaluate(async () => { for (const o of window.EM3D.getState().overlays) await window.EM3D.removeOverlay(o.id); window.EM3D.showStep('layout'); });
  await page.locator('#ov-claims').click();
  const ui = page.locator('#ov-claims-ui');
  await expect(ui.locator('select[data-cf="province"]')).toHaveValue('bc');
  await ui.getByRole('button', { name: 'Claims around the model' }).click();
  await expect(ui.locator('[data-cmsg]')).toContainText('3 project and 8 neighbouring claims from BC Mineral Titles Online');
  await expect(page.locator('#ov-ui')).toContainText('Neighbouring claims');
  await expect(page.locator('select[data-ext="style.insetStyle"]')).toHaveValue('claims');
});

test('the claim map with area overlays of a file, the panel without a coordinate system, and an earlier figure unchanged', async ({ page }) => {
  await open3d(page);
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await page.locator('#ov-claims').click();
  await page.locator('#ov-claims-ui').getByRole('button', { name: 'Claims around the model' }).click();
  await expect(page.locator('#ov-claims-ui [data-cmsg]')).toHaveText('Set the coordinate system first (step 1).');
  // insetStyle "claims" with no claims: the plan of drilling, and a note saying why.
  const r = await page.evaluate(async (legacy) => {
    const E = window.EM3D;
    await E.loadProject(legacy); await E.layersReady();
    const a = E.exportPNG({ view: '3d' });
    E.setStyle({ insetStyle: 'claims' }); await E.layersReady();
    const st = E.getState().tags.inset, b = E.exportPNG({ view: '3d' });
    E.setStyle({ insetStyle: 'plan' }); await E.layersReady();
    const c = E.exportPNG({ view: '3d' });
    await E.loadProject(legacy); await E.layersReady();
    return { st, same: [a === b, a === c, a === E.exportPNG({ view: '3d' })] };
  }, LEGACY);
  expect(r.st.status).toBe('no-claims');
  expect(r.same).toEqual([true, true, true]);
  // An area overlay in the figure's metres (no coordinate system) makes a claim map too.
  const t = await page.evaluate(async () => {
    const E = window.EM3D, ring = [[499700, 5999600], [500700, 5999600], [500700, 6000500], [499700, 6000500], [499700, 5999600]]; // round the fixture's holes
    await E.addOverlay({ name: 'Licence', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { number: 'L-77' }, geometry: { type: 'Polygon', coordinates: [ring] } }] }, kind: 'fill', inset: true }); // an earlier figure: inset asked for
    E.setStyle({ insetStyle: 'claims' }); await E.layersReady();
    return E.getState().tags.inset;
  });
  expect(t).toEqual({ status: 'ready', message: 'Inset: claim map (1 claim).' });
  expect(await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }))).toEqual(expect.arrayContaining(['Claims', 'L-77']));
  expect(await page.evaluate(() => { try { window.EM3D.setStyle({ insetStyle: 'claim' }); return null; } catch (e) { return e.message; } })).toMatch(/or "claims" \(the claim map\)/);
});
