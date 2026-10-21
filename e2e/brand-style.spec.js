import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// "Apply style" from a saved brand kit (F4): colours and fonts change, the map's composition and data do
// not, and the map records the kit it took its look from. Needs the configured client build
// (dist-auth-check, VITE_SUPABASE_URL=https://example.supabase.co); auth and REST are mocked.
// F4_SHOTS=<dir> also saves before/after renders of the map there.
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.skip(({ isMobile }) => isMobile, 'The brand kit list is in the desktop inspector');

const uid = '00000000-0000-4000-8000-0000000000f4';
const user = { id: uid, email: 'brand@rift.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

// A kit captured from another map: its template, corners and inset would recompose this one.
const kit = {
  id: '00000000-0000-4000-8000-0000000000a4', user_id: uid, name: 'Rift Resources', is_default: false,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-20T09:30:00Z',
  config: {
    templateId: 'side_panel', mode: 'drill_plan', titleCorner: 'br', legendCorner: 'tr', insetEnabled: false, footerText: 'Rift Resources Ltd.',
    accentColor: '#ae4b0a', titleBgColor: '#0a4268', titleFgColor: '#ffffff', panelFgColor: '#1e1d26',
    fonts: { title: 'Montserrat', legend: 'Lato', label: 'Lato', callout: 'Lato' },
    style: { version: 1, colours: { primary: '#0a4268', accent: '#ae4b0a', ink: '#1e1d26', panel: '#fffdf7' }, type: { title: { family: 'Montserrat', weight: 700 }, label: { family: 'Lato' } } },
  },
};

async function fakeSupabase(page) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      return json({});
    }
    if (path === '/rest/v1/templates') {
      const single = (req.headers().accept || '').includes('vnd.pgrst.object');
      if (single) return json({ code: 'PGRST116', message: 'no rows' }, 406); // no default kit
      return json([kit]);
    }
    if (path.endsWith('/user_plans')) return json({ plan: 'pro', source: 'test', status: 'active' });
    return json([]);
  });
  await page.addInitScript((s) => { try { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)); } catch { /* none */ } }, session);
}

// The open map as the editor last saved it locally (the draft autosave).
async function draft(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
  if (!raw) return null;
  const text = raw.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw;
  return JSON.parse(text).payload;
}

const shots = process.env.F4_SHOTS;
async function shoot(page, name) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.locator('.map-stage').screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' });
}

test('Apply style changes the look only, and records the kit; Full template still recomposes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeSupabase(page);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Try sample data' }).click();
  await expect(page.getByRole('tab', { name: 'Style', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const card = page.locator('.bk-side-card').filter({ hasText: 'Rift Resources' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500); // tiles and the first autosave settle
  await expect.poll(async () => (await draft(page))?.layers?.length || 0).toBeGreaterThan(0);
  const before = await draft(page);
  await shoot(page, 'before');

  await card.getByRole('button', { name: 'Apply style' }).click();
  await expect.poll(async () => (await draft(page))?.layout?.brandStyle?.brandKitId).toBe(kit.id);
  const after = await draft(page);
  await page.waitForTimeout(800);
  await shoot(page, 'after-style-only');

  // The look changed...
  expect(after.layout).toMatchObject({ accentColor: '#ae4b0a', titleBgColor: '#0a4268', panelBgColor: '#fffdf7', panelFgColor: '#1e1d26' });
  expect(after.layout.fonts).toMatchObject({ title: 'Montserrat', legend: 'Lato', label: 'Lato', callout: 'Lato' });
  // ...and the record says where from.
  expect(after.layout.brandStyle).toMatchObject({ brandKitId: kit.id, brandRevision: kit.updated_at, mode: 'style' });
  expect(after.layout.brandStyle.style.colours.panel).toBe('#fffdf7');
  // Extent, layers, text, data styling and composition are as they were.
  expect(after.mapView).toEqual(before.mapView);
  expect(after.layers).toEqual(before.layers);
  expect(after.callouts).toEqual(before.callouts);
  for (const k of ['title', 'subtitle', 'templateId', 'mode', 'titleCorner', 'legendCorner', 'insetEnabled', 'footerText', 'zoomPercent', 'legendItems']) {
    expect(after.layout[k], k).toEqual(before.layout[k]);
  }

  // Full template is still there, and still brings the kit's composition.
  await card.getByRole('button', { name: 'Full template' }).click();
  await expect.poll(async () => (await draft(page))?.layout?.templateId).toBe('side_panel');
  const full = await draft(page);
  expect(full.layout.brandStyle.mode).toBe('full');
  expect(full.layers).toEqual(before.layers);
  await page.waitForTimeout(800);
  await shoot(page, 'after-full-template');
});
