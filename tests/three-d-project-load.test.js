import { describe, expect, it, vi } from 'vitest';
import { cloneFigureState, createProjectLoader } from '../src/three-d/project-load.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const state = { raw: 'original CSV', history: ['before'], asset: new Date(0) };
  const hooks = {
    begin: vi.fn(),
    signature: vi.fn(() => state.raw),
    prepare: vi.fn(async (project) => project),
    capture: vi.fn(() => cloneFigureState(state)),
    lock: vi.fn(),
    apply: vi.fn(async (project) => { state.raw = project.raw; state.history.push('candidate'); }),
    restore: vi.fn(async (checkpoint, check) => { check(); Object.assign(state, checkpoint); }),
    retainRecovery: vi.fn(),
    result: vi.fn(() => ({ raw: state.raw })),
    ...overrides,
  };
  return { state, hooks, load: createProjectLoader(hooks) };
}

describe('transactional project loader', () => {
  it('cancels a superseded preparation even if its decoder never settles', async () => {
    const f = fixture({ prepare: vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce({ raw: 'newest' }) });
    const pending = f.load({ raw: 'never decoded' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    await expect(f.load({ raw: 'newest' })).resolves.toEqual({ raw: 'newest' });
    await rejected;
    expect(f.hooks.capture).toHaveBeenCalledTimes(1);
    expect(f.hooks.apply).toHaveBeenCalledTimes(1);
    expect(f.state.raw).toBe('newest');
  });

  it('bounds a never-settling live application with the default 90-second watchdog', async () => {
    vi.useFakeTimers();
    try {
      const entered = deferred();
      const f = fixture();
      f.hooks.apply.mockImplementation(async () => { f.state.raw = 'partial'; entered.resolve(); await new Promise(() => {}); });
      const pending = f.load({ raw: 'never completed' });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'PROJECT_TIMEOUT', stateRestored: true });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(89999);
      expect(f.hooks.restore).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(f.state.raw).toBe('original CSV');
      expect(f.hooks.lock).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('leaves the figure and decoded references untouched when preparation fails', async () => {
    const failure = new Error('decode rejected');
    const f = fixture({ prepare: vi.fn().mockRejectedValue(failure) });
    const original = cloneFigureState(f.state);
    await expect(f.load({ raw: 'new' })).rejects.toMatchObject({ message: 'decode rejected', stateRestored: true });
    expect(f.state).toEqual(original);
    expect(f.state.asset).toBe(original.asset);
    expect(f.hooks.capture).not.toHaveBeenCalled();
    expect(f.hooks.lock).not.toHaveBeenCalled();
    expect(f.hooks.apply).not.toHaveBeenCalled();
    expect(f.hooks.restore).not.toHaveBeenCalled();
  });

  it('keeps edits made while a slow preparation is pending', async () => {
    const preparation = deferred();
    const f = fixture({ prepare: vi.fn(() => preparation.promise) });
    const pending = f.load({ raw: 'candidate' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    f.state.raw = 'user edit';
    preparation.resolve({ raw: 'candidate' });
    await rejected;
    expect(f.state.raw).toBe('user edit');
    expect(f.hooks.capture).not.toHaveBeenCalled();
  });

  it('supersedes an older preparation without applying it', async () => {
    const preparation = deferred();
    const f = fixture({ prepare: vi.fn().mockImplementationOnce(() => preparation.promise).mockResolvedValueOnce({ raw: 'newest' }) });
    const old = f.load({ raw: 'old' });
    const rejected = expect(old).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    await expect(f.load({ raw: 'newest' })).resolves.toEqual({ raw: 'newest' });
    preparation.resolve({ raw: 'old' });
    await rejected;
    expect(f.hooks.apply).toHaveBeenCalledTimes(1);
    expect(f.state.raw).toBe('newest');
  });

  it('restores an interrupted live commit before a newer operation checkpoints', async () => {
    const applying = deferred(), entered = deferred();
    const f = fixture();
    const events = [];
    f.hooks.apply.mockImplementationOnce(async (project, check) => {
      f.state.raw = project.raw;
      entered.resolve();
      await applying.promise;
      check();
    });
    f.hooks.restore.mockImplementation(async (checkpoint, check) => {
      check(); Object.assign(f.state, checkpoint); events.push('restored');
    });
    f.hooks.capture.mockImplementation(() => { events.push(`capture:${f.state.raw}`); return cloneFigureState(f.state); });
    const old = f.load({ raw: 'partial' });
    const rejected = expect(old).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    await entered.promise;
    const newest = f.load({ raw: 'newest' });
    expect(f.hooks.capture).toHaveBeenCalledTimes(1);
    applying.resolve();
    await rejected;
    await newest;
    expect(events).toEqual(['capture:original CSV', 'restored', 'capture:original CSV']);
    expect(f.state.raw).toBe('newest');
    expect(f.hooks.lock.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('restores original raw text, history and decoded asset references without preparing again', async () => {
    const f = fixture();
    const originalAsset = f.state.asset;
    f.hooks.apply.mockImplementation(async () => {
      f.state.raw = 'partial'; f.state.history.push('partial'); f.state.asset = new Date(1);
      throw new Error('apply failed');
    });
    await expect(f.load({ raw: 'new' })).rejects.toMatchObject({ message: 'apply failed', stateRestored: true });
    expect(f.state.raw).toBe('original CSV');
    expect(f.state.history).toEqual(['before']);
    expect(f.state.asset).toBe(originalAsset);
    expect(f.hooks.prepare).toHaveBeenCalledTimes(1);
    expect(f.hooks.restore).toHaveBeenCalledTimes(1);
    expect(f.hooks.lock).toHaveBeenLastCalledWith(false);
  });

  it('retains the checkpoint and marks recovery failure explicitly', async () => {
    const restoreError = new Error('restore failed');
    const f = fixture({
      apply: vi.fn().mockRejectedValue(new Error('apply failed')),
      restore: vi.fn().mockRejectedValue(restoreError),
    });
    await expect(f.load({})).rejects.toMatchObject({ stateRestored: false, restoreError });
    expect(f.hooks.retainRecovery).toHaveBeenCalledWith(expect.objectContaining({ raw: 'original CSV', history: ['before'] }));
    expect(f.hooks.lock).toHaveBeenLastCalledWith(false);
  });

  it('checks the caller identity/context guard after preparation', async () => {
    let current = true;
    const preparation = deferred();
    const f = fixture({ prepare: vi.fn(() => preparation.promise) });
    const pending = f.load({}, { isCurrent: () => current });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    current = false; preparation.resolve({ raw: 'other account' });
    await rejected;
    expect(f.hooks.apply).not.toHaveBeenCalled();
  });

  it('restores when the caller context changes during application', async () => {
    let current = true;
    const f = fixture();
    f.hooks.apply.mockImplementation(async () => { f.state.raw = 'partial'; current = false; });
    await expect(f.load({}, { isCurrent: () => current })).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    expect(f.state.raw).toBe('original CSV');
    expect(f.hooks.restore).toHaveBeenCalledTimes(1);
  });

  it('returns the ordinary result and releases the lock after success', async () => {
    const f = fixture();
    await expect(f.load({ raw: 'accepted' })).resolves.toEqual({ raw: 'accepted' });
    expect(f.hooks.begin).toHaveBeenCalledTimes(1);
    expect(f.hooks.lock.mock.calls).toEqual([[true], [false]]);
    expect(f.hooks.restore).not.toHaveBeenCalled();
  });

  it('releases serialization even if unlocking throws', async () => {
    const f = fixture();
    f.hooks.lock.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('unlock failed'); });
    await expect(f.load({ raw: 'first' })).rejects.toThrow('unlock failed');
    await expect(f.load({ raw: 'second' })).resolves.toEqual({ raw: 'second' });
  });
});

describe('figure checkpoint cloning', () => {
  it('deeply clones editable plain arrays and records while retaining decoded objects', () => {
    class DecodedAsset {}
    const asset = new DecodedAsset();
    const input = { files: [{ cols: { x: 1 }, raw: 'unaltered\r\nCSV' }], asset, empty: null, optional: undefined };
    const cloned = cloneFigureState(input);
    cloned.files[0].cols.x = 9;
    expect(input.files[0].cols.x).toBe(1);
    expect(cloned.files[0].raw).toBe(input.files[0].raw);
    expect(cloned.asset).toBe(asset);
    expect(cloned).toHaveProperty('optional', undefined);
    expect(cloned.empty).toBeNull();
  });
});
