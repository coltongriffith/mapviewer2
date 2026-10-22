import { test, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createInitialProjectState } from '../shared/projectState.js';

// Geology and label styling (layer.fx, utils/geoStyle.js) end to end at 1280 × 720: a unit feathered with its
// name printed into it, a trend with glow and its name along it, the basemap wash, the overlap list, and the
// same on the editor stage (its own canvases), in the PNG and in the SVG (live text). SVG export is a Pro
// format, so this runs on the configured client build with a mocked Pro account (playwright.admin.config.js).
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');
test.skip(({ isMobile }) => isMobile, 'The inspector is a desktop flow');
test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 150_000 });

const uid = '00000000-0000-4000-8000-0000000000e7';
const user = { id: uid, email: 'geo@tower.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

function tilePng(seed) {
  const n = 256, raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y += 1) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x += 1) {
      const v = Math.sin((x + seed) * 0.07) * Math.cos((y - seed) * 0.05);
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
  await page.route('https://server.arcgisonline.com/**', (route) => {
    const x = Number(new URL(route.request().url()).pathname.split('/').at(-1)) || 0;
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tilePng(x * 37) });
  });
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/v1/')) return json(path.endsWith('/token') ? session : path.endsWith('/user') ? user : {});
    if (path === '/rest/v1/templates' && (req.headers().accept || '').includes('vnd.pgrst.object')) return json({ code: 'PGRST116', message: 'no rows' }, 406);
    if (path.endsWith('/user_plans')) return json({ plan: 'pro', source: 'test', status: 'active' });
    return json([]);
  });
  // Every glyph the canvases draw (the stage's fx canvases and the PNG exporter), in order.
  await page.addInitScript((s) => {
    try { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)); } catch { /* none */ }
    window.__texts = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__texts.push(String(t)); return f.call(this, t, ...a); };
  }, session);
}

const ring = (pts) => [[...pts, pts[0]]];
function project() {
  const p = createInitialProjectState();
  p.layout = { ...p.layout, basemap: 'satellite', title: 'Rabbit North · Geology', subtitle: 'Illustrative', footerEnabled: false, legendTitle: 'Legend' };
  p.mapView = { center: { lat: 50.6, lng: -120.7 }, zoom: 14 };
  const layer = (id, name, type, geometry, style) => ({ id, name, sourceName: `${name}.geojson`, dataSource: 'upload', displayName: name, type, visible: true, role: 'other', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] }, style, userStyled: true, legend: { enabled: true, label: name } });
  p.layers = [
    layer('unit', 'Durand Stock', 'polygons', { type: 'Polygon', coordinates: ring([[-120.712, 50.594], [-120.684, 50.594], [-120.684, 50.606], [-120.700, 50.606], [-120.700, 50.611], [-120.712, 50.611]]) }, { fill: '#e7a1bf', fillOpacity: 0.55, stroke: '#ffffff', strokeWidth: 1 }),
    // From under the legend (bottom left, at 1280 × 720) out to the top right.
    layer('trend', 'Thunder trend', 'line', { type: 'LineString', coordinates: [[-120.7264, 50.5861], [-120.70, 50.600], [-120.655, 50.618]] }, { stroke: '#f5b425', strokeWidth: 4 }),
  ];
  return p;
}

async function open(page) {
  const p = project();
  const draft = JSON.stringify({ schemaVersion: 1, payload: p, projectId: null, projectName: p.layout.title });
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('geo-seeded')) return;
    localStorage.setItem('mapviewer.draft.v1', value);
    sessionStorage.setItem('geo-seeded', '1');
  }, draft);
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

async function exportFile(page, label) {
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await page.evaluate(() => { window.__texts = []; });
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: label, exact: true }).first().click();
  return readFileSync(await (await download).path());
}
const selectLayer = async (page, name) => {
  await page.getByRole('tab', { name: 'Customize', exact: true }).click();
  const heading = page.locator('.ins-acc-heading button', { hasText: /^Layers/ });
  if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click();
  await page.locator('.layer-item', { hasText: name }).click();
  await expect(page.getByTestId('geo-style-controls')).toBeVisible();
};

