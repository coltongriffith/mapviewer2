import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/mobile-viewer.css';
import { BASEMAPS } from '../utils/basemapConfig';
import {
  normalizeClaims, claimGroups, summarize, commonHolder, handoffProject, daysLeftText, displayName,
} from '../utils/mobileClaims';
import { shareMap } from '../utils/cloudStorage';
import { trackEvent } from '../utils/track';
import { detectRegion } from '../utils/detectRegion';
import { US_GEOMETRY_DISCLAIMER, isUsJurisdiction } from '../utils/jurisdictions';

const ReadOnlyMapStage = React.lazy(() => import('./ReadOnlyMapStage'));

// Amber for anything due within a year, blue for later: the one question a
// phone lookup is usually asking is "when do these lapse".
const BAND_COLORS = {
  urgent: { stroke: '#9a6715', fill: '#c98a1e' },
  soon: { stroke: '#9a6715', fill: '#c98a1e' },
  later: { stroke: '#176b87', fill: '#176b87' },
  expired: { stroke: '#aa3e3e', fill: '#aa3e3e' },
  unknown: { stroke: '#5f6e72', fill: '#7c898c' },
};
const LEGEND = [
  { band: 'soon', match: ['urgent', 'soon'], label: 'Due within a year' },
  { band: 'later', match: ['later'], label: 'Good for 1+ years' },
  { band: 'expired', match: ['expired'], label: 'Expired' },
  { band: 'unknown', match: ['unknown'], label: 'No date in registry' },
];
const GROUPS = [
  { title: 'Expired', match: ['expired'] },
  { title: 'Due within a year', match: ['urgent', 'soon'] },
  { title: 'Good for 1+ years', match: ['later'] },
  { title: 'No date in registry', match: ['unknown'] },
];
const HEADER_H = 184; // top bar, view switch and map key, kept clear when framing
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function styleFor(band, selected) {
  const c = BAND_COLORS[band] || BAND_COLORS.unknown;
  return selected
    ? { color: '#142126', weight: 3, fillColor: '#c65322', fillOpacity: 0.45, opacity: 1 }
    : { color: c.stroke, weight: 1.5, fillColor: c.fill, fillOpacity: band === 'later' ? 0.2 : 0.28, opacity: 1 };
}

