import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// A free PNG cut to the 2,000 px cap offers one full-resolution export: an
// anonymous exporter gets it for an email (the sign-in link creates the
// account), and the link brings them back to download it.
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client with isolated auth fixtures');
test.skip(({ isMobile }) => isMobile, 'Exports are a desktop flow');
// A full-HD window: its 2× print export is past the free cap.
test.use({ viewport: { width: 1600, height: 1000 } });

const uid = '00000000-0000-4000-8000-000000000091';
const baseUser = { id: uid, email: 'fullres@example.test', role: 'authenticated', created_at: '2026-10-19T00:00:00Z', email_confirmed_at: '2026-10-19T00:00:00Z' };
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.test-signature`;
const sessionFor = (user) => ({ user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' });

async function setup(page, metadata = {}) {
  const calls = { otp: [], userUpdates: [] };
  let user = { ...baseUser, user_metadata: metadata };
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => {
    const request = route.request();
    const fn = new URL(request.url()).pathname.split('/').at(-1);
    const reply = (json) => route.fulfill({ status: 200, json });
    if (fn === 'otp') { calls.otp.push(new URL(request.url()).searchParams.get('redirect_to')); return reply({}); }
    if (fn === 'user' && request.method() === 'PUT') {
      const body = request.postDataJSON();
      calls.userUpdates.push(body);
      user = { ...user, user_metadata: { ...user.user_metadata, ...body.data } };
      return reply(user);
    }
    if (fn === 'user') return reply(user);
    if (fn === 'token') return reply(sessionFor(user));
    if (fn === 'user_plans') return reply({ plan: 'free', source: 'signup', status: 'active' });
    return reply([]);
  });
  return { calls, signIn: () => page.evaluate((s) => localStorage.setItem('sb-example-auth-token', JSON.stringify(s)), sessionFor(user)) };
}

async function openDemo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open this map as a live demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cedar Ridge Project', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
}

async function longEdge(download, testInfo, name) {
  const file = testInfo.outputPath(name);
  await download.saveAs(file);
  const png = await readFile(file);
  return Math.max(png.readUInt32BE(16), png.readUInt32BE(20));
}

test('an email buys one full-resolution export, downloaded after the sign-in link', async ({ page }, testInfo) => {
  const { calls, signIn } = await setup(page);
  await openDemo(page);
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  const capped = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download with watermark', exact: true }).click();
  expect(await longEdge(await capped, testInfo, 'capped.png')).toBe(2000);

  const offer = page.getByRole('dialog', { name: 'Get this map at full resolution' });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('2,000 px, the free limit');
  await offer.getByLabel('Work email').fill(baseUser.email);
  await offer.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByRole('dialog', { name: 'Check your email' })).toContainText(baseUser.email);
  expect(calls.otp).toHaveLength(1);
  expect(calls.otp[0]).toMatch(/\?intent=resume$/);

  // The link opens in this browser, signed in.
  await signIn();
  await page.goto('/?intent=resume');
  const ready = page.getByRole('dialog', { name: 'Your full-resolution map is ready' });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  const full = page.waitForEvent('download', { timeout: 60_000 });
  await ready.getByRole('button', { name: /^Download at [\d,]+ px$/ }).click();
  expect(await longEdge(await full, testInfo, 'full.png')).toBeGreaterThan(2000);
  await expect.poll(() => calls.userUpdates.length).toBe(1);
  expect(calls.userUpdates[0].data.em_fullres_export_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await expect(page.getByText(/your free full-resolution export/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mapviewer.pendingFullResExport.v1'))).toBeNull();
});

test('an account that has used its export gets the Pro prompt instead', async ({ page }, testInfo) => {
  const { signIn } = await setup(page, { em_fullres_export_at: '2026-10-01T00:00:00.000Z' });
  await openDemo(page);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('mapviewer.draft.v1')))).toBe(true);
  await signIn();
  await page.goto('/?intent=resume');
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const capped = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).first().click();
  expect(await longEdge(await capped, testInfo, 'capped.png')).toBe(2000);
  await expect(page.getByRole('heading', { name: 'Upgrade to Pro' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /full resolution/ })).toHaveCount(0);
});
