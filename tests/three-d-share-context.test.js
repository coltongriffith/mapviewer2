import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), context: vi.fn(), ready: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/three-d/account-core.js', () => ({ client: mocks.client, getUser: mocks.getUser, saveProject: vi.fn(), captureFigureContext: mocks.context, requireFigureReady: mocks.ready }));
vi.mock('../src/three-d/track.js', () => ({ track: vi.fn() }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
let share, project, target, epoch;
const id = 'a'.repeat(32);
const figure = title => ({ v: 1, settings: { title }, files: [{ name: 'survey.csv', text: 'HoleID,Depth,Dip\r\nA,12tail,-45', geophysNumericPolicy: 'future-policy' }] });
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  project = figure('A'); target = 'saved-a'; epoch = 0;
  window.EM3D = { getProject: () => structuredClone(project), getState: () => ({ ready: true, brand: { title: project.settings.title } }), getThumbnail: () => null };
  mocks.ready.mockImplementation(() => {}); mocks.getUser.mockResolvedValue({ id: 'user-a' });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: id });
  mocks.context.mockImplementation(() => {
    const initialEpoch = epoch, signature = JSON.stringify(project), saved = target;
    const isCurrent = () => initialEpoch === epoch && signature === JSON.stringify(project);
    return { project: saved, isCurrent, assertCurrent() { if (!isCurrent()) throw Object.assign(new Error('Figure changed'), { code: 'PROJECT_CHANGED', plain: true }); } };
  });
  share = await import('../src/three-d/share.js');
});
describe('share snapshots retain one verified figure context', () => {
  it('sends the captured raw source with its captured saved target and remembers it on success', async () => {
    const result = await share.create();
    expect(mocks.rpc).toHaveBeenCalledWith('create_3d_share', expect.objectContaining({ p_state: figure('A'), p_project_id: 'saved-a' }));
    expect(JSON.parse(localStorage.getItem('em3d.share.last.v1'))).toEqual({ id, projectId: 'saved-a' });
    expect(result.embedCode).toContain('title="A"');
  });
  it('refuses an A snapshot after an account/figure switch while verifying the user, without keys or RPC', async () => {
    const gate = deferred(); mocks.getUser.mockReturnValue(gate.promise);
    const creating = share.create(); const rejected = expect(creating).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    epoch++; target = 'saved-b'; project = figure('B'); gate.resolve({ id: 'user-b' }); await rejected;
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(localStorage.getItem('em_share_key')).toBeNull();
    expect(localStorage.getItem('em3d.share.last.v1')).toBeNull();
  });
  it('checks dirty edits again after waiting for the client, before issuing the write', async () => {
    const gate = deferred(); mocks.client.mockReturnValue(gate.promise);
    const updating = share.update(id); const rejected = expect(updating).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    project.files[0].text += '\nA,20,-50'; gate.resolve({ rpc: mocks.rpc }); await rejected;
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not remember a returned link as the new figure after a dispatched RPC completes late', async () => {
    const gate = deferred(); mocks.rpc.mockReturnValue(gate.promise);
    const creating = share.create(); const rejected = expect(creating).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    project = figure('B'); target = 'saved-b'; epoch++; gate.resolve({ data: id }); await rejected;
    expect(localStorage.getItem('em3d.share.last.v1')).toBeNull();
    expect(mocks.rpc.mock.calls[0][1].p_project_id).toBe('saved-a');
  });
  it('retains anonymous sharing and the colleague snapshot fallback without changing source', async () => {
    mocks.getUser.mockResolvedValue(null); await share.create();
    expect(mocks.rpc.mock.calls[0][1].p_project_id).toBeNull();
    mocks.getUser.mockResolvedValue({ id: 'user-a' }); mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValueOnce({ error: new Error('not in your account') }).mockResolvedValueOnce({ data: id });
    await share.create();
    expect(mocks.rpc.mock.calls[0][1].p_project_id).toBe('saved-a');
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_project_id: null, p_state: figure('A') });
  });
});
