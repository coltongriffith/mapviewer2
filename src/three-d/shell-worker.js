// Builds the exploratory grade shell off the main thread (see shell-core.js and shell-mesh.js).
// One job at a time: the studio terminates the worker to cancel, or to replace a running job.
import { buildShell } from './shell-mesh.js';

self.onmessage = (e) => {
  const m = e.data; let last = -1;
  try {
    const r = buildShell(m, (p) => { if (p - last >= 0.02 || p === 1) { last = p; self.postMessage({ id: m.id, type: 'progress', p }); } });
    self.postMessage({ id: m.id, type: 'done', ...r }, [r.field.buffer, r.positions.buffer, r.indices.buffer]);
  } catch (err) {
    self.postMessage({ id: m.id, type: 'error', message: String((err && err.message) || err) });
  }
};
