import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { createInitialProjectState } from '../shared/projectState.js';
import { defaultRecipe, computeResults } from '../shared/drillResults.js';
import { parseDrillFilter, matchesDrillFilter } from '../tests/fixtures/drill-filter.js';

test.skip(!process.env.E2E_ADMIN, 'Requires the configured client with isolated fixtures');
test.skip(({ isMobile }) => isMobile, 'The 2D editor inspector is a desktop flow');
test.use({ viewport: { width: 1600, height: 1000 } });

test('2D property recipes stay staged until build and persist their exact text and version', async ({ page }) => {
  const uid = '00000000-0000-4000-8000-000000000001', org = '00000000-0000-4000-8000-000000000002';
  const property = '00000000-0000-4000-8000-000000000003', map = '00000000-0000-4000-8000-000000000004';
  const user = { id: uid, email: 'synthetic@example.test', role: 'authenticated', aud: 'authenticated', user_metadata: {}, app_metadata: {} };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const session = { user, access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test`, refresh_token: 'synthetic', expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, token_type: 'bearer' };
  const project = createInitialProjectState(); project.mapView = { center: { lat: 50, lng: -120 }, zoom: 17 };
  project.layout.basemap = 'none';
  const assays = [0.5, 0.9].map((v, i) => ({ hole_id: 'SYN-01', from_m: i * 2, to_m: i * 2 + 2, values: { Au: v }, units: { Au: 'g/t' }, bdl: {} }));
  const recipe = { ...defaultRecipe(['Au'], { Au: 'g/t' }), inclCutoff: null };
  const expected = computeResults(assays, recipe).results[0];
  let version = 3, recipeReads = 0;
  await page.route('**/api/track', (r) => r.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const drillPage = (rows) => {
      const q = url.searchParams;
      for (const [k, v] of q) if (k === 'hole_id') rows = rows.filter((r) => matchesDrillFilter(r, parseDrillFilter(`${k}.${v}`)));
      if (q.has('or')) rows = rows.filter((r) => matchesDrillFilter(r, parseDrillFilter(`or${q.get('or')}`)));
      const keys = q.get('order').split(',').map((s) => s.split('.')[0]);
      return rows.slice().sort((a, b) => { for (const k of keys) { if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1; } return 0; }).slice(0, Number(q.get('limit')));
    };
    if (path.endsWith('/auth/v1/user')) return json(user);
    if (path.endsWith('/auth/v1/token')) return json(session);
    if (path.endsWith('/rpc/get_my_workspaces')) return json([{ id: org, name: 'Synthetic company', slug: 'synthetic', role: 'owner' }]);
    if (path.endsWith('/rpc/drill_property_recipes')) { recipeReads++; return json([{ id: `recipe-${version}`, name: 'Default', version, recipe: { ...recipe, cutoff: version === 3 ? 0.3 : 99 } }]); }
    if (path.endsWith('/drill_import_batches')) return json([{ id: 'batch', kind: 'assays', created_at: '2026-10-22T00:00:00Z' }]);
    if (path.endsWith('/drill_collars')) return json(drillPage([{ hole_id: 'SYN-01', x: -120, y: 50, z: 1000, crs: 'EPSG:4326', azimuth: 0, dip: -60, depth: 10 }]));
    if (path.endsWith('/drill_assays')) return json(drillPage(assays));
    if (path.endsWith('/drill_surveys') || path.endsWith('/drill_lithology')) return json([]);
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (path.endsWith('/projects')) {
      const body = req.method() === 'POST' ? req.postDataJSON() : {};
      const row = { id: map, user_id: uid, name: 'Synthetic property plan', org_id: org, property_id: property, revision: 1, payload: project, ...body };
      return json(single ? row : [row]);
    }
    if (path.endsWith('/properties')) { const row = { id: property, org_id: org, name: 'Synthetic property', slug: 'synthetic' }; return json(single ? row : [row]); }
    if (path.endsWith('/user_plans')) return json(single ? { plan: 'free', status: 'active' } : []);
    return json(single ? null : []);
  });
  await page.addInitScript(({ session, project, map }) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
    localStorage.setItem(`em_migration_v2_${session.user.id}`, JSON.stringify({ done: true, projects: {} }));
    if (!sessionStorage.getItem('recipe-seeded')) {
      localStorage.setItem('mapviewer.draft.v1', JSON.stringify({ schemaVersion: 1, payload: project, projectId: map, projectName: 'Synthetic property plan' }));
      sessionStorage.setItem('recipe-seeded', '1');
    }
  }, { session, project, map });
  const open = async () => {
    await page.goto('/?intent=resume');
    await expect(page.locator('.leaflet-container').first()).toBeVisible();
    await page.locator('#ins-tab-annotate').click();
    const toggle = page.getByRole('button', { name: /^Drill plan/ });
    await expect(toggle).toBeVisible();
    // The saved accordion can already be open while its lazy controls load.
    // Inspect the toggle, not the deferred child's momentary visibility.
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(page.getByTestId('drill-plan-controls')).toBeVisible();
  };
  await open();
  const readPlan = async () => {
    const raw = await page.evaluate(() => localStorage.getItem('mapviewer.draft.v1'));
    return JSON.parse(raw.startsWith('gz1:') ? inflateRawSync(Buffer.from(raw.slice(4), 'base64')).toString('utf8') : raw).payload.drillPlan || null;
  };
  const controls = page.getByTestId('drill-plan-controls');
  await controls.getByRole('button', { name: "From the property's drill data" }).click();
  await expect(controls.getByLabel('Property results')).toHaveValue('r:Default');
  await controls.getByRole('button', { name: 'Load property data' }).click();
  await expect(controls.getByRole('button', { name: 'Build the drill plan' })).toBeEnabled();
  expect(await readPlan()).toBeNull();
  await controls.getByRole('button', { name: 'Build the drill plan' }).click();
  await expect(controls).toContainText('1 calculated results');
  await expect.poll(async () => (await readPlan())?.drillSource?.resultsRecipe?.version).toBe(3);
  const frozen = await readPlan();
  expect(frozen.results[0]).toMatchObject({ resultId: expected.id, approvedText: expected.line });
  version = 4; const reads = recipeReads;
  await open();
  await expect(controls).toContainText('Default v3');
  expect(recipeReads).toBe(reads);
  await controls.getByRole('button', { name: "From the property's drill data" }).click();
  await expect(controls.getByLabel('Property results')).toHaveValue('r:Default');
  await controls.getByRole('button', { name: 'Load property data' }).click();
  await expect(controls.getByRole('button', { name: 'Rebuild the drill plan' })).toBeEnabled();
  expect(await readPlan()).toEqual(frozen);
  await controls.getByRole('button', { name: 'Rebuild the drill plan' }).click();
  await expect(controls).toContainText('0 calculated results');
  await expect(controls).toContainText('Default v4');
});
