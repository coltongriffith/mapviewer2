// Save-generation protection for autosave and manual saves.
//
// The bugs this closes:
//  * A save begins with project state A; the user edits to state B while A is
//    in flight; A completes and used to mark the app clean even though B was
//    never saved.
//  * A save begins in project P1; the user switches to project P2; the P1
//    completion used to clear P2's dirty flag (and, on the create-recovery
//    path, could even re-point P2 at a row created for P1's data).
//
// Model:
//  * epoch      — bumped on every workspace switch (open project, new project,
//                 demo/deep-link/fork loads). A completion whose ticket epoch
//                 is stale may not touch ANY state.
//  * snapshot   — the exact serialized payload a save call sent. Dirty may be
//                 cleared only when the CURRENT serialized project still equals
//                 that snapshot; otherwise the baseline advances but the app
//                 stays dirty so the next autosave picks up the newer edits.

//  * serialize  — cloud writes that carry an expected revision run one at a
//                 time per tab. Two overlapping saves (autosave + Save, or a
//                 save slower than the autosave delay) both read the same
//                 revision, so the second was rejected as SAVE_CONFLICT and
//                 the user was told another tab had saved. Queued, each save
//                 reads the revision its predecessor left behind.
export function createSaveCoordinator() {
  let epoch = 0;
  let chain = Promise.resolve();
  return {
    /** Run `fn` after every earlier serialized save has settled. */
    serialize(fn) {
      const run = chain.then(fn, fn);
      chain = run.then(() => {}, () => {});
      return run;
    },
    /** Call at every workspace switch — detaches all in-flight completions. */
    switchWorkspace() { epoch += 1; },
    /** Capture a ticket at save start; check stillCurrent() after the await. */
    begin() {
      const t = epoch;
      return { epoch: t, stillCurrent: () => t === epoch };
    },
  };
}

/**
 * Run one guarded save. `doSave` performs the actual write (cloud or local).
 * Completion callbacks are only invoked when appropriate:
 *   onSaved(result)    — save landed AND the project hasn't changed since:
 *                        safe to advance the baseline and clear dirty.
 *   onMismatch(result) — save landed but the user edited during the await:
 *                        advance the baseline to what was saved; KEEP dirty.
 *   onError(err)       — save failed and the workspace is still current:
 *                        surface it. Stale errors are swallowed (the previous
 *                        workspace no longer exists on screen).
 * Stale completions (workspace switched mid-save) touch nothing.
 */
export async function runGuardedSave({ ticket, snapshot, doSave, getCurrentSerialized, onSaved, onMismatch, onError }) {
  // A save that waited behind another (serialize) may start after the
  // workspace switched. Its payload belongs to a workspace that is gone and
  // the revision it would read belongs to the new one: do not send it.
  if (!ticket.stillCurrent()) return { status: 'stale' };
  let result;
  try {
    result = await doSave();
  } catch (err) {
    if (!ticket.stillCurrent()) return { status: 'stale-error', err };
    onError?.(err);
    return { status: 'error', err };
  }
  if (!ticket.stillCurrent()) return { status: 'stale', result };
  if (getCurrentSerialized() !== snapshot) {
    onMismatch?.(result);
    return { status: 'saved-but-dirty', result };
  }
  onSaved?.(result);
  return { status: 'saved', result };
}

/**
 * The save target is gone for this account: deleted, trashed, or no longer
 * saveable by this user. Never answered by creating a new row automatically.
 */
export function isMissingProjectError(err) {
  return err?.code === 'PROJECT_NOT_FOUND' || /not found/i.test(String(err?.message || ''));
}
