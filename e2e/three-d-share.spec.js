import { test, expect } from '@playwright/test';
import { DESIGN_VERSION } from '../src/three-d/design-version.js';
import { readFile } from 'node:fs/promises';

// Exploration Maps 3D share links: the Share dialog on /3d, the read-only
// viewer at /3d/share/<id>, the iframe version at /3d/embed/<id>, and the
// headers that let only the embed be framed. The share RPCs, auth, REST and
// storage are an in-memory Supabase (no request leaves the browser); those
// tests need the configured client build (dist-auth-check,
// VITE_SUPABASE_URL=https://example.supabase.co). The header and routing
// tests run against any build.

// three.js needs WebGL; headless Chromium provides it through SwiftShader.
test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});

const uid = '00000000-0000-4000-8000-0000000003d2';
const user = { id: uid, email: 'share@example.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
const AUTH_KEY = 'sb-example-auth-token';
const hex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

// An in-memory Supabase with the share RPCs' rules: the owner is the signed-in
// user (from the bearer token) or, signed out, the browser key.
async function fakeSupabase(context, { shares = new Map() } = {}) {
  const fake = { shares, calls: [], rows: new Map(), objects: new Map() };
  await context.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const signedIn = (req.headers().authorization || '') === `Bearer ${token}`;
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      if (fn === 'logout') return route.fulfill({ status: 204 });
      return json({});
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(), a = req.postDataJSON() || {};
      fake.calls.push({ fn, args: a, signedIn });
      const owns = (s, key) => (s.user_id ? signedIn && s.user_id === uid : !!key && key.length >= 16 && s.creator_key === key);
      const err = (message) => json({ code: 'P0001', message, details: null, hint: null }, 400);
      if (fn === 'create_3d_share') {
        if (!a.p_state || a.p_state.v !== 1) return err('SHARE_INVALID: share payload is not a 3D figure');
        const id = hex32(), now = new Date().toISOString();
        shares.set(id, { id, state: a.p_state, thumbnail: a.p_thumbnail, user_id: signedIn ? uid : null, creator_key: signedIn ? null : a.p_creator_key, project_id: a.p_project_id, created_at: now, updated_at: now, expires_at: signedIn ? null : new Date(Date.now() + 30 * 864e5).toISOString(), revoked_at: null, view_count: 0 });
        return json(id);
      }
      if (fn === 'get_3d_share') {
        const s = shares.get(a.share_id);
        if (!s || s.revoked_at || (s.expires_at && new Date(s.expires_at) <= new Date())) return json(null);
        s.view_count++;
        return json({ state: s.state, thumbnail: s.thumbnail });
      }
      if (fn === 'list_my_3d_shares') {
        return json([...shares.values()].filter((s) => owns(s, a.p_creator_key)).reverse().map((s) => ({ id: s.id, project_id: s.project_id, title: s.state?.settings?.title || null, created_at: s.created_at, updated_at: s.updated_at, expires_at: s.expires_at, revoked_at: s.revoked_at, view_count: s.view_count, anonymous: !s.user_id })));
      }
      if (fn === 'update_3d_share') {
        const s = shares.get(a.share_id);
        if (!s || !owns(s, a.p_creator_key)) return err('SHARE_NOT_FOUND: no share of yours with that id');
        if (s.revoked_at) return err('SHARE_GONE: that link was revoked or has expired');
        Object.assign(s, { state: a.p_state, thumbnail: a.p_thumbnail, updated_at: new Date().toISOString() });
        return json(true);
      }
      if (fn === 'revoke_3d_share') {
        const s = shares.get(a.share_id);
        if (!s || s.revoked_at || !owns(s, a.p_creator_key)) return json(false);
        Object.assign(s, { revoked_at: new Date().toISOString(), state: {}, thumbnail: null });
        return json(true);
      }
      return json({ code: 'PGRST202', message: `Could not find the function public.${fn}` }, 404);
    }
    if (path === '/rest/v1/three_d_projects' && method === 'POST') {
      const body = req.postDataJSON(), row = Array.isArray(body) ? body[0] : body, now = new Date().toISOString();
      const full = { user_id: uid, created_at: now, ...row, updated_at: now };
      fake.rows.set(row.id, full);
      return json((req.headers().accept || '').includes('vnd.pgrst.object') ? full : [full], 201);
    }
    if (path.startsWith('/storage/v1/object/') && method === 'POST') {
      const rest = decodeURIComponent(path.slice('/storage/v1/object/'.length));
      if (rest.startsWith('list/')) return json([]);
      fake.objects.set(rest, req.postData()); return json({ Key: rest, Id: rest });
    }
    return json({});
  });
  await context.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  return fake;
}

