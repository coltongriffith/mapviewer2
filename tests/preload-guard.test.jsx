import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const reported = vi.hoisted(() => []);
vi.mock('../src/utils/errorReporter', () => ({ reportError: (error, opts) => reported.push({ error, ...opts }) }));

import { installPreloadGuard, lazyGuarded } from '../src/utils/preloadGuard.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

// A window: real events (so beforeunload listeners run), a session store and a reload spy.
function fakeWindow(sessionStorage = fakeStorage()) {
  const win = new EventTarget();
  win.Event = Event;
  win.document = document;
  win.location = { reload: vi.fn() };
  win.sessionStorage = sessionStorage;
  return win;
}

const staleError = () => new TypeError('Failed to fetch dynamically imported module: /assets/LegendEditor-old.js');

function preloadError(win, payload = staleError()) {
  const e = new Event('vite:preloadError', { cancelable: true });
  e.payload = payload;
  expect(() => win.dispatchEvent(e)).not.toThrow();
  return e;
}

function rejection(win, reason) {
  const e = new Event('unhandledrejection', { cancelable: true });
  e.reason = reason;
  win.dispatchEvent(e);
  return e;
}

beforeEach(() => { reported.length = 0; window.sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// What main.jsx's root ErrorBoundary does with a thrown render error: the editor is replaced.
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <p>Editor unmounted</p> : this.props.children; }
}

function renderEditorWith(Part) {
  return render(<Boundary><p>Editor with unsaved work</p><React.Suspense fallback={<p>Loading</p>}><Part /></React.Suspense></Boundary>);
}

describe('lazyGuarded', () => {
  const stale = () => Promise.reject(staleError());

  it('keeps the editor mounted when a stale chunk fails with unsaved work, with a Reload on the note', async () => {
    const guard = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    try {
      renderEditorWith(lazyGuarded(stale));
      expect(await screen.findByText('This part was updated — save your work, then reload.', {}, { timeout: 3000 })).toBeInTheDocument();
      expect(within(document.querySelector('.stale-chunk-note')).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      // and the page-wide notice, once
      expect(document.querySelectorAll('.update-notice')).toHaveLength(1);
      expect(screen.getByText('Editor with unsaved work')).toBeInTheDocument();
      expect(screen.queryByText('Editor unmounted')).toBeNull();
      // No automatic reload: that is the user's, once the work is saved.
      expect(window.sessionStorage.getItem('em.reloadedAt')).toBeNull();
      expect(reported).toEqual([expect.objectContaining({ kind: 'stale_chunk', context: { outcome: 'notice', unsaved: true } })]);
    } finally {
      window.removeEventListener('beforeunload', guard);
    }
  });

  it('without unsaved work reloads and waits in the fallback, never reaching the error boundary', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom: navigation not implemented
    try {
      const load = vi.fn(stale);
      renderEditorWith(lazyGuarded(load));
      await vi.waitFor(() => expect(window.sessionStorage.getItem('em.reloadedAt')).not.toBeNull(), { timeout: 3000 });
      expect(load).toHaveBeenCalledTimes(2); // retried once before giving up
      expect(screen.getByText('Loading')).toBeInTheDocument();
      expect(screen.queryByText('Editor unmounted')).toBeNull();
      expect(reported[0]).toMatchObject({ kind: 'stale_chunk', context: { outcome: 'reload' } });
    } finally {
      err.mockRestore();
    }
  });

  it('recovers when the retry loads (a transient network failure)', async () => {
    const load = vi.fn().mockRejectedValueOnce(staleError()).mockResolvedValueOnce({ default: () => <p>Legend editor</p> });
    renderEditorWith(lazyGuarded(load));
    expect(await screen.findByText('Legend editor', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(reported).toEqual([]);
  });

  it('recovers a CSS preload failure at once instead of retrying into an unstyled part', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom: navigation not implemented
    try {
      const load = vi.fn()
        .mockRejectedValueOnce(new Error('Unable to preload CSS for /assets/vendor-leaflet-CIGW-MKW.css'))
        .mockResolvedValueOnce({ default: () => <p>Unstyled map</p> });
      renderEditorWith(lazyGuarded(load));
      await vi.waitFor(() => expect(window.sessionStorage.getItem('em.reloadedAt')).not.toBeNull(), { timeout: 3000 });
      expect(load).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Unstyled map')).toBeNull();
      expect(screen.getByText('Loading')).toBeInTheDocument();
      expect(reported[0]).toMatchObject({ kind: 'stale_chunk', context: { outcome: 'reload' } });
    } finally {
      err.mockRestore();
    }
  });

  it('offers the update page in place of a lazy page when it may not reload', async () => {
    window.sessionStorage.setItem('em.reloadedAt', String(Date.now())); // reloaded a moment ago
    renderEditorWith(lazyGuarded(stale, { page: true }));
    expect(await screen.findByRole('button', { name: 'Reload to update' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('Editor unmounted')).toBeNull();
    expect(document.querySelector('.update-notice')).toBeNull(); // the page says it; no second notice
  });

  it('throws an error that is not a stale chunk, as React.lazy would', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderEditorWith(lazyGuarded(() => Promise.reject(new ReferenceError('x is not defined'))));
      expect(await screen.findByText('Editor unmounted')).toBeInTheDocument();
    } finally {
      err.mockRestore();
    }
  });

  it('waits in the Suspense fallback while the guard reloads (the import resolved to undefined)', async () => {
    renderEditorWith(lazyGuarded(() => Promise.resolve(undefined)));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByText('Editor unmounted')).toBeNull();
  });

  it('loads a good chunk normally', async () => {
    renderEditorWith(lazyGuarded(() => Promise.resolve({ default: () => <p>Legend editor</p> })));
    expect(await screen.findByText('Legend editor')).toBeInTheDocument();
  });
});

