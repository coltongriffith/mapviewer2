import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ user: null, writes: [], uploads: [], removed: [], sessions: vi.fn(), rpc: vi.fn(), otp: vi.fn(), authChange: null, initialSession: false, onUpload: null,
  shareImports: 0, shareStart: vi.fn(), shareCreate: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getSession: mock.sessions, onAuthStateChange: fn => { mock.authChange = fn; if (mock.initialSession) fn('INITIAL_SESSION', { user: mock.user }); }, signOut: async () => ({}), signInWithOtp: mock.otp },
  rpc: mock.rpc,
  storage: { from: () => ({ upload: async (path) => { mock.uploads.push(path); await mock.onUpload?.(); return {}; }, remove: async paths => { mock.removed.push(...paths); return {}; } }) },
  from: () => {
    let row;
    const api = { select: () => api, eq: () => api, is: () => api,
      upsert: value => { row = value; mock.writes.push(value); return api; },
      single: async () => ({ data: row }), maybeSingle: async () => ({ data: null }) };
    return api;
  },
}) }));
vi.mock('../src/three-d/track.js', () => ({ track: vi.fn() }));
vi.mock('../src/three-d/share.js', () => {
  mock.shareImports++;
  return { start: mock.shareStart, create: mock.shareCreate, update: vi.fn(), revoke: vi.fn(), list: vi.fn(), openDialog: vi.fn() };
});

const nonce = 'b2'.repeat(16), stashKey = 'em3d.pendingSave.v1';
let project, loadProject, idb, originalStash;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
  history.replaceState(null, '', `/3d/#local-restore=${nonce}`);
  localStorage.clear();
  originalStash = JSON.stringify({ at: Date.now(), intent: 'save', id: 'old-cloud-target', name: 'Other tab', project: { v: 1, settings: { title: 'Other tab' }, files: [] } });
  localStorage.setItem(stashKey, originalStash); localStorage.setItem(`${stashKey}.flag`, '1');
  localStorage.setItem('sb-example-auth-token', '{}');
  const html = new DOMParser().parseFromString(readFileSync('3d/index.html', 'utf8'), 'text/html');
  document.body.innerHTML = html.body.innerHTML;
  document.getElementById('acct-dialog').showModal = function () { this.open = true; };
  document.getElementById('acct-dialog').close = function () { this.open = false; };
  project = { v: 1, settings: { title: 'Restored figure' }, files: [{ name: 'qa.csv', text: '\uFEFFHoleID,X,Y\r\nA,1,2' }] };
  loadProject = vi.fn(async p => { project = structuredClone(p); });
  window.EM3D = { getProject: () => structuredClone(project), getState: () => ({ ready: true, brand: { title: project.settings.title } }),
    filesDigest: () => JSON.stringify(project.files), loadProject, getThumbnail: () => null, help: () => '' };
  mock.user = { id: 'user-a', email: 'a@example.test' }; mock.writes = []; mock.uploads = []; mock.removed = []; mock.authChange = null; mock.initialSession = false; mock.onUpload = null;
  mock.sessions.mockReset().mockImplementation(async () => ({ data: { session: mock.user ? { user: mock.user } : null } }));
  mock.rpc.mockReset().mockResolvedValue({ data: [] });
  mock.otp.mockReset().mockResolvedValue({});
  mock.shareImports = 0; mock.shareStart.mockReset().mockResolvedValue(); mock.shareCreate.mockReset().mockResolvedValue({ id: 'synthetic-share' });
  idb = vi.fn(() => { throw new Error('Restore must not inspect the shared stash'); });
  vi.stubGlobal('indexedDB', { open: idb });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });
const stashUnchanged = () => {
  expect(localStorage.getItem(stashKey)).toBe(originalStash);
  expect(localStorage.getItem(`${stashKey}.flag`)).toBe('1');
  expect(idb).not.toHaveBeenCalled();
};

