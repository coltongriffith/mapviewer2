import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseDrillFilter, matchesDrillFilter } from '../tests/fixtures/drill-filter.js';
import { defaultRecipe, computeResults } from '../shared/drillResults.js';

// Exploration Maps 3D (/3d): a figure that takes its holes from a property's drill database
// (src/three-d/property-data.js), against an in-memory Supabase (auth, REST and storage mocked; no request
// leaves the browser). Needs the configured client build (dist-auth-check, VITE_SUPABASE_URL=https://example.supabase.co).
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});
test.setTimeout(300_000); // three loads and reopens of 2,500 assays under software WebGL

const uid = '00000000-0000-4000-8000-0000000004d1';
const user = { id: uid, email: 'drill@example.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
const AUTH_KEY = 'sb-example-auth-token';
const ORG = '00000000-0000-4000-8000-0000000004a1', PROP = '00000000-0000-4000-8000-0000000004b1';
const LEGACY = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
const B = (n) => `00000000-0000-4000-8000-00000000b${String(n).padStart(3, '0')}`;

// The property's drill database: 12 holes (four of them surveyed and curving), 2,520 assays (three pages), lithology.
function drillData() {
  const db = { batches: [], drill_collars: [], drill_surveys: [], drill_assays: [], drill_lithology: [] };
  const base = { property_id: PROP, org_id: ORG, superseded_by_batch: null };
  const batch = (n, kind, at, summary, mapping = {}) => db.batches.push({ id: B(n), property_id: PROP, org_id: ORG, kind, summary, mapping, created_at: at, rolled_back_at: null });
  batch(1, 'collars', '2026-10-18T10:00:00.000000+00:00', { new: 12 });
  batch(2, 'surveys', '2026-10-18T11:00:00.000000+00:00', { new: 16 });
  batch(3, 'assays', '2026-10-18T12:00:00.000000+00:00', { new: 2520 }, { elements: [{ column: 'Cu_pct', name: 'Cu', unit: '%' }, { column: 'Au_gpt', name: 'Au', unit: 'g/t' }] });
  batch(4, 'lithology', '2026-10-18T13:00:00.000000+00:00', { new: 24 });
  for (let h = 1; h <= 12; h++) addHole(db, base, h, 3);
  return db;
}
function addHole(db, base, h, batchN) {
  const id = `RL-${String(h).padStart(2, '0')}`;
  db.drill_collars.push({ ...base, batch_id: B(1), hole_id: id, x: 500000 + h * 60, y: 6000000 + (h % 3) * 80, z: 1200 - h, crs: null, azimuth: 45, dip: -60, depth: 300, status: null, planned: false });
  if (h <= 4) [0, 100, 200, 300].forEach((d, i) => db.drill_surveys.push({ ...base, batch_id: B(2), hole_id: id, depth_m: d, azimuth: 45 + 3 * i, dip: -60 + 3 * i }));
  for (let i = 0; i < 210; i++) {
    db.drill_assays.push({ ...base, batch_id: B(batchN), hole_id: id, from_m: +(i * 1.4).toFixed(1), to_m: +((i + 1) * 1.4).toFixed(1),
      values: { Cu: ((i * 37 + h * 11) % 100) / 100, Au: ((i * 13 + h * 7) % 50) / 40 }, units: { Cu: '%', Au: 'g/t' }, bdl: {} });
  }
  db.drill_lithology.push({ ...base, batch_id: B(4), hole_id: id, from_m: 0, to_m: 30, code: 'OVB', description: 'Overburden' }, { ...base, batch_id: B(4), hole_id: id, from_m: 30, to_m: 300, code: 'QMP', description: 'Quartz monzonite porphyry' });
}

async function fakeSupabase(page, db) {
  const fake = { requests: [], rows: new Map(), objects: new Map(), upserts: [], drillPages: [] };
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method(), q = url.searchParams;
    fake.requests.push(`${method} ${path}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      return json({});
    }
    if (path === '/rest/v1/rpc/get_my_workspaces') return json([{ id: ORG, name: 'Star Copper Corp.', slug: 'star-copper-corp', role: 'viewer' }]);
    if (path === '/rest/v1/rpc/drill_property_recipes') return json(db.recipes || []);
    if (path.startsWith('/rest/v1/rpc/')) return json(null);
    if (path === '/rest/v1/properties') return json([{ id: PROP, name: 'Rails', slug: 'rails', org_id: ORG }]);
    if (path === '/rest/v1/drill_import_batches') {
      expect(q.get('property_id')).toBe(`eq.${PROP}`);
      return json([...db.batches].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }
    const table = path.slice('/rest/v1/'.length);
    if (db[table]) {
      // The actual SDK sends an ordered key cursor and a limit, never an offset.
      expect(q.get('property_id')).toBe(`eq.${PROP}`);
      expect(q.get('superseded_by_batch')).toBe('is.null');
      expect(q.has('offset')).toBe(false);
      const limit = +q.get('limit'), keys = q.get('order').split(',').map((k) => k.split('.')[0]);
      let rows = db[table].filter((r) => r.superseded_by_batch === null);
      if (q.has('hole_id')) rows = rows.filter((r) => matchesDrillFilter(r, parseDrillFilter(`hole_id.${q.get('hole_id')}`)));
      if (q.has('or')) rows = rows.filter((r) => matchesDrillFilter(r, parseDrillFilter(`or${q.get('or')}`)));
      rows.sort((a, b) => { for (const k of keys) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; });
      const data = rows.slice(0, Math.min(limit, 1000));
      fake.drillPages.push({ table, cursor: q.has('hole_id'), rows: data.length, limit });
      return json(data);
    }
    if (path === '/rest/v1/three_d_projects') {
      if (method === 'GET') {
        const id = q.get('id'), rows = [...fake.rows.values()].filter((r) => r.deleted_at === null && (!id || id === `eq.${r.id}`));
        return json(single ? rows[0] : rows);
      }
      if (method === 'POST') {
        const body = req.postDataJSON(), row = Array.isArray(body) ? body[0] : body, prev = fake.rows.get(row.id), now = new Date().toISOString();
        const full = { user_id: uid, created_at: prev?.created_at || now, deleted_at: null, org_id: null, property_id: null, ...prev, ...row, updated_at: now };
        fake.rows.set(row.id, full); fake.upserts.push(structuredClone(full));
        return json(single ? full : [full], 201);
      }
      if (method === 'PATCH') {
        const id = (q.get('id') || '').slice(3), r = fake.rows.get(id);
        Object.assign(r, req.postDataJSON(), { updated_at: new Date().toISOString() }); fake.upserts.push(structuredClone(r));
        return json(single ? r : [r]);
      }
    }
    if (path.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(path.slice('/storage/v1/object/'.length));
      if (method === 'POST' && rest.startsWith('list/')) return json([]);
      if (method === 'POST') { fake.objects.set(rest, req.postData()); return json({ Key: rest, Id: rest }); }
      if (method === 'GET') return route.fulfill({ status: 200, contentType: 'text/plain', body: fake.objects.get(rest) ?? '' });
      if (method === 'DELETE') return json([]);
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
const exportBoth = (page) => page.evaluate(async () => { await window.EM3D.layersReady(); return [window.EM3D.exportPNG({ view: '3d' }), window.EM3D.exportPNG({ view: 'section' })]; });

test('saved property recipes supply callouts and offer recipe-only updates without changing the saved figure', async ({ page }) => {
  const db = drillData();
  db.drill_collars = db.drill_collars.slice(0, 1); db.drill_surveys = []; db.drill_lithology = [];
  db.drill_assays = [0.5, 0.9].map((v, i) => ({ ...db.drill_assays[0], from_m: i * 2, to_m: i * 2 + 2, values: { Au: v }, units: { Au: 'g/t' }, bdl: {} }));
  const recipe = { ...defaultRecipe(['Au'], { Au: 'g/t' }), inclCutoff: null };
  db.recipes = [{ id: 'recipe-3', name: 'Default', version: 3, recipe }];
  const expected = computeResults(db.drill_assays, recipe).results[0];
  const fake = await fakeSupabase(page, db);
  await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
  await open3d(page);
  await page.getByRole('button', { name: 'From property drill database' }).click();
  await expect(page.locator('#drill-recipe')).toHaveValue('r:Default');
  await page.locator('#drill-load').click();
  await expect(page.locator('#status')).toContainText('Results calculated with Default v3');
  await expect.poll(async () => (await state(page)).callouts.shown[0]?.line1).toBe(expected.line);
  expect((await state(page)).callouts.mode).toBe('published');
  const file = await page.evaluate(() => window.EM3D.getProject().files.find((f) => f.name === 'property-recipe-results.csv'));
  expect(file.role).toBe('published'); expect(file.text).toContain(expected.id);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to your account' });
  await dialog.getByLabel('Name').fill('Illustrative recipe test');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fake.upserts.length).toBe(1);
  const saved = fake.upserts[0];
  expect(saved.settings.settings.drillSource.resultsRecipe.version).toBe(3);
  db.recipes = [{ id: 'recipe-4', name: 'Default', version: 4, recipe: { ...recipe, cutoff: 99 } }];
  await open3d(page, `/3d?project=${saved.id}`);
  await expect(page.locator('#drill-notice')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#drill-notice')).toContainText('Default changed from v3 to v4');
  expect((await state(page)).drillSource.resultsRecipe.version).toBe(3);
  expect((await state(page)).callouts.shown[0].line1).toBe(expected.line);
  await page.locator('#drill-update').click();
  await expect(page.locator('#drill-notice')).toBeHidden();
  await expect.poll(async () => (await state(page)).drillSource.resultsRecipe.version).toBe(4);
  await expect(page.locator('#status')).toContainText('Results calculated with Default v4');
  expect((await state(page)).callouts.shown).toEqual([]);
  expect((await state(page)).callouts.mode).toBe('published');
  expect(fake.upserts).toHaveLength(1); // update is an unsaved edit until the user saves
  expect(saved.settings.settings.drillSource.resultsRecipe.version).toBe(3);
});

test('a figure takes its holes from the property drill database, keeps them, and updates only when asked', async ({ page }) => {
  const errors = [], chunks = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => chunks.push(r.url()));
  const db = drillData(), fake = await fakeSupabase(page, db);
  await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
  await open3d(page);
  expect(fake.requests.some((r) => /drill_/.test(r))).toBe(false); // nothing read until asked

  // Pick the property and load it: three pages of assays, the sample replaced.
  await page.getByRole('button', { name: 'From property drill database' }).click();
  const picker = page.getByRole('region', { name: 'Property drill database' });
  await expect(picker.getByLabel('Property')).toHaveValue(PROP);
  await picker.getByRole('button', { name: 'Load drill data' }).click();
  await expect(page.locator('#status')).toContainText('Loaded Rails from its drill database: 12 holes, 2,520 assays.');
  expect(fake.drillPages.filter((p) => p.table === 'drill_assays')).toEqual([1000, 1000, 520, 0].map((rows, i) => ({ table: 'drill_assays', cursor: i > 0, rows, limit: 1000 })));
  let st = await state(page);
  expect(st.usingSample).toBe(false);
  expect(st.files.map((f) => [f.name, f.role])).toEqual([['property-collars.csv', 'collar'], ['property-surveys.csv', 'survey'], ['property-assays.csv', 'assay'], ['property-lithology.csv', 'litho']]);
  expect(st.files[2].gradeColumns).toEqual(['Cu_pct', 'Au_gpt']);
  expect(st.project).toMatchObject({ holes: 12, intervals: 2520 });
  expect(st.grade.column).toBe('Cu_pct');
  expect(st.drillSource).toEqual({ kind: 'property', propertyId: PROP, propertyName: 'Rails', latestBatchId: B(4), latestAt: '2026-10-18T13:00:00.000Z', holes: 12, assays: 2520, crs: null, geologySource: 'lithology', geologyIntervals: 24 });
  await expect.poll(() => chunks.some((u) => /\/min-curvature-[\w-]+\.js$/.test(u))).toBe(true); // surveyed holes follow minimum curvature

  // Saved: the data goes with the figure as files, and the reference with its settings.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to your account' });
  await dialog.getByLabel('Name').fill('Rails drilling');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fake.upserts.length).toBe(1);
  const saved = fake.upserts[0];
  expect(saved.settings.settings.drillSource).toEqual(st.drillSource);
  expect(saved.file_paths.map((f) => f.name)).toEqual(st.files.map((f) => f.name));
  const savedAssays = await page.evaluate(() => window.EM3D.getProject().files.find((f) => f.name === 'property-assays.csv').text);

  // Reopened with nothing new: no notice.
  await open3d(page, `/3d?project=${saved.id}`);
  await expect(page.locator('#acct-note')).toHaveText(/^Saved /, { timeout: 60_000 }); // a reopen downloads and rebuilds the figure
  await expect.poll(() => fake.requests.filter((r) => r.endsWith('/drill_import_batches')).length).toBeGreaterThan(2);
  await expect(page.locator('#drill-notice')).toBeHidden();

  // A new import of one hole and its assays: reopening offers it, and changes nothing until Update.
  db.batches.push({ id: B(5), property_id: PROP, org_id: ORG, kind: 'collars', summary: { new: 1 }, mapping: {}, created_at: '2026-10-21T09:00:00.000000+00:00', rolled_back_at: null });
  db.batches.push({ id: B(6), property_id: PROP, org_id: ORG, kind: 'assays', summary: { new: 210, changed: 0 }, mapping: {}, created_at: '2026-10-21T09:05:00.000000+00:00', rolled_back_at: null });
  addHole(db, { property_id: PROP, org_id: ORG, superseded_by_batch: null }, 13, 6);
  const pagesBefore = fake.drillPages.length;
  await open3d(page, `/3d?project=${saved.id}`);
  const notice = page.locator('#drill-notice');
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect(notice).toContainText('New drill data since this figure (1 new hole, 210 assays, 0 lithology intervals) —');
  st = await state(page);
  expect(st.project).toMatchObject({ holes: 12, intervals: 2520 });
  expect(st.drillSource.latestBatchId).toBe(B(4));
  expect(fake.drillPages.length).toBe(pagesBefore); // only the import list was read
  await expect(page.locator('#acct-note')).toHaveText(/^Saved /, { timeout: 60_000 }); // a reopen downloads and rebuilds the figure
  const kept = await exportBoth(page);
  // Dismissed: the figure stays exactly as approved.
  await notice.getByRole('button', { name: 'Keep the drill data this figure has' }).click();
  await expect(notice).toBeHidden();
  expect(await exportBoth(page)).toEqual(kept);
  expect(await page.evaluate(() => window.EM3D.getProject().files.find((f) => f.name === 'property-assays.csv').text)).toBe(savedAssays);
  expect((await state(page)).drillSource.latestBatchId).toBe(B(4));

  // Offered again on the next open; Update re-reads the property and keeps the figure's camera and style.
  await open3d(page, `/3d?project=${saved.id}`);
  await expect(notice).toBeVisible({ timeout: 60_000 });
  const cam = (await state(page)).camera;
  await notice.getByRole('button', { name: 'Update' }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator('#status')).toContainText('Updated from Rails: 13 holes, 2,730 assays. Save to keep it.');
  st = await state(page);
  expect(st.project).toMatchObject({ holes: 13, intervals: 2730 });
  expect(st.drillSource).toMatchObject({ latestBatchId: B(6), latestAt: '2026-10-21T09:05:00.000Z', holes: 13, assays: 2730 });
  expect(st.camera).toEqual(cam);
  expect(await exportBoth(page)).not.toEqual(kept);
  await expect(page.locator('#acct-note')).toHaveText(/^Unsaved changes/);
  expect(errors).toEqual([]);
});

test('a figure made from files is untouched: no drill source, no drill reads, no notice', async ({ page }) => {
  const db = drillData(), fake = await fakeSupabase(page, db), id = '00000000-0000-4000-8000-0000000004d9', at = '2026-10-19T12:00:00.000Z', chunks = [];
  page.on('request', (r) => chunks.push(r.url()));
  const { files, ...snapshot } = LEGACY;
  fake.rows.set(id, { id, user_id: uid, name: 'OLD FIGURE', settings: { ...snapshot, files }, file_paths: [], thumbnail: null, created_at: at, updated_at: at, deleted_at: null, org_id: null, property_id: null });
  await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
  await open3d(page, `/3d?project=${id}`);
  await expect(page.locator('#acct-note')).toHaveText(/^Saved /, { timeout: 60_000 }); // a reopen downloads and rebuilds the figure
  const st = await state(page);
  expect(st.drillSource).toBeNull();
  expect(st.files.map((f) => f.name)).toEqual(LEGACY.files.map((f) => f.name));
  await expect(page.getByRole('button', { name: 'From property drill database' })).toBeVisible(); // offered, never applied
  await expect(page.locator('#drill-notice')).toBeHidden();
  expect(fake.requests.filter((r) => /drill_/.test(r))).toEqual([]);
  expect(chunks.filter((u) => /\/(min-curvature|property-data)-/.test(u))).toEqual([]); // nor the code that would change it
  // Saved again, it records no drill source.
  await page.evaluate((i) => window.EM3D.account.saveProject('OLD FIGURE', i), id);
  await expect.poll(() => fake.upserts.length).toBe(1);
  expect(fake.upserts[0].settings.settings.drillSource).toBeNull();
});

test('explicit alteration source stays separate, survives saving, and updates without losing legend labels', async ({ page }) => {
  const db = drillData();
  db.drill_collars = db.drill_collars.slice(0, 1); db.drill_assays = []; db.drill_surveys = [];
  db.drill_lithology = db.drill_lithology.filter((r) => r.hole_id === 'RL-01');
  db.drill_alteration = [{ ...db.drill_lithology[0], batch_id: B(5), code: '03', description: 'Chlorite', intensity: 'weak', from_m: 0, to_m: 30 }];
  db.batches.push({ ...db.batches[3], id: B(5), kind: 'alteration', created_at: '2026-10-19T13:00:00Z', summary: { new: 1 } });
  const fake = await fakeSupabase(page, db);
  await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
  await open3d(page);
  await page.getByRole('button', { name: 'From property drill database' }).click();
  await expect(page.getByLabel('Geology source')).toHaveValue('lithology');
  await page.getByLabel('Geology source').selectOption('alteration');
  await page.locator('#drill-load').click();
  await expect(page.locator('#status')).toContainText('Loaded Rails');
  let st = await state(page);
  expect(st.drillSource.geologySource).toBe('alteration');
  expect(st.files.filter((f) => f.role === 'litho').map((f) => f.name)).toEqual(['property-alteration.csv']);
  expect(fake.drillPages.some((p) => p.table === 'drill_lithology')).toBe(false);
  const text = await page.evaluate(() => window.EM3D.getProject().files.find((f) => f.name === 'property-alteration.csv').text);
  expect(text).toContain('Intensity'); expect(text).toContain('weak'); expect(text).toContain('03');
  await page.evaluate(async () => { await window.EM3D.setGeology({ enabled: true }); const legend = window.EM3D.getState().geology.legend.map((r) => ({ ...r, name: 'My chlorite label', nameSet: true })); await window.EM3D.setGeology({ legend }); });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to your account' });
  await dialog.getByLabel('Name').fill('Synthetic alteration'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fake.upserts.length).toBe(1); const saved = fake.upserts[0];
  expect(saved.settings.settings.drillSource.geologySource).toBe('alteration');
  db.batches.push({ ...db.batches[4], id: B(6), created_at: '2026-10-20T13:00:00Z', summary: { new: 0, changed: 1 } });
  db.drill_alteration[0].intensity = '03'; db.drill_alteration[0].batch_id = B(6);
  await open3d(page, `/3d?project=${saved.id}`);
  await expect(page.locator('#drill-notice')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#acct-note')).toHaveText(/^Saved /, { timeout: 60_000 });
  await page.locator('#drill-update').click();
  await expect(page.locator('#drill-notice')).toBeHidden();
  st = await state(page); expect(st.drillSource.geologySource).toBe('alteration');
  expect(st.geology.legend[0].name).toBe('My chlorite label'); expect(st.geology.title).toBe('Alteration');
  expect(st.files.filter((f) => f.role === 'litho').map((f) => f.name)).toEqual(['property-alteration.csv']);
  await page.getByRole('button', { name: 'From property drill database' }).click();
  await expect(page.getByLabel('Geology source')).toHaveValue('alteration');
  await page.getByLabel('Geology source').selectOption('none'); await page.locator('#drill-load').click();
  await expect.poll(async () => (await state(page)).drillSource.geologySource).toBe('none');
  expect((await state(page)).files.some((f) => f.role === 'litho')).toBe(false);
  expect((await state(page)).geology.legend).toEqual([]);
});
