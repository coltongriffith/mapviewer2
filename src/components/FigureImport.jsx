import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { BASEMAPS } from '../utils/basemapConfig.js';
import { fitTransform, describeFit, formatMetres, applyFit } from '../utils/georef.js';
import { TRACE_DEFAULTS, samplePatch } from '../utils/figureTrace.js';
import {
  loadFigureImage, figurePixels, makeProjector, constraintsFor, placeFigure, runTrace, unitColour, unitFill, ringsToLngLat,
  figureCreditText, figureRasterLayer, tracedLayer, utmZoneOf, parseCoord, FIGURE_MAX_EDGE,
} from '../utils/figureImport.js';
import { figureOverlay } from '../utils/figureOverlay.js';
import { trackEvent } from '../utils/track';

// "Import a company figure": put a figure from a news release on the map
// (georeference it by a few known points, rotation included), trace its map
// units by colour into polygon layers, and credit it on the export.
//
// Two panes: the figure, where points and colour samples are clicked, and a
// satellite map, where a point's position can be clicked instead of typed and
// the fitted figure is previewed. Lazy: fetched only when the dialog opens.

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);
const KIND_LABEL = { point: 'Point', e: 'Easting label', n: 'Northing label' };
const MIN_AREA_STEPS = [0.02, 0.05, 0.1, 0.3, 1];
const areasLabel = (n) => (n == null ? 'not traced' : `${n} area${n === 1 ? '' : 's'}`);

