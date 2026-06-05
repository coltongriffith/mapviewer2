import React, { useMemo, useState } from 'react';
import { useBCClaims } from '../hooks/useBCClaims';

export default function BCRegistrySearch({ onImport, onBack }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const { results, loading, error, search, reset } = useBCClaims();

  const features = results?.features || [];

  const totalHa = useMemo(() =>
    [...selected].reduce((sum, i) => sum + (Number(features[i]?.properties?.AREA_IN_HECTARES) || 0), 0),
    [selected, features]
  );

  function toggleOne(i, checked) {
    setSelected(prev => {
      const s = new Set(prev);
      checked ? s.add(i) : s.delete(i);
      return s;
    });
  }

  function handleSelectAll(checked) {
    setSelected(checked ? new Set(features.map((_, i) => i)) : new Set());
  }

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSelected(new Set());
    search(query);
  }

  function handleAdd() {
    const selectedFeatures = [...selected].map(i => features[i]);
    const geojson = { type: 'FeatureCollection', features: selectedFeatures };
    const holder = selectedFeatures[0]?.properties?.TENURE_HOLDER || query;
    onImport(geojson, `${holder} Claims`);
  }

  const allSelected = features.length > 0 && selected.size === features.length;

  return (
    <>
      <h3 className="export-hd-title">BC Registry Search</h3>
      <p className="export-hd-desc">Search BC's live mineral tenure registry by company name.</p>

      <form onSubmit={handleSearch}>
        <div className="claims-search-row">
          <input
            className="export-hd-input claims-search-input"
            placeholder="Company name…"
            value={query}
            onChange={e => { setQuery(e.target.value); if (results || error) reset(); }}
            autoFocus
          />
          <button
            className="topbar-btn primary"
            type="submit"
            disabled={loading || query.trim().length < 2}
            style={{ whiteSpace: 'nowrap' }}
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>
      </form>

      {error && <p className="claims-error">⚠ {error}</p>}

      {results && features.length === 0 && (
        <p className="claims-empty">No claims found for "{query}". Try a different company name.</p>
      )}

      {features.length > 0 && (
        <>
          <div className="claims-list-header">
            <label className="claims-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={e => handleSelectAll(e.target.checked)}
              />
              {allSelected ? 'Deselect All' : 'Select All'}
              <span className="claims-count-badge">{features.length}</span>
            </label>
            {selected.size > 0 && (
              <span className="claims-selection-summary">
                {selected.size} selected · {totalHa.toFixed(1)} ha
              </span>
            )}
          </div>

          <div className="claims-results-list">
            {features.map((f, i) => {
              const p = f.properties || {};
              const isSelected = selected.has(i);
              return (
                <label key={i} className={`claims-result-row${isSelected ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={e => toggleOne(i, e.target.checked)}
                  />
                  <div className="claims-result-info">
                    <div className="claims-result-top">
                      <span className="claims-result-number">{p.TENURE_NUMBER || '—'}</span>
                      <span className="claims-result-type">{p.TITLE_TYPE || ''}</span>
                    </div>
                    <div className="claims-result-holder">{p.TENURE_HOLDER || ''}</div>
                    <div className="claims-result-meta">
                      {p.AREA_IN_HECTARES ? `${Number(p.AREA_IN_HECTARES).toFixed(1)} ha` : ''}
                      {p.EXPIRY_DATE ? ` · expires ${String(p.EXPIRY_DATE).slice(0, 10)}` : ''}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <button
            className="share-generate-btn"
            disabled={selected.size === 0}
            onClick={handleAdd}
          >
            Add {selected.size || ''} {selected.size === 1 ? 'claim' : 'claims'} to map
          </button>
        </>
      )}

      <button className="export-hd-skip" onClick={onBack}>← Back</button>
    </>
  );
}
