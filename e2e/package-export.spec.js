import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { createInitialProjectState } from '../shared/projectState.js';

// Tower v3 item 40, the dashboard's package export, driven by clicks: saved maps (and a figure exported from
// /3d) become one ZIP with a PDF and PNGs named Client_Project_Date_FigN_Name_vX.png, with the watermark band
// where it is asked for. Against an in-memory Supabase (auth, plan and projects mocked): needs the configured
// client build (playwright.admin.config.js).
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.skip(({ isMobile }) => isMobile, 'The package export is a desktop flow');
test.use({ viewport: { width: 1400, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const uid = '00000000-0000-4000-8000-0000000004e1';
const user = { id: uid, email: 'pkg@star.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };
const RENDERS = process.env.E2E_RENDER_DIR || null;

// A small RGB PNG, standing in for a figure exported from /3d.
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 30 + (x % 200); raw[o + 1] = 90; raw[o + 2] = 120 + (y % 100); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Two fictional maps on a blank basemap.
const ring = (pts) => [[...pts, pts[0]]];
function payload(title, colour, demo = false) {
  const p = createInitialProjectState();
  p.layout = { ...p.layout, basemap: 'blank', title, subtitle: 'Illustrative sample data', insetEnabled: false, footerEnabled: false, exportSettings: { ...p.layout.exportSettings, pixelRatio: 1 } };
  p.mapView = { center: { lat: 55.05, lng: -129.95 }, zoom: 12 };
  p.layers = [{ id: 'claims', name: 'Claims', sourceName: 'claims.geojson', dataSource: demo ? 'demo' : 'upload', displayName: 'Claims', type: 'polygons', visible: true, role: 'claims', userStyled: true,
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: ring([[-130.0, 55.0], [-129.9, 55.0], [-129.9, 55.1], [-130.0, 55.1]]) } }] },
    style: { fill: colour, fillOpacity: 0.35, stroke: colour, strokeWidth: 2 }, legend: { enabled: true, label: 'Claims' } }];
  return p;
}
const MAPS = [
  { id: '00000000-0000-4000-8000-0000000004a1', name: 'Rails claims', updated_at: '2026-10-20T00:00:00Z', payload: payload('Rails Copper-Gold: claims', '#c65322') },
  { id: '00000000-0000-4000-8000-0000000004a2', name: 'Rails drill plan', updated_at: '2026-10-19T00:00:00Z', payload: payload('Rails Copper-Gold: drill plan', '#2563eb') },
];

async function fakeSupabase(page, plan) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
    if (path.startsWith('/auth/v1/')) return json(path.endsWith('/token') ? session : path.endsWith('/user') ? user : {});
    if (path.endsWith('/user_plans')) return json({ plan, source: 'test', status: 'active' });
    if (path === '/rest/v1/projects') {
      const row = (m) => ({ ...m, user_id: uid, org_id: null, deleted_at: null, revision: 1, thumbnail: null });
      if (eq('id')) { const m = MAPS.find((x) => x.id === eq('id')); return m ? json(single ? row(m) : [row(m)]) : json({ code: 'PGRST116', message: 'no rows' }, 406); }
      return json(MAPS.map(({ payload: _p, ...m }) => row(m)));
    }
    return single ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([]);
  });
  await page.addInitScript(([s, id]) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${id}`, JSON.stringify({ done: true, projects: {} }));
  }, [session, uid]);
}

// Width, height and the bottom-right pixel of a PNG, decoded by the browser.
const inspect = (page, bytes) => page.evaluate(async (u) => {
  const img = new Image(); img.src = u; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, corner: [...g.getImageData(img.width - 4, img.height - 3, 1, 1).data].slice(0, 3) };
}, `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);

async function openPackage(page) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Export a package…' }).click();
  return page.getByRole('dialog', { name: 'Export a package' });
}

