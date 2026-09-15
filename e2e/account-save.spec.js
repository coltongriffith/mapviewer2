import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_ADMIN, 'Requires the configured client with isolated auth/RPC fixtures');
const uid = '00000000-0000-4000-8000-000000000081';
const cloudId = '00000000-0000-4000-8000-000000000082';
const user = { id: uid, email: 'save-test@example.test', role: 'authenticated', created_at: '2026-09-15T00:00:00Z', email_confirmed_at: '2026-09-15T00:00:00Z', user_metadata: {} };
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

async function setup(page, { migrated = false, failCreate = false } = {}) {
  const calls = { creates: [], updates: [], otp: [] };
  calls.allowSave = () => { failCreate = false; };
  await page.route('**/api/track', route => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', route => {
    const url = new URL(route.request().url());
    const fn = url.pathname.split('/').at(-1);
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (fn === 'token') return reply(session);
    if (fn === 'user') return reply(user);
    if (fn === 'otp') { calls.otp.push(url.searchParams.get('redirect_to')); return reply({}); }
    if (fn === 'create_cloud_project') {
      calls.creates.push(route.request().postDataJSON());
      return failCreate ? reply({ message: 'Temporary save failure', code: '503' }, 503) : reply(cloudId);
    }
    if (fn === 'save_cloud_project') { calls.updates.push(route.request().postDataJSON()); return reply(2); }
    if (fn === 'user_plans') return reply({ plan: 'free', source: 'signup', status: 'active' });
    return reply([]);
  });
  if (migrated) await page.addInitScript(id => localStorage.setItem(`em_migration_v2_${id}`, JSON.stringify({ done: true, projects: {} })), uid);
  return calls;
}

async function requestSave(page, info) {
  await page.goto('/companies/got/');
  await page.getByRole('link', { name: /Open this company's claims map/ }).click();
  const save = info.project.name.includes('mobile')
    ? page.locator('.mobile-editor-banner').getByRole('button', { name: 'Save to an account' })
    : page.getByRole('button', { name: 'Save to a free account' });
  await save.click();
  await expect(page.getByRole('dialog', { name: 'Sign in', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('mapviewer.pendingAccountSave.v1')))).toBe(true);
}

for (const migrated of [false, true]) {
  test(`sign-in completes exactly one requested save (prior migration ${migrated})`, async ({ page }, info) => {
    const calls = await setup(page, { migrated });
    await requestSave(page, info);
    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill('synthetic-test-password');
    await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.lastProjectId.v1'))).toBe(cloudId);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.pendingAccountSave.v1'))).toBeNull();
    expect(calls.creates).toHaveLength(1);
    expect(calls.creates[0].p_payload.layers.length).toBeGreaterThan(0);
    // A subsequent save updates the created row; auth/reload must not insert again.
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Save', exact: true }).click();
    await expect.poll(() => calls.updates.length).toBe(1);
    expect(calls.updates[0].p_id).toBe(cloudId);
    await page.goto('/?intent=resume');
    await expect(page.locator('.leaflet-container').first()).toBeVisible();
    expect(calls.creates).toHaveLength(1);
  });
}

test('email return restores and saves a pending new map after a reload', async ({ page }, info) => {
  const calls = await setup(page, { migrated: true });
  await requestSave(page, info);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
  await expect.poll(() => calls.otp.length).toBe(1);
  expect(calls.otp[0]).toMatch(/\/?\?intent=resume$/);
  expect(calls.creates).toHaveLength(0);
  // Simulate successful email authentication without sending any real email.
  await page.evaluate(s => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session);
  await page.goto('/?intent=resume');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.lastProjectId.v1'))).toBe(cloudId);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.pendingAccountSave.v1'))).toBeNull();
  expect(calls.creates).toHaveLength(1);
});

test('a failed cloud save keeps the requested map recoverable', async ({ page }, info) => {
  const calls = await setup(page, { migrated: true, failCreate: true });
  await requestSave(page, info);
  await page.evaluate(s => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), session);
  await page.goto('/?intent=resume');
  await expect.poll(() => calls.creates.length).toBe(1);
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mapviewer.lastProjectId.v1'))).toBeNull();
  expect(await page.evaluate(() => Boolean(localStorage.getItem('mapviewer.pendingAccountSave.v1')))).toBe(true);
  calls.allowSave();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.lastProjectId.v1'))).toBe(cloudId);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mapviewer.pendingAccountSave.v1'))).toBeNull();
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  expect(calls.creates).toHaveLength(2); // one failed attempt and one successful retry
});
