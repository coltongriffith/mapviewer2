import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useClaims } from '../hooks/useClaims';
import { trackSearch } from '../utils/track';

// ── Spatial clustering helpers ─────────────────────────────────────────────

function getCentroid(feature) {
  const pts = [];
  function walk(c) {
    if (typeof c[0] === 'number') pts.push(c);
    else c.forEach(walk);
  }
  const geom = feature.geometry;
  if (geom?.coordinates) walk(geom.coordinates);
  if (!pts.length) return [0, 0];
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bcRegionLabel([lng, lat]) {
  if (lat > 58) return 'Northwest BC';
  if (lat > 56) return lng < -124 ? 'Northern Interior' : 'Northeast BC';
  if (lat > 54) return lng < -126 ? 'Skeena / Haida Gwaii' : lng < -122 ? 'Prince George Area' : 'Peace Country';
  if (lat > 52) return lng < -124 ? 'Cariboo / Chilcotin' : 'Rocky Mountains';
  if (lat > 50) return lng < -121 ? 'Thompson–Okanagan' : 'East Kootenay';
  return lng < -123 ? 'Vancouver Island Area' : 'West Kootenay';
}

// Compass-style labels relative to the spread of all clusters, for provinces
// without hand-tuned region names.
function compassLabels(clusters) {
  if (clusters.length <= 1) return clusters.map(() => 'Claim Area');
  const lngs = clusters.map(c => c.centroid[0]);
  const lats = clusters.map(c => c.centroid[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const third = (v, min, max) => (max - min < 1e-6 ? 1 : Math.min(2, Math.floor(((v - min) / (max - min)) * 3)));
  const GRID = [
    ['Southwest Group', 'Southern Group', 'Southeast Group'],
    ['Western Group', 'Central Group', 'Eastern Group'],
    ['Northwest Group', 'Northern Group', 'Northeast Group'],
  ];
  const labels = clusters.map(c => GRID[third(c.centroid[1], minLat, maxLat)][third(c.centroid[0], minLng, maxLng)]);
  // De-duplicate repeated labels with a counter
  const totals = labels.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const seen = new Map();
  return labels.map(l => {
    if ((totals.get(l) || 0) <= 1) return l;
    const n = (seen.get(l) || 0) + 1;
    seen.set(l, n);
    return `${l} ${n}`;
  });
}

function clusterFeatures(features, thresholdKm = 50) {
  const n = features.length;
  if (!n) return [];
  const centroids = features.map(getCentroid);
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function unite(x, y) {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineKm(centroids[i], centroids[j]) < thresholdKm) unite(i, j);
    }
  }

  const map = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!map.has(root)) map.set(root, []);
    map.get(root).push(i);
  }

  return [...map.values()]
    .map(indices => {
      const feats = indices.map(i => features[i]);
      const ctrs = indices.map(i => centroids[i]);
      const avgLng = ctrs.reduce((s, c) => s + c[0], 0) / ctrs.length;
      const avgLat = ctrs.reduce((s, c) => s + c[1], 0) / ctrs.length;
      const totalHa = feats.reduce((s, f) => s + (Number(f.properties?.AREA_IN_HECTARES) || 0), 0);
      const expiries = feats.map(f => f.properties?.GOOD_TO_DATE).filter(Boolean).sort();
      return {
        features: feats,
        centroid: [avgLng, avgLat],
        totalHa,
        earliestExpiry: expiries[0]?.slice(0, 10),
        latestExpiry: expiries[expiries.length - 1]?.slice(0, 10),
      };
    })
    .sort((a, b) => b.features.length - a.features.length);
}

// ── Province + search mode config ──────────────────────────────────────────

