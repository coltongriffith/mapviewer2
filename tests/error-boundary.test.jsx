import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const calls = vi.hoisted(() => ({ reported: [], recovered: [] }));
vi.mock('../src/utils/errorReporter', () => ({ reportError: (error, opts) => calls.reported.push({ error, ...opts }) }));
vi.mock('../src/utils/preloadGuard', async (importOriginal) => ({
  ...(await importOriginal()),
  recoverFromStaleChunk: (error, win, opts) => { calls.recovered.push({ error, opts }); return 'notice'; },
}));
vi.mock('../src/components/FeedbackModal', () => ({ default: () => null }));

import ErrorBoundary from '../src/components/ErrorBoundary.jsx';

const Throws = ({ error }) => { throw error; };

afterEach(() => { cleanup(); calls.reported.length = 0; calls.recovered.length = 0; });

function renderThrowing(error) {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(<ErrorBoundary><Throws error={error} /></ErrorBoundary>);
  } finally {
    err.mockRestore();
  }
}

describe('root ErrorBoundary', () => {
  it('offers "Reload to update" for a stale chunk, not the crash screen, and does not log a crash', () => {
    renderThrowing(new TypeError('Failed to fetch dynamically imported module: https://www.explorationmaps.com/assets/App-JTKPGumv.js'));
    expect(screen.getByRole('button', { name: 'Reload to update' })).toBeInTheDocument();
    expect(screen.getByText('A new version is available')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    // Recovery logs it as stale_chunk (and reloads when it may); no 'react' crash report.
    expect(calls.recovered).toHaveLength(1);
    expect(calls.recovered[0].opts).toEqual({ notice: false });
    expect(calls.reported).toEqual([]);
  });

  it('treats Safari\'s wording and a CSS preload failure the same', () => {
    for (const message of ['Importing a module script failed.', 'Unable to preload CSS for /assets/vendor-leaflet-CIGW-MKW.css']) {
      renderThrowing(new Error(message));
      expect(screen.getByRole('button', { name: 'Reload to update' })).toBeInTheDocument();
      cleanup();
    }
    expect(calls.reported).toEqual([]);
  });

  it('keeps the crash screen and the crash report for a real render error', () => {
    renderThrowing(new TypeError("Cannot read properties of undefined (reading '_removePath')"));
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload to update' })).toBeNull();
    expect(calls.recovered).toEqual([]);
    expect(calls.reported).toEqual([expect.objectContaining({ kind: 'react' })]);
  });
});
