import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

// Exploration Maps 3D round 5D: the version check after a deploy, plan views (bars, grid, "Plan view"), an
// earlier figure unchanged, shapes per view, claims in the inset and a published callout's second line.

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.skip(({ isMobile }) => isMobile, 'Desktop only');
test.describe.configure({ timeout: 150_000 }); // several full-size exports under SwiftShader

const OVERLAYS = readFileSync('tests/fixtures/three-d/example-ridge-overlays.geojson', 'utf8');
const RELEASE = readFileSync('tests/fixtures/three-d/published-results.csv', 'utf8');

async function open3d(page) {
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.goto('/3d');
  await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(() => window.EM3D.layersReady());
}
// The texts drawn on the figure's canvas while fn runs in the page (an export).
const textsOf = (page, fn) => page.evaluate(async (src) => {
  const out = [], P = CanvasRenderingContext2D.prototype, f = P.fillText;
  P.fillText = function (t, ...a) { out.push(String(t)); return f.call(this, t, ...a); };
  try { await (0, eval)(src)(); } finally { P.fillText = f; }
  return out;
}, fn.toString());

test('/3d is served no-cache with its build stamp; a newer deployed stamp offers a reload, never forced', async ({ page, request }) => {
  for (const path of ['/3d', '/3d/', '/3d/index.html', '/3D', '/3d/share/0123456789abcdef0123456789abcdef']) expect((await request.get(path)).headers()['cache-control'], path).toBe('no-cache');
  const html = await (await request.get('/3d')).text(), stamp = /name="em-build" content="([^"]+)"/.exec(html)?.[1];
  expect(stamp).toMatch(/^3d-/);
  const entry = /src="(\/assets\/3d-[^"]+\.js)"/.exec(html)[1];
  expect((await request.get(entry)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');

  // The clock moves on in the page; the deployed page (fetched uncached) carries another stamp.
  await page.addInitScript(() => { const now = Date.now.bind(Date); let skew = 0; Date.now = () => now() + skew; window.__skew = (ms) => { skew += ms; }; });
  let fetches = 0;
  await page.route(/\/3d\/$/, (route) => { fetches++; route.fulfill({ status: 200, contentType: 'text/html', body: html.replace(stamp, '3d-NEWER123') }); });
  await open3d(page);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(fetches).toBe(0); // just loaded: not due
  await page.evaluate(() => { window.__skew(11 * 60 * 1000); window.dispatchEvent(new Event('focus')); });
  const notice = page.locator('#ver');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('A new version is available');
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.locator('#ver-save')).toBeHidden(); // the sample: nothing to lose
  expect(fetches).toBe(1);
  await page.locator('#ver-x').click();
  await expect(notice).toBeHidden();
  await page.evaluate(() => { window.__skew(30 * 60 * 1000); window.dispatchEvent(new Event('focus')); });
  expect(fetches).toBe(1); // said once
  expect(await page.evaluate(() => window.EM3D.getState().ready)).toBe(true); // and never reloaded
});