export default function FigureImport({ source, existing, map: editorMap, setProject, onClose }) {
  const er = existing?.raster;
  const g = er?.georef;
  const [centre] = useState(() => {
    try { const c = editorMap.getCenter(); return { lat: c.lat, lng: c.lng, zoom: editorMap.getZoom() }; } catch { return { lat: 50, lng: -120, zoom: 12 }; }
  });
  const [image, setImage] = useState(er ? { dataUri: er.dataUri, width: er.width, height: er.height, name: existing.sourceName || existing.name } : null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('place');
  const [crs, setCrs] = useState(g?.crs || { kind: 'utm', zone: utmZoneOf(centre.lng), hemisphere: centre.lat < 0 ? 'S' : 'N', datum: 'NAD83' });
  const [points, setPoints] = useState(g?.points || []);
  const [nextKind, setNextKind] = useState('point');
  const [focusId, setFocusId] = useState(null);
  const [pickOnMap, setPickOnMap] = useState(null);
  const [mode, setMode] = useState(g?.mode || 'auto');
  const [opacity, setOpacity] = useState(er?.opacity ?? 0.75);
  const [zoom, setZoom] = useState(1);
  const [projector, setProjector] = useState(null);
  const [units, setUnits] = useState(() => (g?.units || []).map((u) => ({ ...u, id: uid() })));
  const [activeUnit, setActiveUnit] = useState(null);
  const [traceOpts, setTraceOpts] = useState({ lineWidth: TRACE_DEFAULTS.lineWidth, gap: TRACE_DEFAULTS.gap, minAreaPct: 0.05 });
  const [area, setArea] = useState(g?.area || null);
  const [areaPick, setAreaPick] = useState(null); // null | 'first' | { x, y }
  const [fillPick, setFillPick] = useState(null); // the unit whose fill the next click takes
  const [trace, setTrace] = useState(null); // { results, scale, units }
  const [tracing, setTracing] = useState(false);
  const [fig, setFig] = useState(() => ({ source: '', date: '', subject: '', ...(existing?.figure || {}) }));
  const [creditEdited, setCreditEdited] = useState(!!existing?.figure?.credit);
  const [keepImage, setKeepImage] = useState(true);
  const paneRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const pixelsRef = useRef(null);
  const clickRef = useRef(null);

  // The picture: a file or data URL, kept as a JPEG of at most 2048 px.
  useEffect(() => {
    if (!source || er) return undefined;
    let live = true;
    loadFigureImage(source.dataUri || source, source.name || 'Figure')
      .then((img) => { if (live) setImage(img); })
      .catch((err) => { if (live) setError(err.message || 'Could not read the image.'); });
    return () => { live = false; };
  }, [source, er]);

  // Fit the figure to the pane's width when it arrives.
  useEffect(() => {
    if (!image || !paneRef.current) return;
    const pane = paneRef.current;
    setZoom(Math.min(2, Math.max(0.1, Math.min((pane.clientWidth - 4) / image.width, (pane.clientHeight - 4) / image.height))));
    pixelsRef.current = null;
  }, [image]);

  // Latitude/longitude input is fitted in the UTM zone of the first typed
  // longitude (or the map's); UTM input in its own zone.
  const firstLng = crs.kind === 'latlng' ? points.map((p) => parseCoord(p.b)).find((v) => Number.isFinite(v) && Math.abs(v) <= 180) : null;
  const refLng = Number.isFinite(firstLng) ? firstLng : centre.lng;
  const projKey = crs.kind === 'utm' ? `utm:${crs.zone}:${crs.hemisphere}:${crs.datum}` : `ll:${utmZoneOf(refLng)}`;
  useEffect(() => {
    let live = true;
    makeProjector(crs, { lat: centre.lat, lng: refLng }).then((p) => { if (live) setProjector(p); }).catch(() => setError('Could not load the coordinate systems.'));
    return () => { live = false; };
  }, [projKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const constraints = useMemo(() => constraintsFor(points, projector), [points, projector]);
  const fit = useMemo(() => (projector ? fitTransform(constraints, { mode }) : null), [constraints, mode, projector]);
  const placement = useMemo(() => (fit && !fit.error && image ? placeFigure(fit, image.width, image.height, projector) : null), [fit, image, projector]);
  const ok = !!placement;

  // ── the map pane ──────────────────────────────────────────────────────
  const hasImage = !!image;
  const overlayRef = useRef(null);
  const markersRef = useRef(null);
  const tracedRef = useRef(null);
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return undefined;
    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: true });
    const sat = BASEMAPS.satellite;
    L.tileLayer(sat.url, { attribution: sat.attribution, crossOrigin: true, maxZoom: 20 }).addTo(map);
    if (er?.bounds) map.fitBounds([[er.bounds.south, er.bounds.west], [er.bounds.north, er.bounds.east]]);
    else map.setView([centre.lat, centre.lng], centre.zoom || 12);
    markersRef.current = L.layerGroup().addTo(map);
    map.on('click', (e) => clickRef.current?.(e.latlng));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; overlayRef.current = null; tracedRef.current = null; };
  }, [hasImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointLatLng = (p) => {
    if (!projector || p.kind !== 'point') return null;
    const a = parseCoord(p.a), b = parseCoord(p.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const ll = projector.toLatLng(...projector.inputToWork(a, b));
    return ll.every(Number.isFinite) ? ll : null;
  };

  // A click on the map fills the row waiting for it.
  clickRef.current = (latlng) => {
    if (!pickOnMap || !projector) return;
    const [a, b] = projector.latLngToInput(latlng.lat, latlng.lng);
    const fmt = (v) => (crs.kind === 'utm' ? v.toFixed(1) : v.toFixed(6));
    setPoints((prev) => prev.map((p) => (p.id === pickOnMap ? { ...p, a: fmt(a), b: fmt(b) } : p)));
    setPickOnMap(null);
  };

  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    points.forEach((p, i) => {
      const ll = pointLatLng(p);
      if (!ll) return;
      L.circleMarker(ll, { radius: 6, color: '#ffffff', weight: 2, fillColor: '#e11d48', fillOpacity: 1 })
        .bindTooltip(String(i + 1), { permanent: true, direction: 'right', className: 'fig-map-tip' }).addTo(group);
    });
  }, [points, projector]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !image) return;
    if (!placement) { if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current = null; } return; }
    if (overlayRef.current?._raster.dataUri !== image.dataUri) {
      if (overlayRef.current) map.removeLayer(overlayRef.current);
      overlayRef.current = figureOverlay({ ...image, corners: placement.corners, opacity }, { pane: 'overlayPane', zIndex: 1 }).addTo(map);
    } else {
      overlayRef.current.setCorners(placement.corners);
    }
  }, [placement, image]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { overlayRef.current?.setOpacity(opacity); }, [opacity]);

  // Traced units in map coordinates, shown on the map and handed back on Add.
  const traced = useMemo(() => {
    if (!trace || !placement) return [];
    return trace.units.map((t, i) => ({
      unit: units.find((u) => u.id === t.id) || t,
      polygons: (trace.results[i]?.polygons || []).map((p) => ringsToLngLat([p.outer, ...p.holes], trace.scale, fit, projector)),
    })).filter((t) => t.polygons.length);
  }, [trace, units, placement, fit, projector]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tracedRef.current) { map.removeLayer(tracedRef.current); tracedRef.current = null; }
    if (!traced.length) return;
    tracedRef.current = L.featureGroup(traced.map(({ unit, polygons }) => L.geoJSON(
      { type: 'FeatureCollection', features: polygons.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } })) },
      { style: { color: '#111827', weight: 1, fillColor: unitFill(unit), fillOpacity: 0.6, interactive: false } },
    ))).addTo(map);
  }, [traced]);

  // ── the figure pane ───────────────────────────────────────────────────
  const getPixels = async () => {
    if (!pixelsRef.current) pixelsRef.current = await figurePixels(image.dataUri);
    return pixelsRef.current;
  };

  const onFigureClick = async (e) => {
    if (!image) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom, y = (e.clientY - rect.top) / zoom;
    if (x < 0 || y < 0 || x > image.width || y > image.height) return;
    if (tab === 'place') {
      const p = { id: uid(), kind: crs.kind === 'utm' ? nextKind : 'point', x: +x.toFixed(1), y: +y.toFixed(1), a: '', b: '' };
      setPoints((prev) => [...prev, p]);
      setFocusId(p.id);
    } else if (tab === 'trace') {
      if (areaPick === 'first') { setAreaPick({ x, y }); return; }
      if (areaPick) {
        setArea({ x0: Math.min(x, areaPick.x), y0: Math.min(y, areaPick.y), x1: Math.max(x, areaPick.x), y1: Math.max(y, areaPick.y) });
        setAreaPick(null);
        return;
      }
      const px = await getPixels();
      const colour = samplePatch(px, x / px.scale, y / px.scale, 2);
      if (fillPick) {
        setUnits((prev) => prev.map((u) => (u.id === fillPick ? { ...u, fill: unitColour([colour]) } : u)));
        setFillPick(null);
        return;
      }
      if (!activeUnit || !units.some((u) => u.id === activeUnit)) {
        const u = { id: uid(), name: '', samples: [colour], tolerance: TRACE_DEFAULTS.tolerance };
        setUnits((prev) => [...prev, u]);
        setActiveUnit(u.id);
      } else {
        setUnits((prev) => prev.map((u) => (u.id === activeUnit ? { ...u, samples: [...u.samples, colour] } : u)));
      }
    }
  };

  const doTrace = async () => {
    const ready = units.filter((u) => u.samples.length);
    if (!ready.length) return;
    setTracing(true); setError('');
    try {
      const px = await getPixels();
      const region = area ? { x0: area.x0 / px.scale, y0: area.y0 / px.scale, x1: area.x1 / px.scale, y1: area.y1 / px.scale } : null;
      const results = await runTrace(px, ready.map((u) => ({ samples: u.samples, tolerance: u.tolerance })), {
        lineWidth: traceOpts.lineWidth, gap: traceOpts.gap, minArea: (traceOpts.minAreaPct / 100) * px.width * px.height, region,
      });
      setTrace({ results, scale: px.scale, units: ready });
      if (!fig.subject) setFig((f) => ({ ...f, subject: 'Geology (simplified)' }));
    } catch (err) {
      setError(err.message || 'Tracing failed.');
    } finally {
      setTracing(false);
    }
  };

  const autoCredit = figureCreditText({ ...fig, subject: fig.subject || (traced.length ? 'Geology (simplified)' : 'Figure') });
  const credit = creditEdited ? fig.credit : autoCredit;

  const add = () => {
    if (!ok) return;
    const figure = { id: existing?.figure?.id || uid(), source: fig.source.trim(), date: fig.date.trim(), subject: fig.subject.trim(), credit: (credit || '').trim() };
    const layers = [];
    if (keepImage || existing) {
      layers.push(figureRasterLayer({
        id: existing?.id || uid(), image, placement, opacity, figure,
        georef: {
          crs, mode, points, area, kind: fit.kind, rms: +fit.rms.toFixed(2), work: projector.work,
          units: units.map(({ name, samples, tolerance, fill }) => ({ name, samples, tolerance, fill })),
        },
      }));
    }
    traced.forEach(({ unit, polygons }) => layers.push(tracedLayer({ id: uid(), unit, polygons, figure })));
    // Added to the map, or swapped in for the figure being re-fitted; an
    // empty map is framed on the figure.
    const replaceId = existing?.id;
    const added = layers.filter((l) => l.id !== replaceId);
    setProject((prev) => {
      if (!prev.layers.length) {
        const b = placement.bounds;
        setTimeout(() => editorMap?.fitBounds([[b.south, b.west], [b.north, b.east]]), 0);
      }
      return { ...prev, layers: [...prev.layers.map((l) => (l.id === replaceId ? layers[0] : l)), ...added] };
    });
    added.forEach((l) => trackEvent('layer_added', { source: 'figure', role: l.role, kind: l.type, feature_count: l.geojson?.features?.length ?? 0 }));
    onClose(layers[layers.length - 1]?.id);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const residual = (p, i) => {
    if (!ok) return '';
    const c = constraints[i];
    if (!Number.isFinite(c?.e) && !Number.isFinite(c?.n)) return '';
    const [E, N] = applyFit(fit, c.x, c.y);
    return formatMetres(Math.hypot(Number.isFinite(c.e) ? E - c.e : 0, Number.isFinite(c.n) ? N - c.n : 0));
  };
  const isUtm = crs.kind === 'utm';
  const coordInput = (p, i, field, what) => (
    <input aria-label={`Point ${i + 1} ${what}`} value={p[field]} autoFocus={focusId === p.id && field === 'a'} inputMode="decimal"
      onChange={(e) => setPoints((prev) => prev.map((q) => (q.id === p.id ? { ...q, [field]: e.target.value } : q)))} />
  );
  const r = 7 / zoom; // marker radius, in figure pixels, constant on screen

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-label="Import a company figure">
      <div className="export-hd-card fig-import-card">
        <button className="export-hd-close" type="button" onClick={() => onClose()} aria-label="Close">✕</button>
        <div className="fig-import-head">
          <h3 className="export-hd-title">Import a company figure</h3>
          <div className="fig-tabs" role="tablist">
            {[['place', '1 · Place'], ['trace', '2 · Trace colours'], ['credit', '3 · Credit']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`fig-tab${tab === k ? ' is-active' : ''}`} disabled={!image} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
        </div>

        {!image ? (
          <div className="fig-empty">
            {error ? <div className="export-hd-error" role="alert">{error}</div> : null}
            <label className="secondary-btn fig-file">
              Choose a PNG or JPG figure…
              <input type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFigureImage(f).then(setImage).catch((err) => setError(err.message));
              }} />
            </label>
            <p className="small-note">Kept with the map at up to {FIGURE_MAX_EDGE} px and about 1.2 MB.</p>
          </div>
        ) : (
          <>
            <div className="fig-panes">
              <div className="fig-pane" ref={paneRef}>
                <div className="fig-zoom">
                  <button type="button" className="secondary-btn compact" onClick={() => setZoom((z) => z / 1.5)} aria-label="Zoom out">−</button>
                  <button type="button" className="secondary-btn compact" onClick={() => setZoom((z) => Math.min(8, z * 1.5))} aria-label="Zoom in">+</button>
                </div>
                <div
                  className="fig-canvas"
                  role="button"
                  aria-label="Figure: click to add a point or sample a colour"
                  tabIndex={0}
                  style={{ width: image.width * zoom, height: image.height * zoom }}
                  onClick={onFigureClick}
                  onKeyDown={(e) => { if (e.key === '+') setZoom((z) => Math.min(8, z * 1.5)); if (e.key === '-') setZoom((z) => z / 1.5); }}
                >
                  <img src={image.dataUri} alt="" draggable={false} />
                  <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none">
                    {trace && tab !== 'place' && trace.results.map((res, i) => res.polygons.map((p, j) => (
                      <path key={`${i}-${j}`} d={[p.outer, ...p.holes].map((ring) => `M${ring.map(([x, y]) => `${(x * trace.scale).toFixed(1)},${(y * trace.scale).toFixed(1)}`).join('L')}Z`).join('')}
                        fill={unitFill(units.find((u) => u.id === trace.units[i].id) || trace.units[i])} fillOpacity="0.55" fillRule="evenodd" stroke="#111827" strokeWidth={1.2 / zoom} />
                    )))}
                    {area && <rect x={area.x0} y={area.y0} width={area.x1 - area.x0} height={area.y1 - area.y0} fill="none" stroke="#2563eb" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />}
                    {tab === 'place' && points.map((p, i) => (
                      <g key={p.id}>
                        {p.kind === 'point'
                          ? <circle cx={p.x} cy={p.y} r={r} fill="#e11d48" stroke="#fff" strokeWidth={2 / zoom} />
                          : <path d={p.kind === 'e' ? `M${p.x},${p.y - 2 * r}V${p.y + 2 * r}` : `M${p.x - 2 * r},${p.y}H${p.x + 2 * r}`} stroke="#e11d48" strokeWidth={3 / zoom} />}
                        <text x={p.x + r * 1.4} y={p.y - r * 1.2} fontSize={14 / zoom} fontWeight="700" fill="#e11d48" stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">{i + 1}</text>
                      </g>
                    ))}
                  </svg>
                </div>
              </div>
              <div className={`fig-map${pickOnMap ? ' is-picking' : ''}`} ref={mapDivRef} />
            </div>

            <div className="fig-controls">
              {tab === 'place' && (
                <>
                  <div className="fig-row">
                    <label htmlFor="fig-crs">Coordinates</label>
                    <select id="fig-crs" value={crs.kind} onChange={(e) => setCrs(e.target.value === 'utm' ? { kind: 'utm', zone: utmZoneOf(centre.lng), hemisphere: centre.lat < 0 ? 'S' : 'N', datum: 'NAD83' } : { kind: 'latlng' })}>
                      <option value="utm">UTM easting / northing (m)</option>
                      <option value="latlng">Latitude / longitude</option>
                    </select>
                    {isUtm && (
                      <>
                        <label htmlFor="fig-zone">Zone</label>
                        <input id="fig-zone" type="number" min="1" max="60" value={crs.zone} onChange={(e) => setCrs({ ...crs, zone: e.target.value })} style={{ width: 64 }} />
                        <select aria-label="Hemisphere" value={crs.hemisphere} onChange={(e) => setCrs({ ...crs, hemisphere: e.target.value })}><option value="N">N</option><option value="S">S</option></select>
                        <select aria-label="Datum" value={crs.datum} onChange={(e) => setCrs({ ...crs, datum: e.target.value })}><option value="NAD83">NAD83</option><option value="WGS84">WGS84</option></select>
                      </>
                    )}
                    <label htmlFor="fig-mode">Fit</label>
                    <select id="fig-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                      <option value="auto">Automatic</option>
                      <option value="similarity">Keep shape (similarity)</option>
                      <option value="affine">Affine</option>
                    </select>
                  </div>
                  <div className="fig-row">
                    <span className="fig-label">Clicking the figure adds</span>
                    {(isUtm ? ['point', 'e', 'n'] : ['point']).map((k) => (
                      <button key={k} type="button" className={`fig-chip${nextKind === k || !isUtm ? ' is-active' : ''}`} aria-pressed={nextKind === k} onClick={() => setNextKind(k)}>{KIND_LABEL[k]}</button>
                    ))}
                    <span className="small-note">a known point (a collar, a grid crossing), or a grid label's tick on the frame.</span>
                  </div>
                  {points.length ? (
                    <table className="fig-points">
                      <thead><tr><th>#</th><th>Clicked</th><th>{isUtm ? 'Easting' : 'Latitude'}</th><th>{isUtm ? 'Northing' : 'Longitude'}</th><th /><th>Error</th><th /></tr></thead>
                      <tbody>
                        {points.map((p, i) => (
                          <tr key={p.id}>
                            <td>{i + 1}</td>
                            <td>{KIND_LABEL[p.kind]}</td>
                            <td>{p.kind !== 'n' && coordInput(p, i, 'a', isUtm ? 'easting' : 'latitude')}</td>
                            <td>{p.kind === 'point' ? coordInput(p, i, 'b', isUtm ? 'northing' : 'longitude') : p.kind === 'n' ? coordInput(p, i, 'a', 'northing') : null}</td>
                            <td>{p.kind === 'point' && (
                              <button type="button" className={`fig-chip${pickOnMap === p.id ? ' is-active' : ''}`} onClick={() => setPickOnMap(pickOnMap === p.id ? null : p.id)}>
                                {pickOnMap === p.id ? 'Click the map…' : 'Pick on map'}
                              </button>
                            )}</td>
                            <td className="fig-resid">{residual(p, i)}</td>
                            <td><button type="button" className="fig-x" aria-label={`Remove point ${i + 1}`} onClick={() => setPoints((prev) => prev.filter((q) => q.id !== p.id))}>×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="small-note">Click two to four places on the figure whose coordinates you know, then type them in or pick them on the satellite map. Three or more fit rotation and stretch; a fourth shows the error.</p>}
                  <div className="fig-row">
                    <strong className={`fig-fit${fit?.error ? ' is-error' : ''}`} data-testid="fig-fit">{fit ? describeFit(fit) : 'Loading coordinate systems…'}</strong>
                  </div>
                  <div className="fig-row">
                    <label htmlFor="fig-opacity">Overlay opacity</label>
                    <input id="fig-opacity" type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
                    <span className="range-value">{Math.round(opacity * 100)}%</span>
                    {ok && <button type="button" className="fig-chip" onClick={() => mapRef.current?.fitBounds([[placement.bounds.south, placement.bounds.west], [placement.bounds.north, placement.bounds.east]])}>Zoom map to figure</button>}
                  </div>
                </>
              )}

              {tab === 'trace' && (
                <>
                  <p className="small-note">
                    Click inside a map unit on the figure to sample its colour (where it lies over imagery; add samples where it looks different), then name it from the legend and take its fill from the legend swatch. Lines, lettering and symbols thinner than the line width are ignored.
                  </p>
                  {units.map((u) => (
                    <div key={u.id} className={`fig-unit${activeUnit === u.id ? ' is-active' : ''}`}>
                      <input type="radio" name="fig-unit" aria-label="Sample this unit" checked={activeUnit === u.id} onChange={() => setActiveUnit(u.id)} />
                      <input type="color" className="fig-swatch" aria-label="Fill colour" value={unitFill(u)}
                        onChange={(e) => setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, fill: e.target.value } : x)))} />
                      <button type="button" className={`fig-chip${fillPick === u.id ? ' is-active' : ''}`} onClick={() => setFillPick(fillPick === u.id ? null : u.id)}>
                        {fillPick === u.id ? 'Click the legend swatch…' : 'Fill from legend'}
                      </button>
                      <input aria-label="Unit name" placeholder="Name from the legend, e.g. Durand Stock diorite" value={u.name}
                        onChange={(e) => setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, name: e.target.value } : x)))} />
                      <span className="small-note">{u.samples.length} sample{u.samples.length === 1 ? '' : 's'}</span>
                      <label className="fig-tol">Tolerance
                        <input type="range" min="4" max="40" value={u.tolerance} onChange={(e) => setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, tolerance: Number(e.target.value) } : x)))} />
                      </label>
                      {trace && <span className="small-note">{areasLabel(trace.results[trace.units.findIndex((x) => x.id === u.id)]?.polygons.length)}</span>}
                      <button type="button" className="fig-x" aria-label="Remove unit" onClick={() => setUnits((prev) => prev.filter((x) => x.id !== u.id))}>×</button>
                    </div>
                  ))}
                  <div className="fig-row">
                    <button type="button" className="fig-chip" onClick={() => setActiveUnit(null)}>+ New unit (then click the figure)</button>
                    <button type="button" className={`fig-chip${areaPick ? ' is-active' : ''}`} onClick={() => setAreaPick(areaPick ? null : 'first')}>{areaPick ? 'Click two corners…' : 'Limit to an area'}</button>
                    {area && <button type="button" className="fig-chip" onClick={() => setArea(null)}>Whole figure</button>}
                  </div>
                  <div className="fig-row">
                    <label htmlFor="fig-lw">Ignore lines up to</label>
                    <input id="fig-lw" type="range" min="0" max="6" value={traceOpts.lineWidth} onChange={(e) => setTraceOpts({ ...traceOpts, lineWidth: Number(e.target.value) })} />
                    <span className="range-value">{traceOpts.lineWidth * 2 + 1} px</span>
                    <label htmlFor="fig-gap">Fill gaps up to</label>
                    <input id="fig-gap" type="range" min="0" max="8" value={traceOpts.gap} onChange={(e) => setTraceOpts({ ...traceOpts, gap: Number(e.target.value) })} />
                    <span className="range-value">{traceOpts.gap * 2} px</span>
                    <label htmlFor="fig-min">Smallest area</label>
                    <select id="fig-min" value={traceOpts.minAreaPct} onChange={(e) => setTraceOpts({ ...traceOpts, minAreaPct: Number(e.target.value) })}>
                      {MIN_AREA_STEPS.map((v) => <option key={v} value={v}>{v}% of the figure</option>)}
                    </select>
                    <button type="button" className="btn primary" disabled={tracing || !units.some((u) => u.samples.length)} onClick={doTrace}>{tracing ? 'Tracing…' : 'Trace'}</button>
                  </div>
                  {error && <div className="export-hd-error" role="alert">{error}</div>}
                </>
              )}

              {tab === 'credit' && (
                <>
                  <div className="fig-row">
                    <label htmlFor="fig-src">Source</label>
                    <input id="fig-src" placeholder="e.g. Tower Fig. 1" value={fig.source} onChange={(e) => setFig({ ...fig, source: e.target.value })} />
                    <label htmlFor="fig-date">Date</label>
                    <input id="fig-date" placeholder="e.g. 15 Oct 2026" value={fig.date} onChange={(e) => setFig({ ...fig, date: e.target.value })} />
                    <label htmlFor="fig-subj">What was taken</label>
                    <input id="fig-subj" placeholder={traced.length ? 'Geology (simplified)' : 'Figure'} value={fig.subject} onChange={(e) => setFig({ ...fig, subject: e.target.value })} />
                  </div>
                  <div className="fig-row">
                    <label htmlFor="fig-credit">Credit line</label>
                    <input id="fig-credit" className="fig-credit" value={credit} placeholder="Add a source to make the credit line"
                      onChange={(e) => { setCreditEdited(true); setFig({ ...fig, credit: e.target.value }); }} />
                    {creditEdited && <button type="button" className="fig-chip" onClick={() => setCreditEdited(false)}>Reset</button>}
                  </div>
                  <p className="small-note">Printed with the map's source credits on every export while the figure or a layer traced from it is shown.</p>
                  {!existing && (
                    <label className="toggle-row"><input type="checkbox" checked={keepImage} onChange={(e) => setKeepImage(e.target.checked)} /> <span>Keep the figure itself as an image layer</span></label>
                  )}
                </>
              )}
            </div>

            <div className="fig-footer">
              <span className="small-note">
                {traced.length ? `${traced.length} traced unit${traced.length === 1 ? '' : 's'} · ` : ''}{credit ? `Credit: ${credit}` : 'No credit line yet (Credit tab).'}
              </span>
              <button className="export-hd-skip fig-cancel" type="button" onClick={() => onClose()}>Cancel</button>
              <button className="btn primary" type="button" disabled={!ok || (!keepImage && !existing && !traced.length)} onClick={add}>{existing ? 'Update map' : 'Add to map'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