describe('preload error guard', () => {
  it('reloads once for a stale chunk, and logs it as stale_chunk', () => {
    const win = fakeWindow();
    installPreloadGuard(win);
    const e = preloadError(win);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(reported).toEqual([expect.objectContaining({ kind: 'stale_chunk', context: { outcome: 'reload', unsaved: false } })]);
  });

  it('does not loop: the reloaded page offers the reload instead for a minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const storage = fakeStorage();
    const first = fakeWindow(storage);
    installPreloadGuard(first);
    preloadError(first);
    expect(first.location.reload).toHaveBeenCalledTimes(1);

    // The reloaded page (same tab session) fails again: no second reload, a notice with a Reload button.
    vi.setSystemTime(new Date('2026-10-21T12:00:05Z'));
    const second = fakeWindow(storage);
    installPreloadGuard(second);
    const e = preloadError(second);
    preloadError(second);
    expect(second.location.reload).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    const notes = document.querySelectorAll('.update-notice');
    expect(notes).toHaveLength(1);
    fireEvent.click(within(notes[0]).getByRole('button', { name: 'Reload' }));
    expect(second.location.reload).toHaveBeenCalledTimes(1); // the user's click

    // A later deploy, well after that reload, gets its own reload (as /3d does).
    vi.setSystemTime(new Date('2026-10-21T14:00:00Z'));
    preloadError(second);
    expect(second.location.reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload with unsaved work, and shows one notice instead', () => {
    const win = fakeWindow();
    // App.jsx's guard: signed in with unsaved cloud changes.
    win.addEventListener('beforeunload', (ev) => { ev.preventDefault(); ev.returnValue = ''; });
    installPreloadGuard(win);
    const e = preloadError(win);
    preloadError(win);
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    expect(win.sessionStorage.getItem('em.reloadedAt')).toBeNull();
    const notes = document.querySelectorAll('[role="status"]');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('A new version is available — save your work, then reload.');
    // Dismissed with a real, focusable button (keyboard users included).
    const dismiss = within(notes[0]).getByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    expect(dismiss).toHaveFocus();
    fireEvent.click(dismiss);
    expect(document.querySelector('.update-notice')).toBeNull();
  });

  it('reloads once the unsaved work is saved', () => {
    const win = fakeWindow();
    const guard = (ev) => ev.preventDefault();
    win.addEventListener('beforeunload', guard);
    installPreloadGuard(win);
    preloadError(win);
    expect(win.location.reload).not.toHaveBeenCalled();
    win.removeEventListener('beforeunload', guard);
    preloadError(win);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('survives storage that throws, and does not reload without it', () => {
    const boom = () => { throw new DOMException('denied', 'SecurityError'); };
    for (const storage of [{ getItem: boom, setItem: boom }, { getItem: () => null, setItem: boom }]) {
      const win = fakeWindow(storage);
      installPreloadGuard(win);
      const e = preloadError(win);
      expect(win.location.reload).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    }
    const win = fakeWindow();
    Object.defineProperty(win, 'sessionStorage', { get: boom });
    installPreloadGuard(win);
    preloadError(win);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('recovers a bare import() that rejects without Vite (Safari\'s wording), and leaves other rejections', () => {
    const win = fakeWindow();
    installPreloadGuard(win);
    const other = rejection(win, new TypeError('Failed to fetch'));
    expect(other.defaultPrevented).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();

    const e = rejection(win, new TypeError('Importing a module script failed.'));
    expect(e.defaultPrevented).toBe(true); // handled: not reported as a crash
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([expect.objectContaining({ kind: 'stale_chunk' })]);
  });

  it('leaves a preload error inside a guarded load to its retry', async () => {
    const win = window;
    installPreloadGuard(win);
    let event;
    const load = vi.fn()
      .mockImplementationOnce(() => { event = preloadError(win); return Promise.reject(staleError()); })
      .mockResolvedValueOnce({ default: () => <p>Satellite inset</p> });
    renderEditorWith(lazyGuarded(load));
    expect(await screen.findByText('Satellite inset', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(false);
    expect(window.sessionStorage.getItem('em.reloadedAt')).toBeNull();
  });
});
