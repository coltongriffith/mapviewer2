import { useState, useCallback } from 'react';
import { loadGeoJSON } from '../utils/importers';
import { maybeReprojectGeoJSON } from '../utils/reproject';

export function useFileParser() {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);

  const parseFile = useCallback(async (file) => {
    setParsing(true);
    setError(null);
    try {
      const geojson = await loadGeoJSON(file);
      return maybeReprojectGeoJSON(geojson);
    } catch (e) {
      setError(e.message || 'Failed to parse file');
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  return { parseFile, parsing, error, setError };
}
