// Serialize live commits, not asset preparation. A superseded preparation never
// touches the figure; an interrupted commit restores its checkpoint before the
// next commit is allowed to start. All application state stays in the hooks.
export function projectChanged() {
  return Object.assign(new Error('The figure changed while it was opening. Your current work was kept.'), { code: 'PROJECT_CHANGED' });
}

// Keep decoded images/canvases and other renderer-owned objects by reference;
// clone editable arrays/plain records so a candidate cannot mutate a checkpoint.
export function cloneFigureState(value) {
  if (Array.isArray(value)) return value.map(cloneFigureState);
  if (!value || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFigureState(item)]));
}

// getCam omits zero pan; setCamera intentionally preserves omitted fields for
// partial edits. A full saved snapshot must instead restore its unpanned view.
export function snapshotCamera(camera) {
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) return camera;
  return { ...cloneFigureState(camera), pan: camera.pan === undefined ? null : cloneFigureState(camera.pan) };
}

export function createProjectLoader(hooks, { timeoutMs = 90000, pollMs = 100 } = {}) {
  let latest = 0, active = null;
  const preparations = new Set();
  const timeout = () => Object.assign(new Error('Opening the figure took too long. Your original work was kept for recovery.'), { code: 'PROJECT_TIMEOUT' });
  const bounded = async (promise) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(timeout()), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  return async (project, options = {}) => {
    const ticket = ++latest;
    preparations.forEach((cancel) => cancel(projectChanged()));
    active?.cancel(projectChanged());
    hooks.begin?.();
    let cancelled = null, rejectGate;
    const gate = new Promise((_, reject) => { rejectGate = reject; });
    // A newer request can arrive while this request is waiting for a restore.
    gate.catch(() => {});
    const cancel = (error) => { if (!cancelled) { cancelled = error; rejectGate(error); } };
    const check = () => {
      if (cancelled) throw cancelled;
      if (ticket !== latest || (options.isCurrent && !options.isCurrent())) throw projectChanged();
    };
    // No newer operation may checkpoint an older operation's partial state.
    if (active) await active.finished;
    check();
    const signature = hooks.signature();
    const timer = setTimeout(() => cancel(timeout()), timeoutMs);
    const watch = setInterval(() => { try { check(); } catch (error) { cancel(error); } }, pollMs);
    let checkpoint, committed = false, transaction;
    try {
      preparations.add(cancel);
      const prepared = await Promise.race([hooks.prepare(project, options), gate]);
      preparations.delete(cancel);
      check();
      if (signature !== hooks.signature()) throw projectChanged();
      checkpoint = hooks.capture();
      let finish;
      transaction = { finished: new Promise((resolve) => { finish = resolve; }), finish, cancel };
      active = transaction;
      hooks.lock(true);
      committed = true;
      await Promise.race([hooks.apply(prepared, check), gate]);
      check();
      return hooks.result();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('That figure could not be opened.', { cause });
      if (!committed) {
        error.stateRestored = true; // the loader never changed the original
      } else {
        try {
          await bounded(hooks.restore(checkpoint, () => {
            if (active !== transaction) throw projectChanged();
          }));
          error.stateRestored = true;
        } catch (restoreError) {
          error.stateRestored = false;
          error.restoreError = restoreError;
          // Source/checkpoint recovery must not depend on refetching old assets.
          hooks.retainRecovery?.(checkpoint);
        }
      }
      throw error;
    } finally {
      clearTimeout(timer); clearInterval(watch); preparations.delete(cancel);
      cancelled ||= projectChanged(); // late native continuations must stay inert
      if (transaction) {
        try { hooks.lock(false); }
        finally {
          if (active === transaction) active = null;
          transaction.finish();
        }
      }
    }
  };
}
