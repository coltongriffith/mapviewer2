import { test, expect } from '@playwright/test';

// Save As, the signed-in homepage and Duplicate against an in-memory Supabase
// (auth, REST and RPC mocked; nothing leaves the browser). Needs the
// configured client build (dist-auth-check, VITE_SUPABASE_URL=https://example.supabase.co).
//
//   B2  Save As asked with window.prompt(), which blocks the page and any agent
//       or test driving it. It is an in-app dialog now.
//   B3  Opening the homepage while signed in, then searching for claims, landed
//       in the last saved map, so the new claims (and autosave) went into it.
//   B4  Duplicate kept the title, and the dashboard said "Untitled map Copy".
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');

const uid = '00000000-0000-4000-8000-0000000000b4';
const user = { id: uid, email: 'naming@example.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

async function fakeSupabase(page) {
  const db = { rows: [], creates: [], updates: [] };
  let next = 1;
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const fn = path.split('/').pop();
    if (path.startsWith('/auth/v1/')) return json(fn === 'user' ? user : fn === 'token' ? session : {});
    if (fn === 'create_cloud_project') {
      const args = req.postDataJSON();
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
      db.creates.push(args);
      db.rows.unshift({ id, name: args.p_name, payload: args.p_payload, revision: 1, updated_at: new Date().toISOString(), thumbnail: null });
      return json(id);
    }
    if (fn === 'save_cloud_project') {
      const args = req.postDataJSON();
      db.updates.push(args);
      const row = db.rows.find((r) => r.id === args.p_id);
      if (row) Object.assign(row, { name: args.p_name, payload: args.p_payload, revision: row.revision + 1 });
      return json(row ? row.revision : 1);
    }
    if (fn === 'user_plans') return json({ plan: 'free', source: 'signup', status: 'active' });
    if (path === '/rest/v1/projects' && req.method() === 'GET') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      if (id) {
        const row = db.rows.find((r) => r.id === id);
        return row ? json(row) : json({ code: 'PGRST116', message: 'no rows' }, 406);
      }
      return json(db.rows.map(({ payload, ...r }) => r));
    }
    return json([]);
  });
  await page.addInitScript(([s, id]) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${id}`, JSON.stringify({ done: true, projects: {} }));
  }, [session, uid]);
  // No native dialog may open at any point in these flows.
  page.on('dialog', (d) => { db.nativeDialog = d.message(); d.dismiss(); });
  return db;
}

const header = (page) => page.locator('.ed-doc-name');

async function newSavedMap(page, db, name) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: '+ New map' }).first().click();
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save As…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as a new map' });
  await dialog.getByLabel('Map name').fill(name);
  await dialog.getByLabel('Map name').press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => db.creates.length).toBeGreaterThan(0);
  await expect(header(page)).toHaveText(name);
  return db.rows[0].id;
}

test('Save As opens an in-app dialog: prefilled, Escape cancels, Enter saves under the typed name', async ({ page }) => {
  const db = await fakeSupabase(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: '+ New map' }).first().click();
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await expect(header(page)).toHaveText('Untitled map');

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save As…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as a new map' });
  await expect(dialog).toBeVisible();
  const field = dialog.getByLabel('Map name');
  await expect(field).toHaveValue('Untitled map');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(db.creates).toHaveLength(0);

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save As…' }).click();
  // The default is selected, so typing replaces it.
  await page.keyboard.type('Tower drill plan');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => db.creates.length).toBe(1);
  expect(db.creates[0].p_name).toBe('Tower drill plan');
  await expect(header(page)).toHaveText('Tower drill plan');
  expect(db.nativeDialog).toBeUndefined();
});

test('the homepage lands a signed-in user on the dashboard, and a claims search there starts a new map', async ({ page }) => {
  const db = await fakeSupabase(page);
  const towerId = await newSavedMap(page, db, 'Tower');

  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Tower' })).toBeVisible();

  // Starting a search from here is a new map, not more claims in "Tower".
  await page.getByRole('button', { name: 'Search mineral claims' }).first().click();
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await expect(header(page)).toHaveText('Untitled map');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.lastProjectId.v1'))).toBeNull();
  // Deep links and an explicit open still go where they say.
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open Tower' }).click();
  await expect(header(page)).toHaveText('Tower');
  expect(db.updates.filter((u) => u.p_id === towerId)).toHaveLength(0);
  expect(db.nativeDialog).toBeUndefined();
});

test('Duplicate names the copy "<name> (copy)", then "(copy 2)", switches to it and shows its name', async ({ page }) => {
  const db = await fakeSupabase(page);
  const towerId = await newSavedMap(page, db, 'Tower');

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect.poll(() => db.creates.length).toBe(2);
  expect(db.creates[1].p_name).toBe('Tower (copy)');
  await expect(header(page)).toHaveText('Tower (copy)');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.lastProjectId.v1'))).not.toBe(towerId);

  // From the dashboard: named the same way, and opened.
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Duplicate Tower', exact: true }).click();
  await expect.poll(() => db.creates.length).toBe(3);
  expect(db.creates[2].p_name).toBe('Tower (copy 2)');
  await expect(header(page)).toHaveText('Tower (copy 2)');
  expect(db.rows.map((r) => r.name)).toEqual(['Tower (copy 2)', 'Tower (copy)', 'Tower']);
  expect(db.updates.filter((u) => u.p_id === towerId)).toHaveLength(0);
  expect(db.nativeDialog).toBeUndefined();
});
