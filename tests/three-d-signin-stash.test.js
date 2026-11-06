import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The "save after the sign-in link" path: tab A stashes the figure and sends a
// link, the link opens a fresh /3d that restores the stash and saves it.
// docs/state-machines.md, 3D-1 and 3D-2.

const T0 = '2026-10-01T00:00:00.000Z';
const T1 = '2026-10-02T00:00:00.000Z';
const stashKey = 'em3d.pendingSave.v1';
const db = vi.hoisted(() => ({ rows: new Map(), uploads: [], failUploads: 0 }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'u1@example.test' } } } }),
    onAuthStateChange: () => {}, signOut: async () => ({}), signInWithOtp: async () => ({}),
  },
  rpc: async () => ({ data: [] }),
  storage: { from: () => ({
    upload: async (path) => {
      if (db.failUploads > 0) { db.failUploads -= 1; return { error: new Error('Network down') }; }
      db.uploads.push(path); return {};
    },
    remove: async () => ({}),
  }) },
  from: () => {
    const filters = {}; let write = null, update = false;
    const result = async () => {
      const row = [...db.rows.values()].find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      if (!write) return { data: row ? structuredClone(row) : null };
      if (update && !row) return { data: null };
      db.rows.set(write.id, { ...db.rows.get(write.id), ...structuredClone(write) });
      return { data: structuredClone(db.rows.get(write.id)) };
    };
    const api = {
      select: () => api, eq: (k, v) => { filters[k] = v; return api; }, is: (k, v) => { filters[k] = v; return api; },
      update: (r) => { write = r; update = true; return api; }, upsert: (r) => { write = r; return api; },
      single: result, maybeSingle: result,
    };
    return api;
  },
}) }));
vi.mock('../src/three-d/track.js', () => ({ track: vi.fn() }));

let project, core;
const figure = (title) => ({ v: 1, settings: { title }, files: [{ name: 'collars.csv', text: 'HoleID,X,Y\nA,1,2' }] });
const stash = (extra) => localStorage.setItem(stashKey, JSON.stringify({ at: Date.now(), intent: 'save', name: 'Figure X', project: figure('Stashed copy'), ...extra }));
const stashed = () => localStorage.getItem(stashKey);
const dialogMode = () => (document.getElementById('acct-conflict').hidden ? null : 'conflict');

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
  vi.stubGlobal('indexedDB', undefined);
  history.replaceState(null, '', '/3d/');
  localStorage.clear();
  localStorage.setItem('sb-example-auth-token', '{}');
  localStorage.setItem(`${stashKey}.flag`, '1');
  db.rows = new Map([['x', { id: 'x', name: 'Figure X', updated_at: T0, deleted_at: null, settings: figure('Saved X'), file_paths: [] }]]);
  db.uploads = []; db.failUploads = 0;
  const html = new DOMParser().parseFromString(readFileSync('3d/index.html', 'utf8'), 'text/html');
  document.body.innerHTML = html.body.innerHTML;
  document.getElementById('acct-dialog').showModal = function () { this.open = true; };
  document.getElementById('acct-dialog').close = function () { this.open = false; };
  project = figure('Sample');
  window.EM3D = {
    getProject: () => structuredClone(project), getState: () => ({ ready: true, brand: { title: project.settings.title } }),
    filesDigest: () => JSON.stringify(project.files), loadProject: async (p) => { project = structuredClone(p); },
    getThumbnail: () => null, help: () => '',
  };
  core = await import('../src/three-d/account-core.js');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

describe('sign-in link stash replay', () => {
  it('3D-1: saves the stash over the figure it was taken from when nothing changed since', async () => {
    stash({ id: 'x', savedAt: T0 });
    await core.start();
    expect(db.rows.get('x').settings.settings.title).toBe('Stashed copy');
    expect(stashed()).toBeNull();
  });

  it('3D-1: a figure saved elsewhere since the stash shows the conflict instead of being overwritten', async () => {
    stash({ id: 'x', savedAt: T0 });
    db.rows.get('x').updated_at = T1;
    await core.start();
    expect(db.rows.get('x').settings.settings.title).toBe('Saved X');
    expect(dialogMode()).toBe('conflict');
  });

  it('3D-1: an old stash without a base version is never written over the figure', async () => {
    stash({ id: 'x' });
    await core.start();
    expect(db.rows.get('x').settings.settings.title).toBe('Saved X');
    expect(db.rows.size).toBe(1);
    // Kept as the recovery copy until this tab saves it as a new figure.
    expect(stashed()).not.toBeNull();
    expect(core.currentProject()).toBeNull();
  });

  it('3D-1: after a failed replay, the next successful save in that tab clears the stash', async () => {
    stash({ id: 'x', savedAt: T0 });
    db.failUploads = 1;
    await core.start();
    expect(stashed()).not.toBeNull();
    await core.save();
    expect(db.rows.get('x').settings.settings.title).toBe('Stashed copy');
    expect(stashed()).toBeNull();
  });

  it('3D-2: a company figure replayed from the stash keeps its files in the company folder', async () => {
    db.rows.get('x').org_id = 'o1';
    stash({ id: 'x', savedAt: T0, home: { orgId: 'o1', propertyId: 'p1', role: 'editor', orgName: 'Co' } });
    await core.start();
    expect(db.uploads.length).toBeGreaterThan(0);
    expect(db.uploads.every((p) => p.startsWith('org/o1/x/'))).toBe(true);
  });
});