test('a new figure in plan view: bars, "Plan view" and the grid; an earlier figure keeps its look', async ({ page }) => {
  await open3d(page);
  const d3 = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  // The same figure saved as design version 4 (before round 5D), for later.
  const v4 = await page.evaluate(() => { const p = JSON.parse(JSON.stringify(window.EM3D.getProject())); p.settings.designVersion = 4; delete p.settings.grid; return p; });
  expect((await page.evaluate(() => window.EM3D.getState())).display.grid).toBe(true);
  await page.evaluate(async () => { window.EM3D.setCamera({ azimuth: 0, plunge: 89, zoom: 100 }); await window.EM3D.layersReady(); });
  const plan = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(plan).toContain('Plan view');
  expect(plan).toContain('Grid 200 m');
  expect(plan.some((t) => /^Looking/.test(t))).toBe(false);
  expect(plan.filter((t) => /^\d{6}E$/.test(t)).length).toBeGreaterThan(2); // eastings
  expect(plan.filter((t) => /^\d{7}N$/.test(t)).length).toBeGreaterThan(2); // northings
  expect(plan.filter((t) => /^EX-\d{3}$/.test(t)).length).toBeGreaterThan(20); // most of the 35 holes keep their ID
  // The editable annotations carry the same plan drawing.
  const zip = unzipSync(Buffer.from((await page.evaluate(() => window.EM3D.exportLayers({ svg: true }))).split(',')[1], 'base64'));
  const svg = new TextDecoder().decode(zip['annotations.svg']);
  expect(svg).toContain('>Plan view<'); expect(svg).toMatch(/>\d{6}E</);
  // The grid can be turned off.
  await page.evaluate(() => window.EM3D.setStyle({ grid: false }));
  const noGrid = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(noGrid.some((t) => /^\d{6}E$/.test(t))).toBe(false);
  expect(noGrid).toContain('Plan view');

  // Reopened as design version 4: the look it had.
  await open3d(page);
  const opened = await page.evaluate(async (p) => { const s = await window.EM3D.loadProject(p); await window.EM3D.layersReady(); return s; }, v4);
  expect(opened.display.grid).toBe(false);
  expect(opened.design.version).toBe(4);
  const d3v4 = await page.evaluate(() => window.EM3D.exportPNG({ view: '3d' }));
  await page.evaluate(async () => { window.EM3D.setCamera({ azimuth: 0, plunge: 89, zoom: 100 }); await window.EM3D.layersReady(); });
  const oldPlan = await textsOf(page, () => window.EM3D.exportPNG({ view: '3d' }));
  expect(oldPlan).toContain('Looking 000°'); expect(oldPlan).toContain('plunge 89°');
  expect(oldPlan).not.toContain('Plan view');
  expect(oldPlan.some((t) => /^\d{6}E$/.test(t))).toBe(false);
  // Its 3D view is the new figure's, byte for byte (nothing of round 5D shows outside a plan view).
  expect(d3v4 === d3).toBe(true);
});

test('shapes on the 3D figure, the section or both', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, plain = { d3: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    const id = await E.addShape({ type: 'ellipse' }); // upright round the top intercept, in the section's plane
    const both = { d3: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    await E.updateShape(id, { views: 'section' });
    const sec = { d3: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    await E.updateShape(id, { views: '3d' });
    const d3 = { d3: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    let bad = null; try { await E.updateShape(id, { views: 'plan' }); } catch (e) { bad = e.message; }
    const project = JSON.parse(JSON.stringify(E.getProject())); E.clearFiles(); const after = await E.loadProject(project);
    return { id, shapes: after.shapes, saved: project.settings.shapes[0].views, bad,
      both: [both.d3 !== plain.d3, both.sec !== plain.sec], sec: [sec.d3 === plain.d3, sec.sec === both.sec], d3: [d3.d3 === both.d3, d3.sec === plain.sec] };
  });
  expect(r.both).toEqual([true, true]);
  expect(r.sec).toEqual([true, true]);
  expect(r.d3).toEqual([true, true]);
  expect(r.bad).toMatch(/views must be "both", "3d" or "section"/);
  expect(r.saved).toBe('3d');
  expect(r.shapes[0]).toMatchObject({ id: r.id, views: '3d' });
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const sel = page.locator(`#shape-ui select[data-k="views"]`);
  await expect(sel).toHaveValue('3d');
  await sel.selectOption('both');
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).shapes[0].views).toBe('both');
});

