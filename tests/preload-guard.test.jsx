import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function preloadError(win) {
  const e = new Event('vite:preloadError', { cancelable: true });
  expect(() => win.dispatchEvent(e)).not.toThrow();
  return e;
}

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
  const stale = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/LegendEditor-old.js'));

  it('keeps the editor mounted when a stale chunk fails with unsaved work', async () => {
    const guard = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderEditorWith(lazyGuarded(stale));
      expect(await screen.findByText('This part was updated — save your work, then reload.')).toBeInTheDocument();
      expect(screen.getByText('Editor with unsaved work')).toBeInTheDocument();
      expect(screen.queryByText('Editor unmounted')).toBeNull();
    } finally {
      window.removeEventListener('beforeunload', guard);
      err.mockRestore();
    }
  });

  it('throws as before without unsaved work', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderEditorWith(lazyGuarded(stale));
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
  it('reloads once for a stale chunk', () => {
    const win = fakeWindow();
    installPreloadGuard(win);
    const e = preloadError(win);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('does not loop: the reloaded page lets the error stand for a minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const storage = fakeStorage();
    const first = fakeWindow(storage);
    installPreloadGuard(first);
    preloadError(first);
    expect(first.location.reload).toHaveBeenCalledTimes(1);

    // The reloaded page (same tab session) fails again: no second reload.
    vi.setSystemTime(new Date('2026-10-21T12:00:05Z'));
    const second = fakeWindow(storage);
    installPreloadGuard(second);
    const e = preloadError(second);
    preloadError(second);
    expect(second.location.reload).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);

    // A later deploy, well after that reload, gets its own reload (as /3d does).
    vi.setSystemTime(new Date('2026-10-21T14:00:00Z'));
    preloadError(second);
    expect(second.location.reload).toHaveBeenCalledTimes(1);
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
});
