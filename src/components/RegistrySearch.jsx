import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useClaims } from '../hooks/useClaims';
import { trackSearch, trackEvent } from '../utils/track';
import {
  US_CLAIMS_ENABLED, US_STATES, US_GROUP_LABEL, US_GEOMETRY_DISCLAIMER,
  US_CLAIM_TYPES, isUsJurisdiction,
} from '../utils/jurisdictions';
import { bestJurisdictionHit, autoAdoptionNotice } from '../utils/claimRanking';
import { scopingWarning, emptyResultMessage } from '../utils/scopingNotice';
import { claimNamePrefix, sourceCredit, CLAIM_NAME_CAVEAT } from '../utils/claimProvenance';

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
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = expiries.filter((d) => d.slice(0, 10) >= today);
      return {
        features: feats,
        centroid: [avgLng, avgLat],
        totalHa,
        // Soonest still-valid expiry (the risk-relevant date), the horizon,
        // and how many claims are already expired.
        earliestExpiry: upcoming[0]?.slice(0, 10),
        latestExpiry: expiries[expiries.length - 1]?.slice(0, 10),
        expiredCount: expiries.length - upcoming.length,
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
    // Manitoba's public iMaQs claim layer publishes no holder name, so only
    // claim-number (tenure / staking tag) lookup is supported — no company mode.
    value: 'mb', label: 'Manitoba', registry: 'Mineral Dispositions',
    modes: ['number'],
    placeholders: { number: 'e.g. CB12345' },
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

// U.S. federal (BLM MLRS) jurisdictions.
//
// The `company` mode is NOT a company search and must never be labelled as one.
// The BLM spatial layer publishes no claimant field, so the server's alias
// ladder resolves against CLAIM NAMES (see api/_lib/us-aliases.js). Claim names
// are chosen by whoever located the claim: they frequently echo an operator's
// name, but they are not an ownership record, and nothing about a name match —
// fuzzy or exact — establishes who holds the ground. So the tab is labelled
// "Project / claim name", results are titled by the matched claim name rather
// than by a company, and importing such a set requires explicit confirmation.
// Real company search needs a claimant source joined on serial number; see
// docs/us-claims.md ("Claimant join").
const US_JURISDICTION_ENTRIES = US_STATES.map((st) => ({
  value: st.value,
  label: st.label,
  registry: 'BLM MLRS (federal)',
  country: 'us',
  // Two tabs, not three. The server still accepts type=name (a literal
  // substring on the claim-name field, used by deep links), but offering it
  // beside the ladder put two tabs on screen that both searched claim names —
  // the ladder is a superset, since its first tier is the literal match.
  modes: ['company', 'number'],
  // Per-jurisdiction label overrides — the mode KEYS stay as they are (they are
  // the API's `type` param); only what the user reads changes.
  modeLabels: { company: 'Project / claim name' },
  placeholders: {
    company: 'e.g. project name, operator name, or US subsidiary',
    number: 'e.g. NV101234567',
  },
}));

// All searchable jurisdictions. Canadian provinces keep their existing
// behavior; US states appear only when the feature flag is on.
const ALL_JURISDICTIONS = [
  ...PROVINCES.map((p) => ({ ...p, country: 'ca' })),
  ...(US_CLAIMS_ENABLED ? US_JURISDICTION_ENTRIES : []),
];

const MODE_LABELS = {
  company: 'Company',
  number: 'Claim #',
  map: 'Map Sheet',
  name: 'Claim Name',
};

function autoDetectMode(q, allowedModes) {
  // Fall back to the province's first supported mode, not a hardcoded
  // 'company' — some provinces (e.g. Manitoba) only support number search.
  const fallback = allowedModes.includes('company') ? 'company' : allowedModes[0];
  if (!q) return fallback;
  const t = q.trim();
  if (/^\d+$/.test(t) && allowedModes.includes('number')) return 'number';
  // US MLRS serials: two-letter state prefix + digits (NV105331298, "nv 105331298")
  if (/^[A-Za-z]{2}[\s-]?\d{4,}$/.test(t) && allowedModes.includes('number')) return 'number';
  if (/^\d{3}[A-Za-z]/.test(t) && allowedModes.includes('map')) return 'map';
  return fallback;
}

// ── Component ──────────────────────────────────────────────────────────────

const LAST_PROVINCE_KEY = 'em_last_province';

export default function RegistrySearch({ onImport, onBack, initialProvince, initialQuery = '', autoSearch = false }) {
  // Default to a deep-link province, else the last province this browser used,
  // else BC — so a repeat visitor isn't reset to BC every time.
  const [province, setProvince] = useState(() => {
    if (initialProvince) return initialProvince;
    try { return localStorage.getItem(LAST_PROVINCE_KEY) || 'bc'; } catch { return 'bc'; }
  });
  useEffect(() => {
    try { localStorage.setItem(LAST_PROVINCE_KEY, province); } catch { /* ignore */ }
  }, [province]);
  const [query, setQuery] = useState(initialQuery);
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
  // Deep-link prefill (e.g. a company page with no published map): run the
  // company-name search once on mount so the visitor sees results immediately
  // instead of an empty box. Cross-province fallback then handles the province.
  const autoSearchedRef = useRef(false);
  useEffect(() => {
    if (!autoSearch || autoSearchedRef.current) return;
    const q = (initialQuery || '').trim();
    if (q.length < 2) return;
    autoSearchedRef.current = true;
    // Company search where supported (all Canadian provinces except MB); US
    // jurisdictions have no claimant data, so fall back to their first
    // supported mode (claim name) instead of firing a request the server
    // rejects with 400.
    const cfg = ALL_JURISDICTIONS.find((p) => p.value === province) || ALL_JURISDICTIONS[0];
    const autoMode = cfg.modes.includes('company') ? 'company' : autoDetectMode(q, cfg.modes);
    // auto: true → a zero-result outcome may adopt a cross-province hit
    // automatically (the visitor didn't choose this province, a deep link did).
    pendingSearchRef.current = { province, mode: autoMode, query: q, auto: true };
    search(q, autoMode, province);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provinceCfg = ALL_JURISDICTIONS.find(p => p.value === province) || ALL_JURISDICTIONS[0];

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
        // Deep-link auto-searches adopt a cross-province hit automatically —
        // the province was a page's guess, not the visitor's choice, so
        // leaving them on "No claims found in <wrong province>" is a dead end.
        // Remember what was ASKED for, so an adopted switch can attribute
        // itself ("Showing Nevada — no BC claims found …").
        autoAdoptRef.current = pending.auto
          ? { requestedProvince: pending.province, query: pending.query }
          : null;
        searchOtherProvinces(
          pending.query,
          pending.mode,
          pending.province,
          // Only fan out to jurisdictions in the SAME COUNTRY that support
          // this search mode — a Canadian company search must not hit 11 BLM
          // states, and a US claim-name search must not hit Canada.
          ALL_JURISDICTIONS.filter((p) =>
            p.country === (ALL_JURISDICTIONS.find((j) => j.value === pending.province)?.country || 'ca')
            && p.modes.includes(pending.mode)),
        );
      }
      pendingSearchRef.current = null;
    }
  }, [results, error, loading, searchOtherProvinces]);

  // Auto-adopt the strongest cross-province hit for deep-link auto-searches.
  // Manual searches keep the explicit "Switch & view" buttons — a user who
  // picked a province themselves shouldn't be yanked to another one.
  const autoAdoptRef = useRef(null);
  // Attribution for a jurisdiction the app chose on the user's behalf. Rendered
  // here AND attached to every imported layer, so an auto-adopted switch can't
  // reach an export unnoticed.
  const [adoptionNotice, setAdoptionNotice] = useState(null);
  useEffect(() => {
    if (!autoAdoptRef.current || crossProvinceLoading) return;
    const request = autoAdoptRef.current;
    autoAdoptRef.current = null;              // consume regardless of outcome
    if (crossProvinceHits?.length) {
      // Rank by materiality (total area, then most recent recording date), not
      // by claim count — see utils/claimRanking.js.
      const top = bestJurisdictionHit(crossProvinceHits);
      if (!top) return;
      // A claim-name-resolved hit is never adopted automatically. It has not
      // been linked to an owner, so silently switching the user to it — and
      // onward into the editor — would present a name coincidence as a
      // company's ground. It stays in the "Found elsewhere" list for an
      // explicit click instead.
      if (top.data?.resolution?.resolvedAgainst === 'claim_name') return;
      const requestedLabel = ALL_JURISDICTIONS.find((p) => p.value === request.requestedProvince)?.label
        || request.requestedProvince;
      handleSwitchProvince(top, {
        message: autoAdoptionNotice(top.province.label, requestedLabel, request.query),
        requestedProvince: request.requestedProvince,
        requestedLabel,
        adoptedProvince: top.province.value,
        adoptedLabel: top.province.label,
        rankedBy: top.rankedBy,
        totalHa: top.totalHa,
        query: request.query,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossProvinceHits, crossProvinceLoading]);

  // notice: set only for switches the app made itself. A manual "Switch & view"
  // click passes nothing and behaves exactly as before.
  function handleSwitchProvince(hit, notice = null) {
    setProvince(hit.province.value);
    setManualMode(false);
    setMode(autoDetectMode(query, hit.province.modes));
    adoptResults(hit.data);
    clearSelections();
    setAdoptionNotice(notice);
  }

  // Auto-detect mode from query (unless user manually picked)
  useEffect(() => {
    if (!manualMode) setMode(autoDetectMode(query, provinceCfg.modes));
  }, [query, manualMode, provinceCfg]);

  // US-only claim-type filter (lode/placer/mill/tunnel). Client-side and
  // exact: US result sets are complete (server paginates to the ceiling).
  const [usTypeFilter, setUsTypeFilter] = useState('all');
  const isUS = isUsJurisdiction(province);

  // Selections are index-based — never let them survive a results change
  // OR a type-filter change (indices shift when the list is filtered).
  useEffect(() => {
    setSelectedOwner(null);
    setSelectedGroups(new Set());
    setExpandedGroups(new Set());
    setSelectedFlat(new Set());
  }, [results, usTypeFilter]);
  useEffect(() => { setUsTypeFilter('all'); }, [province]);

  const allFeatures = useMemo(() => {
    const feats = results?.features || [];
    if (!isUS || usTypeFilter === 'all') return feats;
    return feats.filter((f) => (f.properties?.CLAIM_TYPE || 'unknown') === usTypeFilter);
  }, [results, isUS, usTypeFilter]);

  // Degraded-scoping warning for the current result set (null when precise).
  const claimsScopingWarning = useMemo(() => scopingWarning(results?.meta), [results]);

  // True when these claims were linked to the search term by claim name rather
  // than by a claimant record. Such a set may not be titled as a company's
  // claims, and may not enter the editor without explicit confirmation.
  const isClaimNameResolved = results?.resolution?.resolvedAgainst === 'claim_name';
  const [claimNameConfirmed, setClaimNameConfirmed] = useState(false);
  // Any new result set withdraws a previous confirmation.
  useEffect(() => { setClaimNameConfirmed(false); }, [results]);
  const importBlocked = isClaimNameResolved && !claimNameConfirmed;

  // Zero results: which of the two distinct reasons applies.
  const emptyMessage = useMemo(() => emptyResultMessage({
    resolution: results?.resolution,
    query,
    jurisdictionLabel: provinceCfg.label,
    isUs: isUS,
  }), [results, query, provinceCfg, isUS]);

  // ── Company mode: owner picker + clustering ──
  // Holder label for a feature. US federal records carry no claimant, so their
  // bucket is labelled with the company the server actually resolved (falling
  // back to what was typed) — never "Unknown", which would end up as the
  // layer name on the map.
  const ownerFallbackLabel = isUS
    ? (results?.resolution?.company || query.trim() || 'Unknown')
    : 'Unknown';
  const ownerLabelOf = (f) => f?.properties?.OWNER_NAME || ownerFallbackLabel;

  const owners = useMemo(() => {
    if (!allFeatures.length || mode !== 'company') return [];
    const counts = new Map();
    const hectares = new Map();
    allFeatures.forEach(f => {
      const name = ownerLabelOf(f);
      counts.set(name, (counts.get(name) || 0) + 1);
      hectares.set(name, (hectares.get(name) || 0) + (Number(f.properties?.AREA_IN_HECTARES) || 0));
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, totalHa: hectares.get(name) || 0 }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFeatures, mode, ownerFallbackLabel]);

  const activeOwner = selectedOwner || (owners.length === 1 ? owners[0].name : null);
  const companyFeatures = useMemo(
    // Same label rule as the picker above — filtering on the raw field would
    // drop every US record, whose OWNER_NAME is absent.
    () => activeOwner ? allFeatures.filter(f => ownerLabelOf(f) === activeOwner) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allFeatures, activeOwner, ownerFallbackLabel]
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
    // A stale attribution is worse than none — any new search, province change
    // or edited query drops it (handleSwitchProvince re-sets it after this).
    setAdoptionNotice(null);
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
    // ALL_JURISDICTIONS, not PROVINCES: a US state must resolve its own modes
    // (name/number), never fall back to BC's (company/number/map).
    const cfg = ALL_JURISDICTIONS.find(p => p.value === val) || ALL_JURISDICTIONS[0];
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

  // Everything that qualifies the claim set travels with the layer into the
  // editor and into the export credit line: the data source and when it was
  // retrieved, how the state scope was resolved, how the company/name link was
  // made, and whether the app (not the user) chose the jurisdiction. Always
  // returns a value — the export credit needs a source and a date for every
  // registry layer, not only the degraded ones.
  function importProvenance() {
    const warning = scopingWarning(results?.meta);
    const resolvedAgainst = results?.resolution?.resolvedAgainst || null;
    return {
      province,
      provinceLabel: provinceCfg.label,
      registry: provinceCfg.registry,
      dataSource: sourceCredit(provinceCfg, results?.meta, results?.resolution),
      // Live-queried registries: the response IS the snapshot, so retrieval
      // time is the snapshot time. A claimant-resolved set also carries the
      // claimant extract's own snapshot date, which the export credit prefers —
      // ownership from a month-old extract must not read as current.
      retrievedAt: new Date().toISOString().slice(0, 10),
      ...(results?.resolution?.snapshotDate ? { snapshotDate: results.resolution.snapshotDate } : {}),
      ...(results?.meta?.scopingMethod ? { scopingMethod: results.meta.scopingMethod } : {}),
      ...(warning ? { scopingWarning: warning } : {}),
      ...(resolvedAgainst ? { resolvedAgainst } : {}),
      ...(results?.resolution?.method ? { resolutionMethod: results.resolution.method } : {}),
      ...(adoptionNotice ? { autoAdopted: adoptionNotice } : {}),
      // Records that the user was shown the ownership caveat and accepted it.
      ...(isClaimNameResolved ? { claimNameAcknowledged: true } : {}),
    };
  }

  // Layer title for a claim set. A claim-name-resolved set is titled by the
  // matched CLAIM NAME, never "<Company> Claims" — the latter asserts ownership
  // that a name match does not establish.
  function layerTitle(features, groupLabel = null) {
    if (isClaimNameResolved) {
      const prefix = claimNamePrefix(features) || query.trim() || 'Claim-name match';
      return groupLabel ? `${prefix} – ${groupLabel} (claim name)` : `${prefix} (claim name)`;
    }
    const holder = activeOwner || features[0]?.properties?.OWNER_NAME || query;
    if (isUsJurisdiction(province)) {
      const usName = mode === 'number'
        ? features[0]?.properties?.TAG_NUMBER || query
        : features[0]?.properties?.CLAIM_NAME || query;
      return `${usName} Claims (BLM)`;
    }
    if (mode === 'number') return `Claim ${query}`;
    return groupLabel ? `${holder} – ${groupLabel}` : `${holder} Claims`;
  }

  function handleAddGroups() {
    const provenance = importProvenance();
    const items = [...selectedGroups].sort((a, b) => a - b).map(i => {
      const g = groups[i];
      return {
        geojson: { type: 'FeatureCollection', features: g.features },
        name: layerTitle(g.features, groups.length > 1 ? g.label : null),
        provenance,
      };
    });
    // Province + count only coexist here (lost before reaching App's layer add).
    trackEvent('registry_claims_imported', {
      province,
      mode: 'groups',
      groups: items.length,
      features: items.reduce((n, it) => n + (it.geojson.features?.length || 0), 0),
      resolved_against: provenance.resolvedAgainst || 'n/a',
    });
    onImport(items);
  }

  function handleAddFlat() {
    const features = [...selectedFlat].sort((a, b) => a - b).map(i => allFeatures[i]);
    const provenance = importProvenance();
    trackEvent('registry_claims_imported', {
      province, mode: 'flat', groups: 1, features: features.length,
      resolved_against: provenance.resolvedAgainst || 'n/a',
    });
    onImport([{
      geojson: { type: 'FeatureCollection', features },
      name: layerTitle(features),
      provenance,
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
          <optgroup label="Canada">
            {ALL_JURISDICTIONS.filter(p => p.country === 'ca').map(p => (
              <option key={p.value} value={p.value}>{p.label} — {p.registry}</option>
            ))}
          </optgroup>
          {US_CLAIMS_ENABLED && (
            <optgroup label={US_GROUP_LABEL}>
              {ALL_JURISDICTIONS.filter(p => p.country === 'us').map(p => (
                <option key={p.value} value={p.value}>{p.label} — {p.registry}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <p className="claims-province-hint">
        {isUS ? (
          <>
            Federal BLM claims only — state-managed tenure isn't included yet.
            Looking for a company's claims? BLM publishes no claimant names in
            its public map data, so a <strong>Company</strong> search matches the
            company and its known US subsidiaries ("… US Inc.", "… Nevada LLC")
            against claim names — US operators usually name claims after
            themselves (we'll check other states automatically). For an exact
            claimant lookup, find their serial numbers in{' '}
            <a href="https://reports.blm.gov/report/MLRS/103/Mining-Claims-Customer-Info-Report" target="_blank" rel="noreferrer">
              BLM's Customer Info Report
            </a>{' '}and search a serial here.
          </>
        ) : (
          "Not sure which province? Search any company name — we'll check the others automatically if nothing turns up here."
        )}
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
            {provinceCfg.modeLabels?.[m] || MODE_LABELS[m]}
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

      {/* The app picked this jurisdiction, not the user — say so, every time. */}
      {adoptionNotice && (
        <div className="claims-adoption-notice" role="status">
          <strong>{adoptionNotice.message}</strong>
          <span>
            {adoptionNotice.rankedBy === 'area'
              ? 'Chosen as the largest holding by area.'
              : 'Chosen by claim count — no area published for these registries.'}
            {' '}This attribution stays on the layer when you add it to the map.
          </span>
        </div>
      )}

      {/* Claim-name resolution is not an ownership finding. The user has to say
          so out loud before these claims can enter the editor, because from
          there they flow into an exported map that a reader will take as a
          statement about who holds the ground. */}
      {isClaimNameResolved && allFeatures.length > 0 && (
        <div className="claims-namematch-gate" role="alert">
          <strong>Matched by claim name — ownership not established</strong>
          <span>{CLAIM_NAME_CAVEAT}</span>
          <label className="claims-namematch-check">
            <input
              type="checkbox"
              checked={claimNameConfirmed}
              onChange={(e) => setClaimNameConfirmed(e.target.checked)}
            />
            I understand these are claim-name matches, not confirmed holdings.
          </label>
        </div>
      )}

      {/* Degraded state scoping. Never silent: claims shown under an
          administrative scope are labelled as such wherever they appear. */}
      {claimsScopingWarning && allFeatures.length > 0 && (
        <div className="claims-scoping-warning" role="alert">
          <strong>⚠ {claimsScopingWarning.short}</strong>
          <span>{claimsScopingWarning.detail}</span>
        </div>
      )}

      {results?.meta?.truncated && allFeatures.length > 0 && (
        <p className="claims-error" role="status">
          ⚠ Large result set — showing the first {allFeatures.length.toLocaleString()}
          {results.meta.totalKnown ? ` of ${results.meta.totalKnown.toLocaleString()}` : ''} claims.
          Narrow the search (full company name or claim number) to see everything.
        </p>
      )}

      {results && allFeatures.length === 0 && (
        <>
          {/* Two different failures, two different messages — "we couldn't link
              this company to a claim holder" is not "this company holds no
              claims here", and a US issuer holding Nevada ground through a
              subsidiary hits the first one. */}
          <p className={emptyMessage.kind === 'unresolved' ? 'claims-empty claims-empty--unresolved' : 'claims-empty'}>
            {emptyMessage.headline}
            {emptyMessage.detail ? <><br /><span className="claims-empty-detail">{emptyMessage.detail}</span></> : null}
            {emptyMessage.hint ? <><br /><span className="claims-empty-hint">{emptyMessage.hint}</span></> : null}
          </p>
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

      {/* US claim-type filter (lode/placer/mill/tunnel). Applies to whichever
          list renders below — US company results are grouped geographically,
          not by holder, so the chips can't live inside the flat list. */}
      {isUS && results && (allFeatures.length > 0 || usTypeFilter !== 'all') && (
        <div className="claims-mode-tabs" style={{ marginTop: 4 }}>
          {[{ value: 'all', label: 'All types' }, ...US_CLAIM_TYPES].map((t) => (
            <button
              key={t.value}
              type="button"
              className={`claims-mode-tab${usTypeFilter === t.value ? ' active' : ''}`}
              onClick={() => setUsTypeFilter(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
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
                            {group.earliestExpiry ? ` · exp. ${group.earliestExpiry}${group.latestExpiry && group.latestExpiry !== group.earliestExpiry ? `–${group.latestExpiry}` : ''}` : ''}{group.expiredCount > 0 ? ` · ${group.expiredCount} expired` : ''}
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

              <button className="share-generate-btn" disabled={selectedGroups.size === 0 || importBlocked} onClick={handleAddGroups}>
                {importBlocked
                  ? 'Confirm the claim-name notice above to continue'
                  : selectedGroups.size === 0
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
                    <span className="claims-result-holder">{p.CLAIM_NAME || p.OWNER_NAME || '—'}</span>
                    <span className="claims-result-meta">
                      {p.TITLE_TYPE_DESCRIPTION || ''}{p.STATUS ? ` · ${p.STATUS}` : ''} · {p.AREA_IN_HECTARES ? `${Number(p.AREA_IN_HECTARES).toFixed(1)} ha` : ''}
                      {p.GOOD_TO_DATE ? ` · exp. ${String(p.GOOD_TO_DATE).slice(0, 10)}` : ''}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          <button className="share-generate-btn" disabled={selectedFlat.size === 0 || importBlocked} onClick={handleAddFlat}>
            {importBlocked
              ? 'Confirm the claim-name notice above to continue'
              : selectedFlat.size === 0
                ? 'Select claims to add'
                : `Add ${selectedFlat.size} claim${selectedFlat.size !== 1 ? 's' : ''} to map`}
          </button>
        </>
      )}

      {isUS && results && (
        <p className="claims-province-hint" style={{ marginTop: 10 }}>
          {US_GEOMETRY_DISCLAIMER}
        </p>
      )}

      <button className="export-hd-skip" onClick={onBack}>← Back</button>
    </>
  );
}
