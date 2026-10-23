import { test, expect } from '@playwright/test';

// Company workspaces against an in-memory Supabase (auth, REST and RPC are
// mocked; no request leaves the browser). Needs the configured client build
// (dist-auth-check, VITE_SUPABASE_URL=https://example.supabase.co).
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');

const uid = '00000000-0000-4000-8000-0000000000e1';
const user = { id: uid, email: 'geo@star.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

const ORG = '00000000-0000-4000-8000-0000000000a1';
const PROP = '00000000-0000-4000-8000-0000000000b1';
const MAP = '00000000-0000-4000-8000-0000000000c1';
const FIG = '00000000-0000-4000-8000-0000000000d1';
const org = (role) => ({ id: ORG, name: 'Star Copper Corp.', slug: 'star-copper-corp', plan: 'free', role, member_count: 2, property_count: 1 });
const property = { id: PROP, org_id: ORG, name: 'Rails Copper-Gold', slug: 'rails-copper-gold', jurisdiction: 'bc', commodities: ['Cu', 'Au'], status: 'active', description: 'Porphyry target', crs: null, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };

const ORG2 = '00000000-0000-4000-8000-0000000000a2';
const jvOrg = { id: ORG2, name: 'North Rock JV', slug: 'north-rock-jv', plan: 'free', role: 'viewer', member_count: 3, property_count: 1 };
const jvProperty = { ...property, id: '00000000-0000-4000-8000-0000000000b2', org_id: ORG2, name: 'Rails JV', description: 'Joint venture ground' };

const FILE = '00000000-0000-4000-8000-0000000000f1';
const assays = { id: FILE, name: 'assays.csv', kind: 'drill', role: 'assays', version: 2, path: `${ORG}/${PROP}/${FILE}/v2/assays.csv`, bytes: 2048, sha256: 'a'.repeat(64), note: null, uploaded_at: '2026-10-19T00:00:00Z', uploaded_by_email: 'cfo@star.test' };

const BATCH0 = '00000000-0000-4000-8000-0000000000e0';
const collarBatch = { id: BATCH0, kind: 'collars', filename: 'Rails collars.csv', rows: 12, rows_written: 12, summary: { new: 12, changed: 0, unchanged: 0, new_holes: 12 }, created_at: '2026-10-18T00:00:00Z', created_by_email: 'cfo@star.test', rolled_back_at: null, blocked_by: null };
const drillSummary = () => ({ collars: 12, planned: 2, metres: 3420.5, surveys: 40, assays: 0, lithology: 0, holes: 12, elements: [], limit: 20000, batches: [{ ...collarBatch }] });

async function fakeSupabase(page, { role = 'owner', orgs = [org(role)], properties = null } = {}) {
  const fake = { rpc: [], orgs, properties: properties || (orgs.length ? [property] : []), invites: [], files: [{ ...assays }], uploads: [], signed: [], patches: [], drill: drillSummary(), templates: [], recipes: [], assayRows: [] };
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    const rows = (list) => (single ? (list[0] ? json(list[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(list));
    // Property data library: storage uploads, signed downloads, soft deletes.
    if (path.startsWith('/storage/v1/object/sign/')) {
      const p = decodeURIComponent(path.slice('/storage/v1/object/sign/property-files/'.length));
      fake.signed.push(p);
      return json({ signedURL: `/object/sign/property-files/${p}?token=t` });
    }
    if (path.startsWith('/storage/v1/object/property-files/') && method === 'POST') {
      fake.uploads.push(decodeURIComponent(path.slice('/storage/v1/object/property-files/'.length)));
      return json({ Key: path, Id: 'x' });
    }
    if (path === '/rest/v1/property_files' && method === 'PATCH') {
      const id = (url.searchParams.get('id') || '').slice(3);
      fake.patches.push({ id, body: req.postDataJSON() });
      fake.files = fake.files.filter((f) => f.id !== id);
      return json([{ id }]);
    }
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      return json({});
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(), args = req.postDataJSON() || {};
      fake.rpc.push({ fn, args });
      if (fn === 'get_my_workspaces') return json(fake.orgs);
      if (fn === 'create_organization') {
        fake.orgs = [{ id: ORG, name: args.p_name, slug: 'star-copper-corp', plan: 'free', role: 'owner', member_count: 1, property_count: 0 }];
        return json({ id: ORG, name: args.p_name, slug: 'star-copper-corp', role: 'owner' });
      }
      if (fn === 'list_org_members') {
        return json([{ user_id: uid, email: user.email, role: fake.orgs[0]?.role || 'owner', joined_at: '2026-10-02T00:00:00Z', is_me: true },
          ...(fake.orgs[0]?.member_count > 1 ? [{ user_id: 'u2', email: 'cfo@star.test', role: 'admin', joined_at: '2026-10-02T00:00:00Z', is_me: false }] : [])]);
      }
      if (fn === 'list_org_invites') return json(fake.invites);
      if (fn === 'create_org_invite') {
        const t = 'a'.repeat(64);
        const inv = { id: 'i1', email: args.p_email, role: args.p_role, expires_at: '2026-11-03T00:00:00Z', created_at: '2026-10-20T00:00:00Z', token: t, link: `https://www.explorationmaps.com/invite?token=${t}` };
        fake.invites = [{ id: 'i1', email: args.p_email, role: args.p_role, expires_at: inv.expires_at, created_at: inv.created_at }];
        return json(inv);
      }
      if (fn === 'get_org_activity') return json([{ id: 'a1', created_at: '2026-10-20T10:00:00Z', action: 'created', entity_type: 'map', property_id: PROP, property_name: property.name, actor_email: 'cfo@star.test', summary: 'Created map "Rails claims"' }]);
      if (fn === 'get_property_claims') return json([]);
      if (fn === 'list_property_files') return json(fake.files);
      // Drill database: a dry run returns the diff; a commit adds a batch; a rollback marks it.
      if (fn === 'drill_property_summary') return json(fake.drill);
      if (fn === 'drill_import_batch') {
        const diff = { ok: true, kind: args.p_kind, rows: args.p_rows.length, new: args.p_rows.length, changed: 0, unchanged: 0, holes: 2, new_holes: 1,
          missing_collars: 1, missing_collar_holes: ['R-9'], overlaps_existing: 0, overlap_holes: [], changed_sample: [], errors: [], error_count: 0, limit: 20000 };
        if (args.p_dry_run) return json({ ...diff, dry_run: true });
        fake.drill = { ...fake.drill, assays: fake.drill.assays + diff.new, holes: 13, elements: ['Au', 'Cu'],
          batches: [{ id: args.p_batch, kind: args.p_kind, filename: args.p_filename, rows: diff.rows, rows_written: diff.new, summary: diff, created_at: '2026-10-21T00:00:00Z', created_by_email: user.email, rolled_back_at: null, blocked_by: null }, ...fake.drill.batches] };
        return json({ ...diff, dry_run: false, committed: true, batch_id: args.p_batch, rows_written: diff.new });
      }
      if (fn === 'drill_rollback_batch') {
        fake.drill = { ...fake.drill, assays: fake.rollbackAssays ?? 0, holes: 12, elements: [], batches: fake.drill.batches.map((b) => (b.id === args.p_batch ? { ...b, rolled_back_at: '2026-10-21T01:00:00Z' } : b)) };
        return json({ batch_id: args.p_batch, rolled_back: true, already: false, withdrawn: 3, restored: 0 });
      }
      // Results recipes: each save is the next version of its name.
      if (fn === 'drill_property_recipes') return json(fake.recipes);
      if (fn === 'drill_save_recipe') {
        const cur = fake.recipes.find((r) => r.name === args.p_name);
        const r = { id: `r${(cur?.version || 0) + 1}`, name: args.p_name, version: (cur?.version || 0) + 1, recipe: args.p_recipe, created_at: '2026-10-21T00:00:00Z', created_by_email: user.email, versions: [] };
        fake.recipes = [...fake.recipes.filter((x) => x !== cur), r];
        return json({ ...r, unchanged: false });
      }
      if (fn === 'drill_save_template') {
        const t = { id: 't1', kind: args.p_kind, name: args.p_name, mapping: args.p_mapping, updated_at: '2026-10-21T00:00:00Z' };
        fake.templates = [t];
        return json(t);
      }
      if (fn === 'add_property_file_version') {
        const f = fake.files.find((x) => x.id === args.p_file);
        const version = f ? f.version + 1 : 1;
        const entry = { ...(f || { id: args.p_file, name: args.p_name, kind: args.p_kind, role: args.p_role }), version, path: args.p_path, bytes: args.p_bytes, sha256: args.p_sha256, uploaded_at: '2026-10-21T00:00:00Z', uploaded_by_email: user.email };
        fake.files = [...fake.files.filter((x) => x.id !== args.p_file), entry].sort((a, b) => a.name.localeCompare(b.name));
        return json({ file_id: args.p_file, version, unchanged: false });
      }
      return json(null);
    }
    if (path === '/rest/v1/properties') {
      if (method === 'POST') {
        const body = req.postDataJSON();
        const p = { ...property, ...body, id: 'p-new', slug: 'new-property' };
        fake.properties.push(p);
        return json([p], 201);
      }
      const slug = url.searchParams.get('slug'), orgId = url.searchParams.get('org_id');
      return rows(fake.properties.filter((p) => (!slug || `eq.${p.slug}` === slug) && (!orgId || `eq.${p.org_id}` === orgId)));
    }
    if (path === '/rest/v1/projects') {
      if (url.searchParams.get('property_id')) return rows([{ id: MAP, name: 'Rails claims', updated_at: '2026-10-19T00:00:00Z', thumbnail: null, revision: 3, user_id: 'u2' }]);
      return rows([]);
    }
    if (path === '/rest/v1/three_d_projects') {
      if (url.searchParams.get('property_id')) return rows([{ id: FIG, name: 'Rails 3D section', updated_at: '2026-10-18T00:00:00Z', thumbnail: null }]);
      return rows([]);
    }
    if (path === '/rest/v1/drill_column_templates') return json(fake.templates);
    if (path === '/rest/v1/drill_assays') { fake.assayReads = (fake.assayReads || 0) + 1; return json(Number(url.searchParams.get('offset') || 0) ? [] : fake.assayRows); }
    if (path === '/rest/v1/user_plans') return single ? json({ plan: 'free', source: 'signup', status: 'active' }) : json([]);
    return single ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([]);
  });
  await page.addInitScript((s) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${s.user.id}`, JSON.stringify({ done: true, projects: {} }));
  }, session);
  return fake;
}

test('creates a company workspace and invites a colleague', async ({ page }) => {
  const fake = await fakeSupabase(page, { orgs: [] });
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'Create a company workspace' })).toBeVisible();
  await page.getByLabel('Company name').fill('Star Copper Corp.');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Star Copper Corp\./ })).toBeVisible();
  expect(fake.rpc.find((c) => c.fn === 'create_organization').args).toEqual({ p_name: 'Star Copper Corp.' });
  await expect(page.getByRole('region', { name: /Members/ }).getByText('geo@star.test (you)')).toBeVisible();

  const invites = page.getByRole('region', { name: 'Invite people' });
  await invites.getByLabel('Email').fill('investor@fund.test');
  await invites.getByLabel('Role').selectOption('viewer');
  await invites.getByRole('button', { name: 'Send invite' }).click();
  await expect(invites.getByText(/Invite sent to investor@fund\.test/)).toBeVisible();
  await expect(invites.locator('code')).toHaveText(`https://www.explorationmaps.com/invite?token=${'a'.repeat(64)}`);
  await expect(invites.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(invites.getByRole('list', { name: 'Pending invites' }).getByText('investor@fund.test')).toBeVisible();
  expect(fake.rpc.find((c) => c.fn === 'create_org_invite').args).toEqual({ p_org: ORG, p_email: 'investor@fund.test', p_role: 'viewer' });
  // Phone width: nothing widens the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('the property page lists its map and its 3D figure', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor' });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Rails Copper-Gold', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/star-copper-corp\/p\/rails-copper-gold$/);
  await expect(page.getByRole('heading', { level: 1, name: /Rails Copper-Gold/ })).toBeVisible();
  await expect(page.getByText('Porphyry target')).toBeVisible();

  await page.getByRole('tab', { name: 'Maps' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails claims' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New map in this property' })).toBeVisible();

  await page.getByRole('tab', { name: '3D figures' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails 3D section' })).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Created map "Rails claims"')).toBeVisible();
});

test('the data library lists, adds, versions, downloads and deletes files', async ({ page }) => {
  const fake = await fakeSupabase(page, { role: 'admin' });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Data library' }).click();
  const region = page.getByRole('region', { name: 'Data library' });
  const table = region.getByRole('table', { name: 'Data files' });
  await expect(table.getByRole('row', { name: /assays\.csv.*Drill data · assays.*v2.*cfo@star\.test/ })).toBeVisible();

  // A new file: kind guessed from the name, uploaded to v1 of its own folder, then recorded.
  let chooser = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Add a file' }).click();
  await (await chooser).setFiles({ name: 'Rails collars.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,Easting,Northing\nR-1,1,2\n') });
  await expect(region.getByLabel('Kind of data')).toHaveValue('drill');
  await region.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(region.getByText('Added Rails collars.csv.')).toBeVisible();
  expect(fake.uploads[0]).toMatch(new RegExp(`^${ORG}/${PROP}/[0-9a-f-]{36}/v1/[0-9a-f]{8}-Rails_collars\\.csv$`));
  const added = fake.rpc.find((c) => c.fn === 'add_property_file_version').args;
  expect(added).toMatchObject({ p_property: PROP, p_name: 'Rails collars.csv', p_kind: 'drill', p_role: 'collars', p_path: fake.uploads[0], p_bytes: 32 });
  expect(added.p_sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(table.getByRole('row', { name: /Rails collars\.csv.*v1.*geo@star\.test/ })).toBeVisible();

  // A new version of an existing file goes into its next folder.
  chooser = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: 'Upload a new version of assays.csv' }).click();
  await (await chooser).setFiles({ name: 'assays-batch7.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,From,To,Cu\nR-1,0,2,0.4\n') });
  await expect(region.getByText('Uploaded version 3 of assays.csv.')).toBeVisible();
  expect(fake.uploads[1]).toMatch(new RegExp(`^${ORG}/${PROP}/${FILE}/v3/[0-9a-f]{8}-assays-batch7\\.csv$`));
  await expect(table.getByRole('row', { name: /assays\.csv.*v3/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.route('https://example.supabase.co/storage/v1/object/sign/property-files/**', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, headers: { 'content-disposition': 'attachment; filename="assays.csv"' }, body: 'HoleID' }) : route.fallback()));
  await region.getByRole('button', { name: 'Download assays.csv' }).click();
  expect((await download).suggestedFilename()).toBe('assays.csv');
  expect(fake.signed).toEqual([fake.uploads[1]]);

  page.once('dialog', (d) => d.accept());
  await region.getByRole('button', { name: 'Delete assays.csv' }).click();
  await expect(table.getByText('assays.csv')).toHaveCount(0);
  expect(fake.patches).toEqual([{ id: FILE, body: { deleted_at: expect.any(String) } }]);
});

