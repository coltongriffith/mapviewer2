import { useState, useCallback, useRef } from 'react';

const PROXY = '/api/claims';

async function fetchProvince(query, type, province) {
  const params = new URLSearchParams({ q: query.trim(), type, province });
  const res = await fetch(`${PROXY}?${params}`);
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
  const requestIdRef = useRef(0);

  // type: 'company' | 'number' | 'map'; province: 'bc' | 'on' | 'sk' | 'yt'
  const search = useCallback(async (query, type = 'company', province = 'bc') => {
    requestIdRef.current += 1; // invalidate any in-flight cross-province check from a prior search
    setLoading(true);
    setError(null);
    setResults(null);
    setCrossProvinceHits(null);
    try {
      const data = await fetchProvince(query, type, province);
      setResults(data);
    } catch (e) {
      setError(String(e.message || 'Search failed').slice(0, 200));
    } finally {
      setLoading(false);
    }
  }, []);

  // Best-effort background check of every other supported province, used when
  // the primary search comes back empty so we can point the user at the right
  // one instead of leaving them with a bare "nothing found". Failures and
  // zero-result provinces are dropped silently — this never surfaces an error.
  // A request token guards against a slower, stale call overwriting the
  // results of a newer one if searches overlap.
  const searchOtherProvinces = useCallback(async (query, type, excludeProvince, candidateProvinces) => {
    const myRequestId = ++requestIdRef.current;
    setCrossProvinceLoading(true);
    setCrossProvinceHits(null);
    try {
      const settled = await Promise.allSettled(
        candidateProvinces
          .filter((p) => p.value !== excludeProvince)
          .map((p) => fetchProvince(query, type, p.value).then((data) => ({ province: p, data })))
      );
      if (requestIdRef.current !== myRequestId) return;
      settled
        .filter((r) => r.status === 'rejected')
        .forEach((r) => console.warn('[cross-province search] failed:', r.reason?.message || r.reason));
      const hits = settled
        .filter((r) => r.status === 'fulfilled' && r.value.data.features.length > 0)
        .map((r) => ({ province: r.value.province, count: r.value.data.features.length, data: r.value.data }));
      setCrossProvinceHits(hits);
    } finally {
      if (requestIdRef.current === myRequestId) setCrossProvinceLoading(false);
    }
  }, []);

  // Adopt an already-fetched FeatureCollection directly (e.g. from a
  // cross-province hit) without re-issuing the request.
  const adoptResults = useCallback((data) => {
    setResults(data);
    setError(null);
    setCrossProvinceHits(null);
  }, []);

  const reset = useCallback(() => {
    setResults(null);
    setError(null);
    setLoading(false);
    setCrossProvinceHits(null);
    setCrossProvinceLoading(false);
  }, []);

  return {
    results, loading, error, search, reset,
    crossProvinceHits, crossProvinceLoading, searchOtherProvinces, adoptResults,
  };
}
