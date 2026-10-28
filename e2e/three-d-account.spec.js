import { test, expect } from '@playwright/test';
import { DESIGN_VERSION } from '../src/three-d/design-version.js';
import { readFileSync } from 'node:fs';

// Exploration Maps 3D (/3d): whole-figure snapshots, and Save / My 3D maps
// against an in-memory Supabase (auth, REST and storage are all mocked; no
// request leaves the browser). The account tests need the configured client
// build (dist-auth-check, VITE_SUPABASE_URL=https://example.supabase.co).

// three.js needs WebGL; headless Chromium provides it through SwiftShader.
test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});

// These flows deliberately leave edited figures; acknowledge the new unload warning.
test.beforeEach(({ page }) => { page.on('dialog', (dialog) => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()); });

const uid = '00000000-0000-4000-8000-0000000003d1';
const user = { id: uid, email: 'three-d@example.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
const AUTH_KEY = 'sb-example-auth-token';
// A figure saved before figure design versions (October 2026): its settings have no designVersion.
const LEGACY = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
const LEGACY_LOOK = { imagery: { saturation: 1.15, contrast: 1, warmth: 0, relief: 0 }, legend: { merge: 'separate', pos: { main: 'br' } },
  geology: { strength: 1, hidden: 'clear' }, tags: { emphasis: 'none', highlightNew: false, idMode: 'all' }, shell: { color: '#1f9e96', throughTerrain: false } };

// A release table for the built-in sample (fictional): EX-021 with an "incl." result, two results on EX-014, a draft.
const RELEASE = readFileSync('tests/fixtures/three-d/published-results.csv', 'utf8');
const LONG = '508.00 m @ 0.5300000000000001% Cu, 0.1234567890123 g/t Au from 8.000 m';

const ORG = '00000000-0000-4000-8000-0000000003a1', PROP = '00000000-0000-4000-8000-0000000003b1';

// library: { files } for a user in one company with one property (Rails) whose data library lists `files`.
async function fakeSupabase(page, { failUpload = false, library = null } = {}) {
  const fake = { requests: [], otp: [], rows: new Map(), objects: new Map(), upserts: [], patches: [] };
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    fake.requests.push(`${method} ${path}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'otp') { fake.otp.push({ email: req.postDataJSON().email, redirect: url.searchParams.get('redirect_to') }); return json({}); }
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      if (fn === 'logout') return route.fulfill({ status: 204 });
      return json({});
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop();
      if (fn === 'get_my_workspaces') return json(library ? [{ id: ORG, name: 'Star Copper Corp.', slug: 'star-copper-corp', role: 'editor' }] : []);
      if (fn === 'list_property_files') return json(library?.files || []);
      return json(null);
    }
    if (path === '/rest/v1/properties') return json(library ? [{ id: PROP, name: 'Rails', slug: 'rails', org_id: ORG }] : []);
    if (path === '/rest/v1/three_d_projects') {
      const single = (req.headers().accept || '').includes('vnd.pgrst.object');
      if (method === 'GET') {
        const id = url.searchParams.get('id');
        const rows = [...fake.rows.values()].filter((r) => r.deleted_at === null && (!id || id === `eq.${r.id}`))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return json(single ? rows[0] : rows);
      }
      if (method === 'POST') {
        const body = req.postDataJSON(), row = Array.isArray(body) ? body[0] : body, prev = fake.rows.get(row.id), now = new Date().toISOString();
        const full = { user_id: uid, created_at: prev?.created_at || now, ...prev, ...row, updated_at: now };
        fake.rows.set(row.id, full); fake.upserts.push(structuredClone(full));
        return json(single ? full : [full], 201);
      }
      if (method === 'PATCH') {
        const id = (url.searchParams.get('id') || '').slice(3), r = fake.rows.get(id), body = req.postDataJSON();
        const at = url.searchParams.get('updated_at');
        if (at) {
          // A save over the version the tab opened: only while it is still that version.
          if (!r || Date.parse(at.slice(3)) !== Date.parse(r.updated_at)) return single ? route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } }) : json([]);
          Object.assign(r, body, { updated_at: new Date().toISOString() }); fake.upserts.push(structuredClone(r));
          return json(single ? r : [r]);
        }
        if (!r || r.deleted_at !== null) return json([]);
        Object.assign(r, body); fake.patches.push(id);
        return json([{ id }]);
      }
    }
    if (path.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(path.slice('/storage/v1/object/'.length));
      if (method === 'POST' && rest.startsWith('list/')) {
        const { prefix } = req.postDataJSON();
        // Like Storage: the prefix's direct children, sub-folders with id null.
        const seen = new Map();
        for (const k of fake.objects.keys()) {
          if (!k.startsWith(`three-d-files/${prefix}/`)) continue;
          const [head, ...tail] = k.slice(`three-d-files/${prefix}/`.length).split('/');
          if (!seen.has(head)) seen.set(head, { name: head, id: tail.length ? null : k });
        }
        return json([...seen.values()]);
      }
      if (method === 'POST') {
        if (failUpload) return json({ statusCode: '500', error: 'Internal', message: 'Storage is down' }, 500);
        fake.objects.set(rest, req.postData()); return json({ Key: rest, Id: rest });
      }
      if (method === 'GET') {
        const text = fake.objects.get(rest);
        return text === undefined ? json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400) : route.fulfill({ status: 200, contentType: 'text/plain', body: text });
      }
      if (method === 'DELETE') { req.postDataJSON().prefixes.forEach((p) => fake.objects.delete(`three-d-files/${p}`)); return json([]); }
    }
    return json({});
  });
  return fake;
}

async function open3d(page, path = '/3d') {
  await page.goto(path);
  await page.waitForFunction(() => window.EM3D?.getState().ready);
}
const state = (page) => page.evaluate(() => window.EM3D.getState());

test('an anonymous edited figure shows unsaved work and warns before leaving without loading account services', async ({ page }) => {
  const fake = await fakeSupabase(page);
  await open3d(page);
  await page.waitForFunction(() => JSON.parse(document.getElementById('em3d-state').textContent || '{}').ready);
  const warns = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  expect(await warns()).toBe(false);
  await page.evaluate(() => window.EM3D.setBrand({ title: 'Unsaved field work' }));
  await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');
  await expect(page.locator('#acct-note')).toBeVisible();
  expect(await warns()).toBe(true);
  expect(fake.requests).toEqual([]);
});

test('a figure survives getProject, clearFiles and loadProject unchanged', async ({ page }) => {
  await open3d(page);
  const { before, after, cleared } = await page.evaluate(async () => {
    const E = window.EM3D;
    const c = document.createElement('canvas'); c.width = 40; c.height = 20;
    const g = c.getContext('2d'); g.fillStyle = '#0b3954'; g.fillRect(0, 0, 20, 20); g.fillStyle = '#e4572e'; g.fillRect(20, 0, 20, 20);
    await E.setLogo(c.toDataURL('image/png'));
    E.setBrand({ company: 'Star Copper', title: 'STAR · RAILS', subtitle: 'Looking north', primary: '#0b3954', accent: '#e4572e', credit: false });
    const ids = E.getState().project.holeIds;
    E.setStyle({ coCount: 3, coMin: 15, secAz: 120, walls: false, surface: 0.6 });
    E.setCallout(ids[3], { show: true, line1: 'Custom first line' });
    E.setCamera({ azimuth: 200, plunge: 35, zoom: 130 });
    E.setFigureSize('square');
    const project = JSON.parse(JSON.stringify(E.getProject()));
    const before = E.getState();
    const cleared = E.clearFiles().files.length;
    const after = await E.loadProject(project);
    return { before, after, cleared };
  });
  expect(cleared).toBe(0);
  expect(after).toEqual(before);
  expect(after.brand).toMatchObject({ title: 'STAR · RAILS', hasLogo: true, credit: false });
  expect(after.camera).toEqual({ azimuth: 200, plunge: 35, zoom: 130 });
  expect(after.figureSize.key).toBe('square');
});

test('holes chosen for the section and its fitted line survive getProject and loadProject; an earlier figure keeps the centre line', async ({ page }) => {
  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, ids = E.getState().project.holeIds.slice(0, 5);
    const { walls, ids: holeIds, inset } = E.getProject().settings, defaults = { walls, ids: holeIds, inset };
    const chosen = (await E.setSection({ holes: ids })).section;
    const project = JSON.parse(JSON.stringify(E.getProject())), before = E.getState();
    E.clearFiles(); const after = await E.loadProject(project);
    const png = E.exportPNG({ view: 'section' }).length;
    const old = JSON.parse(JSON.stringify(project)); delete old.settings.section; old.settings.designVersion = 2;
    const earlier = (await E.loadProject(old)).section;
    return { ids, chosen, saved: project.settings.section, before, after, png, earlier, defaults };
  });
  expect(r.defaults).toEqual({ walls: true, ids: true, inset: true }); // a new figure keeps its block sides, hole IDs and inset
  expect(r.chosen.holes).toEqual(r.ids);
  expect(r.chosen.ends).toHaveLength(2);
  expect(r.saved).toEqual({ holes: r.ids, a: r.chosen.ends[0], b: r.chosen.ends[1] });
  expect(r.after).toEqual(r.before);
  expect(r.png).toBeGreaterThan(10000);
  expect(r.earlier).toMatchObject({ holes: null, ends: null });
});

test('geology, geophysics, tags and a face image survive getProject and loadProject', async ({ page }) => {
  await open3d(page);
  const { before, after, roles } = await page.evaluate(async () => {
    const E = window.EM3D, ids = E.getState().project.holeIds;
    const lith = ['HoleID,From,To,Lith,Description', ...ids.flatMap((id) => [`${id},0,40,COV,Cover`, `${id},40,400,POR,Porphyry`])].join('\n');
    const pts = ['/ X Y Z CHARG', 'Line 100'];
    const holes = E.getProject().files.find((f) => /collar/.test(f.name)).text.split('\n').slice(1, 6).map((l) => l.split(','));
    holes.forEach(([, x, y, z]) => { for (let d = 0; d < 300; d += 30) pts.push(`${x} ${y} ${+z - d} ${10 + d / 10}`); });
    // Adding files replaces the sample, so its own files go in again alongside the new ones.
    const base = E.getProject().files.map(({ name, text }) => ({ name, text }));
    E.addFiles([...base, { name: 'lithology.csv', text: lith }, { name: 'ip_model.xyz', text: pts.join('\n') }]);
    const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').fillRect(0, 0, 4, 4);
    await E.setGeology({ enabled: true, faces: ['N', 'E'], title: 'Alteration', legend: [{ code: 'POR', name: 'Porphyry (altered)', color: '#c5c8ea' }] });
    await E.setFaceImage('S', c.toDataURL('image/png'));
    await E.setGeophys({ mode: 'curtain', lines: 'section', ramp: 'viridis' });
    await E.setTags({ at: 'collar', status: { [ids[0]]: 'new' } });
    await E.addStatBox({ title: 'Resource', rows: ['Indicated: 1 Mt'] });
    const project = JSON.parse(JSON.stringify(E.getProject()));
    const before = E.getState();
    E.clearFiles();
    const after = await E.loadProject(project);
    return { before, after, roles: after.files.map((f) => f.role) };
  });
  expect(roles).toEqual(expect.arrayContaining(['litho', 'geophys']));
  for (const k of ['geology', 'geophys', 'tags', 'labels', 'footnoteAuto']) expect(after[k]).toEqual(before[k]);
  expect(after.geology).toMatchObject({ enabled: true, title: 'Alteration', faces: ['N', 'E'], images: { S: true } });
  expect(after.geology.legend.find((e) => e.code === 'POR').name).toBe('Porphyry (altered)');
  expect(after.footnoteAuto).toEqual(expect.arrayContaining(['Geology on block faces interpolated from drill logs; schematic.', 'Geophysics: illustrative inversion model']));
});

test('published results: never read as assays, drawn on their own depths, reworded per result and kept verbatim', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  const before = await page.evaluate(async (rel) => {
    const E = window.EM3D, base = E.getProject().files.map(({ name, text }) => ({ name, text }));
    E.addFiles([...base, { name: 'release.csv', text: rel }]);
    const s = await E.setShell({ enabled: true, cutoff: 0.3 });
    return { roles: s.files.map((f) => f.role), intervals: s.project.intervals, cols: s.grade.available, composites: s.shell.composites, cells: s.shell.cells, mode: s.callouts.mode };
  }, RELEASE);
  // Holes, From and To, but a release table: held back, not read as assays.
  expect(before.roles.at(-1)).toBe('unknown');
  expect(before.mode).toBe('calculated');
  await expect(page.locator('#file-list')).toContainText('Published results? Choose that type to use them.');
  await page.locator('[data-role="5"]').selectOption('published');
  await expect.poll(async () => (await state(page)).callouts.mode).toBe('published');
  let now = await page.evaluate(async () => { await window.EM3D.setShell({ enabled: true, cutoff: 0.3 }); return window.EM3D.layersReady(); });
  // The assays, their colours, histogram and shell are as they were.
  expect({ intervals: now.project.intervals, cols: now.grade.available, composites: now.shell.composites, cells: now.shell.cells }).toEqual({ intervals: before.intervals, cols: before.cols, composites: before.composites, cells: before.cells });
  // Two releases on EX-014 stay two callouts; EX-021's "incl." is a line on its parent's, not a callout; the draft is left off.
  expect(now.callouts.shown.map((c) => [c.resultId, c.holeId, c.fromM, c.toM, c.incl])).toEqual([['EX21-01', 'EX-021', 8, 516, ['EX21-01a']], ['EX14-01', 'EX-014', 40, 70, []], ['EX14-02', 'EX-014', 300, 342, []]]);
  expect(now.callouts.shown[0]).toMatchObject({ line1: LONG, line2: 'incl. 60.0 m @ 0.81% Cu from 120 m' });
  expect(now.callouts.published.problems.map((p) => `${p.kind} ${p.resultId}`)).toEqual(['length-discrepancy EX14-02', 'not-approved EX22-01']);
  await expect(page.locator('#file-list')).toContainText('the published length (40) is not To − From (342 − 300 = 42 m)');

  // Reword one result on EX-014 in the panel: the other keeps its own text.
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await page.locator('[data-pt="EX14-01"]').fill('30.000 m @ 0.6100000000000001% Cu, near surface');
  now = await state(page);
  expect(now.callouts.shown.map((c) => c.line1)).toEqual([LONG, '30.000 m @ 0.6100000000000001% Cu, near surface', '40 m @ 0.48% Cu from 300 m']);
  expect(now.callouts.overrides['EX14-01']).toEqual({ line1: '30.000 m @ 0.6100000000000001% Cu, near surface', at: [40, 70] });

  // Saved and reopened, everything as it was, the long decimals verbatim.
  const { after, project } = await page.evaluate(async () => {
    const project = JSON.parse(JSON.stringify(window.EM3D.getProject()));
    window.EM3D.clearFiles();
    return { project, after: await window.EM3D.loadProject(project) };
  });
  expect(after.callouts).toEqual(now.callouts);
  expect(project.files.at(-1)).toMatchObject({ role: 'published', text: RELEASE });
  expect(project.settings).toMatchObject({ calloutMode: 'published', pubOverrides: { 'EX14-01': { line1: '30.000 m @ 0.6100000000000001% Cu, near surface' } } });

  // A corrected table moves EX14-01: the wording written for 40–70 m is not carried to the new depths.
  const moved = await page.evaluate(async (p) => { p.files.at(-1).text = p.files.at(-1).text.replace('EX14-01,EX-014,40,70', 'EX14-01,EX-014,40,75'); return window.EM3D.loadProject(p); }, project);
  expect(moved.callouts.shown.find((c) => c.resultId === 'EX14-01')).toMatchObject({ fromM: 40, toM: 75, line1: '30 m @ 0.61% Cu from 40 m' });
  expect(moved.callouts.published.staleWording).toEqual(['EX14-01: your wording was written for 40–70 m; the result is now 40–75 m, so its approved text is shown. Retype it to keep yours.']);
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await expect(page.locator('#callout-editor .warn').first()).toContainText('your wording was written for 40–70 m');
  expect(errors).toEqual([]);
});

test('map overlays and shapes: draped, listed, saved and reopened unchanged, and in the exports', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  const r = await page.evaluate(async (fc) => {
    const E = window.EM3D, plain = E.exportPNG({ view: '3d' });
    // A line at opacity 0, left out of the legend, leaves the export as it was.
    const ghost = await E.addOverlay({ name: 'Ghost', data: JSON.parse(fc), kind: 'line', opacity: 0, label: '' });
    const ghostPng = E.exportPNG({ view: '3d' }); await E.updateOverlay(ghost, { opacity: 1 });
    const shownPng = E.exportPNG({ view: '3d' }); await E.removeOverlay(ghost);
    // A GeoJSON file with claims, a fault and soil points: one overlay of each, the sample kept.
    let s = E.addFiles([{ name: 'example-ridge-overlays.geojson', text: fc }]);
    s = await E.layersReady();
    const fromFile = { usingSample: s.usingSample, role: s.files.at(-1).role, overlays: s.overlays.map((o) => [o.name, o.kind, o.features, o.placed]) };
    await E.updateOverlay(s.overlays[1].id, { dash: 'dashed', width: 3 });
    const tenure = await E.addOverlay({ name: 'Tenure numbers', data: { type: 'FeatureCollection', features: [JSON.parse(fc).features[0]] }, kind: 'line', color: '#1f6fb5', labelField: 'tenure' });
    const ids = [await E.addShape({ type: 'arrow' }), await E.addShape({ type: 'ellipse' }), await E.addShape({ type: 'dimension' })];
    const before = E.getState(), withAll = E.exportPNG({ view: '3d' }), section = E.exportPNG({ view: 'section' });
    const project = JSON.parse(JSON.stringify(E.getProject()));
    E.clearFiles();
    const after = await E.loadProject(project);
    const again = E.exportPNG({ view: '3d' });
    let bad = null; try { await E.addOverlay({ name: 'x', data: { type: 'FeatureCollection', features: [] } }); } catch (e) { bad = e.message; }
    await E.removeOverlay(tenure);
    const removed = await E.removeOverlay(after.overlays[0].id);
    return { ghostSame: ghostPng === plain, shownSame: shownPng === plain, fromFile, ids, before, after, plain: plain.length, withAll: withAll.length, again: again.length, same: again === withAll, section: section.length, bad,
      saved: { overlays: project.settings.overlays.map((o) => [o.id, o.file || null, !!o.data]), shapes: project.settings.shapes.map((x) => x.type) },
      left: removed.overlays.map((o) => o.name), files: removed.files.map((f) => f.name) };
  }, readFileSync('tests/fixtures/three-d/example-ridge-overlays.geojson', 'utf8'));
  expect([r.ghostSame, r.shownSame]).toEqual([true, false]); // overlay opacity reaches the export
  expect(r.fromFile).toEqual({ usingSample: true, role: 'overlay', overlays: [['Example Ridge claims', 'fill', 1, true], ['Ridge Fault', 'line', 1, true], ['example ridge overlays (points)', 'points', 20, true]] });
  expect(r.ids).toEqual(['S1', 'S2', 'S3']);
  expect(r.before.overlays[1]).toMatchObject({ dash: 'dashed', width: 3, color: '#142126' }); // brand colours unless set
  expect(r.before.overlays[0].color).toBe('#c65322');
  expect(r.before.shapes.map((x) => [x.type, x.text])).toEqual([['arrow', 'OPEN'], ['ellipse', 'Target'], ['dimension', null]]);
  expect(r.after).toEqual(r.before);
  // Overlays from the file keep only its name (the file is saved with the figure); one added as data keeps its features.
  expect(r.saved).toEqual({ overlays: [['O1', 'example-ridge-overlays.geojson', false], ['O2', 'example-ridge-overlays.geojson', false], ['O3', 'example-ridge-overlays.geojson', false], ['O4', null, true]], shapes: ['arrow', 'ellipse', 'dimension'] });
  expect(r.withAll).toBeGreaterThan(200000);
  expect(r.withAll).not.toBe(r.plain);
  expect(r.same).toBe(true); // reopened, the figure exports exactly as before
  expect(r.section).toBeGreaterThan(50000);
  expect(r.bad).toMatch(/No points, lines or polygons/);
  expect(r.left).toEqual(['Ridge Fault', 'example ridge overlays (points)']);
  expect(r.files).toContain('example-ridge-overlays.geojson'); // still drawn from it

  // The Layout step lists them; hiding one there takes it out of the legend.
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await expect(page.locator('#ov-ui')).toContainText('Ridge Fault');
  await expect(page.locator('#shape-ui')).toContainText('Dimension line');
  await page.locator('#ov-ui [data-k="show"]').first().uncheck();
  await expect.poll(async () => (await state(page)).overlays[0].show).toBe(false);
  expect(errors).toEqual([]);
});

test('named sections: B–B′ through two holes with fences, saved and reopened unchanged, each exported on its own; a figure without them is untouched', async ({ page }) => {
  test.setTimeout(150_000); // three page loads and a dozen full-size exports under SwiftShader
  const errors = [], chunks = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (q) => { if (/\/assets\/sections-[\w-]+\.js/.test(q.url())) chunks.push(q.url()); });
  await open3d(page);
  // A figure with its one section, new or saved before named sections, never fetches sections.js; "A" is its section.
  const plain = await page.evaluate(async (old) => {
    const E = window.EM3D, out = { d3: E.exportPNG({ view: '3d' }), sec: E.exportPNG({ view: 'section' }) };
    out.secA = E.exportPNG({ view: 'section', section: 'A' }); out.saved = E.getProject().settings.sections; out.state = E.getState().sections;
    try { E.exportPNG({ view: 'section', section: 'B' }); } catch (e) { out.bad = e.message; }
    const opened = await E.loadProject(old); out.old = [opened.sections, E.getProject().settings.sections, E.exportPNG({ view: 'section', section: 'A' }) === E.exportPNG({ view: 'section' })];
    return out;
  }, LEGACY);
  expect(plain.secA).toBe(plain.sec);
  expect([plain.saved, plain.state, plain.old]).toEqual([null, null, [null, null, true]]);
  expect(plain.bad).toMatch(/No section "B"/);
  expect(chunks).toEqual([]);

  await open3d(page);
  const r = await page.evaluate(async () => {
    const E = window.EM3D, ids = E.getState().project.holeIds, through = [ids[2], ids[9]];
    const id = await E.addSection({ through, width: 60 });
    await E.updateSection('A', { fence: true });
    const before = E.getState(), project = JSON.parse(JSON.stringify(E.getProject()));
    const exp = { a: E.exportPNG({ view: 'section', section: 'A' }), b: E.exportPNG({ view: 'section', section: 'B' }), d3: E.exportPNG({ view: '3d' }) };
    E.clearFiles();
    const after = await E.loadProject(project);
    const exp2 = { a: E.exportPNG({ view: 'section', section: 'A' }), b: E.exportPNG({ view: 'section', section: 'B' }), d3: E.exportPNG({ view: '3d' }) };
    let bad = null; try { E.exportPNG({ view: 'section', section: 'Z' }); } catch (e) { bad = e.message; }
    const activeA = (await E.setActiveSection('A')).section;
    let last = null; await E.removeSection('B'); try { await E.removeSection('A'); } catch (e) { last = e.message; }
    return { id, through, before, after, project, exp, saved: project.settings.sections, savedActive: project.settings.secActive, same: JSON.stringify(exp) === JSON.stringify(exp2),
      sizes: [exp.a.length, exp.b.length, exp.d3.length], differ: exp.a !== exp.b, bad, activeA, left: E.getState().sections.list.map((s) => s.id), last, tab: document.getElementById('view-section').textContent };
  });
  expect(r.id).toBe('B');
  const [A, B] = r.before.sections.list;
  expect(r.before.sections.active).toBe('B');
  expect(A).toMatchObject({ id: 'A', name: 'A–A′', letters: ['A', 'A′'], fence: true, width: 75 });
  expect(B).toMatchObject({ id: 'B', name: 'B–B′', letters: ['B', 'B′'], fence: true, width: 60 });
  expect(B.holes).toBeUndefined(); // through the two holes, every hole within the width drawn
  expect(r.before.section).toMatchObject({ secAz: B.az, secW: 60, holes: null, ends: B.ends }); // the active section is the one drawn
  expect(r.saved.map((s) => s.id)).toEqual(['A', 'B']);
  expect(r.savedActive).toBe('B');
  expect(r.after).toEqual(r.before);
  expect(r.same).toBe(true); // reopened, both sections and the 3D figure with its fences export exactly as before
  expect(r.differ).toBe(true);
  r.sizes.forEach((n) => expect(n).toBeGreaterThan(50000));
  expect(r.bad).toMatch(/No section "Z"/);
  expect(r.activeA).toMatchObject({ secAz: A.az, secW: 75, ends: null });
  expect(r.left).toEqual(['A']);
  expect(r.last).toMatch(/at least one section/);
  expect(r.tab).toBe('Section A–A′');
  expect(chunks.length).toBe(1);

  // The Layout step: a tab per section; Add another section takes the first free letter (B again) and is the active one.
  await page.evaluate(() => window.EM3D.showStep('layout'));
  await page.locator('#sec-add').click();
  await expect(page.locator('#sec-tabs [data-sid]')).toHaveText(['A–A′', 'B–B′']);
  await expect(page.locator('#sec-tabs [data-sid="B"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#sec-tabs [data-sid="A"]').click();
  await expect.poll(async () => (await state(page)).sections.active).toBe('A');

  // Opened in a new page, where sections.js has not loaded yet: the fences, their lines on the terrain and each
  // section export exactly as the saved figure did.
  await open3d(page);
  const fresh = await page.evaluate(async ({ p, exp }) => {
    const E = window.EM3D, loaded = !!E.getState().sections; await E.loadProject(p);
    return { loaded, d3: E.exportPNG({ view: '3d' }) === exp.d3, a: E.exportPNG({ view: 'section', section: 'A' }) === exp.a, b: E.exportPNG({ view: 'section', section: 'B' }) === exp.b };
  }, { p: r.project, exp: r.exp });
  expect(fresh).toEqual({ loaded: false, d3: true, a: true, b: true });
  expect(errors).toEqual([]);
});

test('setShell resolves with the shell already on the figure, so an export straight after includes it', async ({ page }) => {
  await open3d(page);
  const s = await page.evaluate(async () => { const r = await window.EM3D.setShell({ enabled: true }); return { ...r.shell, notes: r.footnoteAuto }; });
  expect(s).toMatchObject({ status: 'ready', shown: true, shading: 'solid+edges' });
  expect(s.notes.some((t) => t.startsWith('Grade shell'))).toBe(true);
});

test('a figure saved before design versions keeps its look; its gap callout is flagged and recalculated in one undoable step', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open3d(page);
  // A warning in a newly opened figure must reveal itself even when the
  // user previously collapsed the whole labels group.
  await page.locator('#callout-editor').evaluate(el=>{el.closest('.layout-group').open=false;});
  expect((await state(page)).design).toEqual({ version: DESIGN_VERSION, current: DESIGN_VERSION, optIn: [] }); // a new figure: today's design
  const { opened, settings } = await page.evaluate(async (p) => {
    const opened = await window.EM3D.loadProject(p);
    await window.EM3D.history(); // the history starts at the opened figure
    return { opened, settings: window.EM3D.getProject().settings };
  }, LEGACY);
  expect(opened.design).toEqual({ version: 1, current: DESIGN_VERSION, optIn: [] });
  // What it saved is as saved; what it lacks takes the earlier look, not today's defaults.
  for (const [k, v] of Object.entries(LEGACY.settings)) expect(settings[k], k).toEqual(v && typeof v === 'object' && !Array.isArray(v) ? expect.objectContaining(v) : v);
  expect(settings).toMatchObject({ ...LEGACY_LOOK, designVersion: 1, designOptIn: [] });
  expect(opened.tags).toMatchObject(LEGACY_LOOK.tags);

  // The earlier callout numbers stay, flagged where they span an unsampled gap or an overlap.
  expect(opened.callouts).toMatchObject({ sampled: false, warnings: ['S-037 callout spans a 90 m unsampled gap', 'S-038 callout spans overlapping samples'] });
  expect(opened.callouts.shown.find((c) => c.holeId === 'S-037').line1).toBe('110 m @ 1.50% Cu from 0 m');
  await expect(page.locator('#status')).toContainText('S-037 callout spans a 90 m unsampled gap');
  await page.evaluate(() => window.EM3D.showStep('layout'));
  const warn = page.locator('#callout-editor .warn');
  await expect(warn).toContainText('S-037 callout spans a 90 m unsampled gap; S-038 callout spans overlapping samples.');
  await warn.getByRole('button', { name: 'Recalculate' }).click();
  await expect(warn).toBeHidden();
  let now = await state(page);
  expect(now.design).toEqual({ version: 1, current: DESIGN_VERSION, optIn: ['sampledIntercepts'] });
  expect(now.callouts).toMatchObject({ sampled: true, warnings: [] });
  expect(now.callouts.shown.map((c) => c.holeId)).toEqual(['S-035', 'S-038']); // S-037's two 10 m zones are each under the 20 m minimum
  expect(now.callouts.shown.find((c) => c.holeId === 'S-038').line1).toBe('24 m @ 0.48% Cu from 20 m');
  expect(now.display.legend).toEqual(LEGACY_LOOK.legend); // nothing else changes
  // A callout reworded by hand keeps its words.
  now = await page.evaluate(() => window.EM3D.setCallout('S-038', { line1: '24 m of copper' }));
  expect(now.callouts.shown.find((c) => c.holeId === 'S-038')).toMatchObject({ line1: '24 m of copper' });

  await page.evaluate(() => window.EM3D.undo()); // the reworded line
  now = await page.evaluate(() => window.EM3D.undo()); // the recalculation
  expect(now.design.optIn).toEqual([]);
  expect(now.callouts.warnings).toHaveLength(2);
  expect(now.callouts.shown.find((c) => c.holeId === 'S-037').line1).toBe('110 m @ 1.50% Cu from 0 m');
  // Saved and reopened, it is still a version 1 figure.
  const again = await page.evaluate(async () => (await window.EM3D.loadProject(JSON.parse(JSON.stringify(window.EM3D.getProject())))).design);
  expect(again).toEqual({ version: 1, current: DESIGN_VERSION, optIn: [] });
  expect(errors).toEqual([]);
});

test.describe('account', () => {
  test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
  // Software WebGL and several page loads per test: allow more than the default minute.
  test.setTimeout(150_000);

  test('signed out: Save asks to sign in, keeps the figure across the email link, then saves it', async ({ page }) => {
    const fake = await fakeSupabase(page);
    await open3d(page);
    expect(fake.requests).toEqual([]); // supabase-js is not even loaded for a signed-out visitor
    await page.evaluate(() => window.EM3D.setBrand({ title: 'STAR · RAILS ZONE' }));

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save to your account' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('STAR · RAILS ZONE');
    await dialog.getByLabel('Name').fill('Rails zone 3D');
    await dialog.getByLabel('Email').fill(user.email);
    await dialog.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect(fake.otp).toEqual([{ email: user.email, redirect: `${new URL(page.url()).origin}/3d` }]);
    expect(fake.upserts).toHaveLength(0);

    // Back on /3d before the link is used: the figure comes back, unsaved.
    await open3d(page);
    await expect.poll(async () => (await state(page)).brand.title).toBe('STAR · RAILS ZONE');
    await expect(page.locator('#status')).toContainText('Sign in to finish saving it');
    expect(fake.upserts).toHaveLength(0);

    // The email link: the session lands in storage and /3d opens fresh.
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    await expect.poll(() => fake.upserts.length).toBe(1);
    const saved = fake.upserts[0];
    expect(saved.name).toBe('Rails zone 3D');
    expect(saved.settings.settings.title).toBe('STAR · RAILS ZONE');
    expect(saved.settings.files).toBeUndefined(); // file text goes to storage, not the row
    expect(saved.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(saved.file_paths.map((f) => f.path.replace(/\/r[a-z0-9]+\//, '/'))).toEqual(saved.file_paths.map((f) => `${uid}/${saved.id}/${f.name}`));
    expect([...fake.objects.keys()].sort()).toEqual(saved.file_paths.map((f) => `three-d-files/${f.path}`).sort());
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    expect((await state(page)).brand.title).toBe('STAR · RAILS ZONE');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('em3d.pendingSave.v1.flag'))).toBeNull();
    expect(new URL(page.url()).searchParams.get('project')).toBe(saved.id);

    // A reload reopens the saved figure and does not save it again.
    await open3d(page, `/3d?project=${saved.id}`);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    expect((await state(page)).brand.title).toBe('STAR · RAILS ZONE');
    expect(fake.upserts).toHaveLength(1);
  });

  test('signed in: save, Ctrl/Cmd+S, list, open and delete', async ({ page }) => {
    const fake = await fakeSupabase(page);
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    await page.evaluate(() => window.EM3D.setBrand({ title: 'NORTH ZONE' }));

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save to your account' });
    await expect(dialog.getByLabel('Name')).toHaveValue('NORTH ZONE');
    await expect(dialog.getByLabel('Email')).toBeHidden();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(1);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    const id = fake.upserts[0].id;
    // A personal figure has no property library.
    await expect(page.getByRole('button', { name: 'From property library' })).toBeHidden();
    expect(fake.upserts[0].settings.settings.libRefs).toEqual({});

    await page.evaluate(() => window.EM3D.setBrand({ subtitle: 'Version two' }));
    await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');
    await page.locator('body').press('Control+s');
    await expect.poll(() => fake.upserts.length).toBe(2);
    expect(fake.upserts[1]).toMatchObject({ id, name: 'NORTH ZONE' });
    expect(fake.upserts[1].settings.settings.subtitle).toBe('Version two');
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    // Each save writes its own folder. Earlier revisions remain safe for other tabs and published versions.
    const stored = [...fake.objects.keys()].map((k) => k.replace(/^three-d-files\//, '')).sort();
    expect(stored).toEqual(fake.upserts.flatMap((r) => r.file_paths.map((f) => f.path)).sort());
    expect(new Set(fake.upserts[1].file_paths.map((f) => f.path.split('/')[2])).size).toBe(1);
    expect(fake.upserts[1].file_paths[0].path).not.toBe(fake.upserts[0].file_paths[0].path);

    // A corrected file with the same name, rows and columns is still unsaved work.
    await page.evaluate(async () => {
      const p = window.EM3D.getProject();
      const f = p.files[p.files.length - 1];
      f.text = f.text.replace(/\d(?=[^\d]*$)/, (d) => String((Number(d) + 1) % 10));
      await window.EM3D.loadProject(p);
    });
    await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');
    await page.locator('body').press('Control+s');
    await expect.poll(() => fake.upserts.length).toBe(3);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);

    // Work on something else, then reopen the saved figure from the list.
    await page.evaluate(() => { window.EM3D.loadSample(); window.EM3D.setBrand({ title: 'SOMETHING ELSE' }); });
    await page.getByRole('button', { name: 'My 3D maps' }).click();
    const menu = page.getByRole('region', { name: 'My 3D maps' });
    await expect(menu.getByText('NORTH ZONE')).toBeVisible();
    await expect(menu.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await expect(menu.getByText(user.email)).toBeVisible();
    const open = menu.getByRole('button', { name: 'Open NORTH ZONE' });
    await open.click();
    await expect(open).toHaveText('Replace current figure?'); // unsaved work is not dropped on one click
    await open.click();
    await expect(menu).toBeHidden();
    await expect.poll(async () => (await state(page)).brand).toMatchObject({ title: 'NORTH ZONE', subtitle: 'Version two' });

    await page.getByRole('button', { name: 'My 3D maps' }).click();
    const del = menu.getByRole('button', { name: 'Delete NORTH ZONE' });
    await del.click();
    await expect(del).toHaveText('Confirm delete');
    await del.click();
    await expect(menu.getByText('No saved 3D maps yet')).toBeVisible();
    expect(fake.patches).toEqual([id]);
    expect(fake.rows.get(id).deleted_at).toBeTruthy();
    expect((await state(page)).brand.title).toBe('NORTH ZONE'); // the figure on screen stays
  });

  test('published results and their wording survive an account save and reopen verbatim', async ({ page }) => {
    const fake = await fakeSupabase(page);
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    const made = await page.evaluate(async (rel) => {
      const E = window.EM3D, base = E.getProject().files.map(({ name, text }) => ({ name, text }));
      E.addFiles([...base, { name: 'release.csv', text: rel, role: 'published' }]);
      E.setStyle({ calloutMode: 'published' }); await E.layersReady();
      E.setCallout('EX14-02', { line1: '42.000 m @ 0.4800000000000001% Cu' });
      E.setBrand({ title: 'RELEASED RESULTS' });
      return E.getState().callouts;
    }, RELEASE);
    expect(made.shown.map((c) => c.line1)).toEqual([LONG, '30 m @ 0.61% Cu from 40 m', '42.000 m @ 0.4800000000000001% Cu']);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save to your account' });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(1);
    // The table goes up as its own text, the wording with the settings.
    const saved = fake.upserts[0], rel = saved.file_paths.find((f) => f.name === 'release.csv');
    expect(rel.role).toBe('published');
    expect(fake.objects.get(`three-d-files/${rel.path}`)).toBe(RELEASE);
    expect(saved.settings.settings.pubOverrides['EX14-02']).toEqual({ line1: '42.000 m @ 0.4800000000000001% Cu', at: [300, 342] });

    await page.evaluate(() => { window.EM3D.loadSample(); window.EM3D.setBrand({ title: 'SOMETHING ELSE' }); });
    await page.getByRole('button', { name: 'My 3D maps' }).click();
    const open = page.getByRole('region', { name: 'My 3D maps' }).getByRole('button', { name: 'Open RELEASED RESULTS' });
    await open.click();
    // Unsaved work asks first; whether it counts yet depends on the change notice having landed.
    await expect(open).toHaveText(/Replace current figure\?|Opening…/).catch(() => {});
    if (await open.isVisible() && (await open.textContent()) === 'Replace current figure?') await open.click();
    await expect.poll(async () => (await state(page)).callouts.shown.map((c) => c.line1)).toEqual(made.shown.map((c) => c.line1));
    expect((await state(page)).callouts).toEqual(made);
  });

  test('a save over a newer copy warns first: overwrite, save as new or reload', async ({ page }) => {
    const fake = await fakeSupabase(page);
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    await page.evaluate(() => window.EM3D.setBrand({ title: 'EAST ZONE' }));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog', { name: 'Save to your account' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(1);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    const id = fake.upserts[0].id;
    // Another tab (or computer) saves the same figure later.
    const elsewhere = (rid, subtitle) => { const r = fake.rows.get(rid); r.updated_at = new Date(Date.now() + 60_000).toISOString(); if (subtitle) r.settings.settings.subtitle = subtitle; };
    const conflict = page.getByRole('dialog', { name: 'Saved somewhere else since you opened it' });

    elsewhere(id);
    await page.evaluate(() => window.EM3D.setBrand({ subtitle: 'Edited here' }));
    await page.locator('body').press('Control+s');
    await expect(conflict).toBeVisible();
    expect(fake.upserts).toHaveLength(1); // nothing written yet
    await conflict.getByRole('button', { name: 'Overwrite' }).click();
    await expect.poll(() => fake.upserts.length).toBe(2);
    expect(fake.upserts[1]).toMatchObject({ id });
    expect(fake.upserts[1].settings.settings.subtitle).toBe('Edited here');
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /); // the save has finished

    // A save straight after our own save is not a conflict.
    await page.evaluate(() => window.EM3D.setBrand({ subtitle: 'Edited again' }));
    await page.locator('body').press('Control+s');
    await expect.poll(() => fake.upserts.length).toBe(3);
    await expect(conflict).toBeHidden();
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /); // the save has finished

    elsewhere(id);
    await page.locator('body').press('Control+s');
    await conflict.getByRole('button', { name: 'Save as new' }).click();
    const named = page.getByRole('dialog', { name: 'Save to your account' });
    await expect(named.getByLabel('Name')).toHaveValue('EAST ZONE (copy)');
    await named.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(4);
    const copy = fake.upserts[3].id;
    expect(copy).not.toBe(id);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /); // the save has finished

    elsewhere(copy, 'From the other tab');
    await page.evaluate(() => window.EM3D.setBrand({ subtitle: 'Not wanted' }));
    await page.locator('body').press('Control+s');
    await conflict.getByRole('button', { name: 'Reload saved version' }).click();
    await expect.poll(async () => (await state(page)).brand.subtitle).toBe('From the other tab');
    expect(fake.upserts).toHaveLength(4);
  });

  test('a figure saved to the account before design versions opens with its earlier look and keeps it when saved', async ({ page }) => {
    const fake = await fakeSupabase(page), id = '00000000-0000-4000-8000-0000000003d9', at = '2026-10-19T12:00:00.000Z';
    const { files, ...snapshot } = LEGACY; // a row as account.js saved it, with the files inline
    fake.rows.set(id, { id, user_id: uid, name: 'OLD FIGURE', settings: { ...snapshot, files }, file_paths: [], thumbnail: null, created_at: at, updated_at: at, deleted_at: null, org_id: null, property_id: null });
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    const opened = await page.evaluate((i) => window.EM3D.account.openProject(i), id);
    expect(opened.state.design).toEqual({ version: 1, current: DESIGN_VERSION, optIn: [] });
    expect(opened.state.display).toMatchObject({ imagery: LEGACY_LOOK.imagery, legend: LEGACY_LOOK.legend });
    expect(opened.state.callouts.warnings).toHaveLength(2);
    await page.evaluate((i) => window.EM3D.account.saveProject('OLD FIGURE', i), id);
    await expect.poll(() => fake.upserts.length).toBe(1);
    expect(fake.upserts[0].settings.settings).toMatchObject({ ...LEGACY_LOOK, designVersion: 1, designOptIn: [], title: LEGACY.settings.title });
  });

  test('a figure in a property takes files from its data library and offers newer versions', async ({ page }) => {
    const library = { files: [] };
    const fake = await fakeSupabase(page, { library });
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    // The sample's own collars and assays stand in for the property's drill data.
    const sample = await page.evaluate(() => window.EM3D.getProject().files.map(({ name, text }) => ({ name, text })));
    const publish = (n, f, version) => {
      const id = `00000000-0000-4000-8000-00000000f${n}00`, path = `${ORG}/${PROP}/${id}/v${version}/${f.name}`;
      fake.objects.set(`property-files/${path}`, f.text);
      library.files = [...library.files.filter((x) => x.id !== id), { id, name: f.name, kind: 'drill', version, path, bytes: f.text.length, sha256: String(version).repeat(64) }];
      return id;
    };
    const collars = sample.find((f) => /collar/i.test(f.name)), assays = sample.find((f) => /assay/i.test(f.name));
    publish(1, collars, 1);
    const assaysId = publish(2, assays, 1);
    publish(3, { name: 'NI 43-101.pdf', text: '%PDF' }, 1);

    // Saved into the property, the figure offers its library.
    const libButton = page.getByRole('button', { name: 'From property library' });
    await expect(libButton).toBeHidden();
    await page.getByRole('button', { name: 'My 3D maps' }).click();
    await page.getByRole('region', { name: 'My 3D maps' }).getByRole('button', { name: 'Save to property…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save to your account' });
    await expect(dialog.getByLabel('Save to')).toHaveValue(PROP);
    await dialog.getByLabel('Name').fill('Rails 3D');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(1);
    expect(fake.upserts[0]).toMatchObject({ org_id: ORG, property_id: PROP });
    await expect(libButton).toBeVisible();

    await libButton.click();
    const picker = page.getByRole('region', { name: 'Property library' });
    await expect(picker.getByText('NI 43-101.pdf')).toHaveCount(0); // only what the editor reads
    await picker.getByRole('button', { name: `Add ${collars.name} to the figure` }).click();
    await expect(picker.getByRole('button', { name: `Add ${collars.name} to the figure` })).toHaveText('Added');
    await picker.getByRole('button', { name: `Add ${assays.name} to the figure` }).click();
    await expect(picker.getByRole('button', { name: `Add ${assays.name} to the figure` })).toHaveText('Added');
    const st = await state(page);
    expect(st.files.map((f) => f.name).sort()).toEqual([collars.name, assays.name].sort());
    expect(st.project.holes).toBeGreaterThan(0);
    expect(st.libRefs[assays.name]).toEqual({ libFileId: assaysId, version: 1 });
    await page.locator('body').press('Control+s');
    await expect.poll(() => fake.upserts.length).toBe(2);
    expect(fake.upserts[1].settings.settings.libRefs[assays.name]).toEqual({ libFileId: assaysId, version: 1 });
    const id = fake.upserts[1].id;

    // A new version of the assays in the library: reopening the figure offers it.
    const v2 = assays.text.replace(/\d(?=[^\d]*$)/, (d) => String((Number(d) + 1) % 10));
    publish(2, { name: assays.name, text: v2 }, 2);
    await open3d(page, `/3d?project=${id}`);
    const notice = page.locator('#lib-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`Newer data: ${assays.name} v2 (was v1)`);
    await notice.getByRole('button', { name: 'Update' }).click();
    await expect(notice).toBeHidden();
    expect((await state(page)).libRefs[assays.name]).toEqual({ libFileId: assaysId, version: 2 });
    expect(await page.evaluate((n) => window.EM3D.getProject().files.find((f) => f.name === n).text, assays.name)).toBe(v2);
    await expect(page.locator('#acct-note')).toHaveText(/^Unsaved changes/);
  });

  test('a failed save says so plainly and keeps the figure', async ({ page }) => {
    const fake = await fakeSupabase(page, { failUpload: true });
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    await page.evaluate(() => window.EM3D.setBrand({ title: 'KEEP ME' }));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog', { name: 'Save to your account' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Your figure is still here in this browser.');
    expect(fake.upserts).toHaveLength(0); // no row points at files that were not stored
    expect((await state(page)).brand.title).toBe('KEEP ME');
    await expect(page.locator('#acct-note')).toBeVisible();
    await expect(page.locator('#acct-note')).toHaveText('Unsaved changes');
  });
});
