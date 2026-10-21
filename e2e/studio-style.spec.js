import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInitialProjectState } from '../shared/projectState.js';
import { auroraClaims, auroraDrillholes, auroraTargets, auroraCallouts } from '../src/assets/auroraDemo.js';

// The opt-in 2D Studio style (the /3d figure look): on the editor stage and in the PNG and SVG exports, the
// title card with its caps kicker, the scale bar beside the north arrow, the dark locator card, the legend
// card and the label halo. SVG export is a Pro format, so this runs on the configured client build with a
// mocked Pro account (playwright.admin.config.js). STUDIO_SHOTS=<dir> saves the exports and stage renders;
// STUDIO_REAL_TILES=1 uses real imagery for them instead of the synthetic tiles.
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.skip(({ isMobile }) => isMobile, 'Exports are a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 150_000 });

const uid = '00000000-0000-4000-8000-0000000000e7';
const user = { id: uid, email: 'studio@tower.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

// A mottled green-brown 256 px tile, so the export reads like imagery without the network.
function tilePng(seed) {
  const n = 256, raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y += 1) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x += 1) {
      const v = Math.sin((x + seed) * 0.07) * Math.cos((y - seed) * 0.05) + Math.sin((x * 0.31 + y * 0.17 + seed) * 0.4) * 0.35;
      const o = y * (n * 3 + 1) + 1 + x * 3;
      raw[o] = 74 + v * 22; raw[o + 1] = 84 + v * 20; raw[o + 2] = 58 + v * 14;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function setup(page) {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  if (!process.env.STUDIO_REAL_TILES) {
    await page.route('https://server.arcgisonline.com/**', (route) => {
      const x = Number(new URL(route.request().url()).pathname.split('/').at(-1)) || 0;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tilePng(x * 37) });
    });
  }
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/v1/')) return json(path.endsWith('/token') ? session : path.endsWith('/user') ? user : {});
    if (path === '/rest/v1/templates' && (req.headers().accept || '').includes('vnd.pgrst.object')) return json({ code: 'PGRST116', message: 'no rows' }, 406);
    if (path.endsWith('/user_plans')) return json({ plan: 'pro', source: 'test', status: 'active' });
    return json([]);
  });
  // The texts the PNG exporter draws, in order.
  await page.addInitScript((s) => {
    try { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)); } catch { /* none */ }
    window.__texts = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__texts.push(String(t)); return f.call(this, t, ...a); };
  }, session);
}

const layer = (id, name, role, type, geojson, style, label) => ({
  id, name, sourceName: `${name}.geojson`, dataSource: 'upload', displayName: label, type, visible: true, role, geojson, style, userStyled: true, legend: { enabled: true, label },
});
// A Tower-style sample figure: claims, targets, collars with intercept cards, an area label and a hole ID.
function sampleProject(layout = {}) {
  const project = createInitialProjectState();
  project.layout = {
    ...project.layout, basemap: 'satellite', title: 'Cedar Ridge · Geology & Copper Trends', subtitle: 'New holes CR-24-07 & CR-24-11 (15 Oct 2026) · Smithers, B.C.',
    companyName: 'Aurora Ridge Minerals', mapDate: 'October 2026', projectNumber: 'NAD83 / UTM Zone 9N', mapScaleNote: 'Geology after Aurora Ridge',
    insetMode: 'satellite_locator', insetTitle: 'Project location', insetLabel: 'British Columbia, Canada', legendTitle: 'Legend', footerEnabled: false, accentColor: '#2e9e44', titleBgColor: '#16466e',
    ...layout,
  };
  project.mapView = { center: { lat: 55.45, lng: -127.2 }, zoom: 12.4 };
  project.layers = [
    layer('claims', 'claims', 'claims', 'polygons', auroraClaims, { stroke: '#ffffff', fill: '#117a68', fillOpacity: 0.42, strokeWidth: 2, dissolve: true }, 'Cedar Ridge claims'),
    layer('targets', 'targets', 'target_areas', 'polygons', auroraTargets, { stroke: '#e5b52c', fill: '#e5b52c', fillOpacity: 0.12, strokeWidth: 2.5, dashArray: '8 6' }, 'Target areas'),
    layer('collars', 'collars', 'drillholes', 'points', auroraDrillholes, { markerColor: '#0b3533', markerFill: '#ffffff', markerSize: 11 }, 'Drill collars 2021–2026'),
  ];
  project.callouts = [
    ...auroraCallouts.map((c, i) => ({ ...c, id: `co-${i}`, featureId: null, layerId: null })),
    { id: 'hole-id', text: 'CR-24-07', type: 'plain', anchor: { lat: 55.462, lng: -127.235 }, offset: { x: 18, y: -18 }, boxWidth: 80, style: { textColor: '#0b3533', fontSize: 12 } },
  ];
  project.markers = [{ id: 'm1', type: 'maplabel', label: 'Hazelton Group', lat: 55.476, lng: -127.16, size: 22, opacity: 0.85, color: '#5a1f2b' }];
  return project;
}

async function open(page, project) {
  const draft = JSON.stringify({ schemaVersion: 1, payload: project, projectId: null, projectName: project.layout.title });
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('studio-seeded')) return;
    localStorage.setItem('mapviewer.draft.v1', value);
    sessionStorage.setItem('studio-seeded', '1');
  }, draft);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.map-callout').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500); // tiles, the locator and fonts settle
}

async function exportFile(page, label) {
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await page.evaluate(() => { window.__texts = []; }); // not the project thumbnail's
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: label, exact: true }).first().click();
  const file = await download;
  return readFileSync(await file.path());
}

