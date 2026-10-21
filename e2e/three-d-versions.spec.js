import { test, expect } from '@playwright/test';

// Exploration Maps 3D published versions (src/three-d/versions.js,
// supabase/migrations/20261029100000_figure_versions.sql): publish a saved
// figure, edit it, and open the version read-only, drawn exactly as it was.
// Auth, REST, the two RPCs and storage are an in-memory Supabase (no request
// leaves the browser); the RPC copies the saved row as the real one does.
// Needs the configured client build (dist-auth-check,
// VITE_SUPABASE_URL=https://example.supabase.co).

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});

const uid = '00000000-0000-4000-8000-0000000003d5';
const user = { id: uid, email: 'versions@example.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
const AUTH_KEY = 'sb-example-auth-token';

async function fakeSupabase(context) {
  const fake = { rows: new Map(), objects: new Map(), versions: [], upserts: [], calls: [] };
  const frozen = (key) => fake.versions.some((v) => v.file_names.includes(key.replace(/^three-d-files\//, '')));
  await context.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      return json({});
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(), a = req.postDataJSON() || {};
      fake.calls.push({ fn, args: a });
      const err = (message) => json({ code: 'P0001', message, details: null, hint: null }, 400);
      if (fn === 'get_my_workspaces') return json([]);
      if (fn === 'publish_figure_version') {
        // As the SQL: the CURRENT saved row, never anything the browser sends.
        const r = fake.rows.get(a.p_figure_id);
        if (!r || r.deleted_at) return json({ code: 'P0002', message: 'NOT_FOUND' }, 400);
        if (a.p_expected_updated_at && Date.parse(a.p_expected_updated_at) !== Date.parse(r.updated_at)) return err('VERSION_STALE: the figure was saved again since this copy was opened');
        const n = fake.versions.filter((v) => v.figure_id === r.id).length + 1;
        const v = { id: `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`, figure_kind: 'figure', figure_id: r.id, version: n, label: a.p_label, release_date: a.p_release_date,
          name: r.name, content_hash: String(n).repeat(64), created_at: new Date().toISOString(), published_by_email: user.email, file_names: r.file_paths.map((f) => f.path),
          snapshot: structuredClone({ kind: 'figure', id: r.id, name: r.name, settings: r.settings, file_paths: r.file_paths, saved_at: r.updated_at,
            files: r.file_paths.map((f) => ({ path: f.path, size: Buffer.byteLength(fake.objects.get(`three-d-files/${f.path}`), 'utf8'), etag: null })) }) };
        fake.versions.push(v);
        return json({ id: v.id, kind: 'figure', figure_id: r.id, version: n, label: v.label, release_date: v.release_date, name: v.name, content_hash: v.content_hash, created_at: v.created_at });
      }
      if (fn === 'list_figure_versions') {
        return json(fake.versions.filter((v) => v.figure_id === a.p_figure_id).reverse().map(({ snapshot, file_names, figure_kind, figure_id, ...v }) => v));
      }
      return json(null);
    }
    if (path === '/rest/v1/figure_versions' && method === 'GET') {
      const eq = (k) => url.searchParams.get(k)?.slice(3);
      const rows = fake.versions.filter((v) => (!eq('id') || v.id === eq('id')) && (!eq('figure_id') || v.figure_id === eq('figure_id')) && (!eq('version') || String(v.version) === eq('version')));
      return json(single ? rows[0] ?? null : rows);
    }
    if (path === '/rest/v1/three_d_projects') {
      if (method === 'GET') {
        const id = url.searchParams.get('id');
        const rows = [...fake.rows.values()].filter((r) => r.deleted_at === null && (!id || id === `eq.${r.id}`)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return json(single ? rows[0] : rows);
      }
      const body = req.postDataJSON(), row = Array.isArray(body) ? body[0] : body, now = new Date().toISOString();
      const id = method === 'PATCH' ? (url.searchParams.get('id') || '').slice(3) : row.id, prev = fake.rows.get(id);
      const full = { user_id: uid, created_at: prev?.created_at || now, org_id: null, property_id: null, ...prev, ...row, id, updated_at: now };
      fake.rows.set(id, full); fake.upserts.push(structuredClone(full));
      return json(single ? full : [full], method === 'POST' ? 201 : 200);
    }
    if (path.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(path.slice('/storage/v1/object/'.length));
      if (method === 'POST' && rest.startsWith('list/')) {
        const { prefix } = req.postDataJSON(), seen = new Map();
        for (const k of fake.objects.keys()) {
          if (!k.startsWith(`three-d-files/${prefix}/`)) continue;
          const [head, ...tail] = k.slice(`three-d-files/${prefix}/`.length).split('/');
          if (!seen.has(head)) seen.set(head, { name: head, id: tail.length ? null : k });
        }
        return json([...seen.values()]);
      }
      if (method === 'POST') { fake.objects.set(rest, req.postData()); return json({ Key: rest, Id: rest }); }
      if (method === 'GET') {
        const text = fake.objects.get(rest.replace(/^authenticated\//, ''));
        return text === undefined ? json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400) : route.fulfill({ status: 200, contentType: 'text/plain', body: text });
      }
      // The restrictive storage policies: a published version's files are never removed.
      if (method === 'DELETE') { req.postDataJSON().prefixes.map((p) => `three-d-files/${p}`).filter((k) => !frozen(k)).forEach((k) => fake.objects.delete(k)); return json([]); }
    }
    return json({});
  });
  return fake;
}

const open3d = async (page, path = '/3d') => { await page.goto(path); await page.waitForFunction(() => window.EM3D?.getState().ready); };
// Both views as PNG data URLs, once the terrain has settled.
const exports = (page, section = false) => page.evaluate(async (sec) => {
  const E = window.EM3D; await E.terrainReady?.();
  return { fig: E.exportPNG({ view: '3d' }), section: sec ? E.exportPNG({ view: 'section' }) : null, title: E.getState().brand.title };
}, section);

test.describe('published versions', () => {
  test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
  test.setTimeout(300_000); // software WebGL, full-size exports and four page loads

  test('publish, edit, then open version 1: read-only and drawn byte for byte as before the edit', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fake = await fakeSupabase(context);
    await context.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    await page.evaluate(() => { window.EM3D.setBrand({ title: 'RAILS RELEASE', subtitle: 'As released' }); window.EM3D.setCamera({ azimuth: 210, plunge: 30, zoom: 120 }); });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog', { name: 'Save to your account' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(1);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    const id = fake.upserts[0].id;
    const v1 = await exports(page, true);

    // Publish from My 3D maps → Versions…
    const menu = page.getByRole('region', { name: 'My 3D maps' });
    const versions = page.getByRole('dialog', { name: 'Published versions' });
    await page.getByRole('button', { name: 'My 3D maps' }).click();
    await menu.getByRole('button', { name: 'Versions…' }).click();
    await expect(versions.getByText('No published versions yet.')).toBeVisible();
    await versions.getByLabel('Label').fill('News release 2026-10-21');
    await versions.getByLabel('Release date').fill('2026-10-21');
    await versions.getByRole('button', { name: 'Publish version' }).click();
    await expect(versions.getByRole('status')).toHaveText('Published version 1 · News release 2026-10-21.');
    await expect(versions.getByText('v1 · News release 2026-10-21')).toBeVisible();
    const call = fake.calls.find((c) => c.fn === 'publish_figure_version');
    expect(call.args).toEqual({ p_kind: 'figure', p_figure_id: id, p_label: 'News release 2026-10-21', p_release_date: '2026-10-21', p_expected_updated_at: fake.upserts[0].updated_at });
    expect(fake.versions[0].snapshot.settings).toEqual(fake.upserts[0].settings); // the saved row, copied by the server
    await versions.getByRole('button', { name: 'Close' }).click();

    // Edit: publishing waits for a save; the save keeps the published files.
    await page.evaluate(() => { window.EM3D.setBrand({ title: 'RAILS EDITED', subtitle: 'Changed after the release' }); window.EM3D.setStyle({ coCount: 2 }); window.EM3D.setCamera({ azimuth: 40, plunge: 50, zoom: 100 }); });
    await expect(page.locator('#acct-note')).toHaveText(/^Unsaved changes/);
    await page.getByRole('button', { name: 'My 3D maps' }).click();
    await menu.getByRole('button', { name: 'Versions…' }).click();
    await expect(versions.getByRole('button', { name: 'Publish version' })).toBeDisabled();
    await expect(versions.getByText(/unsaved changes/)).toBeVisible();
    await versions.getByRole('button', { name: 'Close' }).click();
    await page.locator('body').press('Control+s');
    await expect.poll(() => fake.upserts.length).toBe(2);
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);
    const edited = await exports(page);
    expect(edited.fig).not.toBe(v1.fig);
    for (const p of fake.versions[0].file_names) expect(fake.objects.has(`three-d-files/${p}`), p).toBe(true);

    // Open version 1.
    await page.getByRole('button', { name: 'My 3D maps' }).click();
    await menu.getByRole('button', { name: 'Versions…' }).click();
    await versions.getByRole('button', { name: 'Open version 1' }).click();
    await expect(versions).toBeHidden();
    await expect(page.locator('#ver-banner')).toHaveText('Published version 1 · News release 2026-10-21 · read-only');
    await expect(page.locator('html')).toHaveClass(/em3d-version/);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.querySelector('.panel').inert)).toBe(true); // in place, so nothing moves, but not editable
    expect(new URL(page.url()).searchParams.get('version')).toBe('1');
    const opened = await exports(page, true);
    expect(opened.title).toBe('RAILS RELEASE');
    expect(opened.fig).toBe(v1.fig); // byte-identical to the export before the edit
    expect(opened.section).toBe(v1.section);
    // Read-only: Ctrl/Cmd+S saves nothing.
    await page.locator('body').press('Control+s');
    await expect(page.locator('#status')).toContainText('read-only');
    expect(fake.upserts).toHaveLength(2);
    // ...and neither does the API: the version on screen never overwrites the live figure.
    const refused = await page.evaluate((i) => window.EM3D.account.saveProject('RAILS RELEASE', i).then(() => 'saved', (e) => `${e.code}: ${e.message}`), id);
    expect(refused).toBe('READ_ONLY: A published version is open read-only. Start a new figure from it to save.');
    expect(fake.upserts).toHaveLength(2);
    expect(fake.rows.get(id).settings.settings.title).toBe('RAILS EDITED');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ver-bar').getByRole('button', { name: 'Download PNG' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    // The exports that wait for pending layers (exportLayers, the Export buttons) finish on a read-only version too,
    // and leave its PNG byte-identical to the one published.
    const waited = await page.evaluate(() => Promise.race([window.EM3D.exportLayers({ as: 'blob' }).then((b) => b.size > 0), new Promise((r) => setTimeout(() => r('timed out'), 30000))]));
    expect(waited).toBe(true);
    expect((await exports(page)).fig).toBe(v1.fig);

    // Back to the figure as last saved.
    await page.getByRole('button', { name: 'Back to the current figure' }).click();
    await expect(page.locator('#ver-bar')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/em3d-version/);
    expect(await page.evaluate(() => document.querySelector('.panel').inert)).toBe(false);
    await expect.poll(async () => (await page.evaluate(() => window.EM3D.getState().brand.title))).toBe('RAILS EDITED');
    await expect(page.locator('#acct-note')).toHaveText(/^Saved /);

    // A link straight to the version, in a fresh page; then a new figure from it.
    await open3d(page, `/3d?project=${id}&version=1`);
    await expect(page.locator('#ver-banner')).toHaveText('Published version 1 · News release 2026-10-21 · read-only');
    expect((await exports(page)).fig).toBe(v1.fig);
    await page.getByRole('button', { name: 'Start a new figure from this version' }).click();
    const named = page.getByRole('dialog', { name: 'Save to your account' });
    await expect(named.getByLabel('Name')).toHaveValue('RAILS RELEASE (from v1)');
    await named.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fake.upserts.length).toBe(3);
    expect(fake.upserts[2].id).not.toBe(id);
    expect(fake.upserts[2].settings.settings).toEqual(fake.versions[0].snapshot.settings.settings);
    expect(fake.rows.get(id).settings.settings.title).toBe('RAILS EDITED'); // the figure itself is untouched
    expect(fake.versions).toHaveLength(1);

    // The live figure deleted: the link still opens the version (read on its own), with nothing to go back to.
    fake.rows.get(id).deleted_at = new Date().toISOString();
    await open3d(page, `/3d?project=${id}&version=1`);
    await expect(page.locator('#ver-banner')).toHaveText('Published version 1 · News release 2026-10-21 · read-only');
    await expect(page.locator('#ver-bar').getByRole('button', { name: 'Start a new figure from this version' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to the current figure' })).toHaveCount(0);
    expect((await exports(page)).fig).toBe(v1.fig);
    expect(errors).toEqual([]);
  });
});