const fmtHa = (n) => (n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 1 : 0 })} ha`);
const claimLabel = (c) => c.name || (c.number ? `Claim ${c.number}` : 'Claim');
// BC numbers tenures, Quebec titles; everywhere else it is a claim number.
const numberLabel = (c) => ({ bc: 'Tenure', qc: 'Title' }[c.registry?.code] || 'Claim');

function Icon({ d, size = 20, stroke = 2 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );
}

/**
 * The phone's way into a claim search or a company's claims: a full-screen
 * map and list that answer where the claims are, who holds them and when they
 * lapse. Styling and layout stay a desktop job; this hands the map on (email
 * link, share link, PNG) or steps aside for the editor.
 */
export default function MobileClaimsViewer({
  project, layerIds, title: titleProp = null, source = 'search', initialSheet = null,
  user = null, entitlements = null, signInWithMagicLink, onSaveToAccount, onEditHere, onBack,
}) {
  const layers = useMemo(() => {
    const keep = new Set(layerIds);
    return (project.layers || []).filter((l) => keep.has(l.id) && l.geojson?.features?.length);
  }, [project.layers, layerIds]);
  const claims = useMemo(() => normalizeClaims(layers), [layers]);
  const byKey = useMemo(() => new Map(claims.map((c) => [c.key, c])), [claims]);
  const groups = useMemo(() => claimGroups(claims), [claims]);
  const primary = groups[0] || claims;
  const elsewhere = claims.length - primary.length;
  const summary = useMemo(() => summarize(claims), [claims]);
  const title = titleProp || commonHolder(claims) || displayName(layers[0]?.displayName || layers[0]?.name) || 'Claims';
  const countText = `${summary.count.toLocaleString('en-US')} claim${summary.count === 1 ? '' : 's'}`;
  const subtitle = summary.places ? `${countText} · ${summary.places}` : countText;
  const isUs = claims.some((c) => isUsJurisdiction(c.registry?.code));

  const [view, setView] = useState('map');
  const [sheet, setSheet] = useState(initialSheet === 'desktop' ? 'desktop' : 'peek');
  const [selectedKey, setSelectedKey] = useState(null);
  const [sort, setSort] = useState('date');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [basemap, setBasemap] = useState('terrain');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState(null);
  const [toast, setToast] = useState(null);
  const [sheetH, setSheetH] = useState(180);
  const [exportProject, setExportProject] = useState(null);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const sheetRef = useRef(null);
  const layerIndex = useRef(new Map());
  const selectRef = useRef(null);
  const selectFrom = useRef('map');
  const interacted = useRef(false);
  const toastTimer = useRef(null);
  const shareCache = useRef(null);
  const exportStarted = useRef(false);
  const openedTracked = useRef(false);
  const chipShown = useRef(false);
  chipShown.current = elsewhere > 0;

  const act = (action) => trackEvent('mobile_viewer_action', { action, source });
  const say = useCallback((message, ms = 2600) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    if (ms) toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (openedTracked.current || !claims.length) return;
    openedTracked.current = true;
    trackEvent('mobile_viewer_opened', { source, claims: claims.length, groups: groups.length });
  }, [claims.length, groups.length, source]);

  // ── Map ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
    map.attributionControl.setPrefix(false);
    L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);
    map.on('click', () => selectRef.current?.(null));
    map.on('dragstart', () => { interacted.current = true; });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cfg = BASEMAPS[basemap] || BASEMAPS.terrain;
    const tiles = L.tileLayer(cfg.url, {
      attribution: cfg.attribution, maxZoom: 19, crossOrigin: true,
      ...(cfg.maxNativeZoom ? { maxNativeZoom: cfg.maxNativeZoom } : {}),
    }).addTo(map);
    tiles.bringToBack();
    return () => { tiles.remove(); };
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    const index = layerIndex.current;
    index.clear();
    const geo = L.geoJSON(null, {
      style: (f) => styleFor(byKey.get(f.properties.key)?.band, false),
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 7 }),
      bubblingMouseEvents: false,
      onEachFeature: (f, layer) => {
        index.set(f.properties.key, layer);
        layer.on('click', (e) => { L.DomEvent.stopPropagation(e); selectRef.current?.(f.properties.key, 'map'); });
      },
    });
    claims.forEach((c) => geo.addData({ type: 'Feature', geometry: c.feature.geometry, properties: { key: c.key } }));
    geo.addTo(map);
    return () => { geo.remove(); };
  }, [claims, byKey]);

  const fitTo = useCallback((list, animate = true) => {
    const map = mapRef.current;
    if (!map || !list.length) return;
    const keys = new Set(list.map((c) => c.key));
    let bounds = null;
    layerIndex.current.forEach((layer, key) => {
      if (!keys.has(key)) return;
      const b = layer.getBounds ? layer.getBounds() : L.latLngBounds([layer.getLatLng()]);
      bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
    });
    if (!bounds?.isValid()) return;
    map.invalidateSize();
    // Clear of the sheet, and of the "claims elsewhere" chip above it.
    const bottom = (sheetRef.current?.offsetHeight || 180) + (chipShown.current ? 96 : 16);
    map.fitBounds(bounds, { paddingTopLeft: [16, HEADER_H], paddingBottomRight: [16, bottom], maxZoom: 15, animate });
  }, []);

  // Open on the main group of claims, and keep framing it while a multi-area
  // import is still arriving, until the reader moves the map themselves.
  useEffect(() => {
    if (interacted.current || !claims.length) return;
    fitTo(showAll ? claims : primary, false);
  }, [claims, primary, showAll, fitTo]);

  const select = useCallback((key, from = 'map') => {
    setSelectedKey(key);
    if (key) {
      selectFrom.current = from;
      interacted.current = true;
      setSheet('claim');
      setView('map');
      trackEvent('mobile_viewer_action', { action: from === 'list' ? 'claim_from_list' : 'claim', source });
    } else {
      setSheet((s) => (s === 'claim' ? 'peek' : s));
    }
  }, [source]);
  selectRef.current = select;

  useEffect(() => {
    layerIndex.current.forEach((layer, key) => layer.setStyle?.(styleFor(byKey.get(key)?.band, key === selectedKey)));
    layerIndex.current.get(selectedKey)?.bringToFront?.();
  }, [selectedKey, byKey, claims]);

  // Bring the chosen claim into the part of the map the details sheet leaves
  // open. A tap on the map only pans (the reader chose that zoom); a pick from
  // the list zooms in far enough to see the claim.
  useEffect(() => {
    if (sheet !== 'claim' || !selectedKey) return undefined;
    const frame = requestAnimationFrame(() => {
      const map = mapRef.current;
      const layer = layerIndex.current.get(selectedKey);
      if (!map || !layer) return;
      const b = layer.getBounds ? layer.getBounds() : L.latLngBounds([layer.getLatLng()]);
      const bottom = (sheetRef.current?.offsetHeight || 360) + 24;
      const maxZoom = selectFrom.current === 'list' ? 14 : map.getZoom();
      map.fitBounds(b, { paddingTopLeft: [24, HEADER_H], paddingBottomRight: [24, bottom], maxZoom });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedKey, sheet]);

  // The sheet's height lifts the scale bar and the basemap credit above it.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    const update = () => setSheetH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet, view, user]);

  // ── Hand-off ───────────────────────────────────────────────────────────────
  // What the phone is showing, as the view a landscape page should keep in
  // frame: the strip between the top bar and the sheet.
  const visibleView = () => {
    const map = mapRef.current;
    if (!map) return null;
    const size = map.getSize();
    const top = 60;
    const bottom = size.y - sheetH;
    const center = map.containerPointToLatLng([size.x / 2, (top + bottom) / 2]);
    return { center: { lat: center.lat, lng: center.lng }, zoom: map.getZoom(), width: size.x, height: Math.max(120, bottom - top) };
  };
  // onScreenOnly (the PNG): drop the claim groups the map is not showing, so
  // the locator and legend describe the page. The hand-off keeps them all.
  const handoff = async ({ onScreenOnly = false } = {}) => {
    const b = mapRef.current?.getBounds();
    const insetRegion = b ? await detectRegion({ minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() }).catch(() => null) : null;
    let source = project;
    if (onScreenOnly && !showAll && groups.length > 1) {
      const keep = new Set(primary.map((c) => c.feature));
      source = {
        ...project,
        layers: project.layers
          .map((l) => (layerIds.includes(l.id) ? { ...l, geojson: { ...l.geojson, features: l.geojson.features.filter((f) => keep.has(f)) } } : l))
          .filter((l) => !layerIds.includes(l.id) || l.geojson.features.length),
      };
    }
    const trimmed = source !== project;
    const shown = trimmed ? primary.length : summary.count;
    const place = trimmed ? insetRegion?.name || summary.places : summary.places;
    const subtitleText = `${shown.toLocaleString('en-US')} mineral claim${shown === 1 ? '' : 's'}${place ? ` · ${place}` : ''}`;
    return handoffProject(source, { layerIds, view: visibleView(), title, subtitle: subtitleText, insetRegion });
  };

  const getShareUrl = async () => {
    const copy = await handoff();
    const key = JSON.stringify([copy.layers.map((l) => l.id), copy.mapView]);
    if (shareCache.current?.key === key) return shareCache.current.url;
    const id = await shareMap(copy);
    trackEvent('share_created', { mapId: id, source: 'mobile_viewer' }, user?.id);
    const url = `${window.location.origin}/map/${id}`;
    shareCache.current = { key, url };
    return url;
  };

  // A share sheet needs a fresh tap: after the network round trip the browser
  // may refuse it, so a new link opens the link sheet with its own buttons.
  const nativeShare = async (url) => {
    if (navigator.share) {
      try { await navigator.share({ title, url }); return true; } catch (e) { if (e?.name === 'AbortError') return true; }
    }
    return false;
  };
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); say('Link copied'); return true; } catch { return false; }
  };

  const shareLink = async () => {
    act('share');
    const cached = shareCache.current?.url;
    if (cached && await nativeShare(cached)) return;
    setBusy(true);
    say('Making a link…', 0);
    try {
      const url = await getShareUrl();
      setShareUrl(url);
      setToast(null);
      setSheet('link');
    } catch (e) {
      say(e?.message ? `Couldn't make a link: ${e.message}` : "Couldn't make a link. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const sendLink = async (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!EMAIL_RE.test(address)) { setError('Enter the email address you use on your computer.'); return; }
    setBusy(true);
    setError('');
    try {
      const url = await getShareUrl();
      await signInWithMagicLink(address, { redirectPath: new URL(url).pathname, context: 'mobile_handoff' });
      setSheet('sent');
      act('link_sent');
    } catch (err) {
      setError(err?.message && !/fetch/i.test(err.message) ? err.message : 'The email could not be sent. Check your connection and try again.');
      act('link_failed');
    } finally {
      setBusy(false);
    }
  };

  // A cloud save reports failure in its result rather than throwing; only a
  // save that reached the account may say so.
  const SAVED = ['saved', 'saved-but-dirty', 'stale'];
  const saveToAccount = async () => {
    setBusy(true);
    setError('');
    try {
      const outcome = await onSaveToAccount?.();
      if (SAVED.includes(outcome?.status)) { setSheet('saved'); act('saved'); return; }
      setError(outcome?.err?.code === 'SAVE_CONFLICT'
        ? 'This map was changed elsewhere. Open it in the editor to choose which version to keep.'
        : 'The map could not be saved. Check your connection and try again.');
      act('save_failed');
    } catch {
      setError('The map could not be saved. Check your connection and try again.');
      act('save_failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadPng = async () => {
    if (exportProject || exportStarted.current === 'pending') return;
    act('png');
    exportStarted.current = 'pending';
    say('Making your PNG…', 0);
    const copy = await handoff({ onScreenOnly: true });
    exportStarted.current = false;
    setExportProject(copy);
  };
  const onExporter = useCallback(async (exporter) => {
    if (exportStarted.current) return;
    exportStarted.current = true;
    try {
      await exporter.downloadPng(entitlements);
      trackEvent('export_completed', { format: 'png', source: 'mobile_viewer' }, user?.id);
      say('PNG downloaded');
    } catch {
      say('The PNG could not be made. Try again.');
    } finally {
      setExportProject(null);
    }
  }, [entitlements, say, user?.id]);

  // ── List ───────────────────────────────────────────────────────────────────
  const listGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q
      ? claims.filter((c) => [c.name, c.number, c.holder].some((v) => v && String(v).toLowerCase().includes(q)))
      : claims;
    if (sort === 'area') {
      const rows = shown.slice().sort((a, b) => (b.areaHa || 0) - (a.areaHa || 0));
      return rows.length ? [{ title: 'Largest first', rows }] : [];
    }
    const rows = shown.slice().sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || claimLabel(a).localeCompare(claimLabel(b)));
    return GROUPS.map((g) => ({ title: g.title, rows: rows.filter((c) => g.match.includes(c.band)) })).filter((g) => g.rows.length);
  }, [claims, query, sort]);

  const legend = LEGEND.filter((item) => claims.some((c) => item.match.includes(c.band)));
  const selected = selectedKey ? byKey.get(selectedKey) : null;
  const earliest = summary.earliest;

  const peekActions = (
    <div className="mcv-actions">
      <button type="button" className="mcv-btn" onClick={downloadPng} disabled={Boolean(exportProject)}>
        <Icon size={18} d={<><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></>} />
        {exportProject ? 'Making PNG…' : 'Download PNG'}
      </button>
      <button type="button" className="mcv-btn mcv-btn--primary" onClick={() => { setSheet('desktop'); setError(''); act('desktop_open'); }}>
        <Icon size={18} d={<><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>} />
        Edit on desktop
      </button>
    </div>
  );

  return (
    <div className="mcv" style={{ '--mcv-sheet-h': `${sheetH}px` }} role="region" aria-label="Claims viewer">
      <div ref={mapEl} className="mcv-map" />

      <header className="mcv-top">
        <button type="button" className="mcv-icon-btn" aria-label={source === 'company' ? 'Back' : 'New search'} onClick={() => { act('back'); onBack?.(); }}>
          <Icon size={22} stroke={2.2} d={<path d="M15 5l-7 7 7 7" />} />
        </button>
        <div className="mcv-title">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="mcv-icon-btn" aria-label="Share this map" onClick={shareLink} disabled={busy}>
          <Icon size={21} d={<><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>} />
        </button>
      </header>

      <div className="mcv-switch" role="group" aria-label="View as">
        <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>Map</button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => { setView('list'); setSheet((s) => (s === 'claim' ? 'peek' : s)); setSelectedKey(null); act('list'); }}>List</button>
      </div>

      {view === 'map' && (
        <>
          <div className="mcv-legend" aria-label="Map key">
            {legend.map((item) => (
              <div key={item.band}><span aria-hidden="true" className={`mcv-swatch mcv-swatch--${item.band}`} />{item.label}</div>
            ))}
          </div>
          <div className="mcv-controls">
            <button type="button" className="mcv-icon-btn mcv-icon-btn--card" aria-label="Zoom to the claims" onClick={() => { fitTo(showAll ? claims : primary); act('fit'); }}>
              <Icon d={<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />} />
            </button>
            <button type="button" className="mcv-icon-btn mcv-icon-btn--card" aria-pressed={basemap === 'satellite'}
              aria-label={basemap === 'satellite' ? 'Show the topographic map' : 'Show satellite imagery'}
              onClick={() => { setBasemap((b) => (b === 'satellite' ? 'terrain' : 'satellite')); act('basemap'); }}>
              <Icon d={<><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>} />
            </button>
          </div>
          {elsewhere > 0 && sheet !== 'claim' && (
            <button type="button" className="mcv-chip" onClick={() => { const all = !showAll; setShowAll(all); fitTo(all ? claims : primary); act('show_all'); }}>
              {showAll ? 'Back to the main group' : `+${elsewhere.toLocaleString('en-US')} claim${elsewhere === 1 ? '' : 's'} elsewhere · Show all`}
            </button>
          )}
        </>
      )}

      {view === 'list' && (
        <div className="mcv-list">
          <label htmlFor="mcv-filter">Filter claims</label>
          <input id="mcv-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Claim name, number or holder" />
          <div className="mcv-sort" role="group" aria-label="Sort by">
            <span>Sort by</span>
            <button type="button" aria-pressed={sort === 'date'} onClick={() => setSort('date')}>Good-to date</button>
            <button type="button" aria-pressed={sort === 'area'} onClick={() => setSort('area')}>Area</button>
          </div>
          {listGroups.map((g) => (
            <section key={g.title}>
              <h2>{g.title} · {g.rows.length.toLocaleString('en-US')}</h2>
              {g.rows.map((c) => (
                <button key={c.key} type="button" className="mcv-row" onClick={() => select(c.key, 'list')}>
                  <span aria-hidden="true" className={`mcv-swatch mcv-swatch--${c.band === 'urgent' ? 'soon' : c.band}`} />
                  <span className="mcv-row-main">
                    <span className="mcv-row-name">{claimLabel(c)}</span>
                    <span className="mcv-row-meta">{[c.name ? c.number : null, fmtHa(c.areaHa)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="mcv-row-date">
                    <span>{c.goodTo || 'No date'}</span>
                    {c.days != null && <span className={`mcv-days mcv-days--${c.band}`}>{daysLeftText(c.days)}</span>}
                  </span>
                </button>
              ))}
            </section>
          ))}
          {!listGroups.length && <p className="mcv-empty">No claims match that name or number.</p>}
        </div>
      )}

      {sheet === 'peek' && (
        <div ref={sheetRef} className="mcv-sheet">
          {view === 'map' && (
            <>
              <div className="mcv-grip" aria-hidden="true" />
              <p className="mcv-total">{countText} · {fmtHa(summary.totalHa)}</p>
              {earliest
                ? <p className="mcv-earliest"><span aria-hidden="true" className={`mcv-dot mcv-dot--${earliest.band}`} />Earliest good-to date {earliest.goodTo} · {daysLeftText(earliest.days)}</p>
                : <p className="mcv-earliest">The registry gives no good-to dates for these claims.</p>}
            </>
          )}
          {peekActions}
        </div>
      )}

      {sheet === 'claim' && selected && (
        <section ref={sheetRef} className="mcv-sheet" aria-label="Claim details">
          <div className="mcv-grip" aria-hidden="true" />
          <div className="mcv-claim-head">
            <div>
              <h2>{claimLabel(selected)}</h2>
              {selected.number && selected.name && <p className="mcv-mono">{numberLabel(selected)} {selected.number}</p>}
            </div>
            <button type="button" className="mcv-icon-btn mcv-icon-btn--soft" aria-label="Close claim details" onClick={() => select(null)}>
              <Icon size={18} stroke={2.2} d={<path d="M6 6l12 12M18 6L6 18" />} />
            </button>
          </div>
          {selected.goodTo
            ? <p className={`mcv-pill mcv-pill--${selected.band}`}><span aria-hidden="true" className={`mcv-dot mcv-dot--${selected.band}`} />{selected.band === 'expired' ? `Lapsed ${selected.goodTo}` : `Good to ${selected.goodTo}`} · {daysLeftText(selected.days)}</p>
            : <p className="mcv-pill mcv-pill--unknown">No good-to date in the registry</p>}
          <dl className="mcv-fields">
            <div><dt>Holder</dt><dd>{selected.holder ? displayName(selected.holder) : (titleProp || '—')}</dd></div>
            <div><dt>Area</dt><dd>{fmtHa(selected.areaHa)}</dd></div>
            {selected.registry && <div><dt>{isUsJurisdiction(selected.registry.code) ? 'State' : 'Province'}</dt><dd>{selected.registry.label}</dd></div>}
            {selected.type && <div><dt>Type</dt><dd>{displayName(selected.type)}</dd></div>}
            {selected.status && <div><dt>Status</dt><dd>{displayName(selected.status)}</dd></div>}
          </dl>
          {selected.registry?.url && (
            <a className="mcv-verify" href={selected.registry.url} target="_blank" rel="noopener noreferrer">
              Verify in {selected.registry.registry}
              <Icon size={15} stroke={2.2} d={<><path d="M14 4h6v6" /><path d="M10 14L20 4" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>} />
            </a>
          )}
          <div className="mcv-actions">
            <button type="button" className="mcv-btn" onClick={shareLink} disabled={busy}>Share this map</button>
            <button type="button" className="mcv-btn" onClick={() => { setView('list'); setSheet('peek'); setSelectedKey(null); act('list'); }}>See all claims</button>
          </div>
          <p className="mcv-fine">{isUs ? US_GEOMETRY_DISCLAIMER : 'From the public registry. Not a legal title opinion.'}</p>
        </section>
      )}

      {['desktop', 'sent', 'saved', 'link'].includes(sheet) && (
        <>
          <button type="button" className="mcv-scrim" aria-label="Close" onClick={() => setSheet('peek')} />
          <div ref={sheetRef} className="mcv-sheet mcv-sheet--modal" role="dialog" aria-modal="true" aria-labelledby="mcv-sheet-title">
            <div className="mcv-grip" aria-hidden="true" />
            {sheet === 'desktop' && !user && (
              <form onSubmit={sendLink} noValidate>
                <h2 id="mcv-sheet-title">Edit this map on a computer</h2>
                <p>Styling, layouts and exports work best on a bigger screen. We'll email you a sign-in link that opens this map. Sign in on your computer and save it to your free account.</p>
                <label htmlFor="mcv-email">Email</label>
                <input id="mcv-email" type="email" autoComplete="email" inputMode="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" aria-describedby={error ? 'mcv-email-error' : undefined} />
                {error && <p id="mcv-email-error" className="mcv-error" role="alert">{error}</p>}
                <button type="submit" className="mcv-btn mcv-btn--primary mcv-btn--block" disabled={busy}>{busy ? 'Sending…' : 'Email me the link'}</button>
                <div className="mcv-actions">
                  <button type="button" className="mcv-btn" onClick={() => { act('copy_link'); shareLink(); }} disabled={busy}>Copy link</button>
                  <button type="button" className="mcv-btn" onClick={() => { act('edit_here'); onEditHere?.(); }}>Edit on this phone</button>
                </div>
              </form>
            )}
            {sheet === 'desktop' && user && (
              <>
                <h2 id="mcv-sheet-title">Edit this map on a computer</h2>
                <p>Save it to your account, then open Exploration Maps on your computer. It is in your dashboard.</p>
                {error && <p className="mcv-error" role="alert">{error}</p>}
                <button type="button" className="mcv-btn mcv-btn--primary mcv-btn--block" onClick={saveToAccount} disabled={busy}>{busy ? 'Saving…' : 'Save to my account'}</button>
                <div className="mcv-actions">
                  <button type="button" className="mcv-btn" onClick={() => { act('edit_here'); onEditHere?.(); }}>Edit on this phone</button>
                </div>
              </>
            )}
            {(sheet === 'sent' || sheet === 'saved') && (
              <>
                <svg className="mcv-done" aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
                <h2 id="mcv-sheet-title">{sheet === 'sent' ? 'Check your email on your computer' : 'Saved to your account'}</h2>
                <p>{sheet === 'sent'
                  ? `We sent a sign-in link to ${email.trim()}. Open it on your computer to sign in and edit this map.`
                  : 'Open Exploration Maps on your computer and find this map in your dashboard.'}</p>
                <button type="button" className="mcv-btn mcv-btn--primary mcv-btn--block" onClick={() => setSheet('peek')}>Back to the map</button>
              </>
            )}
            {sheet === 'link' && shareUrl && (
              <>
                <h2 id="mcv-sheet-title">Link to this map</h2>
                <p>Anyone with the link can view the map and make their own copy.</p>
                <input className="mcv-link" type="text" readOnly value={shareUrl} aria-label="Link to this map" onFocus={(e) => e.target.select()} />
                <div className="mcv-actions">
                  <button type="button" className="mcv-btn" onClick={() => copy(shareUrl)}>Copy</button>
                  {typeof navigator !== 'undefined' && navigator.share && (
                    <button type="button" className="mcv-btn mcv-btn--primary" onClick={() => nativeShare(shareUrl)}>Share…</button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {toast && <div className="mcv-toast" role="status">{toast}</div>}

      {exportProject && (
        <div className="mcv-export-stage" aria-hidden="true">
          <React.Suspense fallback={null}>
            <ReadOnlyMapStage project={exportProject} onExportReady={onExporter} />
          </React.Suspense>
        </div>
      )}
    </div>
  );
}