async function open3d(page, path = '/3d') {
  await page.goto(path);
  await page.waitForFunction(() => window.EM3D?.getState().ready);
}
// A shared figure has drawn: the viewer marks the page once loadProject resolves.
async function openShared(page, path) {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.classList.contains('em3d-shown') && window.EM3D?.getState().ready);
}
const state = (page) => page.evaluate(() => window.EM3D.getState());

test.describe('share routes and headers (any build)', () => {
  test('only /3d/embed/<id> may be framed; share pages stay out of search', async ({ request }) => {
    const id = 'a'.repeat(32);
    for (const path of ['/', '/3d', `/3d/share/${id}`, '/3d/embed/', `/3d/embed/${id}/extra`, '/map/example']) {
      const h = (await request.get(path)).headers();
      expect(h['x-frame-options'], path).toBe('DENY');
      expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    }
    const embed = await request.get(`/3d/embed/${id}`);
    expect(embed.status()).toBe(200);
    const h = embed.headers();
    expect(h['x-frame-options']).toBeUndefined();
    expect(h['content-security-policy']).toContain('frame-ancestors *');
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).not.toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    for (const path of [`/3d/share/${id}`, `/3d/embed/${id}`]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['x-robots-tag'], path).toContain('noindex');
      expect(await res.text(), path).toContain('src="/3d/mode.js"');
    }
    expect((await request.get('/3d')).headers()['x-robots-tag'] || '').not.toContain('noindex');
  });

  test('a share link opens read-only: no editor, no canonical, and kept out of search', async ({ page }) => {
    await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
    await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
    await page.goto(`/3d/share/${'b'.repeat(32)}`);
    await expect(page.locator('#share-msg h1')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await page.locator('link[rel="canonical"]').count()).toBe(0);
    await expect(page.locator('.panel')).toBeHidden();
    await expect(page.locator('#about')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden();
    await expect(page.locator('#share-msg').getByRole('link', { name: 'Make your own 3D figure' })).toHaveAttribute('href', '/3d');
  });
});

