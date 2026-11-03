import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.skip(!process.env.E2E_ADMIN, 'Requires the configured client with fully intercepted account fixtures');
test.setTimeout(180000);
test.use({ launchOptions: {
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
} });

// Fictional identities and isolated memory-only REST/storage. No real account,
// private project, provider imagery, font or email endpoint is contacted.
const uid = '00000000-0000-4000-8000-00000000ba01';
const savedId = '00000000-0000-4000-8000-00000000ba02';
const org = '00000000-0000-4000-8000-00000000ba03', property = '00000000-0000-4000-8000-00000000ba04';
const authKey = 'sb-example-auth-token', stashKey = 'em3d.pendingSave.v1';
const user = { id: uid, email: 'backup-qa@example.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-11-03T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const session = { user, access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.synthetic`,
  refresh_token: 'synthetic-backup-refresh', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 };
const files = [
  { name: 'synthetic-collars.csv', text: '\uFEFFHoleID,X,Y,Z,Length\r\nQA-A,500000,5500000,100,100\r\nQA-B,500100,5500100,100,100' },
  { name: 'synthetic-assays.csv', text: 'HoleID,From,To,Au\r\nQA-A,0,10,0.5300000000000001\r\nQA-B,0,10,<0.05' },
];

async function fakeAccount(context, role) {
  const fake = { requests: [], rows: new Map(), objects: new Map(), posts: [], patches: [], otp: [] };
  const origin = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.route('**/api/**', route => route.fulfill({ status: 204 }));
  await context.route('https://example.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    let page = null; try { page = req.frame().page(); } catch { /* no worker requests expected */ }
    fake.requests.push({ page, path, method });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/v1/')) {
      if (path.endsWith('/otp')) { fake.otp.push(req.postDataJSON()); return json({}); }
      if (path.endsWith('/token')) return json(session);
      if (path.endsWith('/user')) return json(user);
      return json({});
    }
    if (path.endsWith('/rpc/get_my_workspaces')) return json([{ id: org, name: 'Synthetic backup company', slug: 'synthetic-backup', role }]);
    if (path.startsWith('/rest/v1/rpc/')) return json([]);
    if (path === '/rest/v1/properties') return json([{ id: property, org_id: org, name: 'Synthetic QA property', slug: 'synthetic-qa' }]);
    if (path === '/rest/v1/three_d_projects') {
      const single = (req.headers().accept || '').includes('vnd.pgrst.object');
      if (method === 'GET') {
        const id = url.searchParams.get('id');
        const rows = [...fake.rows.values()].filter(row => row.deleted_at === null && (!id || id === `eq.${row.id}`));
        return json(single ? rows[0] || null : rows);
      }
      if (method === 'PATCH') { fake.patches.push(req.postDataJSON()); return json({ message: 'Synthetic old-row overwrite refused' }, 403); }
      if (method === 'POST') {
        const posted = req.postDataJSON(), row = Array.isArray(posted) ? posted[0] : posted;
        fake.posts.push(structuredClone(row));
        if (row.id === savedId || (row.org_id && role === 'viewer')) return json({ message: 'Synthetic permission refusal' }, 403);
        const full = { ...row, user_id: uid, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        fake.rows.set(full.id, full); return json(single ? full : [full], 201);
      }
    }
    if (path.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(path.slice('/storage/v1/object/'.length));
      if (method === 'POST') { fake.objects.set(key, req.postData()); return json({ Key: key, Id: key }); }
      if (method === 'GET') return route.fulfill({ status: 200, contentType: 'text/plain;charset=utf-8', body: fake.objects.get(key) || '' });
      if (method === 'DELETE') return json([]);
    }
    return json({});
  });
  return fake;
}