const PROVINCES = [
  {
    value: 'bc', label: 'British Columbia', registry: 'Mineral Titles Online',
    modes: ['company', 'number', 'map'],
    placeholders: { company: 'e.g. Teck Resources', number: 'e.g. 1012345', map: 'e.g. 082F056' },
  },
  {
    value: 'on', label: 'Ontario', registry: 'MLAS',
    modes: ['company', 'number'],
    placeholders: { company: 'e.g. Glencore', number: 'e.g. 123456' },
  },
  {
    value: 'sk', label: 'Saskatchewan', registry: 'MARS',
    modes: ['company', 'number'],
    placeholders: { company: 'e.g. Cameco', number: 'e.g. MC00001234' },
  },
  {
    value: 'mb', label: 'Manitoba', registry: 'Mineral Dispositions',
    modes: ['company', 'number'],
    placeholders: { company: 'e.g. Hudbay', number: 'e.g. CB12345' },
  },
  {
    value: 'nl', label: 'Newfoundland & Labrador', registry: 'GeoAtlas',
    modes: ['company', 'number'],
    placeholders: { company: 'e.g. company or licensee', number: 'e.g. 012345' },
  },
  {
    value: 'yt', label: 'Yukon', registry: 'Quartz Claims',
    modes: ['company', 'number'],
    placeholders: { company: 'e.g. claim or owner name', number: 'e.g. YA12345' },
  },
  {
    value: 'qc', label: 'Quebec', registry: 'GESTIM',
    modes: ['company', 'number'],
    placeholders: { company: 'e.g. titleholder name', number: 'e.g. 2654321' },
  },
];

const MODE_LABELS = {
  company: 'Company',
  number: 'Claim #',
  map: 'Map Sheet',
};

