import { createElement, lazy } from 'react';

// A tab opened before a deploy may ask for a lazy chunk whose hashed name is gone; Vite then fires
// vite:preloadError. Reload once for the new build (not again within a minute, so it can never loop:
// the same guard as /3d's studio.js). With unsaved work, show a notice instead and leave the error be;
// lazyGuarded below keeps that error from unmounting the editor. Lives in the entry, not App.

// Unsaved work is whatever makes the page warn on leaving (App.jsx's beforeunload guard).
const unsaved = (win) => { const e = new win.Event('beforeunload', { cancelable: true }); win.dispatchEvent(e); return e.defaultPrevented; };

export function installPreloadGuard(win = window) {
  win.addEventListener('vite:preloadError', (e) => {
    if (unsaved(win)) {
      const d = win.document;
      if (d.querySelector('.update-notice')) return;
      const n = d.createElement('div'), b = d.createElement('button');
      n.className = 'update-notice'; n.setAttribute('role', 'status');
      b.setAttribute('aria-label', 'Dismiss'); b.textContent = '×'; b.onclick = () => n.remove();
      d.body.append(n);
      n.append('A new version is available — save your work, then reload.', b);
      return;
    }
    try { if (Date.now() - (+win.sessionStorage.getItem('em.reloadedAt') || 0) < 6e4) return; win.sessionStorage.setItem('em.reloadedAt', Date.now()); } catch { return; }
    e.preventDefault(); win.location.reload();
  });
}

// React.lazy for parts of the editor. A stale chunk with unsaved work renders this note in the part's
// place: thrown, the error would reach the root ErrorBoundary, unmount the editor and lose the work.
// Without unsaved work it throws as before; a chunk the guard is reloading for (Vite resolves the
// import to undefined) waits in its Suspense fallback for the reload.
const Stale = () => createElement('p', null, 'This part was updated — save your work, then reload.');
export const lazyGuarded = (load) => lazy(() => load().then((m) => m || new Promise(() => {}), (err) => {
  if (unsaved(window)) return { default: Stale };
  throw err;
}));
