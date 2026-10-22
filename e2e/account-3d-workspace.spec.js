import { test, expect } from '@playwright/test';

// 3D figures in the account, and adding maps and data to a company property,
// against an in-memory Supabase (auth, REST, RPC and storage mocked; nothing
// leaves the browser). Needs the configured client build (dist-auth-check,
// VITE_SUPABASE_URL=https://example.supabase.co).
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');

// /3d's three.js needs WebGL; headless Chromium provides it through SwiftShader.
test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});

const SHOTS = process.env.E2E_SHOTS_DIR || null;

const uid = '00000000-0000-4000-8000-0000000003e1';
const user = { id: uid, email: 'geo@star.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

const ORG = '00000000-0000-4000-8000-0000000003a1';
const PROP = '00000000-0000-4000-8000-0000000003b1';
const org = { id: ORG, name: 'Star Copper Corp.', slug: 'star-copper-corp', plan: 'free', role: 'editor', member_count: 2, property_count: 1 };
const property = { id: PROP, org_id: ORG, name: 'Rails Copper-Gold', slug: 'rails-copper-gold', jurisdiction: 'bc', commodities: ['Cu', 'Au'], status: 'active', description: null, crs: null, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };

// A small 16:9 gradient, so the tile shows a stored thumbnail.
const THUMB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAABBElEQVR42g3LIa6lMAAAwD3E96RmBKmpIDUVpKaC1OI5AB6Px+PxeE63b/z8+wuGYAymYA6WYA22YA+O4Ayu4A6e4A2+4N8fAyMTMwsrGzsHJxc3Dy+fX4iGaIymaI6WaI22aI+O6Iyu6I6e6I2++AvJkIzJlMzJkqzJluzJkZzJldzJk7zJl34hG7Ixm7I5W7I127I9O7Izu7I7e7I3+/IvFEMxFlMxF0uxFluxF0dxFldxF0/xFl/5hWqoxmqq5mqp1mqr9uqozuqq7uqp3uqrv9AMzdhMzdwszdpszd4czdlczd08zdt87Re6oRu7qZu7pVu7rdu7ozu7q7u7p3u7r/sPhZxuISF9DsYAAAAASUVORK5CYII=';
const fig = (n, name, updated, extra = {}) => ({
  id: `00000000-0000-4000-8000-0000000003f${n}`, user_id: uid, org_id: null, property_id: null, name, thumbnail: null,
  settings: { brand: { title: name } }, file_paths: [{ name: 'collars.csv', path: `${uid}/00000000-0000-4000-8000-0000000003f${n}/r1/collars.csv`, size: 2048, role: 'collars' }],
  created_at: updated, updated_at: updated, deleted_at: null, ...extra,
});

const GEOJSON = JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: 'Rails 1' }, geometry: { type: 'Polygon', coordinates: [[[-121.5, 50.1], [-121.4, 50.1], [-121.4, 50.2], [-121.5, 50.2], [-121.5, 50.1]]] } },
] });