test('drill data: import a CSV, map its columns, see the diff, commit and roll back', async ({ page }, testInfo) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Drill data' });
  const summary = region.getByRole('definition').filter({ hasText: '12 (2 planned)' });
  await expect(summary).toBeVisible();
  await expect(region.getByText('3,420.5')).toBeVisible();
  const history = region.getByRole('table', { name: 'Import history' });
  await expect(history.getByRole('row', { name: /Collars.*Rails collars\.csv.*12 new holes.*cfo@star\.test/ })).toBeVisible();

  // A file with an unclosed quote is refused whole, naming the line.
  const broken = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Import a CSV' }).click();
  await (await broken).setFiles({ name: 'lith.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,From,To,Code,Description\nR-1,0,2,QMD,"Quartz monzodiorite\nR-1,2,4,AND,Andesite\n') });
  await expect(region.getByRole('alert')).toContainText('Line 2: a quoted value starts here and is never closed');
  await expect(region.getByRole('form', { name: 'Import drill data' })).toHaveCount(0);

  // The kind and columns are detected; the BDL value is flagged before anything is sent.
  const chooser = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Import a CSV' }).click();
  await (await chooser).setFiles({ name: 'assays-2026.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,Sample,From,To,Cu_pct,Au_gpt\nR-1,A1,0,2,0.41,<0.005\nR-1,A2,2,4,0.55,0.12\nR-9,A3,0,1.5,0.2,0.03\n') });
  const form = region.getByRole('form', { name: 'Import drill data' });
  await expect(form.getByLabel('Data')).toHaveValue('assays');
  await expect(form.getByLabel('Hole ID *')).toHaveValue('HoleID');
  await expect(form.getByLabel('From *')).toHaveValue('From');
  await expect(form.getByLabel('Sample ID')).toHaveValue('Sample');
  await expect(form.getByLabel('Element for Au_gpt')).toHaveValue('Au');
  await expect(form.getByLabel('Unit for Au_gpt')).toHaveValue('g/t');
  await expect(form.getByText('1 value below detection, stored as half the detection limit and flagged')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await form.getByRole('button', { name: 'Check against stored data' }).click();
  await expect(form.getByRole('status', { name: 'Changes' })).toContainText('1 new hole, 3 new assays');
  await expect(form.getByText('1 hole has no collar yet: R-9')).toBeVisible();
  const dry = fake.rpc.find((c) => c.fn === 'drill_import_batch').args;
  expect(dry).toMatchObject({ p_property: PROP, p_kind: 'assays', p_filename: 'assays-2026.csv', p_dry_run: true, p_batch: null });
  expect(dry.p_rows[0]).toEqual({ hole_id: 'R-1', sample_id: 'A1', from_m: 0, to_m: 2, values: { Cu: 0.41, Au: 0.0025 }, bdl: { Au: 0.005 }, units: { Cu: '%', Au: 'g/t' } });
  expect(dry.p_mapping).toMatchObject({ columns: { hole_id: 'HoleID', from_m: 'From', to_m: 'To', sample_id: 'Sample' }, bdl: 'half' });
  await page.screenshot({ path: testInfo.outputPath('drill-diff.png'), fullPage: true });

  // Columns saved as a template for the next file from this lab.
  await form.getByLabel('Template name').fill('ALS export');
  await form.getByRole('button', { name: 'Save columns as template' }).click();
  await expect(form.getByLabel('Saved columns').locator('option', { hasText: 'ALS export' })).toHaveCount(1);
  expect(fake.rpc.find((c) => c.fn === 'drill_save_template').args).toMatchObject({ p_org: ORG, p_kind: 'assays', p_name: 'ALS export' });

  await form.getByRole('button', { name: 'Commit import' }).click();
  await expect(region.getByText('Imported assays-2026.csv: 1 new hole, 3 new assays.')).toBeVisible();
  const commit = fake.rpc.filter((c) => c.fn === 'drill_import_batch')[1].args;
  expect(commit).toMatchObject({ p_dry_run: false, p_batch: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await expect(history.getByRole('row', { name: /Assays.*assays-2026\.csv.*1 new hole, 3 new assays.*geo@star\.test/ })).toBeVisible();
  await expect(region.getByText('Au, Cu')).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await history.getByRole('button', { name: 'Roll back assays-2026.csv' }).click();
  await expect(history.getByRole('row', { name: /assays-2026\.csv.*Rolled back/ })).toBeVisible();
  expect(fake.rpc.find((c) => c.fn === 'drill_rollback_batch').args).toEqual({ p_batch: commit.p_batch });
});

// Assays as the drill database returns them: 2 m samples, 122 m of mineralisation from 34 m with an 18 m core.
const assayRows = (hole) => Array.from({ length: 100 }, (_, i) => {
  const d = i * 2, v = d < 34 || d >= 156 ? { Cu: 0.02, Au: 0.01 } : d >= 80 && d < 98 ? { Cu: 1.0, Au: 0.42 } : { Cu: 0.355, Au: 0.174 };
  return { hole_id: hole, from_m: d, to_m: d + 2, values: v, bdl: {}, units: { Cu: '%', Au: 'g/t' } };
});
const RESULT = '122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m, incl. 18.0 m @ 1.32% CuEq';
const withAssays = (fake) => { fake.drill = { ...fake.drill, assays: 200, holes: 12, elements: ['Au', 'Cu'] }; fake.assayRows = [...assayRows('R-10'), ...assayRows('R-2')]; };

test('drill results: the recipe, the release table, copies and downloads, then saved for 3D', async ({ page }, testInfo) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  withAssays(fake);
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    navigator.clipboard.write = async ([item]) => {
      window.__formattedCopy = Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await (await item.getType(type)).text()])));
    };
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Results' });
  await region.getByRole('button', { name: 'Show results' }).click();
  await expect(region.getByText('Not saved yet: a first recipe from the elements in the assays.')).toBeVisible();
  expect(fake.assayReads).toBe(1);
  await region.getByLabel('Recovery for Cu').fill('90');
  await region.getByLabel('Recovery for Au').fill('70');
  await region.getByLabel('"incl." cut-off').fill('1');
  await region.getByLabel('True-width note').fill('True widths are not yet known.');
  await expect(region.getByText('CuEq = Cu + 0.756 × Au', { exact: true })).toBeVisible();
  const table = region.getByRole('table', { name: 'Drill results' });
  // Sorted by hole (R-2 before R-10) and depth, each "incl." under its interval.
  await expect(table.getByRole('row')).toHaveText([/Hole ID.*CuEq \(%\).*Cu \(%\).*Au \(g\/t\)/, /^R-2\s*34\.0\s*156\.0\s*122\.0\s*0\.61\s*0\.45\s*0\.21$/, /^incl\.\s*80\.0\s*98\.0\s*18\.0\s*1\.32/, /^R-10\s*34\.0/, /^incl\./]);
  await expect(region.getByText('2 intercepts in 2 of 2 holes with assays.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('drill-results.png'), fullPage: true });

  await region.getByRole('button', { name: 'Copy as text' }).click();
  await expect(region.getByRole('status')).toHaveText('Copied the results as text.');
  const text = await page.evaluate(() => window.__copied);
  expect(text.split('\n').slice(0, 2)).toEqual([`R-2: ${RESULT}`, `R-10: ${RESULT}`]);
  expect(text).toContain('True widths are not yet known.');
  await region.getByRole('button', { name: 'Copy table (TSV)' }).click();
  expect((await page.evaluate(() => window.__copied)).split('\n')[1]).toBe('R-2\t\t34.0\t156.0\t122.0\t0.61\t0.45\t0.21\t122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m');
  const csv = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Download CSV' }).click();
  const file = await csv;
  expect(file.suggestedFilename()).toBe('rails-copper-gold-results.csv');

  await region.getByLabel('Table format').selectOption('html');
  await region.getByRole('button', { name: 'Copy formatted table' }).click();
  await expect(region.getByRole('status')).toHaveText('Copied the formatted table and recipe notes.');
  const formatted = await page.evaluate(() => window.__formattedCopy);
  expect(formatted['text/plain']).toContain('Unsaved recipe: Default. Calculated from current assays.');
  expect(formatted['text/plain']).toContain('True widths are not yet known.');
  const htmlDownload = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Download HTML' }).click();
  const htmlFile = await htmlDownload;
  expect(htmlFile.suggestedFilename()).toBe('rails-copper-gold-results.html');
  const html = await new Promise((resolve) => { let t = ''; htmlFile.createReadStream().then((st) => { st.on('data', (c) => { t += c; }); st.on('end', () => resolve(t)); }); });
  expect(html).toBe(formatted['text/html']);
  const exported = await page.context().newPage();
  await exported.setContent(html);
  await expect(exported.getByRole('row')).toHaveCount(5);
  await expect(exported.getByRole('cell', { name: RESULT.split(', incl.')[0], exact: true })).toHaveCount(2);
  await expect(exported.getByText('True widths are not yet known.')).toBeVisible();
  await exported.screenshot({ path: testInfo.outputPath('drill-results-html.png'), fullPage: true });
  await exported.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  // Results for 3D come from a saved recipe only.
  const for3d = region.getByRole('button', { name: 'Download for 3D figures' });
  await expect(for3d).toBeDisabled();
  await region.getByRole('button', { name: 'Save recipe' }).click();
  await expect(region.getByRole('status')).toHaveText('Saved Default, version 1.');
  const saved = fake.rpc.find((c) => c.fn === 'drill_save_recipe').args;
  expect(saved).toMatchObject({ p_property: PROP, p_name: 'Default', p_base_version: 0, p_recipe: { primary: 'Cu', equivalent: true, cutoff: 0.2, inclCutoff: 1, trueWidth: 'True widths are not yet known.' } });
  expect(saved.p_recipe.elements).toEqual([{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 70 }]);
  await expect(region.getByText(/Default, version 1 · saved/)).toBeVisible();
  await region.getByRole('button', { name: 'Copy formatted table' }).click();
  await expect(region.getByRole('status')).toHaveText('Copied the formatted table and recipe notes.');
  expect((await page.evaluate(() => window.__formattedCopy))['text/plain']).toContain('Saved recipe: Default, version 1. Calculated from current assays.');
  await page.evaluate(() => { navigator.clipboard.write = async () => { throw new Error('Denied'); }; });
  await region.getByRole('button', { name: 'Copy formatted table' }).click();
  await expect(region.getByText('Copying a formatted table was blocked or is not supported by this browser. Download HTML instead.')).toBeVisible();
  await expect(region.getByRole('button', { name: 'Download HTML' })).toBeEnabled();
  const pub = page.waitForEvent('download');
  await for3d.click();
  const pf = await pub;
  expect(pf.suggestedFilename()).toBe('rails-copper-gold-published-results.csv');
  const body = await new Promise((resolve) => { let t = ''; pf.createReadStream().then((st) => { st.on('data', (c) => { t += c; }); st.on('end', () => resolve(t)); }); });
  expect(body.split('\r\n').slice(0, 3)).toEqual([
    'Result ID,Hole ID,From,To,Published length,Grade,Analyte,Unit,Parent result,Approved text,Release date,Source,Approval status',
    'R-2:1,R-2,34,156,122.0,0.61,CuEq,%,,"122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m",,Property results: Default v1,approved',
    'R-2:1.1,R-2,80,98,18.0,1.32,CuEq,%,R-2:1,18.0 m @ 1.32% CuEq,,Property results: Default v1,approved',
  ]);

  // A roll-back (or an import) changes the assays: Results reads them again.
  fake.rollbackAssays = 100;
  fake.assayRows = assayRows('R-2');
  const reads = fake.assayReads;
  page.once('dialog', (d) => d.accept());
  await page.getByRole('table', { name: 'Import history' }).getByRole('button', { name: 'Roll back Rails collars.csv' }).click();
  await expect(region.getByText('1 intercept in 1 of 1 holes with assays.')).toBeVisible();
  expect(fake.assayReads).toBe(reads + 1);
  await expect(region.getByText(/Default, version 1 · saved/)).toBeVisible();
});

