import React, { useMemo, useState } from 'react';
import { useBCClaims } from '../hooks/useBCClaims';

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
        label: bcRegionLabel([avgLng, avgLat]),
        earliestExpiry: expiries[0]?.slice(0, 10),
        latestExpiry: expiries[expiries.length - 1]?.slice(0, 10),
      };
    })
    .sort((a, b) => b.features.length - a.features.length);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function BCRegistrySearch({ onImport, onBack }) {
  const [query, setQuery] = useState('');
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const { results, loading, error, search, reset } = useBCClaims();

  const allFeatures = results?.features || [];

  // Distinct owner names sorted by claim count descending
  const owners = useMemo(() => {
    if (!allFeatures.length) return [];
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
  }, [allFeatures]);

  // Features for the active owner (or all if only one owner)
  const activeOwner = selectedOwner || (owners.length === 1 ? owners[0].name : null);
  const features = useMemo(
    () => activeOwner ? allFeatures.filter(f => f.properties?.OWNER_NAME === activeOwner) : [],
    [allFeatures, activeOwner]
  );

  const groups = useMemo(() => clusterFeatures(features), [features]);

  const totalSelectedClaims = useMemo(
    () => [...selectedGroups].reduce((s, i) => s + (groups[i]?.features.length || 0), 0),
    [selectedGroups, groups]
  );
  const totalSelectedHa = useMemo(
    () => [...selectedGroups].reduce((s, i) => s + (groups[i]?.totalHa || 0), 0),
    [selectedGroups, groups]
  );

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSelectedOwner(null);
    setSelectedGroups(new Set());
    setExpandedGroups(new Set());
    search(query.trim());
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
    setSelectedGroups(prev => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  }

  function toggleExpand(i, e) {
    e.preventDefault();
    e.stopPropagation();
    setExpandedGroups(prev => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  }

  function handleSelectAll(checked) {
    setSelectedGroups(checked ? new Set(groups.map((_, i) => i)) : new Set());
  }

  function handleAdd() {
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

  const allSelected = groups.length > 0 && selectedGroups.size === groups.length;

  // Showing owner picker: results loaded, multiple owners, none selected yet
  const showOwnerPicker = results && owners.length > 1 && !activeOwner;
  // Showing claim groups: an owner is active
  const showGroups = !!activeOwner;

  return (
    <>
      <h3 className="export-hd-title">BC Registry Search</h3>
      <p className="export-hd-desc">Search BC's live mineral tenure registry by company name.</p>

      <form onSubmit={handleSearch}>
        <div className="claims-search-row">
          <input
            className="export-hd-input claims-search-input"
            placeholder="Company name… e.g. Zimtu Capital"
            value={query}
            onChange={e => { setQuery(e.target.value); if (results || error) { reset(); setSelectedOwner(null); } }}
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
        <p className="claims-empty">No active claims found for "{query}". Try a shorter name or check spelling.</p>
      )}

      {/* Step 2: Owner picker — shown when multiple distinct owners match */}
      {showOwnerPicker && (
        <>
          <p className="claims-owner-hint">
            Found {owners.length} matching companies — select the right one:
          </p>
          <div className="claims-owner-list">
            {owners.map(({ name, count, totalHa }) => (
              <button
                key={name}
                className="claims-owner-row"
                onClick={() => handleOwnerSelect(name)}
              >
                <span className="claims-owner-name">{name}</span>
                <span className="claims-owner-meta">
                  {count} claim{count !== 1 ? 's' : ''} · {totalHa.toFixed(0)} ha
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Step 3: Claim groups for the selected owner */}
      {showGroups && (
        <>
          {owners.length > 1 && (
            <button className="claims-owner-back" onClick={handleBackToOwners}>
              ← {activeOwner}
            </button>
          )}

          {groups.length === 0 && (
            <p className="claims-empty">No active claims found for this owner.</p>
          )}

          {groups.length > 0 && (
            <>
              <div className="claims-list-header">
                <label className="claims-select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={e => handleSelectAll(e.target.checked)}
                  />
                  {allSelected ? 'Deselect All' : 'Select All'}
                  <span className="claims-count-badge">{groups.length} area{groups.length !== 1 ? 's' : ''}</span>
                </label>
                {selectedGroups.size > 0 && (
                  <span className="claims-selection-summary">
                    {totalSelectedClaims} claims · {totalSelectedHa.toFixed(0)} ha
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
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleGroup(gi)}
                          className="claims-group-check"
                        />
                        <div className="claims-group-info" onClick={() => toggleGroup(gi)}>
                          <span className="claims-group-label">{group.label}</span>
                          <span className="claims-group-meta">
                            {group.features.length} claim{group.features.length !== 1 ? 's' : ''} · {group.totalHa > 0 ? `${group.totalHa.toFixed(0)} ha` : ''}
                            {group.earliestExpiry ? ` · exp. ${group.latestExpiry}` : ''}
                          </span>
                        </div>
                        <button
                          className="claims-group-expand"
                          type="button"
                          onClick={e => toggleExpand(gi, e)}
                          title={isExp ? 'Collapse' : 'Expand claims'}
                        >
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

              <button
                className="share-generate-btn"
                disabled={selectedGroups.size === 0}
                onClick={handleAdd}
              >
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

      <button className="export-hd-skip" onClick={onBack}>← Back</button>
    </>
  );
}