test.describe('sharing', () => {
  test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated RPC fixtures');
  // Software WebGL and several page loads per test: allow more than the default minute.
  test.setTimeout(180_000);

  test('a link shared before design versions shows the figure as it was, with no prompt to the viewer', async ({ page, context }) => {
    const legacy = JSON.parse(await readFile('tests/fixtures/three-d/pre-round4-project.json', 'utf8')), id = 'c'.repeat(32), at = '2026-10-19T12:00:00.000Z';
    await fakeSupabase(context, { shares: new Map([[id, { id, state: legacy, thumbnail: null, user_id: uid, creator_key: null, project_id: null, created_at: at, updated_at: at, expires_at: null, revoked_at: null, view_count: 0 }]]) });
    await openShared(page, `/3d/share/${id}`);
    const viewed = await state(page);
    expect(viewed.design).toEqual({ version: 1, current: DESIGN_VERSION, optIn: [] });
    expect(viewed.display).toMatchObject({ imagery: { saturation: 1.15, contrast: 1, warmth: 0, relief: 0 }, legend: { merge: 'separate', pos: { main: 'br' } } });
    expect(viewed.tags).toMatchObject({ emphasis: 'none', highlightNew: false, idMode: 'all' });
    expect(viewed.callouts.shown.find((c) => c.holeId === 'S-037').line1).toBe('110 m @ 1.50% Cu from 0 m'); // the numbers as published
    await expect(page.locator('#status')).not.toContainText('unsampled');
  });

  test('signed out: share, view read-only, download, update the same link, embed and revoke', async ({ page, context }, testInfo) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fake = await fakeSupabase(context);
    await open3d(page);
    await page.evaluate(() => window.EM3D.setBrand({ title: 'STAR · RAILS ZONE', company: 'Star Copper' }));

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share this 3D figure' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('expires after 30 days');
    await expect(dialog).toContainText('anyone with it can see that data');
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const url = await dialog.getByLabel('Share link').inputValue();
    expect(url).toMatch(new RegExp(`^${new URL(page.url()).origin}/3d/share/[0-9a-f]{32}$`));
    const id = url.split('/').pop();
    const embed = await dialog.getByLabel('Embed code').inputValue();
    expect(embed).toMatch(new RegExp(`^<iframe src="[^"]+/3d/embed/${id}" width="960" height="540" [^>]*title="STAR · RAILS ZONE"[^>]*></iframe>$`));
    const created = fake.calls.find((c) => c.fn === 'create_3d_share');
    expect(created.signedIn).toBe(false);
    expect(created.args.p_creator_key).toBe(await page.evaluate(() => localStorage.getItem('em_share_key')));
    expect(created.args.p_project_id).toBeNull();
    expect(created.args.p_thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(created.args.p_state).toMatchObject({ v: 1, settings: { title: 'STAR · RAILS ZONE' } });
    expect(created.args.p_state.files.length).toBeGreaterThan(1);
    await dialog.getByRole('button', { name: 'Close' }).click();

    // The same figure again: offer to update the link it already has.
    await page.evaluate(() => window.EM3D.setBrand({ subtitle: 'With the new assays' }));
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(dialog.getByText('This figure already has a link')).toBeVisible();
    await expect(dialog.getByLabel('Share link')).toHaveValue(url);
    await dialog.getByRole('button', { name: 'Update this link with the current figure' }).click();
    await expect(dialog.getByRole('status')).toContainText('Link updated');
    expect(fake.shares.get(id).state.settings.subtitle).toBe('With the new assays');
    expect(fake.shares.size).toBe(1);
    await dialog.locator('summary', { hasText: 'Your 3D share links' }).click();
    await expect(dialog.locator('.share-list li')).toHaveCount(1);
    await expect(dialog.locator('.share-list')).toContainText('STAR · RAILS ZONE');
    await dialog.getByRole('button', { name: 'Close' }).click();
    const original = await state(page);

    // The viewer: the figure as shared, read-only.
    await openShared(page, `/3d/share/${id}`);
    const viewed = await state(page);
    for (const k of ['brand', 'labels', 'figureSize', 'grade', 'files', 'section']) expect(viewed[k], k).toEqual(original[k]);
    expect(viewed.camera.azimuth).toBeCloseTo(original.camera.azimuth, 0);
    expect(viewed.camera.plunge).toBeCloseTo(original.camera.plunge, 0);
    await expect(page.locator('.panel')).toBeHidden();
    await expect(page.locator('#gl')).toBeVisible();
    await expect(page.locator('.share-note')).toHaveText('Shared 3D figure · Make your own');
    await expect(page.locator('.share-note a')).toHaveAttribute('href', '/3d');
    await expect(page.getByRole('button', { name: 'Save a copy to my account' })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page).toHaveTitle('STAR · RAILS ZONE · Exploration Maps 3D');
    await page.getByRole('tab', { name: 'Section A–A′' }).click();
    expect((await state(page)).view).toBe('section');
    await expect(page.locator('#section')).toBeVisible();
    await page.getByRole('tab', { name: '3D figure' }).click();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PNG' }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe('star-3d-slide.png');
    const file = testInfo.outputPath('shared-3d.png');
    await download.saveAs(file);
    const png = await readFile(file);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([original.figureSize.width, original.figureSize.height]);
    await expect(page.getByRole('button', { name: 'Download PNG again' })).toBeVisible();
    if (testInfo.project.name === 'admin-desktop' && process.env.SHARE_SHOTS) await page.screenshot({ path: `${process.env.SHARE_SHOTS}/viewer.png` });

    // Revoke from the editor; the link then says so plainly.
    await open3d(page);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await dialog.locator('summary', { hasText: 'Your 3D share links' }).click();
    const revokeBtn = dialog.getByRole('button', { name: 'Revoke link to STAR · RAILS ZONE' });
    await revokeBtn.click();
    await expect(revokeBtn).toHaveText('Confirm');
    await revokeBtn.click();
    await expect(dialog.getByRole('status')).toHaveText('Link revoked.');
    expect(fake.shares.get(id).revoked_at).toBeTruthy();
    await page.goto(`/3d/share/${id}`);
    await expect(page.getByRole('heading', { name: 'This figure is no longer shared' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.frame')).toBeHidden();
    await page.goto(`/3d/embed/${id}`);
    await expect(page.getByRole('heading', { name: 'This figure is no longer shared' })).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test('the embed opens in an iframe with minimal chrome; the share page refuses to be framed', async ({ page, context }, testInfo) => {
    const fake = await fakeSupabase(context);
    await open3d(page);
    const snap = await page.evaluate(() => { window.EM3D.setBrand({ title: 'EAST ZONE' }); return window.EM3D.getProject(); });
    const id = hex32();
    fake.shares.set(id, { id, state: snap, thumbnail: null, user_id: null, creator_key: 'k'.repeat(20), created_at: new Date().toISOString(), revoked_at: null, expires_at: null, view_count: 0 });
    const origin = new URL(page.url()).origin;
    await page.close();
    // A page that frames both links. frame-ancestors and X-Frame-Options apply to
    // any parent, same-origin included, so this shows which of the two may be framed.
    const site = `${origin}/investor-page`;
    await context.route(site, (route) => route.fulfill({ status: 200, contentType: 'text/html',
      body: `<!doctype html><title>Investor page</title><h1>Our project</h1><iframe id="f" src="${origin}/3d/embed/${id}" width="960" height="540" style="border:0"></iframe><iframe id="g" src="${origin}/3d/share/${id}" width="300" height="200"></iframe>` }));
    const host = await context.newPage();
    await host.goto(site);
    const frame = host.frameLocator('#f');
    await expect(frame.locator('html.em3d-shown')).toHaveCount(1, { timeout: 60_000 });
    await expect(frame.locator('.share-credit')).toBeVisible();
    await expect(frame.locator('.share-credit')).toHaveAttribute('target', '_blank');
    await expect(frame.locator('.share-bar')).toBeHidden();
    await expect(frame.locator('.panel')).toBeHidden();
    await expect(frame.locator('#status')).toBeHidden();
    await expect(frame.locator('#gl')).toBeVisible();
    await expect(frame.getByRole('tab', { name: 'Section A–A′' })).toBeVisible();
    await expect(host.frameLocator('#g').locator('#gl')).toHaveCount(0); // the share page itself refuses to be framed
    if (testInfo.project.name === 'admin-desktop' && process.env.SHARE_SHOTS) await host.screenshot({ path: `${process.env.SHARE_SHOTS}/embed.png` });
    await host.close();
  });

  test('?download=png downloads the shared figure once it is drawn', async ({ page, context }, testInfo) => {
    const fake = await fakeSupabase(context);
    await open3d(page);
    const snap = await page.evaluate(() => { window.EM3D.setBrand({ title: 'NORTH ZONE' }); window.EM3D.setFigureSize('square'); return window.EM3D.getProject(); });
    const id = hex32();
    fake.shares.set(id, { id, state: snap, thumbnail: null, user_id: uid, creator_key: null, created_at: new Date().toISOString(), revoked_at: null, expires_at: null, view_count: 0 });
    const downloadReady = page.waitForEvent('download', { timeout: 90_000 });
    await page.goto(`/3d/share/${id}?download=png`);
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe('north-zone-3d-square.png');
    const file = testInfo.outputPath('auto.png');
    await download.saveAs(file);
    const png = await readFile(file);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
  });

  test('an expired or unknown link and a malformed one say so plainly', async ({ page, context }) => {
    const fake = await fakeSupabase(context);
    const id = hex32();
    fake.shares.set(id, { id, state: { v: 1, settings: {}, files: [] }, user_id: null, creator_key: 'x'.repeat(20), expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null, view_count: 0 });
    for (const path of [`/3d/share/${id}`, `/3d/share/${hex32()}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'This figure is no longer shared' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('The link has expired, or its owner has stopped sharing it.')).toBeVisible();
    }
    await page.goto('/3d/share/not-a-real-id');
    await expect(page.getByRole('heading', { name: 'This link is not complete' })).toBeVisible({ timeout: 30_000 });
    expect(fake.calls.filter((c) => c.fn === 'get_3d_share').map((c) => c.args.share_id)).not.toContain('not-a-real-id');
  });

  test('signed in: the link joins the account, and a viewer can save a copy', async ({ page, context }) => {
    const fake = await fakeSupabase(context);
    await page.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [AUTH_KEY, session]);
    await open3d(page);
    await page.evaluate(() => window.EM3D.setBrand({ title: 'SOUTH ZONE' }));
    const made = await page.evaluate(() => window.EM3D.share.create());
    expect(made).toMatchObject({ url: expect.stringMatching(/\/3d\/share\/[0-9a-f]{32}$/), signedIn: true, expires: null });
    expect(fake.shares.get(made.id)).toMatchObject({ user_id: uid, creator_key: null });
    expect((await page.evaluate(() => window.EM3D.share.list())).map((s) => s.id)).toEqual([made.id]);

    await openShared(page, `/3d/share/${made.id}`);
    const save = page.getByRole('button', { name: 'Save a copy to my account' });
    await expect(save).toBeVisible();
    await save.click();
    const openCopy = page.getByRole('link', { name: 'Open my copy' });
    await expect(openCopy).toBeVisible();
    expect(fake.rows.size).toBe(1);
    const [row] = fake.rows.values();
    expect(row.name).toBe('SOUTH ZONE (copy)');
    expect(row.settings.settings.title).toBe('SOUTH ZONE');
    expect(row.file_paths.length).toBeGreaterThan(1);
    expect(fake.objects.size).toBe(row.file_paths.length);
    await expect(openCopy).toHaveAttribute('href', `/3d?project=${row.id}`);

    // Inside an embed nothing acts on the account.
    await openShared(page, `/3d/embed/${made.id}`);
    await expect(page.getByRole('button', { name: 'Save a copy to my account' })).toHaveCount(0);
  });

  test('text in a shared figure is shown as text, never as HTML', async ({ page, context }) => {
    const fake = await fakeSupabase(context);
    await open3d(page);
    const snap = await page.evaluate(() => window.EM3D.getProject());
    const tag = (n) => `"><img id="pwn${n}" src="x"><b id="pwn${n}b">`;
    const s = snap.settings;
    Object.assign(s, {
      title: `${tag(1)} TITLE`, company: tag(2), subtitle: tag(3), footnote: tag(4), valueLabel: tag(5),
      labels: [{ id: tag(6), text: tag(7), x: 0.5, y: 0.5, size: 'normal', arrow: false }],
      wallLabels: [{ id: tag(8), text: tag(9), face: 'N', u: 0.5, v: 0.5, size: 'normal' }],
    });
    snap.files[0].name = `${tag(10)}collars.csv`;
    const good = hex32();
    fake.shares.set(good, { id: good, state: snap, user_id: uid, created_at: new Date().toISOString(), revoked_at: null, expires_at: null, view_count: 0 });
    await openShared(page, `/3d/share/${good}`);
    expect(await page.locator('[id^="pwn"]').count()).toBe(0);
    expect((await state(page)).brand.title).toBe(`${tag(1)} TITLE`);
    expect(await page.title()).toBe(`${tag(1)} TITLE · Exploration Maps 3D`);

    // Values that should be numbers or colours, and remote images.
    const odd = structuredClone(snap);
    Object.assign(odd.settings, {
      bins: [tag(11), 1, 2, 3], displayCutoff: tag(12), coOverrides: { [tag(13)]: { line1: tag(14) } },
      eq: { base: 'Cu', basePrice: tag(15), baseRecovery: tag(16), metals: { Au: { price: tag(17), recovery: 90 } } },
      logo: { $image: 'https://tracker.example/pixel.png' },
    });
    if (odd.settings.geology) odd.settings.geology = { ...odd.settings.geology, images: { [tag(18)]: 'https://tracker.example/x.png' }, legend: [{ code: 'A', name: tag(19), color: tag(20) }] };
    if (odd.settings.geophys) odd.settings.geophys = { ...odd.settings.geophys, min: tag(21), max: tag(22), search: tag(23) };
    const bad = hex32();
    fake.shares.set(bad, { id: bad, state: odd, user_id: uid, created_at: new Date().toISOString(), revoked_at: null, expires_at: null, view_count: 0 });
    const remote = [];
    page.on('request', (r) => { if (r.url().includes('tracker.example')) remote.push(r.url()); });
    await page.goto(`/3d/share/${bad}`);
    await page.waitForFunction(() => document.documentElement.classList.contains('em3d-shown') || !document.getElementById('share-msg')?.hidden, null, { timeout: 60_000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    expect(await page.locator('[id^="pwn"]').count()).toBe(0);
    expect(remote).toEqual([]);
  });
});
