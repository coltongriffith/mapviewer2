import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ sessions: vi.fn(), writes: [], uploads: [], upload: null, download: vi.fn(), authChange: null, user: { id: 'user-a', email: 'a@example.test' } }));
vi.mock('../src/three-d/track.js', () => ({ track: vi.fn() }));
vi.mock('../src/utils/svg.js', () => ({ downloadBlob: mock.download }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getSession: mock.sessions, onAuthStateChange: fn => { mock.authChange = fn; fn('INITIAL_SESSION', { user: mock.user }); } },
  rpc: async () => ({ data: [] }),
  storage: { from: () => ({ upload: async (path, raw) => { mock.uploads.push({ path, raw }); await mock.upload?.(); return {}; }, remove: async () => ({}) }) },
  from: () => {
    let row;
    const q = { select: () => q, eq: () => q, is: () => q, upsert: value => { row = value; mock.writes.push(value); return q; },
      single: async () => ({ data: row }), maybeSingle: async () => ({ data: { id: 'explicit-b', name: 'Explicit B', updated_at: '2026-11-03T00:00:00Z', settings: figure('Explicit B') } }) };
    return q;
  },
}) }));
const key = 'em3d.pendingSave.v1', flag = `${key}.flag`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const figure = title => ({ v: 1, settings: { title }, files: [{ name: 'raw.csv', text: '\uFEFFID,Value\r\nA,12tail', role: 'geophys', geophysNumericPolicy: 'future-policy' }] });
const entry = overrides => ({ at: Date.now(), intent: 'save', name: 'Pending A', id: null, project: figure('Pending A'), ...overrides });
const text = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(reader.result)); reader.readAsArrayBuffer(blob); });
let core, project, load;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
  history.replaceState(null, '', '/3d'); localStorage.clear(); localStorage.setItem('sb-example-auth-token', '{}');
  const html = new DOMParser().parseFromString(readFileSync('3d/index.html', 'utf8'), 'text/html'); document.body.innerHTML = html.body.innerHTML;
  document.getElementById('acct-dialog').showModal = function () { this.open = true; };
  document.getElementById('acct-dialog').close = function () { this.open = false; };
  project = figure('Sample'); mock.writes = []; mock.uploads = []; mock.upload = null; mock.authChange = null;
  mock.user = { id: 'user-a', email: 'a@example.test' }; mock.sessions.mockImplementation(async () => ({ data: { session: mock.user ? { user: mock.user } : null } }));
  mock.download.mockResolvedValue();
  load = vi.fn(async (p, options) => { expect(options.isCurrent()).toBe(true); project = structuredClone(p); });
  window.EM3D = { getProject: () => structuredClone(project), getState: () => ({ ready: true, brand: { title: project.settings.title } }), filesDigest: () => JSON.stringify(project.files),
    loadProject: load, getThumbnail: () => null, getRecoveryProject: () => null, help: () => '' };
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('Use local fallback'); } });
  core = await import('../src/three-d/account-core.js');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); history.replaceState(null, '', '/'); });