describe('fresh local restore account document', () => {
  it('account entry does not eagerly boot or expose actions while receipt is unfinished', async () => {
    await import('../src/three-d/account.js');
    await expect(window.EM3D.account.getUser()).rejects.toThrow(/Finish opening/);
    expect(mock.sessions).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
    expect(loadProject).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
    stashUnchanged();
  });

  it('blocks every public sharing/version entry before readiness without importing, RPC or creator-key writes', async () => {
    await import('../src/three-d/account.js');
    const before = { ...localStorage };
    const share = window.EM3D.share, account = window.EM3D.account;
    for (const action of [() => share.create(), () => share.update('old'), () => share.revoke('old'), () => share.list(), () => share.open(),
      () => account.publishVersion({ label: 'not-ready' }), () => account.listVersions(), () => account.openVersion(1), () => account.closeVersion()]) {
      await expect(action()).rejects.toThrow(/Finish opening/);
    }
    expect(mock.shareImports).toBe(0); expect(mock.shareStart).not.toHaveBeenCalled(); expect(mock.shareCreate).not.toHaveBeenCalled();
    expect(mock.sessions).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
    expect({ ...localStorage }).toEqual(before); expect(localStorage.getItem('em_share_key')).toBeNull(); stashUnchanged();
  });

  it.each(['ordinary', 'ready restore'])('preserves the existing sharing entry after %s startup', async mode => {
    if (mode === 'ordinary') history.replaceState(null, '', '/3d');
    else (await import('../src/three-d/local-restore-context.js')).markLocalRestoreReady();
    await import('../src/three-d/account.js');
    await expect(window.EM3D.share.create()).resolves.toEqual({ id: 'synthetic-share' });
    // Vitest retains the mock factory across resetModules; delegation still
    // has to initialize the sharing facade once in each fresh account entry.
    expect(mock.shareStart).toHaveBeenCalledOnce(); expect(mock.shareCreate).toHaveBeenCalledOnce();
  });

  it('refuses unready direct account startup/save even for malformed mixed intent', async () => {
    history.replaceState(null, '', `/3d/?project=old-cloud-target&version=2#local-restore=${nonce}`);
    const core = await import('../src/three-d/account-core.js');
    expect(() => core.start()).toThrow(/Finish opening/);
    await expect(core.saveProject('No write')).rejects.toMatchObject({ code: 'LOCAL_RESTORE_PENDING' });
    expect(mock.sessions).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]); stashUnchanged();
  });

  it('first lazy account startup after success stays new/dirty and never redeems old intent', async () => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    const core = await import('../src/three-d/account-core.js');
    await core.start({ baseline: structuredClone(project) });
    expect(core.currentProject()).toBeNull(); expect(core.tourSharingContext()).toMatchObject({ project: null, readOnly: false });
    expect(document.getElementById('acct-note')).toHaveTextContent('Unsaved changes');
    expect(mock.sessions).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled(); expect(loadProject).not.toHaveBeenCalled();
    expect(await core.readStash()).toBeNull(); expect(await core.stashWork({ id: 'replacement' })).toBe(false); await core.clearStash();
    stashUnchanged();
  });

  it('ordinary explicit Save names a new target and checks the current signed-in user', async () => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    const core = await import('../src/three-d/account-core.js'); await core.start({ baseline: project });
    mock.user = { id: 'user-b', email: 'b@example.test' }; // account changed while the local file was opening
    await core.save();
    expect(document.getElementById('acct-name')).toHaveValue('Restored figure');
    expect(document.getElementById('acct-dialog').open).toBe(true); expect(mock.writes).toEqual([]);
    const saved = await core.saveProject('Restored figure');
    expect(saved.id).not.toBe('old-cloud-target'); expect(mock.writes).toHaveLength(1);
    expect(mock.uploads[0]).toMatch(/^user-b\//); expect(core.currentProject().id).toBe(saved.id);
    stashUnchanged();
  });

  it('notifies waiting opener flows of account changes without leaking identity or refreshing tokens', async () => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    const core = await import('../src/three-d/account-core.js');
    await core.getUser();
    const events = [], listener = event => events.push(event);
    window.addEventListener('em3d:account-context', listener);
    try {
      const before = core.tourSharingContext().epoch;
      mock.authChange('TOKEN_REFRESHED'); expect(core.tourSharingContext().epoch).toBe(before);
      expect(events).toHaveLength(0);
      mock.authChange('SIGNED_OUT'); expect(core.tourSharingContext().epoch).toBe(before + 1);
      expect(events).toHaveLength(1); expect(events[0].detail).toBeUndefined();
      expect(Object.keys(events[0])).not.toContain('user');
    } finally { window.removeEventListener('em3d:account-context', listener); }
    stashUnchanged();
  });

  it('refuses restored-tab email sign-in before any send or shared pending-work changes', async () => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    const core = await import('../src/three-d/account-core.js'); await core.start({ baseline: project });
    mock.user = null; await core.save();
    const before = structuredClone(project);
    document.getElementById('acct-email').value = 'qa@example.test';
    document.getElementById('acct-form').dispatchEvent(new SubmitEvent('submit', {
      bubbles: true, cancelable: true, submitter: document.getElementById('acct-link-btn'),
    }));
    await vi.waitFor(() => expect(document.getElementById('acct-error')).toHaveTextContent('Sign in in another tab, then return and Save this figure.'));
    expect(mock.otp).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
    expect(core.currentProject()).toBeNull(); expect(project).toEqual(before); stashUnchanged();
  });

  it('keeps ordinary non-restore email sign-in behavior available', async () => {
    history.replaceState(null, '', '/3d');
    const core = await import('../src/three-d/account-core.js');
    await core.sendSignInLink('qa@example.test');
    expect(mock.otp).toHaveBeenCalledOnce();
    expect(mock.otp.mock.calls[0][0].email).toBe('qa@example.test');
  });

  it('keeps an initial session and repeated same-user sign-in active during the first save', async () => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    mock.initialSession = true;
    const core = await import('../src/three-d/account-core.js'); await core.start({ baseline: project });
    mock.onUpload = async () => { mock.authChange('SIGNED_IN', { user: mock.user }); };
    const saved = await core.saveProject('First save');
    expect(saved.active).toBe(true); expect(core.currentProject().id).toBe(saved.id);
    expect(mock.writes).toHaveLength(1); expect(mock.removed).toEqual([]); stashUnchanged();
  });

  it.each(['SIGNED_IN', 'SIGNED_OUT'])('refuses a row write after a real %s identity change during upload', async event => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    const core = await import('../src/three-d/account-core.js'); await core.start({ baseline: project });
    await core.getUser();
    mock.onUpload = async () => { mock.authChange(event, event === 'SIGNED_OUT' ? null : { user: { id: 'user-b' } }); };
    await expect(core.saveProject('Must not commit')).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    expect(mock.writes).toEqual([]); expect(mock.removed).toEqual(mock.uploads);
    expect(core.currentProject()).toBeNull(); stashUnchanged();
  });

  it('refuses a stale session response after an account changes while getUser waits', async () => {
    const context = await import('../src/three-d/local-restore-context.js'); context.markLocalRestoreReady();
    const core = await import('../src/three-d/account-core.js'); await core.start({ baseline: project }); await core.getUser();
    mock.sessions.mockImplementationOnce(async () => {
      mock.authChange('SIGNED_IN', { user: { id: 'user-b' } });
      return { data: { session: { user: mock.user } } }; // an older request's user-a result
    });
    await expect(core.saveProject('Must not upload')).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    expect(mock.uploads).toEqual([]); expect(mock.writes).toEqual([]); stashUnchanged();
  });
});
