import { useState, useCallback } from 'react';

const PROXY = '/api/claims';

export function useClaims() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // type: 'company' | 'number' | 'map'; province: 'bc' | 'on' | 'sk' | 'yt'
  const search = useCallback(async (query, type = 'company', province = 'bc') => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), type, province });
      const res = await fetch(`${PROXY}?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      if (!data?.features) throw new Error('Unexpected response format from registry');
      setResults(data);
    } catch (e) {
      setError(String(e.message || 'Search failed').slice(0, 200));
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResults(null);
    setError(null);
    setLoading(false);
  }, []);

  return { results, loading, error, search, reset };
}