const shots = process.env.STUDIO_SHOTS;
async function save(page, name, png, svg) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const { writeFileSync } = await import('node:fs');
  if (png) writeFileSync(join(shots, `${name}.png`), png);
  if (svg) writeFileSync(join(shots, `${name}.svg`), svg);
  await page.locator('.map-stage').screenshot({ path: join(shots, `${name}-stage.png`), animations: 'disabled' });
}
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

test('Studio: title card, legend card, dark locator and scale-north card on the stage, in the PNG and in the SVG', async ({ page }) => {
  await setup(page);
  await open(page, sampleProject({ themeId: 'studio', studio: { pill: 'TSXV: ARM', projectLabel: 'Cedar Ridge' } }));

  // The stage draws the Studio cards in the template's zones.
  for (const kind of ['title', 'scale', 'inset']) await expect(page.locator(`.studio-card--${kind}`)).toBeVisible();
  await expect(page.locator('.studio-card--title text').first()).toHaveText('AURORA RIDGE MINERALS');
  await expect(page.locator('.studio-card--inset')).toContainText('PROJECT LOCATION');
  await expect(page.locator('.studio-card--inset .satellite-inset-map')).toHaveCount(1);
  // One card for scale and north: no separate north arrow.
  await expect(page.locator('.north-arrow-card')).toHaveCount(0);
  const legendRadius = await page.locator('.legend-card').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(legendRadius).toBe('8px');
  // The theme picker offers Studio and its settings show under it.
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Studio' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('studio-controls')).toBeVisible();

  const png = await exportFile(page, 'Export PNG');
  const texts = await page.evaluate(() => window.__texts);
  for (const t of ['AURORA RIDGE MINERALS', 'Cedar Ridge · Geology & Copper Trends', 'PROJECT LOCATION', 'TSXV: ARM', 'CEDAR RIDGE', 'British Columbia, Canada', 'Legend', 'N']) expect(texts, t).toContain(t);
  expect(texts.some((t) => /UTM ZONE 9N$/.test(t)), 'datum note').toBe(true);
  expect(texts.some((t) => /^[\d.]+ (m|km)$/.test(t)), 'scale bar end label').toBe(true);
  const [sw, sh] = await page.locator('.map-stage').evaluate((el) => [el.offsetWidth, el.offsetHeight]);
  expect(pngSize(png)).toEqual({ w: sw * 2, h: sh * 2 });

  const svg = (await exportFile(page, 'Export SVG')).toString('utf8');
  for (const id of ['em-studio-title', 'em-studio-scale', 'em-studio-inset', 'em-legend']) expect(svg, id).toContain(`id="${id}"`);
  expect(svg).not.toContain('id="em-studio-north"');
  expect(svg).toContain('class="em-studio-kicker"');
  expect(svg).toContain('>AURORA RIDGE MINERALS</text>');
  expect(svg).toContain('>TSXV: ARM</text>');
  expect(svg).toContain('filter="url(#em-studio-shadow)"');
  expect(svg).toContain('font-weight="800"');
  expect(svg).toContain("'IBM Plex Mono'");
  // The label halo outlines the area label and the hole ID.
  expect(svg).toMatch(/letter-spacing="0\.12em"[^>]*stroke="#ffffff"[^>]*paint-order="stroke">HAZELTON GROUP</);
  expect(svg).toMatch(/paint-order="stroke">CR-24-07</);
  // Studio's weights and mono numerals are embedded for viewers without the fonts.
  expect(svg).toMatch(/@font-face[\s\S]*font-family: 'IBM Plex Mono'/);
  await save(page, 'studio', png, svg);
});

test('Studio: the title card holds the scale bar and north arrow (Fig 2), bottom left over the map; and full bleed', async ({ page }) => {
  await setup(page);
  await open(page, sampleProject({
    themeId: 'studio', titleCorner: 'bl', legendCorner: 'br', cornerLayout: null,
    studio: { kicker: 'Fig. 2 · Cedar Ridge · TSXV: ARM', projectLabel: 'Cedar Ridge', titleScale: true, datumSub: 'Grid: true UTM ticks on frame', cards: { inset: { tone: 'dark' }, legend: { accent: 'top' } } },
  }));
  await expect(page.locator('.studio-card--title')).toBeVisible();
  await expect(page.locator('.studio-card--scale')).toHaveCount(0);
  await expect(page.locator('.studio-card--title')).toContainText('Grid: true UTM ticks on frame');
  const png = await exportFile(page, 'Export PNG');
  const texts = await page.evaluate(() => window.__texts);
  expect(texts).toContain('FIG. 2 · CEDAR RIDGE · TSXV: ARM');
  expect(texts).toContain('Grid: true UTM ticks on frame');
  expect(texts).toContain('CEDAR RIDGE'); // the project's name stays on the locator's marker
  await save(page, 'studio-fig2-title-scale', png, null);

  // Full bleed: the map fills the frame; no title, legend or locator, the scale-north card stays.
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await page.getByText('Full bleed: the map fills the frame').click();
  await expect(page.locator('.studio-card--title')).toHaveCount(0);
  await expect(page.locator('.legend-card')).toHaveCount(0);
  await expect(page.locator('.studio-card--inset')).toHaveCount(0);
  await expect(page.locator('.studio-card--scale')).toBeVisible();
  const bleed = await exportFile(page, 'Export PNG');
  await save(page, 'studio-full-bleed', bleed, null);
});
