import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ listRecipes: vi.fn(), selectRecipe: () => null, pullPropertyResults: vi.fn() }));
vi.mock('../src/utils/propertyResults.js', () => api);
import { init, toggle, check, reset } from '../src/three-d/property-data.js';

const ref = (geologySource = 'lithology') => ({ kind: 'property', propertyId: 'p', propertyName: 'Property', latestAt: '2026-10-01T00:00:00.000Z', holes: 1, assays: 0, ...(geologySource === null ? {} : { geologySource }) });
const file = (name, role) => ({ name, role, text: 'synthetic' });
let project, E, say, tables, reads, figure, pauseSaving;
const clone = (x) => JSON.parse(JSON.stringify(x));
const client = { from(table) { reads.push(table); let paged = false; const q = { select: () => q, eq: () => q, is: () => q, order: () => q, gt: () => { paged = true; return q; }, limit: () => q, then: (yes) => Promise.resolve({ data: paged ? [] : tables[table] || [], error: null }).then(yes) }; return q; } };
const change = (id, value) => { const e = document.getElementById(id); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); };
const clickLoad = async () => { document.getElementById('drill-load').click(); await vi.waitFor(() => expect(document.getElementById('drill-load').disabled).toBe(false)); };
beforeEach(() => {
  api.listRecipes.mockReset().mockResolvedValue([]); api.pullPropertyResults.mockReset();
  api.pullPropertyResults.mockImplementation(async (_sb, _prop, opts) => ({ files: [file('property-collars.csv', 'collar'), ...(opts.geologySource === 'none' ? [] : [file(`property-${opts.geologySource}.csv`, 'litho')])], ref: ref(opts.geologySource) }));
  document.body.innerHTML = '<button id="drill-add"></button><div id="drill-pick" hidden><div id="drill-body"></div></div><div id="drill-notice" hidden><span id="drill-notice-text"></span></div><button id="drill-update"></button><button id="drill-dismiss"></button>';
  project = { files: [file('property-lithology.csv', 'litho'), file('old-legend.csv', 'lithlegend'), file('terrain.csv', 'topo')], settings: { drillSource: ref(), geology: { legend: [{ code: 'A', name: 'Custom', nameSet: true }] } } };
  figure = { id: 'figure' }; say = vi.fn(); pauseSaving = vi.fn(); reads = [];
  tables = { drill_import_batches: [{ id: 'b2', property_id: 'p', kind: 'collars', created_at: '2026-10-03T00:00:00Z', summary: { new: 1 } }], drill_collars: [{ hole_id: 'H', x: 1, y: 2, z: 3, depth: 10 }] };
  E = { getState: () => ({ ...project.settings, terrain: {}, usingSample: false }), getProject: () => clone(project), clearFiles: vi.fn(() => { project.files = []; project.settings.geology.legend = []; }), addFiles: vi.fn((files, opts) => { project.files = project.files.filter((old) => !files.some((fresh) => fresh.name === old.name)).concat(clone(files)); project.settings.drillSource = opts.drillSource; if (opts.geologyTitle !== undefined) project.settings.geology.title = opts.geologyTitle; }), loadProject: vi.fn(async (p, opts = {}) => { project = clone(p); if (opts.freshDrill) { const fresh = opts.freshDrill; project.files.push(...clone(fresh.files)); project.settings.geology.legend = []; project.settings.drillSource = clone(fresh.drillSource); if (fresh.geologyTitle !== undefined) project.settings.geology.title = fresh.geologyTitle; if (fresh.drillSource.resultsRecipe) project.settings.calloutMode = 'published'; } }), setStyle: vi.fn(), setGeology: vi.fn(async (o) => Object.assign(project.settings.geology, o)) };
  window.EM3D = E;
  init({ client: async () => client, current: () => figure, say, pauseSaving, listHomes: async () => ({ properties: [{ id: 'p', name: 'Property', orgName: 'Org' }] }) }); reset();
});

