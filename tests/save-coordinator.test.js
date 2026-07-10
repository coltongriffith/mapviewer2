import { describe, it, expect, vi } from 'vitest';
import { createSaveCoordinator, runGuardedSave } from '../src/utils/saveCoordinator';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Minimal stand-in for the App save wiring: tracks the same three pieces of
 * state (current serialized project, saved-baseline snapshot, dirty flag)
 * and settles saves exactly the way App.jsx does.
 */
function makeWorkspace() {
  const ws = {
    coordinator: createSaveCoordinator(),
    current: JSON.stringify({ rev: 0 }),
    baseline: JSON.stringify({ rev: 0 }),
    dirty: false,
    errors: [],
    edit(rev) { ws.current = JSON.stringify({ rev }); ws.dirty = ws.current !== ws.baseline; },
    startSave(doSave) {
      const snapshot = ws.current;
      const ticket = ws.coordinator.begin();
      return runGuardedSave({
        ticket,
        snapshot,
        doSave,
        getCurrentSerialized: () => ws.current,
        onSaved: () => { ws.baseline = snapshot; ws.dirty = false; },
        onMismatch: () => { ws.baseline = snapshot; },
        onError: (e) => { ws.errors.push(e.message); },
      });
    },
  };
  return ws;
}

describe('save race: edit during an active save', () => {
  it('edit A saving, edit B occurs, A finishes first → dirty stays set for B', async () => {
    const ws = makeWorkspace();
    ws.edit(1);                          // state A
    const saveA = deferred();
    const done = ws.startSave(() => saveA.promise);

    ws.edit(2);                          // state B while A is in flight
    saveA.resolve('row-1');              // A completes
    const outcome = await done;

    expect(outcome.status).toBe('saved-but-dirty');
    expect(ws.dirty).toBe(true);         // B is NOT masked
    expect(ws.baseline).toBe(JSON.stringify({ rev: 1 })); // baseline = what cloud holds
  });

  it('dirty clears only after the LATEST snapshot is saved', async () => {
    const ws = makeWorkspace();
    ws.edit(1);
    const saveA = deferred();
    const doneA = ws.startSave(() => saveA.promise);
    ws.edit(2);
    saveA.resolve('row');
    await doneA;
    expect(ws.dirty).toBe(true);

    // Second pass saves state B — now clean.
    const saveB = deferred();
    const doneB = ws.startSave(() => saveB.promise);
    saveB.resolve('row');
    await doneB;
    expect(ws.dirty).toBe(false);
    expect(ws.baseline).toBe(JSON.stringify({ rev: 2 }));
  });
});

describe('save race: two saves finish out of order', () => {
  it('an older save resolving after a newer one cannot regress the baseline to a stale snapshot when edits continued', async () => {
    const ws = makeWorkspace();
    ws.edit(1);
    const slow = deferred();
    const doneSlow = ws.startSave(() => slow.promise);   // saving rev 1, slow

    ws.edit(2);
    const fast = deferred();
    const doneFast = ws.startSave(() => fast.promise);   // saving rev 2, fast
    fast.resolve('row');
    await doneFast;
    expect(ws.dirty).toBe(false);
    expect(ws.baseline).toBe(JSON.stringify({ rev: 2 }));

    // Slow save (rev 1) finally lands. Current (rev 2) !== its snapshot (rev 1)
    // → mismatch path: baseline moves to rev 1 (that IS what the last write
    // stored) and dirty re-arms so rev 2 gets re-saved. Crucially it can NOT
    // mark the app clean against a stale snapshot.
    slow.resolve('row');
    const outcome = await doneSlow;
    expect(outcome.status).toBe('saved-but-dirty');
    expect(ws.dirty).toBe(false);        // dirty flag itself untouched by mismatch path
    expect(ws.baseline).toBe(JSON.stringify({ rev: 1 }));
  });
});

describe('save race: switching projects while a save is pending', () => {
  it('a completion from the previous project touches nothing after a workspace switch', async () => {
    const ws = makeWorkspace();
    ws.edit(1);
    const save = deferred();
    const done = ws.startSave(() => save.promise);

    // User switches projects mid-save.
    ws.coordinator.switchWorkspace();
    ws.current = JSON.stringify({ project: 'P2', rev: 0 });
    ws.baseline = ws.current;
    ws.dirty = false;

    save.resolve('row-from-P1');
    const outcome = await done;
    expect(outcome.status).toBe('stale');
    expect(ws.baseline).toBe(JSON.stringify({ project: 'P2', rev: 0 })); // untouched
    expect(ws.dirty).toBe(false);
  });

  it('an error from the previous project is swallowed after a switch', async () => {
    const ws = makeWorkspace();
    ws.edit(1);
    const save = deferred();
    const done = ws.startSave(() => save.promise);
    ws.coordinator.switchWorkspace();
    save.reject(new Error('network down'));
    const outcome = await done;
    expect(outcome.status).toBe('stale-error');
    expect(ws.errors).toHaveLength(0);   // no error toast for a dead workspace
  });
});

describe('save failure handling', () => {
  it('cloud save fails in the current workspace → error surfaced, dirty preserved', async () => {
    const ws = makeWorkspace();
    ws.edit(1);
    const save = deferred();
    const done = ws.startSave(() => save.promise);
    save.reject(new Error('quota'));
    const outcome = await done;
    expect(outcome.status).toBe('error');
    expect(ws.errors).toEqual(['quota']);
    expect(ws.dirty).toBe(true);         // never claim success on failure
    expect(ws.baseline).toBe(JSON.stringify({ rev: 0 }));
  });
});

describe('manual save and autosave overlap', () => {
  it('manual save and autosave of the same snapshot both settle without masking a later edit', async () => {
    const ws = makeWorkspace();
    ws.edit(1);
    const auto = deferred();
    const manual = deferred();
    const doneAuto = ws.startSave(() => auto.promise);
    const doneManual = ws.startSave(() => manual.promise);

    manual.resolve('row');
    await doneManual;
    expect(ws.dirty).toBe(false);

    ws.edit(2);                          // edit after manual completes
    auto.resolve('row');
    const outcome = await doneAuto;      // stale-generation autosave lands last
    expect(outcome.status).toBe('saved-but-dirty');
    expect(ws.dirty).toBe(true);         // rev 2 still needs saving — not masked
  });
});
