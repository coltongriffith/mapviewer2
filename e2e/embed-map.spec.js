import { test, expect } from '@playwright/test';
import { createInitialProjectState } from '../shared/projectState.js';

// The live investor web map: /embed/map/<share id> framed by a company's website. The header test runs against any
// build; the framed map needs the configured client build (dist-auth-check) with the share RPC answered here.
const ID = 'abc123def456abc123def456abc123de';
const square = (x, props = {}) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[[x, 55], [x + 0.2, 55], [x + 0.2, 55.12], [x, 55.12], [x, 55]]] } }] });
const base = createInitialProjectState();
const state = {
  ...base,
  layout: { ...base.layout, title: 'Rails Project', companyName: 'Star Copper Corp.', basemap: 'blank', insetEnabled: false },
  mapView: { center: { lat: 55.06, lng: -129.9 }, zoom: 11, screenW: 900, screenH: 500 },
  layers: [
    { id: 'claims', name: 'Rails claims', type: 'polygons', role: 'claims', visible: true, style: { fill: '#c65322', fillOpacity: 0.5, stroke: '#c65322', strokeWidth: 2 }, legend: { enabled: true, label: 'Rails claims' },
      geojson: square(-130, { TENURE_NUMBER_ID: '1098765', OWNER_NAME: 'Star Copper Corp.', TENURE_STATUS: 'GOOD', INTERNAL_NOTE: 'do not show' }) },
    { id: 'targets', name: 'Targets', type: 'polygons', role: 'other', visible: true, style: { fill: '#2563eb', stroke: '#2563eb' }, legend: { enabled: true, label: 'Targets' }, geojson: square(-129.5) },
    { id: 'mag', name: 'Magnetics', type: 'tiles', visible: true, tiles: { kind: 'xyz', url: 'https://tiles.example.test/{z}/{x}/{y}.png' } },
  ],
};

// The test's company page is a routed response with no address, so Chromium would treat framing the local server
// as a public site reaching into the local network. A real company site and explorationmaps.com are both public.
test.use({ launchOptions: {
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=LocalNetworkAccessChecks'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
} });

test('only /embed/map/<id> (and /3d/embed/<id>) may be framed', async ({ request }) => {
  for (const path of ['/', '/map/example', `/map/${ID}`, '/embed/map/', `/embed/map/${ID}/extra`, '/embed', '/dashboard', '/workspace/x', `/3d/share/${'a'.repeat(32)}`]) {
    const h = (await request.get(path)).headers();
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
  }
  for (const path of [`/embed/map/${ID}`, `/embed/map/${ID}/`]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const h = res.headers();
    expect(h['x-frame-options'], path).toBeUndefined();
    expect(h['content-security-policy'], path).toContain('frame-ancestors *');
    expect(h['content-security-policy'], path).toContain("default-src 'self'");
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-robots-tag'], path).toContain('noindex');
    expect(h['cache-control'], path).toBe('no-cache');
  }
});

test.describe('framed on a company website', () => {
  test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated RPC fixtures');

  test('pans, switches layers, shows public claim records and loads no editor code', async ({ page, baseURL }) => {
    const errors = [], scripts = [], events = [], rpcs = [];
    let published = state;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
    await page.route('**/api/track', (route) => { events.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
    await page.route('https://tiles.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=', 'base64') }));
    await page.route('https://example.supabase.co/**', (route) => {
      const fn = new URL(route.request().url()).pathname.split('/').at(-1);
      rpcs.push(fn);
      return route.fulfill({ status: 200, json: fn === 'get_shared_map' ? published : [] });
    });
    // The company's page: another origin (localhost against the server's 127.0.0.1), so framing is cross-origin.
    const site = new URL(baseURL);
    site.hostname = 'localhost';
    await page.route(`${site.origin}/ir/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html',
      body: `<!doctype html><title>Star Copper</title><h1>Our projects</h1><iframe src="${baseURL}/embed/map/${ID}" style="width:100%;height:520px;border:0" title="Rails map"></iframe>` }));
    await page.goto(`${site.origin}/ir/map?utm_source=newsletter#rails`);

    const frame = page.frameLocator('iframe');
    await expect(frame.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
    const toggle = frame.getByRole('button', { name: /layers/i });
    if ((await toggle.textContent()) === 'Layers') await toggle.click();
    await expect(frame.getByRole('heading', { name: 'Rails Project' })).toBeVisible();
    const legend = frame.getByRole('region', { name: 'Legend' });
    await expect(legend).toContainText('Targets');

    await frame.getByLabel('Targets').uncheck();
    await expect(legend).not.toContainText('Targets');
    await expect(legend).toContainText('Rails claims');
    await frame.getByLabel('Targets').check();
    await expect(legend).toContainText('Targets');

    // Exercise the real Leaflet tile lifecycle, not only the switch's React state.
    const tiles = frame.locator('img.leaflet-tile[src^="https://tiles.example.test/"]');
    await expect.poll(() => tiles.count()).toBeGreaterThan(0);
    await frame.getByLabel('Magnetics').uncheck();
    await expect(tiles).toHaveCount(0);
    await frame.getByLabel('Magnetics').check();
    await expect.poll(() => tiles.count()).toBeGreaterThan(0);
    expect(published.layers.find(layer => layer.id === 'mag').visible).toBe(true);

    // The claim sits under the saved view's centre: a click there opens its registry record, and nothing else.
    await frame.getByRole('button', { name: 'Hide layers' }).click();
    const box = await frame.locator('.leaflet-container').boundingBox();
    await frame.locator('.leaflet-container').click({ position: { x: box.width / 2, y: box.height / 2 } });
    const popup = frame.locator('.area-claims-popup');
    await expect(popup).toContainText('1098765');
    await expect(popup).toContainText('Status: GOOD');
    await expect(popup).not.toContainText('do not show');
    await expect(frame.getByText('Made with ExplorationMaps')).toBeVisible();

    // Live: the share is read on every load, and the view is counted as an embed view without the page's query string.
    expect(rpcs).toContain('get_shared_map');
    const viewed = events.find((e) => e?.event === 'share_viewed');
    expect(viewed?.props).toEqual({ mapId: ID, embed: true, referrer: 'localhost' });
    expect(events.some((e) => e?.kind === 'pageview' || e?.kind === 'ping')).toBe(false);
    expect(scripts.filter((u) => /\/assets\/(App|vendor-export|AddClaimsModal|ReadOnlyMapStage)-/.test(u))).toEqual([]);

    // Republished: the next visit to the company's page shows the new state, with no change to its embed code.
    published = { ...state, layout: { ...state.layout, title: 'Rails Project, 2026 drilling' } };
    await page.reload();
    if ((await toggle.textContent()) === 'Layers') await toggle.click();
    await expect(frame.getByRole('heading', { name: 'Rails Project, 2026 drilling' })).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
