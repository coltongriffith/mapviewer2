import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createInitialProjectState } from '../shared/projectState.js';

test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build and isolated Pro account');
test.skip(({ isMobile }) => isMobile, 'Desktop SVG download flow');
test.use({ viewport: { width: 1400, height: 900 } });
test.setTimeout(120_000);

test('downloaded SVG carries branding fonts independently of the map font', async ({ page }) => {
  const user = { id: '00000000-0000-4000-8000-000000000c11', email: 'svg@example.test', role: 'authenticated', aud: 'authenticated', user_metadata: {}, app_metadata: {} };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const expiry = Math.floor(Date.now() / 1000) + 86400;
  const session = { user, access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp: expiry })}.test`, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: expiry, token_type: 'bearer' };
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    const body = path.startsWith('/auth/v1/') ? (path.endsWith('/token') ? session : user) : path.endsWith('/user_plans') ? { plan: 'pro', status: 'active' } : [];
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  // Synthetic font bytes verify packaging, not glyph rendering or appearance.
  const queries = [];
  await page.route('https://fonts.googleapis.com/**', (r) => {
    const familyQuery = new URL(r.request().url()).searchParams.get('family');
    queries.push(familyQuery);
    const family = familyQuery.split(':')[0];
    return r.fulfill({ contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: `/* latin */\n@font-face { font-family: '${family}'; font-weight: 300 800; src: url(https://fonts.gstatic.com/mock-${encodeURIComponent(family)}.woff2) format('woff2'); }` });
  });
  await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from([1, 2, 3, 4]) }));
  const p = createInitialProjectState();
  p.layout = { ...p.layout, title: 'Illustrative font export check', basemap: 'blank', insetEnabled: false, exportSettings: { ...p.layout.exportSettings, band: true, draft: true }, fonts: { title: 'Inter', subtitle: 'Inter', legend: 'Inter', label: 'Inter', callout: 'Inter', footer: 'Inter' } };
  p.layers = [];
  await page.addInitScript(([auth, payload]) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(auth));
    localStorage.setItem(`em_migration_v2_${auth.user.id}`, JSON.stringify({ done: true, projects: {} }));
    localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload, projectId: null, projectName: payload.layout.title }));
  }, [session, p]);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const band = page.getByLabel('Watermark band under the export (draft for review)');
  const draft = page.getByLabel('Draft watermark over the map');
  await band.check(); await draft.check();
  const svgDownload = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG', exact: true }).first().click();
    const result = readFileSync(await (await pending).path(), 'utf8');
    await page.locator('.export-hd-close').first().click({ timeout: 1500 }).catch(() => {});
    return result;
  };
  const branded = await svgDownload();
  expect(branded).toContain('id="em-watermark-band"');
  expect(branded).toContain("font-family: 'Source Sans 3'");
  expect(branded).toContain('data:font/woff2;base64,AQIDBA==');
  expect(branded).not.toContain('https://fonts.gstatic.com/');
  expect(queries).toContain('Source Sans 3:wght@300..800');
  await band.uncheck();
  const draftOnly = await svgDownload();
  expect(draftOnly).not.toContain('id="em-watermark-band"');
  expect(draftOnly).toContain("font-family: 'Source Sans 3'");
  await draft.uncheck();
  const plain = await svgDownload();
  expect(plain).not.toContain("font-family: 'Source Sans 3'");
});