describe('explicit property geology source', () => {
  it('defaults legacy figures to lithology without changing their files when opening the picker', async () => {
    project.settings.drillSource = ref(null); const before = clone(project);
    await toggle(); expect(document.getElementById('drill-geology').value).toBe('lithology'); expect(project).toEqual(before);
  });
  it('omits the new heading option for a default lithology load', async () => {
    await toggle(); await clickLoad();
    expect(E.loadProject.mock.calls[0][1].freshDrill).not.toHaveProperty('geologyTitle');
    expect(E.clearFiles).not.toHaveBeenCalled(); expect(E.addFiles).not.toHaveBeenCalled();
    expect(E.setGeology).not.toHaveBeenCalled();
  });
  it('fresh alteration load replaces logs, resets custom labels and removes the previous uploaded legend, retaining terrain', async () => {
    await toggle(); change('drill-geology', 'alteration'); await clickLoad();
    expect(api.pullPropertyResults).toHaveBeenCalledWith(client, expect.anything(), expect.objectContaining({ geologySource: 'alteration', recipeName: null }));
    expect(project.files.map((f) => f.name)).toEqual(['terrain.csv', 'property-collars.csv', 'property-alteration.csv']);
    expect(project.settings.geology.legend).toEqual([]); expect(project.settings.drillSource.geologySource).toBe('alteration');
    expect(document.body.textContent).toContain('changing geology source also removes uploaded geology legends');
  });
  it('fresh no-geology load contains no logs or previous legend', async () => {
    await toggle(); change('drill-geology', 'none'); await clickLoad();
    expect(project.files.some((f) => ['litho', 'lithlegend'].includes(f.role))).toBe(false);
  });
  it('discards an in-flight load after source selection changes', async () => {
    let resolve; api.pullPropertyResults.mockImplementation(() => new Promise((r) => { resolve = r; }));
    await toggle(); document.getElementById('drill-load').click(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    change('drill-geology', 'alteration'); resolve({ files: [], ref: ref() }); await new Promise((r) => setTimeout(r, 0));
    expect(E.clearFiles).not.toHaveBeenCalled(); expect(say).not.toHaveBeenCalled(); expect(document.getElementById('drill-load').disabled).toBe(false);
  });
  it('sets the source heading with the files, without a delayed setter leaking into a different figure', async () => {
    let finish;
    E.setGeology.mockImplementation(() => new Promise((resolve) => { finish = () => { project.settings.geology.title = 'Alteration'; resolve(); }; }));
    api.pullPropertyResults.mockResolvedValue({ files: [file('property-collars.csv', 'collar')], ref: { ...ref('alteration'), resultsRecipe: { name: 'Recipe', version: 1 } } });
    await toggle(); change('drill-geology', 'alteration'); document.getElementById('drill-load').click();
    await vi.waitFor(() => expect(E.loadProject).toHaveBeenCalled());
    const callsBefore = E.setStyle.mock.calls.length;
    figure = { id: 'different' }; project.settings.geology.title = 'Other figure';
    finish?.(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(project.settings.geology.title).toBe('Other figure');
    expect(E.setStyle.mock.calls.length).toBe(callsBefore);
    expect(E.setGeology).not.toHaveBeenCalled();
    expect(E.loadProject).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ freshDrill: expect.objectContaining({ geologyTitle: 'Alteration' }) }));
    expect(E.addFiles).not.toHaveBeenCalled();
  });
  it('updates the saved alteration source while preserving custom legend labels', async () => {
    project.settings.drillSource = ref('alteration'); project.files = [file('property-alteration.csv', 'litho'), file('terrain.csv', 'topo')];
    const legend = clone(project.settings.geology.legend); await check(); document.getElementById('drill-update').click();
    await vi.waitFor(() => expect(E.loadProject).toHaveBeenCalled());
    expect(reads).toContain('drill_alteration'); expect(reads).not.toContain('drill_lithology');
    expect(project.settings.geology.legend).toEqual(legend); expect(project.settings.drillSource.geologySource).toBe('alteration');
    expect(project.files.some((f) => f.name === 'property-lithology.csv')).toBe(false);
  });
  it('refuses source-aware Update that would pool an uploaded geology log', async () => {
    project.files.push(file('user-geology.csv', 'litho')); await check(); document.getElementById('drill-update').click();
    await vi.waitFor(() => expect(say).toHaveBeenCalledWith(expect.stringContaining('uploaded geology')));
    expect(E.loadProject).not.toHaveBeenCalled(); expect(project.files.some((f) => f.name === 'user-geology.csv')).toBe(true);
  });
  it('refuses an uploaded log named after the opposite property source without deleting it', async () => {
    project.files.push(file('property-alteration.csv', 'litho')); await check(); document.getElementById('drill-update').click();
    await vi.waitFor(() => expect(say).toHaveBeenCalledWith(expect.stringContaining('uploaded geology')));
    expect(E.loadProject).not.toHaveBeenCalled(); expect(project.files.some((f) => f.name === 'property-alteration.csv')).toBe(true);
  });
  it('keeps legacy uploaded alteration-named files on ordinary Update', async () => {
    project.settings.drillSource = ref(null); project.files.push(file('property-alteration.csv', 'litho'));
    await check(); document.getElementById('drill-update').click(); await vi.waitFor(() => expect(E.loadProject).toHaveBeenCalled());
    expect(project.files.some((f) => f.name === 'property-alteration.csv')).toBe(true); expect(reads).not.toContain('drill_alteration');
    expect(project.settings.drillSource).not.toHaveProperty('geologySource');
  });
});


