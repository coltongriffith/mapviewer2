import { describe, it, expect, vi, beforeAll } from 'vitest';
import { snapshotOf, check } from '../src/three-d/property-data.js';

// A published version on screen and the drill database's newer-data notice
// (property-data.js, drill database 2B), through account-core.js as the page
// uses it: opening a version clears the live figure's notice and pending
// Update, a check still reading never shows over the version, Update never
// rewrites it, and going back to the figure checks again. Supabase is an
// in-memory fake behind the configured client.

const FIG = '00000000-0000-4000-8000-0000000000f1', PROP = 'p1';
const B1 = { property_id: PROP, id: 'b1', kind: 'collars', created_at: '2026-10-18T10:00:00.000Z', rolled_back_at: null, summary: { new: 1 } };
const B9 = { property_id: PROP, id: 'b9', kind: 'collars', created_at: '2026-10-21T10:00:00.000Z', rolled_back_at: null, summary: { new: 1 } };
const REF = snapshotOf({ propertyId: PROP, propertyName: 'Rails' }, [B1], { collars: [{ hole_id: 'RL-1', x: 1, y: 2, crs: 'EPSG:32610' }], surveys: [], assays: [], lithology: [] });
const FILES = [{ name: 'property-collars.csv', text: 'HoleID,X,Y\nRL-1,1,2' }];
const db = {
  three_d_projects: [{ id: FIG, name: 'Rails 3D', updated_at: '2026-10-21T09:00:00.000Z', deleted_at: null, org_id: null, property_id: null, file_paths: [],
    settings: { v: 1, settings: { title: 'LIVE', drillSource: REF }, files: FILES } }],
  figure_versions: [{ id: '00000000-0000-4000-8000-000000000901', figure_kind: 'figure', figure_id: FIG, version: 1, label: 'News release 2026-10-21', release_date: '2026-10-21',
    name: 'Rails 3D', content_hash: '1'.repeat(64), created_at: '2026-10-21T09:30:00.000Z', snapshot: { kind: 'figure', settings: { v: 1, settings: { title: 'V1', drillSource: REF }, files: FILES }, file_paths: [] } }],
  drill_import_batches: [B9, B1],
};
// Filters, order and limit as PostgREST, for the reads these modules make.
const sb = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'geo@star.test' } } }, error: null }), onAuthStateChange: () => {} },
  rpc: async () => ({ data: [], error: null }),
  from(table) {
    const eq = {}, is = {}, api = {
      select: () => api, order: () => api, limit: () => api, range: () => api,
      eq: (k, v) => { eq[k] = v; return api; }, is: (k) => { is[k] = true; return api; },
      rows: () => structuredClone((db[table] || []).filter((r) => Object.entries(eq).every(([k, v]) => String(r[k]) === String(v)) && Object.keys(is).every((k) => r[k] == null))),
      maybeSingle: async () => ({ data: api.rows()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: api.rows(), error: null }).then(res, rej),
    };
    return api;
  },
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => sb }));

let core, shown = null;
const E = {
  getState: () => ({ drillSource: shown?.settings.drillSource || null, brand: { title: shown?.settings.title }, ready: true }),
  getProject: () => structuredClone(shown || { v: 1, settings: {}, files: [] }),
  loadProject: vi.fn(async (p) => { shown = structuredClone(p); return E.getState(); }),
  filesDigest: () => '', exportPNG: () => 'data:image/png;base64,', getThumbnail: () => null,
};
const notice = () => document.getElementById('drill-notice');

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
  localStorage.setItem('sb-example-auth-token', '{}');
  document.body.innerHTML = '<aside class="panel"></aside><div class="toolbar"><div class="acct"></div></div><div id="status"></div>'
    + ['drill-pick', 'drill-body', 'drill-add', 'drill-notice-text'].map((id) => `<div id="${id}"></div>`).join('')
    + '<div id="drill-notice" hidden></div><button id="drill-update"></button><button id="drill-dismiss"></button><div id="lib-notice"></div>';
  window.EM3D = E;
  core = await import('../src/three-d/account-core.js');
});

describe('a published version and the drill database notice', () => {
  it('shows the notice for the live figure with newer imports', async () => {
    await core.openProject(FIG);
    await vi.waitFor(() => expect(notice().hidden).toBe(false));
    expect(document.getElementById('drill-notice-text').textContent).toMatch(/1 new hole/);
  });

  it('opening a version clears the notice and the pending Update, and Update never rewrites the version', async () => {
    const loads = E.loadProject.mock.calls.length;
    await core.openVersion(1);
    expect(E.getState().brand.title).toBe('V1');
    await vi.waitFor(() => expect(notice().hidden).toBe(true));
    expect(document.getElementById('lib-notice').hidden).toBe(true);
    document.getElementById('drill-update').click();
    await new Promise((r) => setTimeout(r, 20));
    expect(E.loadProject.mock.calls.length).toBe(loads + 1); // the version only
    expect(E.getState().brand.title).toBe('V1');
  });

  it('runs no newer-data check over the version: one still reading when it opened stays hidden', async () => {
    await check(); // what an in-flight check does when its read returns
    expect(notice().hidden).toBe(true);
    expect(core.drillFigure({ id: FIG }, { version: 1 })).toBeNull();
    expect(core.drillFigure({ id: FIG }, null)).toEqual({ id: FIG });
  });

  it('back at the live figure, the check runs again', async () => {
    await core.closeVersion();
    expect(E.getState().brand.title).toBe('LIVE');
    await vi.waitFor(() => expect(notice().hidden).toBe(false));
  });

  it('keeps a published recipe snapshot read-only while newer recipe results are available', async () => {
    const ref = { ...REF, resultsRecipe: { id: 'r1', name: 'Default', version: 3, recipe: { cutoff: 1 }, fileName: 'property-recipe-results.csv' } };
    db.three_d_projects[0].settings.settings.drillSource = structuredClone(ref);
    db.figure_versions[0].snapshot.settings.settings.drillSource = structuredClone(ref);
    // No newer import: this notice must come from the recipe alone.
    db.drill_import_batches = [B1];
    sb.rpc = vi.fn(async (fn) => ({ data: fn === 'drill_property_recipes' ? [{ ...ref.resultsRecipe, version: 4, recipe: { cutoff: 2 } }] : [], error: null }));
    await core.openProject(FIG);
    await vi.waitFor(() => expect(notice().hidden).toBe(false));
    expect(document.getElementById('drill-notice-text').textContent).toContain('changed from v3 to v4');
    await core.openVersion(1);
    const loads = E.loadProject.mock.calls.length, reads = sb.rpc.mock.calls.length;
    await check();
    document.getElementById('drill-update').click();
    await new Promise((r) => setTimeout(r, 20));
    expect(notice().hidden).toBe(true);
    expect(sb.rpc.mock.calls.length).toBe(reads);
    expect(E.loadProject.mock.calls.length).toBe(loads);
    expect(E.getState().drillSource).toEqual(ref);
    await core.closeVersion();
    await vi.waitFor(() => expect(notice().hidden).toBe(false));
    expect(E.getState().drillSource).toEqual(ref);
  });
});
