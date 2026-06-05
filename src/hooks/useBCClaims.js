import { useState, useCallback } from 'react';

const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub/wfs';
const PROXY = '/api/bc-claims';
const LAYER = 'pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW';

function buildWfsUrl(company) {
  const u = new URL(WFS_BASE);
  u.searchParams.set('SERVICE', 'WFS');
  u.searchParams.set('VERSION', '2.0.0');
  u.searchParams.set('REQUEST', 'GetFeature');
  u.searchParams.set('outputFormat', 'application/json');
  u.searchParams.set('typeNames', LAYER);
  u.searchParams.set('SRSNAME', 'EPSG:4326');
  u.searchParams.set('CQL_FILTER', `TENURE_HOLDER ILIKE '%${company.trim().replace(/'/g, "''")}%'`);
  u.searchParams.set('count', '500');
  return u.toString();
}

export function useBCClaims() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const search = useCallback(async (company) => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      let data;
      // 1. Try direct fetch (CORS may block; if so, fall through to proxy)
      try {
        const res = await fetch(buildWfsUrl(company), {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`WFS ${res.status}`);
        data = await res.json();
      } catch {
        // 2. Fall back to Vercel serverless proxy
        const res = await fetch(`${PROXY}?company=${encodeURIComponent(company.trim())}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        data = await res.json();
      }

      if (!data?.features) {
        throw new Error('Unexpected response format from BC WFS');
      }
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