async function fakeSupabase(page) {
  const db = {
    figures: [fig(1, 'Rails long section', '2026-10-20T00:00:00Z', { thumbnail: THUMB }), fig(2, 'Tower block model', '2026-10-10T00:00:00Z')],
    maps: [], files: [], objects: new Map(), copies: [], patches: [], inserts: [], rpc: [],
  };
  let next = 1;
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    const rows = (list) => (single ? (list[0] ? json(list[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(list));
    const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      return json(fn === 'user' ? user : fn === 'token' ? session : {});
    }
    // Storage: 3D figure copies, property file uploads and downloads.
    if (path === '/storage/v1/object/copy') {
      const b = req.postDataJSON();
      db.copies.push(b);
      return json({ Key: `${b.bucketId}/${b.destinationKey}` });
    }
    if (path.startsWith('/storage/v1/object/property-files/')) {
      const key = decodeURIComponent(path.slice('/storage/v1/object/property-files/'.length));
      if (method === 'POST') {
        // A File goes up as multipart form data: keep the file part's bytes.
        const raw = req.postDataBuffer().toString('utf8'), type = req.headers()['content-type'] || '';
        const boundary = (type.match(/boundary=(.+)$/) || [])[1];
        const part = boundary ? raw.split(`--${boundary}`).find((x) => /filename=|Content-Type: application/i.test(x) && x.includes('\r\n\r\n')) : null;
        db.objects.set(key, part ? part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '') : raw);
        return json({ Key: key, Id: 'x' });
      }
      const body = db.objects.get(key);
      return body ? route.fulfill({ status: 200, contentType: 'application/geo+json', body }) : json({ message: 'not found' }, 400);
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(), args = req.postDataJSON() || {};
      db.rpc.push({ fn, args });
      if (fn === 'get_my_workspaces') return json([org]);
      if (fn === 'user_plans') return json({ plan: 'free', source: 'signup', status: 'active' });
      if (fn === 'create_org_project') {
        const id = `00000000-0000-4000-8000-0000000004${String(next++).padStart(2, '0')}`;
        db.maps.unshift({ id, name: args.p_name, payload: args.p_payload, revision: 1, updated_at: new Date().toISOString(), thumbnail: null, property_id: args.p_property, org_id: ORG, user_id: uid });
        return json(id);
      }
      if (fn === 'save_cloud_project') {
        const m = db.maps.find((x) => x.id === args.p_id);
        if (m) Object.assign(m, { name: args.p_name, payload: args.p_payload, revision: m.revision + 1 });
        return json(m ? m.revision : 1);
      }
      if (fn === 'list_property_files') return json(db.files);
      if (fn === 'add_property_file_version') {
        db.files = [...db.files, { id: args.p_file, name: args.p_name, kind: args.p_kind, role: args.p_role, version: 1, path: args.p_path, bytes: args.p_bytes, sha256: args.p_sha256, note: null, uploaded_at: '2026-10-21T00:00:00Z', uploaded_by_email: user.email }];
        return json({ file_id: args.p_file, version: 1, unchanged: false });
      }
      if (fn === 'get_property_claims' || fn === 'get_org_activity') return json([]);
      if (fn === 'move_to_property') {
        const f = db.figures.find((x) => x.id === args.p_id);
        if (f) Object.assign(f, { org_id: ORG, property_id: args.p_property });
        return json({ ok: true });
      }
      return json(null);
    }
    if (path === '/rest/v1/properties') return rows([property].filter((p) => !eq('slug') || p.slug === eq('slug')));
    if (path === '/rest/v1/projects') {
      if (eq('property_id')) return rows(db.maps.filter((m) => m.property_id === eq('property_id')).map(({ payload, ...m }) => m));
      if (eq('id')) return rows(db.maps.filter((m) => m.id === eq('id')));
      return rows([]);
    }
    if (path === '/rest/v1/three_d_projects') {
      const live = db.figures.filter((f) => f.deleted_at === null);
      if (method === 'GET') {
        if (eq('id')) return rows(live.filter((f) => f.id === eq('id')));
        if (eq('property_id')) return rows(live.filter((f) => f.property_id === eq('property_id')));
        return rows(live.filter((f) => f.user_id === eq('user_id') && f.org_id === null).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      }
      if (method === 'POST') {
        const body = req.postDataJSON(), row = Array.isArray(body) ? body[0] : body, now = new Date().toISOString();
        const full = { user_id: uid, org_id: null, property_id: null, created_at: now, deleted_at: null, ...row, updated_at: now };
        db.inserts.push(full);
        db.figures.push(full);
        return json(single ? full : [full], 201);
      }
      if (method === 'PATCH') {
        const body = req.postDataJSON(), f = live.find((x) => x.id === eq('id'));
        db.patches.push({ id: eq('id'), body });
        if (!f) return json([]);
        Object.assign(f, body, { updated_at: new Date().toISOString() });
        return json([f]);
      }
    }
    if (path === '/rest/v1/user_plans') return single ? json({ plan: 'free', source: 'signup', status: 'active' }) : json([]);
    return single ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([]);
  });
  await page.addInitScript(([s, id]) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${id}`, JSON.stringify({ done: true, projects: {} }));
  }, [session, uid]);
  page.on('dialog', (d) => { db.nativeDialog = d.message(); d.dismiss(); });
  return db;
}

test('the dashboard lists 3D figures, and renames, duplicates, moves and deletes them', async ({ page }, testInfo) => {
  const db = await fakeSupabase(page);
  await page.goto('/dashboard');
  const section = page.locator('section', { has: page.getByRole('heading', { name: /your 3d figures/i }) });
  await expect(section.getByRole('button', { name: 'Rails long section', exact: true })).toBeVisible();
  await expect(section.locator('.dash-tile-name')).toHaveText(['Rails long section', 'Tower block model']);
  await expect(section.locator('.dash-tile img')).toHaveAttribute('src', THUMB);
  await expect(section.getByRole('link', { name: '+ New 3D figure' })).toHaveAttribute('href', '/3d');
  if (SHOTS) await section.screenshot({ path: `${SHOTS}/dashboard-3d-section-${testInfo.project.name}.png` });

  // Search and sort, as for maps.
  await section.getByLabel('Search your 3D figures').fill('tower');
  await expect(section.locator('.dash-tile-name')).toHaveText(['Tower block model']);
  await section.getByLabel('Search your 3D figures').fill('');
  await section.getByLabel('Sort 3D figures').selectOption('name');
  await expect(section.locator('.dash-tile-name')).toHaveText(['Rails long section', 'Tower block model']);

  // Rename in the app's own dialog.
  await section.getByRole('button', { name: 'Rename Rails long section' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename 3D figure' });
  await expect(dialog.getByLabel('Figure name')).toHaveValue('Rails long section');
  await dialog.getByLabel('Figure name').fill('Rails A–A′');
  await dialog.getByLabel('Figure name').press('Enter');
  await expect(section.getByRole('button', { name: 'Rails A–A′', exact: true })).toBeVisible();
  expect(db.patches.at(-1)).toEqual({ id: db.figures[0].id, body: { name: 'Rails A–A′' } });

  // Duplicate: "<name> (copy)", files copied into the copy's own folder.
  await section.getByRole('button', { name: 'Duplicate Tower block model', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Tower block model (copy)', exact: true })).toBeVisible();
  expect(db.inserts).toHaveLength(1);
  const copy = db.inserts[0];
  expect(copy.name).toBe('Tower block model (copy)');
  expect(db.copies).toEqual([{ bucketId: 'three-d-files', sourceKey: db.figures[1].file_paths[0].path, destinationKey: copy.file_paths[0].path }]);
  expect(copy.file_paths[0].path.startsWith(`${uid}/${copy.id}/`)).toBe(true);

  // Open goes to the 3D maker.
  await expect(section.locator(`[data-figure="${copy.id}"] .dash-tile-thumb`)).toHaveAttribute('aria-label', 'Open 3D figure Tower block model (copy)');

  // Move to a property the user edits for.
  await section.getByRole('button', { name: 'Move Tower block model (copy) to a property' }).click();
  const move = page.getByRole('dialog', { name: /move .* to a property/i });
  await expect(move.getByLabel('Property')).toHaveValue(PROP);
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Moved “Tower block model (copy)” to Rails Copper-Gold');
  expect(db.rpc.find((r) => r.fn === 'move_to_property')?.args).toEqual({ p_kind: 'figure', p_id: copy.id, p_property: PROP });
  await expect(section.getByRole('button', { name: 'Tower block model (copy)', exact: true })).toHaveCount(0);

  // Delete asks first.
  await section.getByRole('button', { name: 'Delete Tower block model', exact: true }).click();
  await section.getByRole('button', { name: 'Yes, delete Tower block model' }).click();
  await expect(section.getByRole('button', { name: 'Tower block model', exact: true })).toHaveCount(0);
  expect(Object.keys(db.patches.at(-1).body)).toEqual(['deleted_at']);
  expect(db.nativeDialog).toBeUndefined();
});

test('the account page counts 3D figures and their storage beside the maps', async ({ page }) => {
  await fakeSupabase(page);
  await page.goto('/account');
  await expect(page.getByTestId('acct-3d-usage')).toHaveText(/2 saved 3D figures, 4\.0 KB of data files\./);
});

test('a property creates a map, starts one from a file, and takes a data file into a new map', async ({ page }, testInfo) => {
  const db = await fakeSupabase(page);
  await page.goto(`/workspace/${org.slug}/p/${property.slug}?tab=maps`);
  await expect(page.getByRole('button', { name: '+ New map in this property' })).toBeVisible();

  // A blank map saved into the property.
  await page.getByRole('button', { name: '+ New map in this property' }).click();
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await expect(page.locator('.ed-doc-name')).toHaveText('Rails Copper-Gold map');
  expect(db.rpc.filter((r) => r.fn === 'create_org_project').map((r) => r.args.p_property)).toEqual([PROP]);

  // A map from a file: the editor's import adds it as the first layer.
  await page.goto(`/workspace/${org.slug}/p/${property.slug}?tab=maps`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /start a map from a file/i }).click();
  await (await chooser).setFiles({ name: 'rails-claims.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(GEOJSON) });
  await expect(page.locator('.ed-doc-name')).toHaveText('Rails Copper-Gold – rails-claims');
  expect(db.rpc.filter((r) => r.fn === 'create_org_project')).toHaveLength(2);
  // Saved into the new property map, not anywhere else.
  const saved = (file) => db.rpc.filter((r) => r.fn === 'save_cloud_project' && r.args.p_payload?.layers?.some((l) => l.sourceName === file));
  await expect.poll(() => saved('rails-claims.geojson').length, { timeout: 30000 }).toBeGreaterThan(0);
  expect(saved('rails-claims.geojson').every((r) => r.args.p_id === db.maps[0].id)).toBe(true);

  // The data library: upload a file, then Use in map.
  await page.goto(`/workspace/${org.slug}/p/${property.slug}?tab=data`);
  const region = page.getByRole('region', { name: 'Data library' });
  const chooser2 = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Add a file' }).click();
  await (await chooser2).setFiles({ name: 'targets.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(GEOJSON) });
  await expect(region.getByLabel('Kind of data')).toHaveValue('layer');
  await region.getByRole('button', { name: 'Upload' }).click();
  await expect(region.getByText('Added targets.geojson.')).toBeVisible();
  await expect(region.getByRole('table', { name: 'Data files' })).toContainText('targets.geojson');
  await expect(region.getByRole('button', { name: 'Download targets.geojson' })).toBeVisible();
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/property-files-tab-${testInfo.project.name}.png` });
  expect([...db.objects.keys()][0]).toMatch(new RegExp(`^${ORG}/${PROP}/[0-9a-f-]+/v1/[0-9a-f]{8}-targets\\.geojson$`));

  await region.getByRole('button', { name: 'Use targets.geojson in a new map' }).click();
  await expect(page.locator('.ed-doc-name')).toHaveText('Rails Copper-Gold – targets');
  expect(db.rpc.filter((r) => r.fn === 'create_org_project')).toHaveLength(3);
  await expect.poll(() => saved('targets.geojson').length, { timeout: 30000 }).toBeGreaterThan(0);
  expect(saved('targets.geojson').every((r) => r.args.p_id === db.maps[0].id)).toBe(true);
  expect(db.nativeDialog).toBeUndefined();
});

test('the property\'s "+ New 3D figure" opens the 3D maker set to save into the property', async ({ page }) => {
  await fakeSupabase(page);
  await page.goto(`/workspace/${org.slug}/p/${property.slug}?tab=figures`);
  await expect(page.getByRole('link', { name: '+ New 3D figure' })).toHaveAttribute('href', `/3d?property=${PROP}`);
});

test.describe('the 3D maker', () => {
  test('links back to the dashboard and says who is signed in', async ({ page }) => {
    await fakeSupabase(page);
    await page.goto('/3d');
    const back = page.getByRole('link', { name: /dashboard/i });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/dashboard');
    await expect(back).toContainText(user.email);
  });

  test('a figure started from a property saves there unless changed', async ({ page }) => {
    await fakeSupabase(page);
    await page.goto(`/3d?property=${PROP}`);
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await page.locator('#acct-save').click();
    await expect(page.locator('#acct-dest-row')).toBeVisible();
    await expect(page.locator('#acct-dest')).toHaveValue(PROP);
  });

  test('says nothing about an account when signed out', async ({ page }) => {
    await page.goto('/3d');
    await expect(page.locator('#acct-save')).toBeVisible();
    await expect(page.locator('#acct-dash')).toBeHidden();
  });
});