const seed = raw => { localStorage.setItem(key, raw); localStorage.setItem(flag, '1'); };
function installIDB(initial) {
  const data = new Map(initial ? [[key, structuredClone(initial)]] : []);
  const db = { close: vi.fn(), transaction: () => {
    const tx = {}, finish = request => { queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return request; };
    const store = { get: name => finish({ result: structuredClone(data.get(name)) }), put: (value, name) => { data.set(name, structuredClone(value)); return finish({ result: name }); }, delete: name => { data.delete(name); return finish({ result: undefined }); } };
    tx.objectStore = () => store; return tx;
  } };
  vi.stubGlobal('indexedDB', { open: () => { const req = { result: db }; queueMicrotask(() => req.onsuccess?.()); return req; } });
  return data;
}
describe('normal sign-in pending work receipt and cleanup', () => {
  it('restores and autosaves the exact pending source on the ordinary email return including initial session observation', async () => {
    const pending = entry(), raw = JSON.stringify(pending); seed(raw);
    await core.start({ baseline: project });
    expect(load).toHaveBeenCalledOnce(); expect(project).toEqual(pending.project);
    expect(mock.writes).toHaveLength(1); expect(mock.writes[0].settings.settings.title).toBe('Pending A');
    expect(mock.uploads[0].raw).toBe(pending.project.files[0].text);
    expect(mock.writes[0].file_paths[0].geophysNumericPolicy).toBe('future-policy');
    expect(core.currentProject().id).toBe(mock.writes[0].id);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(flag)).toBe('1'); // no revision: conditional cleanup cannot prove flag ownership
  });
  it('preserves a failed receipt and never autosaves the pre-existing figure under its target', async () => {
    const pending = entry({ id: 'old-a' }), raw = JSON.stringify(pending); seed(raw);
    load.mockRejectedValueOnce(Object.assign(new Error('saved logo failed'), { stateRestored: true }));
    await core.start({ baseline: project });
    expect(load).toHaveBeenCalledOnce(); expect(project.settings.title).toBe('Sample');
    expect(mock.writes).toEqual([]); expect(mock.uploads).toEqual([]);
    expect(localStorage.getItem(key)).toBe(raw); expect(localStorage.getItem(flag)).toBe('1');
    expect(location.search).toBe(''); expect(document.getElementById('acct-recovery')).not.toBeNull();
  });
  it.each(['?project=explicit-b', '?project=explicit-b&version=garbled'])('does not redeem pending A over an explicit URL %s', async query => {
    history.replaceState(null, '', `/3d${query}`); const raw = JSON.stringify(entry()); seed(raw);
    await core.start({ baseline: project });
    expect(load).toHaveBeenCalledOnce(); expect(load.mock.calls[0][0].settings.title).toBe('Explicit B');
    expect(project.settings.title).toBe('Explicit B'); expect(mock.writes).toEqual([]);
    expect(localStorage.getItem(key)).toBe(raw); expect(location.search).toBe(query);
  });
  it('does not replace an edit made while pending storage is being read', async () => {
    const raw = JSON.stringify(entry()); seed(raw);
    const starting = core.start({ baseline: project }); project.settings.title = 'New user edit'; await starting;
    expect(load).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
    expect(project.settings.title).toBe('New user edit'); expect(localStorage.getItem(key)).toBe(raw);
  });
  it('does not autosave or clear when the restored figure is edited during the account check', async () => {
    const gate = deferred(), raw = JSON.stringify(entry()); seed(raw); mock.sessions.mockReturnValue(gate.promise);
    const starting = core.start({ baseline: project }); await vi.waitFor(() => expect(mock.sessions).toHaveBeenCalled());
    project.settings.title = 'Newer restored edit'; gate.resolve({ data: { session: { user: mock.user } } }); await starting;
    expect(mock.writes).toEqual([]); expect(mock.uploads).toEqual([]); expect(project.settings.title).toBe('Newer restored edit');
    expect(localStorage.getItem(key)).toBe(raw); expect(core.currentProject()).toBeNull(); expect(location.search).toBe('');
  });
  it('does not issue an autosave row or clear pending work after an edit during uploads', async () => {
    const gate = deferred(), entered = deferred(), raw = JSON.stringify(entry()); seed(raw);
    mock.upload = async () => { entered.resolve(); await gate.promise; };
    const starting = core.start({ baseline: project }); await entered.promise;
    project.settings.title = 'Newest local edit'; gate.resolve(); await starting;
    expect(mock.writes).toEqual([]); expect(project.settings.title).toBe('Newest local edit');
    expect(localStorage.getItem(key)).toBe(raw); expect(core.currentProject()).toBeNull(); expect(location.search).toBe('');
  });
  it('does not overwrite a new explicit route selected while autosave uploads are pending', async () => {
    const gate = deferred(), entered = deferred(), raw = JSON.stringify(entry()); seed(raw);
    mock.upload = async () => { entered.resolve(); await gate.promise; };
    const starting = core.start({ baseline: project }); await entered.promise;
    history.replaceState(null, '', '/3d?project=new-route'); gate.resolve(); await starting;
    expect(mock.writes).toEqual([]); expect(location.search).toBe('?project=new-route'); expect(localStorage.getItem(key)).toBe(raw);
  });
});
describe('pending recovery evidence and compare-and-delete', () => {
  it.each(['\uFEFF{broken JSON\r\nprivate-é', JSON.stringify(entry({ at: Date.now() - 8 * 24 * 3600 * 1000 }))])('retains nonredeemable local text byte-for-byte and offers a private recovery download', async raw => {
    seed(raw); await core.start({ baseline: project });
    expect(load).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]); expect(localStorage.getItem(key)).toBe(raw);
    document.getElementById('acct-recovery').click(); await vi.waitFor(() => expect(mock.download).toHaveBeenCalledOnce());
    expect(mock.download.mock.calls[0][0]).toBe('pending-signin-recovery.json');
    expect(await text(mock.download.mock.calls[0][1])).toBe(raw);
    expect(localStorage.getItem(key)).toBe(raw); expect(localStorage.getItem(flag)).toBe('1');
  });
  it('preserves all fields of an expired native IDB record in recovery JSON', async () => {
    const original = entry({ at: Date.now() - 8 * 24 * 3600 * 1000, unknownMetadata: { source: 'retain exactly' } }), data = installIDB(original);
    await core.start({ baseline: project }); expect(load).not.toHaveBeenCalled();
    document.getElementById('acct-recovery').click(); await vi.waitFor(() => expect(mock.download).toHaveBeenCalledOnce());
    expect(JSON.parse(await text(mock.download.mock.calls[0][1]))).toEqual(original);
    expect(data.get(key)).toEqual(original);
  });
  it('cannot delete newer IDB or local pending data using an older receipt', async () => {
    const old = entry(), data = installIDB(old); seed(JSON.stringify(old));
    const expected = await core.readStash(), newer = entry({ name: 'Newer other-tab intent', project: figure('Other tab') }), newerRaw = JSON.stringify(newer);
    data.set(key, structuredClone(newer)); seed(newerRaw);
    expect(await core.clearStash(expected)).toBe(false);
    expect(data.get(key)).toEqual(newer); expect(localStorage.getItem(key)).toBe(newerRaw); expect(localStorage.getItem(flag)).toBe('1');
    await core.clearStash(); expect(data.has(key)).toBe(false); expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(flag)).toBeNull();
  });
  it('conditionally deletes only its own unchanged IDB/local record, retaining the unversioned flag', async () => {
    const original = entry(), data = installIDB(original); seed(JSON.stringify(original));
    const expected = await core.readStash(); expect(await core.clearStash(expected)).toBe(true);
    expect(data.has(key)).toBe(false); expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(flag)).toBe('1');
  });
  it('honours a context invalidation before the IDB delete rather than deleting the only pending copy', async () => {
    const original = entry(), data = installIDB(original); seed(JSON.stringify(original)); const expected = await core.readStash();
    expect(await core.clearStash(expected, { isCurrent: () => false })).toBe(false);
    expect(data.get(key)).toEqual(original); expect(localStorage.getItem(key)).toBe(JSON.stringify(original));
  });
});