function autoDetectMode(q, allowedModes) {
  if (!q) return 'company';
  const t = q.trim();
  if (/^\d+$/.test(t) && allowedModes.includes('number')) return 'number';
  if (/^\d{3}[A-Za-z]/.test(t) && allowedModes.includes('map')) return 'map';
  return 'company';
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RegistrySearch({ onImport, onBack }) {
  const [province, setProvince] = useState('bc');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('company');
  const [manualMode, setManualMode] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [selectedFlat, setSelectedFlat] = useState(new Set());
  const {
    results, loading, error, search, reset,
    crossProvinceHits, crossProvinceLoading, searchOtherProvinces, adoptResults,
  } = useClaims();
  const pendingSearchRef = useRef(null);

  const provinceCfg = PROVINCES.find(p => p.value === province) || PROVINCES[0];

  // Record the outcome of a submitted search once it resolves (results or error).
  useEffect(() => {
    const pending = pendingSearchRef.current;
    if (!pending || loading) return;
    if (results || error) {
      trackSearch({
        kind: 'registry',
        province: pending.province,
        mode: pending.mode,
        query: pending.query,
        resultCount: results?.features?.length ?? 0,
      });
      // A miss in the selected province doesn't mean the company has no
      // claims at all — check the other provinces in the background so a
      // wrong-province guess doesn't read as "search is broken".
      if (!error && results?.features?.length === 0 && pending.mode !== 'map') {
        searchOtherProvinces(pending.query, pending.mode, pending.province, PROVINCES);
      }
      pendingSearchRef.current = null;
    }
  }, [results, error, loading, searchOtherProvinces]);

  function handleSwitchProvince(hit) {
    setProvince(hit.province.value);
    setManualMode(false);
    setMode(autoDetectMode(query, hit.province.modes));
    adoptResults(hit.data);
    clearSelections();
  }

  // Auto-detect mode from query (unless user manually picked)
  useEffect(() => {
    if (!manualMode) setMode(autoDetectMode(query, provinceCfg.modes));
  }, [query, manualMode, provinceCfg]);

  // Selections are index-based — never let them survive a results change
  useEffect(() => {
    setSelectedOwner(null);
    setSelectedGroups(new Set());
    setExpandedGroups(new Set());
    setSelectedFlat(new Set());
  }, [results]);

  const allFeatures = results?.features || [];

  // ── Company mode: owner picker + clustering ──
  const owners = useMemo(() => {
    if (!allFeatures.length || mode !== 'company') return [];
    const counts = new Map();
    const hectares = new Map();
    allFeatures.forEach(f => {
      const name = f.properties?.OWNER_NAME || 'Unknown';
      counts.set(name, (counts.get(name) || 0) + 1);
      hectares.set(name, (hectares.get(name) || 0) + (Number(f.properties?.AREA_IN_HECTARES) || 0));
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, totalHa: hectares.get(name) || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [allFeatures, mode]);

  const activeOwner = selectedOwner || (owners.length === 1 ? owners[0].name : null);
  const companyFeatures = useMemo(
    () => activeOwner ? allFeatures.filter(f => f.properties?.OWNER_NAME === activeOwner) : [],
    [allFeatures, activeOwner]
  );
  const groups = useMemo(() => {
    const clusters = clusterFeatures(companyFeatures);
    const labels = province === 'bc'
      ? clusters.map(c => bcRegionLabel(c.centroid))
      : compassLabels(clusters);
    return clusters.map((c, i) => ({ ...c, label: labels[i] }));
  }, [companyFeatures, province]);

  const totalSelectedClaims = useMemo(
    () => [...selectedGroups].reduce((s, i) => s + (groups[i]?.features.length || 0), 0),
    [selectedGroups, groups]
  );
  const totalSelectedHa = useMemo(
    () => [...selectedGroups].reduce((s, i) => s + (groups[i]?.totalHa || 0), 0),
    [selectedGroups, groups]
  );

  // ── Flat mode (claim # or map sheet): simple flat list ──
  const flatSelectedHa = useMemo(
    () => [...selectedFlat].reduce((s, i) => s + (Number(allFeatures[i]?.properties?.AREA_IN_HECTARES) || 0), 0),
    [selectedFlat, allFeatures]
  );

  function clearSelections() {
    setSelectedOwner(null);
    setSelectedGroups(new Set());
    setExpandedGroups(new Set());
    setSelectedFlat(new Set());
  }

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    clearSelections();
    pendingSearchRef.current = { province, mode, query: query.trim() };
    search(query.trim(), mode, province);
  }

  function handleQueryChange(val) {
    setQuery(val);
    if (results || error) {
      reset();
      clearSelections();
    }
  }

  function handleProvinceChange(val) {
    setProvince(val);
    setManualMode(false);
    const cfg = PROVINCES.find(p => p.value === val) || PROVINCES[0];
    setMode(autoDetectMode(query, cfg.modes));
    reset();
    clearSelections();
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setManualMode(true);
    if (results || error) {
      reset();
      clearSelections();
    }
  }

  function handleOwnerSelect(ownerName) {
    setSelectedOwner(ownerName);
    setSelectedGroups(new Set());
    setExpandedGroups(new Set());
  }

  function handleBackToOwners() {
    setSelectedOwner(null);
    setSelectedGroups(new Set());
    setExpandedGroups(new Set());
  }

  function toggleGroup(i) {
    setSelectedGroups(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  }

  function toggleExpand(i, e) {
    e.preventDefault();
    e.stopPropagation();
    setExpandedGroups(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  }

  function toggleFlat(i) {
    setSelectedFlat(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  }

  function handleSelectAll(checked) {
    setSelectedGroups(checked ? new Set(groups.map((_, i) => i)) : new Set());
  }

  function handleSelectAllFlat(checked) {
    setSelectedFlat(checked ? new Set(allFeatures.map((_, i) => i)) : new Set());
  }

  function handleAddGroups() {
    const items = [...selectedGroups].sort((a, b) => a - b).map(i => {
      const g = groups[i];
      const holder = activeOwner || g.features[0]?.properties?.OWNER_NAME || query;
      return {
        geojson: { type: 'FeatureCollection', features: g.features },
        name: groups.length > 1 ? `${holder} – ${g.label}` : `${holder} Claims`,
      };
    });
    onImport(items);
  }

  function handleAddFlat() {
    const features = [...selectedFlat].sort((a, b) => a - b).map(i => allFeatures[i]);
    const holder = features[0]?.properties?.OWNER_NAME || query;
    onImport([{
      geojson: { type: 'FeatureCollection', features },
      name: mode === 'number' ? `Claim ${query}` : `${holder} Claims`,
    }]);
  }

  const allGroupsSelected = groups.length > 0 && selectedGroups.size === groups.length;
  const allFlatSelected = allFeatures.length > 0 && selectedFlat.size === allFeatures.length;
  const showOwnerPicker = mode === 'company' && results && owners.length > 1 && !activeOwner;
  const showGroups = mode === 'company' && !!activeOwner;
  const showFlatList = mode !== 'company' && results && allFeatures.length > 0;

  return (
    <>
      <h3 className="export-hd-title">Claims Registry Search</h3>

      {/* Province selector */}
      <div className="claims-province-row">
        <select
          className="export-hd-input claims-province-select"
          value={province}
          onChange={e => handleProvinceChange(e.target.value)}
        >
          {PROVINCES.map(p => (
            <option key={p.value} value={p.value}>{p.label} — {p.registry}</option>
          ))}
        </select>
      </div>
      <p className="claims-province-hint">
        Not sure which province? Search any company name — we'll check the others automatically if nothing turns up here.
      </p>

      {/* Search mode tabs */}
      <div className="claims-mode-tabs">
        {provinceCfg.modes.map(m => (
          <button
            key={m}
            type="button"
            className={`claims-mode-tab${mode === m ? ' active' : ''}`}
            onClick={() => handleModeChange(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch}>
        <div className="claims-search-row">
          <input
            className="export-hd-input claims-search-input"
            placeholder={provinceCfg.placeholders[mode] || provinceCfg.placeholders.company}
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
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

      {results && allFeatures.length === 0 && (
        <>
          <p className="claims-empty">No active claims found for "{query}" in {provinceCfg.label}. Try a shorter name or check spelling.</p>
          {crossProvinceLoading && (
            <p className="claims-cross-province-checking">Checking other provinces…</p>
          )}
          {crossProvinceHits && crossProvinceHits.length > 0 && (
            <div className="claims-cross-province-hits">
              <p className="claims-cross-province-label">Found elsewhere:</p>
              {crossProvinceHits.map((hit) => (
                <button
                  key={hit.province.value}
                  type="button"
                  className="claims-cross-province-row"
                  onClick={() => handleSwitchProvince(hit)}
                >
                  <span>{hit.province.label} — {hit.count} claim{hit.count !== 1 ? 's' : ''} found</span>
                  <span className="claims-cross-province-switch">Switch &amp; view →</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {allFeatures.length >= 500 && (
        <p className="claims-limit-warning">⚠ Showing first 500 results — try a more specific search if your target is missing.</p>
      )}

      {/* Company mode: owner picker */}
      {showOwnerPicker && (
        <>
          <p className="claims-owner-hint">
            Found {owners.length} matching companies — select the right one:
          </p>
          <div className="claims-owner-list">
            {owners.map(({ name, count, totalHa }) => (
              <button key={name} className="claims-owner-row" onClick={() => handleOwnerSelect(name)}>
                <span className="claims-owner-name">{name}</span>
                <span className="claims-owner-meta">
                  {count} claim{count !== 1 ? 's' : ''}{totalHa > 0 ? ` · ${totalHa.toFixed(0)} ha` : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Company mode: claim groups */}
      {showGroups && (
        <>
          {owners.length > 1 && (
            <button className="claims-owner-back" onClick={handleBackToOwners}>
              ← {activeOwner}
            </button>
          )}

          {groups.length === 0 && <p className="claims-empty">No active claims found for this owner.</p>}

          {groups.length > 0 && (
            <>
              <div className="claims-list-header">
                <label className="claims-select-all">
                  <input type="checkbox" checked={allGroupsSelected} onChange={e => handleSelectAll(e.target.checked)} />
                  {allGroupsSelected ? 'Deselect All' : 'Select All'}
                  <span className="claims-count-badge">{groups.length} area{groups.length !== 1 ? 's' : ''}</span>
                </label>
                {selectedGroups.size > 0 && (
                  <span className="claims-selection-summary">
                    {totalSelectedClaims} claims{totalSelectedHa > 0 ? ` · ${totalSelectedHa.toFixed(0)} ha` : ''}
                  </span>
                )}
              </div>

              <div className="claims-results-list">
                {groups.map((group, gi) => {
                  const isSel = selectedGroups.has(gi);
                  const isExp = expandedGroups.has(gi);
                  return (
                    <div key={gi} className={`claims-group${isSel ? ' selected' : ''}`}>
                      <div className="claims-group-header">
                        <input type="checkbox" checked={isSel} onChange={() => toggleGroup(gi)} className="claims-group-check" />
                        <div className="claims-group-info" onClick={() => toggleGroup(gi)}>
                          <span className="claims-group-label">{group.label}</span>
                          <span className="claims-group-meta">
                            {group.features.length} claim{group.features.length !== 1 ? 's' : ''} · {group.totalHa > 0 ? `${group.totalHa.toFixed(0)} ha` : ''}
                            {group.earliestExpiry ? ` · exp. ${group.latestExpiry}` : ''}
                          </span>
                        </div>
                        <button className="claims-group-expand" type="button" onClick={e => toggleExpand(gi, e)} title={isExp ? 'Collapse' : 'Expand claims'}>
                          {isExp ? '▲' : '▼'}
                        </button>
                      </div>

                      {isExp && (
                        <div className="claims-group-items">
                          {group.features.map((f, fi) => {
                            const p = f.properties || {};
                            return (
                              <div key={fi} className="claims-subrow">
                                <span className="claims-result-number">{p.TAG_NUMBER || p.TENURE_NUMBER_ID || '—'}</span>
                                <span className="claims-result-type">{p.TITLE_TYPE_DESCRIPTION || ''}</span>
                                <span className="claims-result-meta">
                                  {p.AREA_IN_HECTARES ? `${Number(p.AREA_IN_HECTARES).toFixed(1)} ha` : ''}
                                  {p.GOOD_TO_DATE ? ` · ${String(p.GOOD_TO_DATE).slice(0, 10)}` : ''}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button className="share-generate-btn" disabled={selectedGroups.size === 0} onClick={handleAddGroups}>
                {selectedGroups.size === 0
                  ? 'Select areas to add'
                  : selectedGroups.size === 1
                    ? `Add ${totalSelectedClaims} claims to map`
                    : `Add ${selectedGroups.size} areas to map (${totalSelectedClaims} claims)`}
              </button>
            </>
          )}
        </>
      )}

      {/* Flat list for claim # and map sheet searches */}
      {showFlatList && (
        <>
          <div className="claims-list-header">
            <label className="claims-select-all">
              <input type="checkbox" checked={allFlatSelected} onChange={e => handleSelectAllFlat(e.target.checked)} />
              {allFlatSelected ? 'Deselect All' : 'Select All'}
              <span className="claims-count-badge">{allFeatures.length} claim{allFeatures.length !== 1 ? 's' : ''}</span>
            </label>
            {selectedFlat.size > 0 && (
              <span className="claims-selection-summary">{selectedFlat.size} selected{flatSelectedHa > 0 ? ` · ${flatSelectedHa.toFixed(0)} ha` : ''}</span>
            )}
          </div>

          <div className="claims-results-list">
            {allFeatures.map((f, i) => {
              const p = f.properties || {};
              const isSel = selectedFlat.has(i);
              return (
                <label key={i} className={`claims-result-row${isSel ? ' selected' : ''}`}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleFlat(i)} />
                  <div className="claims-result-info">
                    <span className="claims-result-number">{p.TAG_NUMBER || p.TENURE_NUMBER_ID || '—'}</span>
                    <span className="claims-result-holder">{p.OWNER_NAME || '—'}</span>
                    <span className="claims-result-meta">
                      {p.TITLE_TYPE_DESCRIPTION || ''} · {p.AREA_IN_HECTARES ? `${Number(p.AREA_IN_HECTARES).toFixed(1)} ha` : ''}
                      {p.GOOD_TO_DATE ? ` · exp. ${String(p.GOOD_TO_DATE).slice(0, 10)}` : ''}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          <button className="share-generate-btn" disabled={selectedFlat.size === 0} onClick={handleAddFlat}>
            {selectedFlat.size === 0
              ? 'Select claims to add'
              : `Add ${selectedFlat.size} claim${selectedFlat.size !== 1 ? 's' : ''} to map`}
          </button>
        </>
      )}

      <button className="export-hd-skip" onClick={onBack}>← Back</button>
    </>
  );
}