test('geology styling: a feathered unit named in its fill, a glowing trend named along it, the wash, overlaps; stage, PNG and SVG', async ({ page }) => {
  await setup(page);
  await open(page);
  // A map without the styling draws as before: no fx canvases on the map.
  await expect(page.locator('.leaflet-emFxband-pane canvas')).toHaveCount(0);

  // The unit: feathered, no outline, its name and an italic second line printed into it.
  await selectLayer(page, 'Durand Stock');
  const controls = page.getByTestId('geo-style-controls');
  await controls.getByLabel('Geology style: feather, plume').check();
  await expect(controls.getByLabel('Soft edges (blur)')).toBeVisible();
  await controls.getByLabel('Name printed in the unit').check();
  await controls.getByLabel('Second line (italic)').fill('diorite');
  await expect(page.locator('.leaflet-emFxband-pane canvas')).toHaveCount(1);
  await expect(page.locator('.leaflet-emFxlabels-pane canvas')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__texts.join(''))).toContain('DURAND STOCK');
  await expect.poll(() => page.evaluate(() => window.__texts.join(''))).toContain('diorite');
  // The legend row's swatch is drawn in the unit's style.
  await expect(page.locator('.legend-item', { hasText: 'Durand Stock' }).locator('.legend-fx-svg')).toBeVisible();

  // The trend: an inferred trend with glow, named along it, starting under the legend with stepping clear off.
  await selectLayer(page, 'Thunder trend');
  await controls.getByLabel('Line style: glow, casing, line types').check();
  await controls.getByLabel('Line type', { exact: true }).selectOption('trend');
  await controls.getByLabel('Glow', { exact: true }).fill('6');
  await controls.getByLabel('Label along the line').check();
  await controls.getByLabel('Position along the line').fill('0');
  await controls.getByLabel('Step clear of panels and other labels').uncheck();
  await expect(controls.getByRole('status', { name: 'Label overlaps' })).toContainText('“THUNDER TREND” overlaps legend');
  // Stepping clear moves it off the legend: nothing left to list.
  await controls.getByLabel('Step clear of panels and other labels').check();
  await expect(controls.getByRole('status', { name: 'Label overlaps' })).toHaveCount(0);
  await expect(page.locator('.legend-item', { hasText: 'Thunder trend' }).locator('.legend-fx-svg')).toBeVisible();

  // The wash over the basemap, from the Style tab.
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await page.getByLabel('Wash over the basemap').fill('0.3');
  await page.getByLabel('Edge vignette').fill('0.4');
  await expect(page.locator('.leaflet-emFxwash-pane canvas')).toHaveCount(1);

  // PNG: the same glyphs, painted by the same painter.
  const png = await exportFile(page, 'Export PNG');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const drawn = (await page.evaluate(() => window.__texts)).join('');
  for (const t of ['DURAND STOCK', 'diorite', 'THUNDER TREND']) expect(drawn, t).toContain(t);

  // SVG: live text, each glyph placed and turned; blur filters, the plume-free fill, the wash, the swatches.
  const svg = (await exportFile(page, 'Export SVG')).toString('utf8');
  expect(svg).toMatch(/<text class="em-fx-area-label" xml:space="preserve" x="[\d. ]+" y="[\d. ]+" rotate="[-\d. ]+"[^>]*>DURAND STOCK<\/text>/);
  expect(svg).toMatch(/font-style="italic"[^>]*>diorite<\/text>/);
  expect(svg).toMatch(/<text class="em-fx-line-label"[^>]*paint-order="stroke">THUNDER TREND<\/text>/);
  expect(svg).toContain('<g id="em-fx-wash">');
  expect(svg).toMatch(/<feGaussianBlur stdDeviation="[\d.]+" \/>/);
  expect(svg).toMatch(/id="em-legend-item-\d+" class="em-legend-item"><path[^>]*filter="url\(#em-fx-legend-blur/);
  // The plain vector pass no longer draws the styled layers.
  expect(svg.match(/<g id="em-fx-layers">/g)).toHaveLength(1);

  // Kept with the map (signed in, a reload lands on the dashboard; the draft is resumed from there).
  await page.goto('/?intent=resume');
  await expect(page.locator('.leaflet-emFxband-pane canvas')).toHaveCount(1, { timeout: 30_000 });
  await selectLayer(page, 'Durand Stock');
  await expect(controls.getByLabel('Name printed in the unit')).toBeChecked();
});