async function storedState(page) {
  return page.evaluate(async key => {
    const indexed = await new Promise((resolve, reject) => {
      const request = indexedDB.open('em3d', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('kv', 'readonly'), read = tx.objectStore('kv').get(key);
        tx.oncomplete = () => { db.close(); resolve(read.result); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    return { raw: localStorage.getItem(key), flag: localStorage.getItem(`${key}.flag`), indexed };
  }, stashKey);
}

async function prepareSavedTab(page, context, role) {
  const fake = await fakeAccount(context, role);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: authKey, value: session });
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await page.goto('/3d/'); await page.waitForFunction(() => window.EM3D?.getState().ready);
  await page.evaluate(async sources => {
    const E = window.EM3D; E.clearFiles(); E.addFiles(sources);
    E.setBrand({ company: 'Synthetic company', title: 'Saved account backup QA', primary: '#164e63', accent: '#b45309' });
    await E.layersReady();
  }, files);
  const project = await page.evaluate(() => window.EM3D.getProject());
  fake.rows.set(savedId, { id: savedId, name: 'Saved account QA', settings: project, file_paths: [], org_id: org, property_id: property, deleted_at: null, updated_at: '2026-11-03T00:00:00Z' });
  await page.evaluate(id => window.EM3D.account.openProject(id), savedId);
  // A dirty edit belongs to the existing saved row and must remain in its tab.
  await page.evaluate(() => window.EM3D.setBrand({ subtitle: 'Unsaved original-tab wording' }));
  const source = await page.evaluate(async () => ({ project: window.EM3D.getProject(), target: await window.EM3D.account.currentProject(), history: await window.EM3D.history() }));
  const pending = { at: Date.now(), intent: 'save', id: savedId, name: 'Other tab pending sign-in', project: source.project };
  await page.evaluate(async ({ key, pending }) => {
    localStorage.setItem(key, JSON.stringify(pending)); localStorage.setItem(`${key}.flag`, '1');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('em3d', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(pending, key);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, { key: stashKey, pending });
  return { fake, source, stash: await storedState(page) };
}

async function restoreThroughFile(page, context) {
  await page.getByRole('button', { name: 'My 3D maps', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project backup', exact: true }).click();
  const download = await downloading, bytes = await readFile(await download.path());
  await page.locator('#backup-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('dialog', { name: 'Open project backup' })).toBeVisible();
  const opening = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open as new figure', exact: true }).click();
  const child = await opening;
  child.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await expect(child.locator('#status')).toHaveText('Backup opened as a new unsaved figure.');
  return child;
}

async function originalUnchanged(page, fixture) {
  const now = await page.evaluate(async () => ({ project: window.EM3D.getProject(), target: await window.EM3D.account.currentProject(), history: await window.EM3D.history() }));
  expect(now).toEqual(fixture.source);
  expect(await storedState(page)).toEqual(fixture.stash);
  expect(fixture.fake.patches).toEqual([]);
}

async function savedRawSource(child, fixture) {
  const row = fixture.fake.posts[0];
  await expect.poll(() => child.evaluate(() => window.EM3D.account.currentProject().then(project => project?.id))).toBe(row.id);
  for (const file of row.file_paths) {
    expect(fixture.fake.objects.get(`three-d-files/${file.path}`)).toBe(fixture.source.project.files.find(source => source.name === file.name).text);
  }
  await child.locator('#stage').screenshot({ path: test.info().outputPath('local-backup-account-saved.png') });
}

test('a restored viewer-owned backup stays private until explicit Save creates a new personal figure', async ({ page, context }) => {
  const fixture = await prepareSavedTab(page, context, 'viewer'), { fake } = fixture;
  await page.locator('#acct-save').click();
  await expect(page.locator('#status')).toContainText('view-only access'); expect(fake.posts).toEqual([]); expect(fake.patches).toEqual([]);
  const child = await restoreThroughFile(page, context);
  expect(fake.requests.filter(request => request.page === child)).toEqual([]); // no old-row/version/stash/private RPC redemption
  expect(await child.evaluate(() => window.EM3D.getProject().files)).toEqual(fixture.source.project.files);
  expect(await child.evaluate(() => window.EM3D.account.currentProject())).toBeNull();
  await expect(child.locator('#acct-note')).toHaveText('Unsaved changes');
  expect(fake.requests.filter(request => request.page === child)).toEqual([]);
  await originalUnchanged(page, fixture);
  await child.locator('#acct-save').click();
  await expect(child.locator('#acct-dialog')).toBeVisible();
  await child.locator('#acct-name').fill('Restored personal QA'); await child.locator('#acct-name-save').click();
  await expect.poll(() => fake.posts.length).toBe(1);
  expect(fake.posts[0].id).not.toBe(savedId); expect(fake.posts[0].org_id).toBeUndefined();
  expect(fake.posts[0].file_paths.every(file => file.path.startsWith(`${uid}/${fake.posts[0].id}/`))).toBe(true);
  await savedRawSource(child, fixture);
  expect(fake.requests.filter(request => request.page === child && /figure_versions|list_property_files/.test(request.path))).toEqual([]);
  await originalUnchanged(page, fixture); await child.close();
});

test('restored editor backup refuses email-link redemption and ordinary password Save keeps the other tab intact', async ({ page, context }) => {
  const fixture = await prepareSavedTab(page, context, 'editor'), { fake } = fixture;
  const child = await restoreThroughFile(page, context);
  expect(fake.requests.filter(request => request.page === child)).toEqual([]);
  // Sign out this fresh document before its first lazy account startup. Its
  // pending-save boot exemption must still apply when Save is finally clicked.
  await child.evaluate(key => localStorage.removeItem(key), authKey);
  await child.locator('#acct-save').click(); await expect(child.locator('#acct-dialog')).toBeVisible();
  await expect(child.locator('#acct-intro')).toHaveText('Sign in in another tab, then return and Save this figure. You can also use a password here.');
  await expect(child.locator('#acct-link-btn')).toBeHidden(); await expect(child.locator('#acct-new')).toBeHidden();
  await child.locator('#acct-email').fill(user.email);
  const refused = await child.evaluate(email => window.EM3D.account.sendSignInLink(email).then(() => null, error => error.message), user.email);
  expect(refused).toBe('Sign in in another tab, then return and Save this figure.');
  await child.locator('#acct-dialog').screenshot({ path: test.info().outputPath('local-backup-email-refusal.png') });
  expect(fake.otp).toEqual([]); expect(fake.posts).toEqual([]); expect(fake.patches).toEqual([]);
  expect(await storedState(child)).toEqual(fixture.stash);
  await expect(child.locator('#acct-use-password')).toBeHidden();
  await expect(child.locator('#acct-password')).toBeVisible(); await child.locator('#acct-password').fill('synthetic-password-not-real');
  await child.locator('#acct-password-btn').click();
  await expect.poll(() => fake.posts.length).toBe(1);
  expect(fake.posts[0].id).not.toBe(savedId); expect(fake.posts[0].org_id).toBeUndefined(); expect(fake.otp).toEqual([]);
  await savedRawSource(child, fixture);
  expect(fake.requests.filter(request => request.page === child && /figure_versions|list_property_files/.test(request.path))).toEqual([]);
  await originalUnchanged(page, fixture); await child.close();
});
