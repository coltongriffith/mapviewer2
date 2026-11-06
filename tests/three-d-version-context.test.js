import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/three-d/track.js', () => ({ track: vi.fn() }));
vi.mock('../src/utils/figureSignoffs.js', () => ({ figureSignoffs: () => ({ withSignoffs: async versions => Object.assign(versions, { signoffs: false }) }), barExtras: () => [] }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
let versions, project, target, frozen, epoch, host, read;
const figure = title => ({ v: 1, settings: { title }, files: [{ name: 'raw.csv', text: '\uFEFFID,Value\r\nA,12tail', geophysNumericPolicy: 'future-policy' }], camera: { zoom: 42 } });
const row = n => ({ id: `version-${n}`, figure_id: 'saved-a', version: n, label: `Release ${n}`, name: 'Figure A', created_at: '2026-11-03T10:00:00Z', content_hash: 'a'.repeat(64), snapshot: { kind: 'figure', settings: figure(`Published ${n}`), file_paths: [] } });
beforeEach(async () => {
  vi.resetModules(); project = figure('Live A'); target = { id: 'saved-a', name: 'Figure A' }; frozen = null; epoch = 0; read = async n => row(n);
  document.documentElement.classList.remove('em3d-version');
  document.body.innerHTML = '<aside class="panel"></aside><div class="toolbar"><div class="acct"></div></div>';
  window.EM3D = { getProject: () => structuredClone(project), getState: () => ({ title: project.settings.title }), loadProject: vi.fn(async (p, options) => { expect(options.isCurrent()).toBe(true); project = structuredClone(p); }) };
  const sb = { from: () => { let n; const q = { select: () => q, is: () => q, eq: (k, v) => { if (k === 'version') n = v; return q; }, maybeSingle: async () => ({ data: await read(n) }) }; return q; } };
  host = {
    client: async () => sb, current: () => target, dirty: () => false, canPublish: () => true, say: vi.fn(),
    frozen: () => frozen, setFrozen: vi.fn(v => { frozen = v; epoch++; }), pauseSaving: vi.fn(),
    detach: vi.fn(() => { target = null; epoch++; }), saveAsNew: vi.fn(),
    reopen: vi.fn(async () => { project = figure('Live A'); epoch++; return { id: 'saved-a' }; }),
    captureContext: () => { const ticket = epoch, signature = JSON.stringify(project); return { isCurrent: ({ source = true } = {}) => ticket === epoch && (!source || signature === JSON.stringify(project)), assertCurrent(options) { if (!this.isCurrent(options)) throw Object.assign(new Error('Figure changed'), { plain: true, code: 'PROJECT_CHANGED' }); } }; },
  };
  versions = await import('../src/three-d/versions.js'); versions.init(host);
});
describe('published version transactional caller ownership', () => {
  it('opens a successful version read-only without changing its raw source or current saved target', async () => {
    await versions.open(1);
    expect(project).toEqual(figure('Published 1')); expect(target.id).toBe('saved-a');
    expect(document.documentElement.classList.contains('em3d-version')).toBe(true);
    expect(frozen.version).toBe(1); expect(document.getElementById('ver-banner').textContent).toContain('Published version 1');
  });
  it('does not roll back, freeze, or label a late version read over an accepted live figure', async () => {
    const gate = deferred(); read = vi.fn(() => gate.promise);
    const opening = versions.open(1); const rejected = expect(opening).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    await vi.waitFor(() => expect(read).toHaveBeenCalled()); project = figure('Dirty B'); target = { id: 'saved-b' }; epoch++; versions.acceptLive();
    gate.resolve(row(1)); await rejected;
    expect(project.settings.title).toBe('Dirty B'); expect(window.EM3D.loadProject).not.toHaveBeenCalled();
    expect(host.setFrozen).not.toHaveBeenCalled(); expect(document.getElementById('ver-bar')).toBeNull();
    expect(document.documentElement.classList.contains('em3d-version')).toBe(false);
  });
  it('leaves prior presentation unchanged on verified load failure and never reloads a backup', async () => {
    const original = structuredClone(project);
    window.EM3D.loadProject.mockRejectedValue(Object.assign(new Error('image failed'), { stateRestored: true }));
    await expect(versions.open(1)).rejects.toThrow('previous figure is unchanged');
    expect(window.EM3D.loadProject).toHaveBeenCalledOnce(); expect(project).toEqual(original);
    expect(host.setFrozen).not.toHaveBeenCalled(); expect(host.pauseSaving).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('em3d-version')).toBe(false);
  });
  it('does not leave temporary version CSS after auth changes during a load', async () => {
    window.EM3D.loadProject.mockImplementationOnce(async (_project, options) => {
      epoch++; // a real auth context invalidation while native settle is pending
      expect(options.isCurrent()).toBe(false);
      throw Object.assign(new Error('account changed'), { code: 'PROJECT_CHANGED', stateRestored: true });
    });
    await expect(versions.open(1)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    expect(document.documentElement.classList.contains('em3d-version')).toBe(false);
    expect(document.getElementById('ver-bar')).toBeNull(); expect(frozen).toBeNull();
    expect(project.settings.title).toBe('Live A');
  });
  it('keeps the published snapshot and controls when starting a copy fails', async () => {
    await versions.open(1); window.EM3D.loadProject.mockRejectedValueOnce(Object.assign(new Error('copy settle failed'), { stateRestored: true }));
    await expect(versions.startCopy()).rejects.toThrow('copy settle failed');
    expect(frozen.version).toBe(1); expect(host.detach).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('em3d-version')).toBe(true);
    await versions.close();
    expect(project.settings.title).toBe('Live A'); expect(document.documentElement.classList.contains('em3d-version')).toBe(false);
  });
  it('creates a copy only after successful acceptance and keeps the raw snapshot', async () => {
    await versions.open(1); await versions.startCopy();
    expect(target).toBeNull(); expect(frozen).toBeNull(); expect(project).toEqual(figure('Published 1'));
    expect(host.saveAsNew).toHaveBeenCalledWith('Figure A (from v1)');
    expect(document.documentElement.classList.contains('em3d-version')).toBe(false);
  });
  it('keeps a version read-only when reopening the live save fails', async () => {
    await versions.open(1); host.reopen.mockRejectedValueOnce(new Error('download failed'));
    await expect(versions.close()).rejects.toThrow('download failed');
    expect(project.settings.title).toBe('Published 1'); expect(frozen.version).toBe(1);
    expect(document.documentElement.classList.contains('em3d-version')).toBe(true);
    expect(document.getElementById('ver-banner').textContent).toContain('Published version 1');
  });
});