test('claims outlined in the inset: on for area overlays of a new figure, off when set, off for an earlier figure', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async (fc) => {
    const E = window.EM3D, line = { type: 'FeatureCollection', features: [JSON.parse(fc).features[1]] }, base = E.exportPNG({ view: '3d' });
    // A line at opacity 0 leaves the figure as it was: not in the inset unless set.
    const fault = await E.addOverlay({ name: 'Fault', data: line, kind: 'line', opacity: 0, label: '' });
    const hidden = E.exportPNG({ view: '3d' });
    await E.updateOverlay(fault, { inset: true }); const faultInInset = E.exportPNG({ view: '3d' });
    await E.removeOverlay(fault);
    const claims = await E.addOverlay({ name: 'Claims', data: { type: 'FeatureCollection', features: [JSON.parse(fc).features[0]] }, kind: 'fill', opacity: 0, label: '' });
    const onDefault = E.exportPNG({ view: '3d' });
    await E.updateOverlay(claims, { inset: false });
    const off = E.exportPNG({ view: '3d' });
    const st = E.getState().overlays[0];
    // An earlier figure with the same overlay, inset unset: drawn only on the terrain, as before.
    const p = JSON.parse(JSON.stringify(E.getProject())); p.settings.designVersion = 4; delete p.settings.overlays[0].inset;
    await E.loadProject(p); const oldUnset = E.exportPNG({ view: '3d' });
    await E.updateOverlay(claims, { inset: false }); const oldOff = E.exportPNG({ view: '3d' });
    await E.updateOverlay(claims, { inset: true }); const oldOn = E.exportPNG({ view: '3d' });
    return { line: base === hidden, faultInInset: faultInInset !== hidden, onDefault: onDefault !== off, inset: st.inset, old: [oldUnset === oldOff, oldOn !== oldOff] };
  }, OVERLAYS);
  expect(r).toEqual({ line: true, faultInInset: true, onDefault: true, inset: false, old: [true, true] });
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await page.locator('#ov-ui details summary').first().click();
  const box = page.locator('#ov-ui [data-k="inset"]');
  await expect(box).toBeChecked(); // set on last
  await box.uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).overlays[0].inset).toBe(false);
});

test('a published callout\'s second line is reworded per result and survives save and reopen', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async (rel) => {
    const E = window.EM3D, p = JSON.parse(JSON.stringify(E.getProject()));
    p.files.push({ name: 'release.csv', text: rel, role: 'published' }); p.settings.calloutMode = 'published';
    let s = await E.loadProject(p);
    const auto = s.callouts.shown.map((c) => c.line2);
    s = E.setCallout('EX14-01', { line2: 'Open up-dip; follow-up planned' });
    const set = s.callouts.shown.map((c) => [c.resultId, c.line2]);
    const project = JSON.parse(JSON.stringify(E.getProject())); E.clearFiles();
    const after = await E.loadProject(project);
    return { auto, set, after: after.callouts.shown.map((c) => [c.resultId, c.line2]), saved: project.settings.pubOverrides['EX14-01'], same: JSON.stringify(after.callouts) === JSON.stringify(s.callouts) };
  }, RELEASE);
  expect(r.auto).toEqual(['incl. 60.0 m @ 0.81% Cu from 120 m', null, null]);
  expect(r.set).toEqual([['EX21-01', 'incl. 60.0 m @ 0.81% Cu from 120 m'], ['EX14-01', 'Open up-dip; follow-up planned'], ['EX14-02', null]]);
  expect(r.saved).toEqual({ line2: 'Open up-dip; follow-up planned', at2: [40, 70] }); // its own depths, apart from line1's
  expect(r.after).toEqual(r.set);
  expect(r.same).toBe(true);
  // The editor has a second box per top result, and typing there rewords that result's second line.
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const box = page.locator('[data-pt2="EX21-01"]');
  await expect(box).toHaveAttribute('placeholder', 'incl. 60.0 m @ 0.81% Cu from 120 m');
  await expect(page.locator('[data-pt2="EX21-01a"]')).toHaveCount(0); // an "incl." result is the second line itself
  await box.fill('incl. 60 m of higher grade');
  await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState())).callouts.shown[0].line2).toBe('incl. 60 m of higher grade');
});