test('Pro: two maps and a 3D figure become one PDF and three named PNGs, the maps with the band', async ({ page }, testInfo) => {
  await fakeSupabase(page, 'pro');
  const dialog = await openPackage(page);
  // Ticked in figure order: the drill plan first.
  await dialog.getByRole('checkbox', { name: /Rails drill plan/ }).check();
  await dialog.getByRole('checkbox', { name: /Rails claims/ }).check();
  await expect(dialog.getByText('Fig 1')).toBeVisible();
  await dialog.getByLabel('Figure name for Rails drill plan').fill('Drill plan');
  await dialog.getByLabel('Figure name for Rails claims').fill('Claims and access');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByText('+ Add exported figures').click();
  await (await chooser).setFiles({ name: 'Rails block model.png', mimeType: 'image/png', buffer: png(320, 200) });
  await expect(dialog.getByText('Fig 3')).toBeVisible();
  await dialog.getByLabel('Client').fill('Star Copper Corp.');
  await dialog.getByLabel('Project').fill('Rails');
  await dialog.getByLabel('Date').fill('2026-10-15');
  await dialog.getByLabel('Version').fill('2');
  // Pro, real data: the band is off unless asked for. Asked for here.
  const band = dialog.getByLabel(/Watermark band under each map/);
  await expect(band).not.toBeChecked();
  await band.check();
  const download = page.waitForEvent('download', { timeout: 150_000 });
  await dialog.getByRole('button', { name: 'Download package (3 figures)' }).click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('Star-Copper-Corp_Rails_2026-10-15_Package_v2.zip');
  await expect(dialog.getByRole('status')).toHaveText(/Downloaded Star-Copper-Corp_Rails_2026-10-15_Package_v2\.zip: 4 files\./);
  const zip = readFileSync(await dl.path());
  if (RENDERS) { mkdirSync(RENDERS, { recursive: true }); writeFileSync(join(RENDERS, '2d-package.zip'), zip); }
  const files = unzipSync(zip);
  expect(Object.keys(files)).toEqual([
    'Star-Copper-Corp_Rails_2026-10-15_Fig1_Drill-plan_v2.png',
    'Star-Copper-Corp_Rails_2026-10-15_Fig2_Claims-and-access_v2.png',
    'Star-Copper-Corp_Rails_2026-10-15_Fig3_Rails-block-model_v2.png',
    'Star-Copper-Corp_Rails_2026-10-15_Package_v2.pdf',
  ]);
  const [fig1, fig2] = await Promise.all(Object.values(files).slice(0, 2).map((b) => inspect(page, b)));
  expect(fig1.corner).toEqual([252, 251, 247]); // the band's cream under each map
  expect(fig2.corner).toEqual([252, 251, 247]);
  expect(Buffer.from(Object.values(files)[2]).equals(png(320, 200))).toBe(true); // the 3D figure as it came
  const pdf = Buffer.from(files['Star-Copper-Corp_Rails_2026-10-15_Package_v2.pdf']).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(3); // a page per figure
  testInfo.attach('package.zip', { body: zip, contentType: 'application/zip' });
});

test('free plan: the band is on by default and the ZIP holds the PNGs (the PDF is Pro)', async ({ page }) => {
  await fakeSupabase(page, 'free');
  const dialog = await openPackage(page);
  await expect(dialog.getByText('The package PDF is a Pro feature')).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Rails claims/ }).check();
  await expect(dialog.getByLabel(/Watermark band under each map/)).toBeChecked();
  await dialog.getByLabel('Client').fill('Star Copper');
  await dialog.getByLabel('Date').fill('2026-10-22');
  const download = page.waitForEvent('download', { timeout: 150_000 });
  await dialog.getByRole('button', { name: 'Download package (1 figure)' }).click();
  const files = unzipSync(readFileSync(await (await download).path()));
  expect(Object.keys(files)).toEqual(['Star-Copper_2026-10-22_Fig1_Rails-claims_v1.png']);
  expect((await inspect(page, Object.values(files)[0])).corner).toEqual([252, 251, 247]);
});
