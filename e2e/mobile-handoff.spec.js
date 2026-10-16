import { test, expect } from '@playwright/test';

// The phone viewer's "Edit on desktop": the map becomes a share link and the
// sign-in email returns to it, on whichever device opens the email.
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client with isolated auth/RPC fixtures');

const shareId = '0123456789abcdef0123456789abcdef';

test('a phone emails a sign-in link that opens the shared map', async ({ page }, info) => {
  test.skip(!info.project.name.includes('mobile'), 'The claims viewer is phone-only');
  const calls = { shares: [], otp: [] };
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => {
    const url = new URL(route.request().url());
    const fn = url.pathname.split('/').at(-1);
    if (fn === 'create_shared_map') { calls.shares.push(route.request().postDataJSON()); return route.fulfill({ json: shareId }); }
    if (fn === 'otp') { calls.otp.push({ redirect: url.searchParams.get('redirect_to'), body: route.request().postDataJSON() }); return route.fulfill({ json: {} }); }
    return route.fulfill({ json: [] });
  });

  await page.goto('/companies/got/');
  await page.getByRole('link', { name: /Open this company's claims map/ }).click();
  const viewer = page.getByRole('region', { name: 'Claims viewer' });
  await viewer.getByRole('button', { name: 'Edit on desktop' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit this map on a computer' });
  await sheet.getByLabel('Email').fill('not-an-email');
  await sheet.getByRole('button', { name: 'Email me the link' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Enter the email address');
  expect(calls.otp).toHaveLength(0);

  await sheet.getByLabel('Email').fill('geologist@example.test');
  await sheet.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByRole('dialog', { name: 'Check your email on your computer' })).toContainText('geologist@example.test');

  expect(calls.shares).toHaveLength(1);
  const shared = calls.shares[0].p_state;
  expect(shared.layers.length).toBe(1);
  expect(shared.layers[0].geojson.features.length).toBeGreaterThan(0);
  expect(shared.layout.exportRatio).toBe('landscape');
  expect(shared.mapView.zoom).toBeGreaterThan(0);
  expect(calls.otp).toHaveLength(1);
  expect(calls.otp[0].body.email).toBe('geologist@example.test');
  expect(new URL(calls.otp[0].redirect).pathname).toBe(`/map/${shareId}`);
});

test('a signed-in phone is told when saving to the account fails', async ({ page }, info) => {
  test.skip(!info.project.name.includes('mobile'), 'The claims viewer is phone-only');
  const uid = '00000000-0000-4000-8000-000000000091';
  const user = { id: uid, email: 'phone@example.test', role: 'authenticated', created_at: '2026-09-15T00:00:00Z', email_confirmed_at: '2026-09-15T00:00:00Z', user_metadata: {} };
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.test-signature`;
  const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
  let failCreate = true;
  const creates = [];
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').at(-1);
    if (fn === 'token') return route.fulfill({ json: session });
    if (fn === 'user') return route.fulfill({ json: user });
    if (fn === 'user_plans') return route.fulfill({ json: { plan: 'free', source: 'signup', status: 'active' } });
    if (fn === 'create_cloud_project') {
      creates.push(1);
      return failCreate
        ? route.fulfill({ status: 503, json: { message: 'Temporary save failure', code: '503' } })
        : route.fulfill({ json: '00000000-0000-4000-8000-000000000092' });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript((s) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${s.user.id}`, JSON.stringify({ done: true, projects: {} }));
  }, session);

  await page.goto('/companies/got/');
  await page.getByRole('link', { name: /Open this company's claims map/ }).click();
  await page.getByRole('region', { name: 'Claims viewer' }).getByRole('button', { name: 'Edit on desktop' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit this map on a computer' });
  await sheet.getByRole('button', { name: 'Save to my account' }).click();
  await expect(sheet.getByRole('alert')).toContainText('could not be saved');
  await expect(page.getByRole('dialog', { name: 'Saved to your account' })).toHaveCount(0);
  expect(creates).toHaveLength(1);

  failCreate = false;
  await sheet.getByRole('button', { name: 'Save to my account' }).click();
  await expect(page.getByRole('dialog', { name: 'Saved to your account' })).toBeVisible();
  expect(creates).toHaveLength(2);
});
