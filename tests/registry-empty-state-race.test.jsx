import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';

// The empty state must describe the search that RAN, not the one the form is
// currently showing.
//
// handleModeChange only calls reset() when `results || error`, and while a
// request is in flight both are null. So switching tabs mid-request leaves the
// request running while mode, query and province change underneath it. An empty
// COMPANY search landing after the user has hit the Claim # tab would then be
// explained with claim-number advice — guidance for a search that never ran.
//
// The query half of this predates the mode work: the headline has always read
// the live input, so editing the box while a search was in flight made it quote
// text that was never submitted.

vi.mock('../src/utils/track', () => ({ trackSearch: vi.fn(), trackEvent: vi.fn() }));

const useClaimsState = {
  results: null, loading: false, error: null,
  crossProvinceHits: null, crossProvinceLoading: false,
  search: vi.fn(), reset: vi.fn(), searchOtherProvinces: vi.fn(), adoptResults: vi.fn(),
};
vi.mock('../src/hooks/useClaims', () => ({ useClaims: () => useClaimsState }));

const EMPTY_RESULTS = { features: [], resolution: { status: 'resolved' }, meta: {} };

async function renderRegistry() {
  vi.resetModules();
  const { default: RegistrySearch } = await import('../src/components/RegistrySearch.jsx');
  const view = render(<RegistrySearch onImport={() => {}} onBack={() => {}} />);
  return { view, RegistrySearch };
}

/** Re-render with new hook state, the way a resolving request would. */
function resolveWith(view, RegistrySearch, state) {
  Object.assign(useClaimsState, state);
  view.rerender(<RegistrySearch onImport={() => {}} onBack={() => {}} />);
}

describe('empty-state guidance follows the submitted search', () => {
  beforeEach(() => {
    Object.assign(useClaimsState, {
      results: null, loading: false, error: null,
      crossProvinceHits: null, crossProvinceLoading: false,
    });
    vi.clearAllMocks();
  });

  it('keeps company guidance when the user switches to Claim # mid-request', async () => {
    const { view, RegistrySearch } = await renderRegistry();

    // Submit a company search for B.C.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Taseko Mines' } });
    resolveWith(view, RegistrySearch, { loading: true });
    fireEvent.submit(screen.getByRole('textbox').closest('form'));

    // Switch tabs while it is still in flight. reset() is not called, because
    // results and error are both still null.
    const claimNumberTab = screen.getByRole('button', { name: /claim ?#|number/i });
    fireEvent.click(claimNumberTab);
    expect(useClaimsState.reset).not.toHaveBeenCalled();

    // The company search now lands, empty.
    resolveWith(view, RegistrySearch, { loading: false, results: EMPTY_RESULTS });

    await waitFor(() => expect(screen.getByText(/No active claims found/)).toBeTruthy());
    const panel = screen.getByText(/No active claims found/).closest('p');

    // Company guidance, because a company search is what ran.
    expect(panel.textContent).toMatch(/subsidiary/i);
    expect(panel.textContent).not.toMatch(/check the number/i);
  });

  it('quotes the submitted query, not whatever is now in the box', async () => {
    const { view, RegistrySearch } = await renderRegistry();

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Taseko Mines' } });
    resolveWith(view, RegistrySearch, { loading: true });
    fireEvent.submit(input.closest('form'));

    // User keeps typing while the request is in flight.
    fireEvent.change(input, { target: { value: 'something else entirely' } });

    resolveWith(view, RegistrySearch, { loading: false, results: EMPTY_RESULTS });

    await waitFor(() => expect(screen.getByText(/No active claims found/)).toBeTruthy());
    const panel = screen.getByText(/No active claims found/).closest('p');
    expect(panel.textContent).toMatch(/Taseko Mines/);
    expect(panel.textContent).not.toMatch(/something else entirely/);
  });

  it('gives number guidance when a number search is what actually ran', async () => {
    const { view, RegistrySearch } = await renderRegistry();

    fireEvent.click(screen.getByRole('button', { name: /claim ?#|number/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1012345' } });
    resolveWith(view, RegistrySearch, { loading: true });
    fireEvent.submit(screen.getByRole('textbox').closest('form'));
    resolveWith(view, RegistrySearch, { loading: false, results: EMPTY_RESULTS });

    await waitFor(() => expect(screen.getByText(/No active claims found/)).toBeTruthy());
    const panel = screen.getByText(/No active claims found/).closest('p');
    expect(panel.textContent).toMatch(/check the number/i);
    expect(panel.textContent).not.toMatch(/subsidiary/i);
  });
});

describe('the submitted search is captured at dispatch, not at resolution', () => {
  // STRUCTURAL ON PURPOSE, and worth saying why rather than dressing it up as
  // behaviour: the property is about WHICH FRAME gets painted. React commits
  // the render carrying the new `results` first and runs passive effects after,
  // so capturing in an effect drew the empty state once from the previous
  // search's query and jurisdiction before correcting itself. React Testing
  // Library flushes passive effects inside act(), so that frame does not exist
  // for it to observe — the three behavioural tests above pass identically
  // against both implementations, which is exactly why they are not enough
  // here.
  //
  // Dispatch-time capture is safe because useClaims.search() calls
  // setResults(null) synchronously before fetching, so nothing is on screen for
  // these values to misdescribe while a request is in flight.
  const src = readFileSync('src/components/RegistrySearch.jsx', 'utf8');

  it('sets it beside every pendingSearchRef assignment', () => {
    const dispatches = [...src.matchAll(/pendingSearchRef\.current = \{[^;]*;\n([^\n]*)/g)];
    expect(dispatches.length, 'no search dispatch sites found').toBeGreaterThan(0);
    for (const [, nextLine] of dispatches) {
      expect(
        nextLine,
        'a search is dispatched without recording what it asked for — its empty '
        + 'state would paint one frame describing the previous search',
      ).toMatch(/setSubmitted\(/);
    }
  });

  it('does not set it from the outcome effect', () => {
    const effect = src.slice(
      src.indexOf('// Record the outcome of a submitted search once it resolves'),
      src.indexOf('}, [results, error, loading, searchOtherProvinces]);'),
    );
    expect(effect.length, 'outcome effect not found').toBeGreaterThan(0);
    expect(
      /setSubmitted\(/.test(effect),
      'capturing here runs after the results have already been committed, which '
      + 'is the one-frame flash this moved away from',
    ).toBe(false);
  });

  it('relies on search() clearing results before it fetches', () => {
    // If this stops being true, dispatch-time capture starts describing the
    // PREVIOUS results, which are still on screen — the opposite error.
    const hook = readFileSync('src/hooks/useClaims.js', 'utf8');
    const search = hook.slice(hook.indexOf('const search = useCallback'), hook.indexOf('const searchOtherProvinces'));
    expect(search).toMatch(/setResults\(null\)/);
  });
});
