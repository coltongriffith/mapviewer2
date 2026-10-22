import { createElement, lazy } from 'react';
import { isChunkLoadError, retryImport } from '../../shared/chunkErrors.js';
import { reportError } from './errorReporter';

// A tab opened before a deploy may ask for a lazy chunk whose hashed name is gone. That must never show
// the crash screen or lose work. Every way the failure can surface ends in recoverFromStaleChunk:
//  * a lazyGuarded part (React.lazy) retries the import once, then recovers in place;
//  * vite:preloadError (a chunk with dependencies, outside a lazyGuarded load);
//  * an unhandled rejection from a bare import() (no preload wrapper: Safari's "Importing a module
//    script failed.", or a chunk without dependencies);
//  * the root ErrorBoundary, for anything that still reaches it.
// Without unsaved work the tab reloads once, keeping its URL (not again within a minute, so a stale entry
// page cannot loop: the same guard as /3d's studio.js). With unsaved work, or when it reloaded a moment
// ago, a notice with a Reload button leaves the reload to the user. Each is logged as kind 'stale_chunk',
// apart from real crashes. Lives in the entry, not App.

// Unsaved work is whatever makes the page warn on leaving (App.jsx's beforeunload guard).
const unsaved = (win) => { const e = new win.Event('beforeunload', { cancelable: true }); win.dispatchEvent(e); return e.defaultPrevented; };

function showNotice(win, text) {
  const d = win.document;
  if (d.querySelector('.update-notice')) return;
  const n = d.createElement('div'), r = d.createElement('button'), b = d.createElement('button');
  n.className = 'update-notice'; n.setAttribute('role', 'status');
  r.type = 'button'; r.className = 'update-notice-reload'; r.textContent = 'Reload'; r.onclick = () => win.location.reload();
  b.type = 'button'; b.setAttribute('aria-label', 'Dismiss'); b.textContent = '×'; b.onclick = () => n.remove();
  d.body.append(n);
  n.append(text, r, b);
}

// Reload at most once a minute in this tab. Storage that is unavailable means no reload at all, since
// nothing would then stop a loop.
function mayReload(win) {
  try {
    if (Date.now() - (+win.sessionStorage.getItem('em.reloadedAt') || 0) < 6e4) return false;
    win.sessionStorage.setItem('em.reloadedAt', Date.now());
    return true;
  } catch { return false; }
}

/**
 * Recover from a chunk that failed to load. Returns 'reload' (the tab is reloading) or 'notice' (the
 * reload is the user's, from the notice; `notice: false` leaves showing it to the caller).
 */
export function recoverFromStaleChunk(error, win = window, { notice = true } = {}) {
  const dirty = unsaved(win);
  const outcome = !dirty && mayReload(win) ? 'reload' : 'notice';
  reportError(error, { kind: 'stale_chunk', context: { outcome, unsaved: dirty } });
  if (outcome === 'reload') win.location.reload();
  else if (notice) showNotice(win, dirty ? 'A new version is available — save your work, then reload.' : 'A new version is available.');
  return outcome;
}

// lazyGuarded loads in flight: their own retry and recovery handle a preload error, not the listener.
let guardedLoads = 0;

export function installPreloadGuard(win = window) {
  win.addEventListener('vite:preloadError', (e) => {
    if (guardedLoads > 0) return;
    // Prevented, Vite resolves the import to undefined, which waits for the reload.
    if (recoverFromStaleChunk(e.payload, win) === 'reload') e.preventDefault();
  });
  win.addEventListener('unhandledrejection', (e) => {
    if (!isChunkLoadError(e.reason)) return;
    e.preventDefault();
    recoverFromStaleChunk(e.reason, win);
  });
}

const reload = () => window.location.reload();
const pending = () => new Promise(() => {});

/** The page an update replaces: the root ErrorBoundary's and a lazy page's, in place of the crash screen. */
export const UpdatePage = () => createElement('div', { className: 'update-page', role: 'alert' },
  createElement('h2', null, 'A new version is available'),
  createElement('p', null, 'Exploration Maps was updated while this tab was open. Reload to update; your saved maps are kept.'),
  createElement('button', { type: 'button', onClick: reload }, 'Reload to update'));

// In a part's place when its chunk is gone: thrown, the error would reach the root ErrorBoundary, unmount
// the editor and lose the work.
const Stale = () => createElement('p', { className: 'stale-chunk-note', role: 'status' },
  createElement('span', null, 'This part was updated — save your work, then reload.'), ' ',
  createElement('button', { type: 'button', onClick: reload }, 'Reload'));

/**
 * React.lazy with the import retried once, and a stale chunk recovered rather than thrown: the part
 * waits in its Suspense fallback while the tab reloads, or renders a note (`page`: the update page)
 * when the reload is the user's. A healthy load is exactly React.lazy.
 */
export const lazyGuarded = (load, { page = false } = {}) => lazy(() => {
  guardedLoads += 1;
  return retryImport(load).finally(() => { guardedLoads -= 1; }).then((m) => m || pending(), (err) => {
    if (!isChunkLoadError(err)) throw err;
    return recoverFromStaleChunk(err, window, { notice: !page }) === 'reload' ? pending() : { default: page ? UpdatePage : Stale };
  });
});
