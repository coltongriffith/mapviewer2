import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useClaims } from '../src/hooks/useClaims';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const fc = (n) => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', properties: { i }, geometry: null })),
});
const okResponse = (data) => ({ ok: true, json: () => Promise.resolve(data) });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('useClaims request ordering', () => {
  it('alpha starts, beta starts, beta returns first, alpha returns later → only beta remains', async () => {
    const alpha = deferred();
    const beta = deferred();
    fetchMock.mockImplementation((url) => {
      if (url.includes('q=alpha')) return alpha.promise;
      return beta.promise;
    });

    const { result } = renderHook(() => useClaims());
    act(() => { result.current.search('alpha', 'company', 'bc'); });
    act(() => { result.current.search('beta', 'company', 'bc'); });

    beta.resolve(okResponse(fc(2)));
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(result.current.results.features).toHaveLength(2);
    expect(result.current.loading).toBe(false);

    // Stale alpha lands afterwards — must not overwrite beta.
    alpha.resolve(okResponse(fc(7)));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.results.features).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('a stale request failing after a newer success shows no error', async () => {
    const alpha = deferred();
    const beta = deferred();
    fetchMock.mockImplementation((url) => (url.includes('q=alpha') ? alpha.promise : beta.promise));

    const { result } = renderHook(() => useClaims());
    act(() => { result.current.search('alpha', 'company', 'bc'); });
    act(() => { result.current.search('beta', 'company', 'bc'); });

    beta.resolve(okResponse(fc(1)));
    await waitFor(() => expect(result.current.results).not.toBeNull());

    alpha.reject(new Error('upstream exploded'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.error).toBeNull();
    expect(result.current.results.features).toHaveLength(1);
  });

  it('starting a search aborts the previous in-flight request', async () => {
    const seenSignals = [];
    fetchMock.mockImplementation((url, opts) => {
      seenSignals.push(opts?.signal);
      return new Promise(() => {}); // never resolves
    });
    const { result } = renderHook(() => useClaims());
    act(() => { result.current.search('first', 'company', 'bc'); });
    act(() => { result.current.search('second', 'company', 'bc'); });
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(seenSignals[1]?.aborted).toBe(false);
  });
});

describe('useClaims reset during an active request', () => {
  it('reset() invalidates an unresolved primary search — its response is discarded', async () => {
    const slow = deferred();
    fetchMock.mockReturnValue(slow.promise);

    const { result } = renderHook(() => useClaims());
    act(() => { result.current.search('goldco', 'company', 'bc'); });
    expect(result.current.loading).toBe(true);

    act(() => { result.current.reset(); });
    expect(result.current.loading).toBe(false);

    slow.resolve(okResponse(fc(5)));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('reset() invalidates an unresolved cross-province sweep', async () => {
    const slow = deferred();
    fetchMock.mockReturnValue(slow.promise);

    const { result } = renderHook(() => useClaims());
    act(() => {
      result.current.searchOtherProvinces('goldco', 'company', 'bc', [
        { value: 'on', label: 'Ontario' },
      ]);
    });
    expect(result.current.crossProvinceLoading).toBe(true);

    act(() => { result.current.reset(); });
    expect(result.current.crossProvinceLoading).toBe(false);

    slow.resolve(okResponse(fc(3)));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.crossProvinceHits).toBeNull();
  });
});

describe('useClaims cross-province vs primary ordering', () => {
  it('a newer primary search discards a slower cross-province sweep', async () => {
    const sweep = deferred();
    const primary = deferred();
    fetchMock.mockImplementation((url) => (url.includes('province=on') ? sweep.promise : primary.promise));

    const { result } = renderHook(() => useClaims());
    act(() => {
      result.current.searchOtherProvinces('goldco', 'company', 'bc', [{ value: 'on', label: 'Ontario' }]);
    });
    act(() => { result.current.search('silverco', 'company', 'bc'); });

    primary.resolve(okResponse(fc(4)));
    await waitFor(() => expect(result.current.results).not.toBeNull());

    sweep.resolve(okResponse(fc(9)));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.crossProvinceHits).toBeNull(); // stale sweep discarded
    expect(result.current.results.features).toHaveLength(4);
  });

  it('adoptResults() invalidates in-flight requests so they cannot clobber the adopted data', async () => {
    const slow = deferred();
    fetchMock.mockReturnValue(slow.promise);

    const { result } = renderHook(() => useClaims());
    act(() => { result.current.search('goldco', 'company', 'bc'); });
    act(() => { result.current.adoptResults(fc(6)); });
    expect(result.current.results.features).toHaveLength(6);

    slow.resolve(okResponse(fc(1)));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.results.features).toHaveLength(6);
  });
});
