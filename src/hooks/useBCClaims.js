import { useState, useCallback } from 'react';

const PROXY = '/api/bc-claims';

export function useBCClaims() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const search = useCallback(async (company) => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`${PROXY}?company=${encodeURIComponent(company.trim())}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      if (!data?.features) throw new Error('Unexpected response format from BC WFS');
      setResults(data);
    } catch (e) {
      setError(e.message || 'Search failed');
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