describe('property source replacement transactions', () => {
  it('keeps edits made while property data is downloading without starting any mutation', async () => {
    let resolve; api.pullPropertyResults.mockImplementation(() => new Promise(r => { resolve = r; }));
    await toggle(); document.getElementById('drill-load').click();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    project.settings.title = 'New user work';
    resolve({ files: [file('property-collars.csv', 'collar')], ref: ref() });
    await new Promise(r => setTimeout(r, 0));
    expect(E.loadProject).not.toHaveBeenCalled(); expect(E.clearFiles).not.toHaveBeenCalled(); expect(E.addFiles).not.toHaveBeenCalled();
    expect(project.settings.title).toBe('New user work');
    expect(project.files.some(f => f.name === 'terrain.csv')).toBe(true);
  });
  it('does not reload an old backup over a newer figure when the native loader is superseded', async () => {
    E.loadProject.mockImplementationOnce(async (_p, options) => {
      expect(options.isCurrent()).toBe(true);
      figure = { id: 'new-figure' }; project = { settings: { title: 'New user figure' }, files: [file('new.csv', 'topo')] };
      expect(options.isCurrent()).toBe(false);
      throw Object.assign(new Error('superseded'), { code: 'PROJECT_CHANGED' });
    });
    await toggle(); document.getElementById('drill-load').click();
    await vi.waitFor(() => expect(E.loadProject).toHaveBeenCalledOnce());
    await new Promise(r => setTimeout(r, 0));
    expect(E.loadProject).toHaveBeenCalledOnce(); expect(E.addFiles).not.toHaveBeenCalled(); expect(E.clearFiles).not.toHaveBeenCalled();
    expect(project.settings.title).toBe('New user figure'); expect(project.files[0].name).toBe('new.csv');
    expect(say).not.toHaveBeenCalled(); expect(pauseSaving).not.toHaveBeenCalled();
  });
  it('pauses unsafe saving and gives truthful copy after an unverified native restoration', async () => {
    E.loadProject.mockRejectedValueOnce(new Error('preview and recovery failed'));
    await toggle(); await clickLoad();
    expect(E.loadProject).toHaveBeenCalledOnce(); expect(pauseSaving).toHaveBeenCalledOnce();
    expect(document.getElementById('drill-progress').textContent).toContain('could not be fully restored');
    expect(document.getElementById('drill-progress').textContent).not.toContain('figure is unchanged');
    expect(E.clearFiles).not.toHaveBeenCalled(); expect(E.addFiles).not.toHaveBeenCalled();
  });
  it('does not roll back a stale manual update over newer source', async () => {
    await check();
    E.loadProject.mockImplementationOnce(async (_p, options) => {
      expect(options.isCurrent()).toBe(true);
      figure = { id: 'new-figure' }; project = { settings: { title: 'Fresh B', drillSource: null }, files: [file('B.csv', 'topo')] };
      throw Object.assign(new Error('superseded'), { code: 'PROJECT_CHANGED' });
    });
    document.getElementById('drill-update').click();
    await vi.waitFor(() => expect(E.loadProject).toHaveBeenCalledOnce());
    await new Promise(r => setTimeout(r, 0));
    expect(E.loadProject).toHaveBeenCalledOnce(); expect(project.files[0].name).toBe('B.csv');
    expect(say).not.toHaveBeenCalled(); expect(pauseSaving).not.toHaveBeenCalled();
  });
});
