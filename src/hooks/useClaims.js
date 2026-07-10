import { useState, useCallback, useRef, useEffect } from 'react';

const PROXY = '/api/claims';

async function fetchProvince(query, type, province, signal) {
  const params = new URLSearchParams({ q: query.trim(), type, province });
  const res = await fetch(`${PROXY}?${params}`, signal ? { signal } : undefined);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data?.features) throw new Error('Unexpected response format from registry');
  return data;
}

export function useClaims() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [crossProvinceHits, setCrossProvinceHits] = useState(null);
  const [crossProvinceLoading, setCrossProvinceLoading] = useState(false);
  // Request-generation counter + abort controller. Every new primary search,
  // cross-province sweep, or reset() invalidates everything before it:
  //  * stale responses are discarded by the generation check, so an older
  //    search can never overwrite a newer one's results;
  //  * in-flight fetches are actively aborted so they stop consuming network;
  //  * aborted requests never surface a user-facing error.
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);

  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
    }
    abortRef.current = typeof AbortController !== 'undefined' ? new AbortController() : null;
    return { id: requestIdRef.current, signal: abortRef.current?.signal };
  }, []);

  // Abort anything still in flight on unmount.
  useEffect(() => () => {
    requestIdRef.current += 1;
    try { abortRef.current?.abort(); } catch { /* noop */ }
  }, []);

  // type: 'company' | 'number' | 'map'; province: 'bc' | 'on' | 'sk' | 'yt'…
  const search = useCallback(async (query, type = 'company', province = 'bc') => {
    const { id, signal } = invalidate();
    setLoading(true);
    setError(null);
    setResults(null);
    setCrossProvinceHits(null);
    try {
      const data = await fetchProvince(query, type, province, signal);
      if (requestIdRef.current !== id) return;   // a newer search took over
      setResults(data);
    } catch (e) {
      if (requestIdRef.current !== id) return;   // stale OR aborted-by-newer
      if (e?.name === 'AbortError') return;      // cancellation is not an error
      setError(String(e.message || 'Search failed').slice(0, 200));
    } finally {
      if (requestIdRef.current === id) setLoading(false);
    }
  }, [invalidate]);

  // Best-effort background check of every other supported province, used when
  // the primary search comes back empty so we can point the user at the right
  // one instead of leaving them with a bare "nothing found". Failures and
  // zero-result provinces are dropped silently — this never surfaces an error.
  const searchOtherProvinces = useCallback(async (query, type, excludeProvince, candidateProvinces) => {
    const { id, signal } = invalidate();
    setCrossProvinceLoading(true);
    setCrossProvinceHits(null);
    try {
      const settled = await Promise.allSettled(
        candidateProvinces
          .filter((p) => p.value !== excludeProvince)
          .map((p) => fetchProvince(query, type, p.value, signal).then((data) => ({ province: p, data })))
      );
      if (requestIdRef.current !== id) return;
      settled
        .filter((r) => r.status === 'rejected' && r.reason?.name !== 'AbortError')
        .forEach((r) => console.warn('[cross-province search] failed:', r.reason?.message || r.reason));
      const hits = settled
        .filter((r) => r.status === 'fulfilled' && r.value.data.features.length > 0)
        .map((r) => ({ province: r.value.province, count: r.value.data.features.length, data: r.value.data }));
      setCrossProvinceHits(hits);
    } finally {
      if (requestIdRef.current === id) setCrossProvinceLoading(false);
    }
  }, [invalidate]);

  // Adopt an already-fetched FeatureCollection directly (e.g. from a
  // cross-province hit) without re-issuing the request.
  const adoptResults = useCallback((data) => {
    invalidate();  // anything still in flight must not clobber the adoption
    setResults(data);
    setError(null);
    setCrossProvinceHits(null);
    setLoading(false);
    setCrossProvinceLoading(false);
  }, [invalidate]);

  const reset = useCallback(() => {
    invalidate();  // in-flight requests may not repopulate state after a reset
    setResults(null);
    setError(null);
    setLoading(false);
    setCrossProvinceHits(null);
    setCrossProvinceLoading(false);
  }, [invalidate]);

  return {
    results, loading, error, search, reset,
    crossProvinceHits, crossProvinceLoading, searchOtherProvinces, adoptResults,
  };
}
