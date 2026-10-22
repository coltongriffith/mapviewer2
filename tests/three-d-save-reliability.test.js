import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { figureSignature, watchUnsavedFigure } from '../src/three-d/save-state.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let rows, objects, upload, afterCommit, core, project, stop;
const sb = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => {}, signOut: async () => ({}),
  },
  storage: { from: () => ({
    upload: async (path, text) => { await upload(path); objects.set(path, text); return {}; },
    download: async (path) => ({ data: { text: async () => objects.get(path) } }),
    remove: async (paths) => { paths.forEach((path) => objects.delete(path)); return {}; },
    list: async (root) => ({ data: [...new Set([...objects.keys()].filter((p) => p.startsWith(root + '/')).map((p) => p.slice(root.length + 1).split('/')[0]))].map((name) => ({ name, id: name.includes('.') ? name : null })) }),
  }) },
  from() {
    const filters = {}; let write = null, update = false;
    const result = async () => {
      const row = [...rows.values()].find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      if (!write) return { data: structuredClone(row ?? null) };
      if (update && !row) return { data: null };
      rows.set(write.id, structuredClone(write));
      return await afterCommit(write) || { data: structuredClone(write) };
    };
    const api = {
      select: () => api, eq: (k, v) => { filters[k] = v; return api; }, is: (k, v) => { filters[k] = v; return api; },
      update: (r) => { write = r; update = true; return api; }, upsert: (r) => { write = r; return api; },
      single: result, maybeSingle: result,
    };
    return api;
  },
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => sb }));
vi.mock('../src/three-d/track.js', () => ({ track: vi.fn() }));

const figure = (title) => ({ v: 1, settings: { title }, files: [{ name: 'collars.csv', text: 'HoleID,X,Y\nA,1,2' }] });
const row = (id, title) => ({ id, name: title, updated_at: '2026-10-01T00:00:00.000Z', deleted_at: null, settings: figure(title), file_paths: [] });
const state = () => ({ ready: true, brand: { title: project.settings.title } });
const edit = (title) => { project.settings.title = title; window.dispatchEvent(new CustomEvent('em3d:change', { detail: state() })); };
const wouldWarn = () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
  localStorage.setItem('sb-example-auth-token', '{}');
  rows = new Map([['a', row('a', 'Original')], ['b', row('b', 'Other figure')]]);
  objects = new Map(); upload = async () => {}; afterCommit = async () => null;
  project = figure('Sample');
  document.body.innerHTML = '<div id="acct-note" hidden></div><div id="acct-menu" hidden></div><div id="status"></div><button id="acct-save"></button>';
  window.EM3D = {
    getState: state, getProject: () => structuredClone(project), filesDigest: () => JSON.stringify(project.files),
    getThumbnail: () => null, loadProject: async (p) => { project = structuredClone(p); },
  };
  stop = watchUnsavedFigure({ initial: structuredClone(project), signature: (p = project) => figureSignature(p, window.EM3D.filesDigest()), note: document.getElementById('acct-note') });
  core = await import('../src/three-d/account-core.js');
});
afterEach(() => { stop(); vi.unstubAllEnvs(); });

describe('3D save reliability through the real account module', () => {
  it('warns about an anonymous unsaved figure, including an edit before its change event', () => {
    expect(wouldWarn()).toBe(false);
    edit('My work');
    expect(document.getElementById('acct-note').hidden).toBe(false);
    expect(wouldWarn()).toBe(true);
    edit('Sample');
    expect(wouldWarn()).toBe(false);
    project.files[0].text += '\nB,3,4';
    expect(wouldWarn()).toBe(true);
  });

  it('keeps edits made during a UI save dirty, then clears the warning after the next save', async () => {
    await core.openProject('a');
    edit('Uploaded snapshot');
    const gate = deferred(), started = deferred();
    upload = async () => { started.resolve(); await gate.promise; };
    const saving = core.save();
    await started.promise;
    edit('Newer work');
    gate.resolve(); await saving;
    expect(rows.get('a').settings.settings.title).toBe('Uploaded snapshot');
    expect(document.getElementById('acct-note').textContent).toBe('Unsaved changes');
    expect(wouldWarn()).toBe(true);
    expect(document.getElementById('status').textContent).toContain('Newer changes still need saving');
    await core.save();
    expect(rows.get('a').settings.settings.title).toBe('Newer work');
    expect(wouldWarn()).toBe(false);
  });

  it('does not delete another tab’s uploaded revision when this save finishes', async () => {
    await core.openProject('a');
    const nextPath = 'u1/a/next-revision/collars.csv';
    afterCommit = async () => { objects.set(nextPath, 'Other tab data'); };
    await core.saveProject('First tab', 'a');
    expect(objects.get(nextPath)).toBe('Other tab data');
    // The other tab can now commit the revision it uploaded while our save finished.
    rows.get('a').file_paths = [{ name: 'collars.csv', path: nextPath }];
    await core.openProject('a');
    expect(project.files[0].text).toBe('Other tab data');
  });

  it('keeps the newly opened figure selected when an earlier save completes', async () => {
    await core.openProject('a');
    const gate = deferred(), started = deferred();
    upload = async () => { started.resolve(); await gate.promise; };
    const saving = core.save(); await started.promise;
    await core.openProject('b');
    gate.resolve(); await saving;
    expect(core.currentProject().id).toBe('b');
    expect(state().brand.title).toBe('Other figure');
    expect(wouldWarn()).toBe(false);
  });

  it('does not reattach a figure after signing out during its save', async () => {
    await core.openProject('a');
    const gate = deferred(), started = deferred();
    upload = async () => { started.resolve(); await gate.promise; };
    const saving = core.saveProject('Original', 'a'); await started.promise;
    await core.signOut(); gate.resolve();
    expect((await saving).active).toBe(false);
    expect(core.currentProject()).toBeNull();
  });

  it('retains files when a commit succeeds but its response is lost', async () => {
    await core.openProject('a');
    afterCommit = async () => ({ error: new TypeError('Failed to fetch') });
    await expect(core.saveProject('Original', 'a')).rejects.toThrow(/Check your connection/);
    for (const file of rows.get('a').file_paths) expect(objects.has(file.path)).toBe(true);
  });

  it('waits for every upload before cleaning up a failed save', async () => {
    await core.openProject('a');
    project.files.push({ name: 'assays.csv', text: 'HoleID,From,To,Au\nA,0,1,2' });
    const gate = deferred(), started = deferred();
    upload = async (path) => {
      if (path.endsWith('collars.csv')) throw new Error('Storage is down');
      started.resolve(); await gate.promise;
    };
    const saving = core.saveProject('Original', 'a');
    const rejected = expect(saving).rejects.toThrow(/Storage is down/);
    await started.promise; gate.resolve(); await rejected;
    expect(objects.size).toBe(0);
    expect(rows.get('a').updated_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rejects an intervening save and preserves that revision’s files', async () => {
    await core.openProject('a');
    upload = async () => { rows.get('a').updated_at = '2099-01-01T00:00:00Z'; objects.set('u1/a/other/collars.csv', 'Other'); };
    await expect(core.saveProject('Original', 'a')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect([...objects.keys()]).toEqual(['u1/a/other/collars.csv']);
  });
});