test('drill results: members see the saved recipe and its table, without editing it', async ({ page }) => {
  const fake = await fakeSupabase(page, { role: 'viewer' });
  withAssays(fake);
  fake.recipes = [{ id: 'r3', name: 'Default', version: 3, created_at: '2026-10-20T00:00:00Z', created_by_email: 'cfo@star.test', versions: [],
    recipe: { version: 1, primary: 'Cu', equivalent: true, elements: [{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 70 }],
      cutoff: 0.2, minLength: 2, maxDilution: 6, inclCutoff: 1, inclMinLength: 2, inclMaxDilution: 0, bdl: 'stored', lengthDecimals: 1, gradeDecimals: {}, trueWidth: '' } }];
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Results' });
  await region.getByRole('button', { name: 'Show results' }).click();
  await expect(region.getByText('Default, version 3 · saved')).toBeVisible();
  await expect(region.getByRole('table', { name: 'Drill results' }).getByRole('row').nth(1)).toHaveText(/^R-2\s*34\.0\s*156\.0\s*122\.0\s*0\.61/);
  await expect(region.getByLabel('Recovery for Au')).toBeDisabled();
  await expect(region.getByLabel('Cut-off', { exact: true })).toBeDisabled();
  await expect(region.getByRole('button', { name: 'Save recipe' })).toHaveCount(0);
  await expect(region.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(region.getByRole('button', { name: 'Download for 3D figures' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('a viewer gets the same pages without editing controls', async ({ page }) => {
  await fakeSupabase(page, { role: 'viewer' });
  await page.goto('/workspace');
  await expect(page.getByText(/You have view-only access to Star Copper Corp\./)).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New property' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Invite people' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Rails Copper-Gold' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /Role for/ })).toHaveCount(0);

  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await expect(page.getByText(/View only\. You can open every map/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Maps' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails claims' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New map in this property' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move one of my maps here' })).toHaveCount(0);
  await page.getByRole('tab', { name: '3D figures' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails 3D section' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ New 3D figure' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Data library' }).click();
  await expect(page.getByRole('button', { name: 'Download assays.csv' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add a file' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Upload a new version/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await expect(page.getByRole('table', { name: 'Import history' }).getByRole('row', { name: /Rails collars\.csv.*12 new holes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Import a CSV' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Roll back/ })).toHaveCount(0);
});

test('an older property link opens directly when only one company has that address', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor' });
  await page.goto('/workspace/p/rails-copper-gold');
  await expect(page.getByRole('heading', { level: 1, name: /Rails Copper-Gold/ })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/star-copper-corp\/p\/rails-copper-gold$/);
});

test('an older property link shared by two companies asks which one', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor', orgs: [org('editor'), jvOrg], properties: [property, jvProperty] });
  await page.goto('/workspace/p/rails-copper-gold');
  await expect(page.getByRole('heading', { name: 'Which property did you mean?' })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/p\/rails-copper-gold$/);
  await page.getByRole('button', { name: 'Open in North Rock JV' }).click();
  await expect(page).toHaveURL(/\/workspace\/north-rock-jv\/p\/rails-copper-gold$/);
  await expect(page.getByRole('heading', { level: 1, name: /Rails JV/ })).toBeVisible();
  await expect(page.getByText('Joint venture ground')).toBeVisible();
  // Each company's address opens its own property.
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await expect(page.getByRole('heading', { level: 1, name: /Rails Copper-Gold/ })).toBeVisible();
});

test('an invite link signed out asks to sign in and keeps the token', async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  const t = 'b'.repeat(64);
  await page.goto(`/invite?token=${t}`);
  await expect(page.getByRole('heading', { name: /invited to a company workspace/ })).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('em.pendingInvite.v1')).token)).toBe(t);
});
