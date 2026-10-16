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
