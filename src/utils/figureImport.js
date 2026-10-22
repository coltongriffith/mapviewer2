// The browser side of "Import a company figure": the picture kept with the
// map, the coordinate systems, the tracer's worker and the layers it all
// becomes. Fetched only when the dialog opens (with proj4, lazily).
//
// The figure is stored as the picture itself plus the three corners its fit
// puts on the ground, so the map keeps the original pixels and the fit can be
// reopened and refined. Every layer made from it carries the same `figure`
// record, whose credit line is printed on the export.

import { rasterLayer, utmProjString } from './rasterOverlay.js';
import { applyFit, invertFit } from './georef.js';
import { findMargin, clearMargin, clearOutside } from './figureMargins.js';

// Stored inside the project and in shared copies (2 MB limit per share), so
// the picture is kept to 2048 px on its long edge and about 1.2 MB as a data
// URL: JPEG while it is opaque; WebP with alpha (PNG where the browser cannot
// write WebP) once blank margins or a crop make part of it transparent. The
// quality, then the size, steps down until it fits.
export const FIGURE_MAX_EDGE = 2048;
export const FIGURE_MAX_DATA_URL = 1200 * 1024;
// The tracer works on at most this long edge (about 2.5 Mpx).
export const TRACE_MAX_EDGE = 1600;

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the image.'));
    el.src = src;
  });
}

/** A File or a data URL → { dataUri, width, height, name, sourceWidth, sourceHeight }. */
export async function loadFigureImage(source, name = 'Figure') {
  const isFile = typeof source !== 'string';
  if (isFile && source.size > 25 * 1024 * 1024) throw new Error('Image too large (over 25 MB).');
  const url = isFile ? URL.createObjectURL(source) : source;
  try {
    const img = await loadImageEl(url);
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!(w0 > 0 && h0 > 0)) throw new Error('Could not read the image.');
    let edge = Math.min(FIGURE_MAX_EDGE, Math.max(w0, h0));
    for (;;) {
      const s = edge / Math.max(w0, h0);
      const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Transparent areas print white, as on the page the figure came from.
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.86, 0.76, 0.66]) {
        const dataUri = canvas.toDataURL('image/jpeg', q);
        if (dataUri.length <= FIGURE_MAX_DATA_URL || edge <= 640) {
          return { dataUri, width: w, height: h, sourceWidth: w0, sourceHeight: h0, name: isFile ? source.name : name };
        }
      }
      edge = Math.round(edge * 0.8);
    }
  } finally {
    if (isFile) URL.revokeObjectURL(url);
  }
}

function pixelsOf(img, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, px: ctx.getImageData(0, 0, w, h) };
}

/**
 * The figure's pixels at the tracer's working size. `frameWidth` is the width
 * the fit's pixel coordinates are measured in (the picture as first loaded),
 * so `scale` takes a working pixel back to them.
 */
export async function figurePixels(dataUri, frameWidth, maxEdge = TRACE_MAX_EDGE) {
  const img = await loadImageEl(dataUri);
  const s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const { data } = pixelsOf(img, w, h).px;
  return { data, width: w, height: h, scale: (frameWidth || img.naturalWidth) / w };
}

/** Whether the picture has a flat blank margin round it (a scan's page, a turned figure's corners). */
export async function hasBlankMargin(dataUri) {
  const img = await loadImageEl(dataUri);
  return !!findMargin(pixelsOf(img, img.naturalWidth, img.naturalHeight).px);
}

/**
 * The picture as it is kept: its blank margins and anything outside `crop`
 * (in frame pixels) made transparent. Opaque pictures stay JPEG. Returns
 * { dataUri, width, height, name } or the image itself when there is nothing
 * to do.
 */
export async function finishFigure(image, { hideMargins, crop }) {
  if (!hideMargins && !crop) return image;
  const img = await loadImageEl(image.dataUri);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  let edge = Math.max(w0, h0);
  for (;;) {
    const s = edge / Math.max(w0, h0);
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const { canvas, ctx, px } = pixelsOf(img, w, h);
    const margin = hideMargins ? findMargin(px) : null;
    if (margin) clearMargin(px, margin.color);
    const k = w / image.width;
    if (crop) clearOutside(px, { x0: crop.x0 * k, y0: crop.y0 * k, x1: crop.x1 * k, y1: crop.y1 * k });
    if (!margin && !crop) return image;
    ctx.putImageData(px, 0, 0);
    for (const q of [0.86, 0.76, 0.66]) {
      const webp = canvas.toDataURL('image/webp', q);
      if (!webp.startsWith('data:image/webp')) break; // no WebP writer: PNG below
      if (webp.length <= FIGURE_MAX_DATA_URL) return { ...image, dataUri: webp, width: w, height: h };
    }
    const png = canvas.toDataURL('image/png');
    if (png.length <= FIGURE_MAX_DATA_URL || edge <= 640) return { ...image, dataUri: png, width: w, height: h };
    edge = Math.round(edge * 0.8);
  }
}

// ── coordinate systems ────────────────────────────────────────────────────
// What the person types in: UTM metres (zone, hemisphere, datum) or latitude
// and longitude. The fit itself always runs in UTM metres, so residuals are
// metres: latitude/longitude input is fitted in the UTM zone of the map.
export const utmZoneOf = (lng) => Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));

export async function makeProjector(crs, ref, keptWork = null) {
  const { default: proj4 } = await import('proj4');
  const work = keptWork || (crs.kind === 'utm'
    ? { zone: Number(crs.zone), hemisphere: crs.hemisphere, datum: crs.datum }
    : { zone: utmZoneOf(ref.lng), hemisphere: ref.lat < 0 ? 'S' : 'N', datum: 'WGS84' });
  const tr = proj4('EPSG:4326', utmProjString(work.zone, work.hemisphere, work.datum));
  const toWork = (lat, lng) => tr.forward([lng, lat]);
  const toLatLng = (E, N) => { const [lng, lat] = tr.inverse([E, N]); return [lat, lng]; };
  return {
    work,
    toWork,
    toLatLng,
    // Typed values → work metres: [E, N] (either may be NaN for a grid label).
    inputToWork: (a, b) => (crs.kind === 'utm' ? [a, b] : toWork(a, b)),
    // A map click → the values typed into the row.
    latLngToInput: (lat, lng) => (crs.kind === 'utm' ? toWork(lat, lng) : [lat, lng]),
  };
}

export const parseCoord = (v) => {
  const s = String(v ?? '').replace(/[\s,]/g, '').replace(/[ENSW]$/i, '');
  return s === '' ? NaN : Number(s);
};

/** The dialog's rows → fit constraints in work metres. */
export function constraintsFor(points, projector) {
  if (!projector) return [];
  return points.map((p) => {
    const a = parseCoord(p.a), b = parseCoord(p.b);
    if (p.kind === 'e') return { x: p.x, y: p.y, e: a };
    if (p.kind === 'n') return { x: p.x, y: p.y, n: a };
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { x: p.x, y: p.y };
    const [e, n] = projector.inputToWork(a, b);
    return { x: p.x, y: p.y, e, n };
  });
}

/** Where the fit puts the picture: three corners in lat/lng, and the box around all four. */
export function placeFigure(fit, width, height, projector) {
  const at = (x, y) => projector.toLatLng(...applyFit(fit, x, y));
  const tl = at(0, 0), tr = at(width, 0), bl = at(0, height), br = at(width, height);
  const lats = [tl, tr, bl, br].map((p) => p[0]), lngs = [tl, tr, bl, br].map((p) => p[1]);
  return {
    corners: { tl, tr, bl },
    bounds: { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) },
  };
}

// ── tracing ───────────────────────────────────────────────────────────────
let worker = null;
let seq = 0;
/** Runs the tracer in a Web Worker, so the dialog stays responsive (and the tracer is not in its chunk). */
export function runTrace(image, units, options) {
  const id = ++seq;
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot trace figures (no Web Workers).'));
  if (!worker) worker = new Worker(new URL('./figureTrace.worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const w = worker;
    const done = () => { w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); };
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      done();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    };
    // A worker that fails to load is dropped, so the next Trace starts a new one.
    const onError = (event) => { done(); worker = null; reject(new Error(event.message || 'Tracing failed.')); };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    // The pixels are copied, not transferred: the dialog traces again with
    // other settings from the same buffer.
    w.postMessage({ id, image: { data: image.data, width: image.width, height: image.height }, units, options });
  });
}

const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** A unit's fill: the average of its samples. */
export function unitColour(samples) {
  if (!samples?.length) return '#999999';
  const m = samples.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]).map((v) => v / samples.length);
  return hex(m);
}
/**
 * A unit's fill: the colour picked from the legend swatch when there is one
 * (a figure paints its units half transparent over imagery, so the samples
 * from the map come out muddier than the unit's own colour), else the samples.
 */
export const unitFill = (unit) => unit.fill || unitColour(unit.samples);
export function darker(hexColour, f = 0.6) {
  const n = parseInt(hexColour.slice(1), 16);
  return hex([(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v * f));
}

/** Pixel rings (work pixels) → GeoJSON rings in lon/lat, closed. */
export function ringsToLngLat(rings, scale, fit, projector) {
  return rings.map((ring) => {
    const out = ring.map(([x, y]) => { const [lat, lng] = projector.toLatLng(...applyFit(fit, x * scale, y * scale)); return [lng, lat]; });
    out.push(out[0]);
    return out;
  });
}

// ── layers ────────────────────────────────────────────────────────────────
export function figureCreditText({ subject, source, date }) {
  const s = String(source || '').trim();
  if (!s) return '';
  const d = String(date || '').trim();
  return `${String(subject || 'Figure').trim() || 'Figure'} after ${s}${d ? ` (${d})` : ''}`;
}

export function figureRasterLayer({ id, image, placement, opacity, georef, figure }) {
  const layer = rasterLayer({ id, name: image.name, dataUri: image.dataUri, width: image.width, height: image.height, bounds: placement.bounds, opacity });
  return { ...layer, raster: { ...layer.raster, corners: placement.corners, georef }, figure };
}

export function tracedLayer({ id, unit, polygons, figure }) {
  const fill = unitFill(unit);
  const name = String(unit.name || '').trim() || 'Traced unit';
  return {
    id,
    name,
    sourceName: figure.source || 'Imported figure',
    dataSource: 'figure',
    displayName: name,
    type: 'polygons',
    visible: true,
    role: 'other',
    // A traced unit keeps the colour it was traced from whatever the mode.
    userStyled: true,
    geojson: {
      type: 'FeatureCollection',
      features: polygons.map((coordinates) => ({ type: 'Feature', properties: { unit: name }, geometry: { type: 'Polygon', coordinates } })),
    },
    style: { stroke: darker(fill), fill, fillOpacity: 0.55, strokeWidth: 1 },
    legend: { enabled: true, label: name, group: 'Geology' },
    figure,
    figureUnit: unit.id,
  };
}

/** The last trace's results for the units still in the dialog (a removed unit's polygons are not imported). */
export function tracedForUnits(trace, units) {
  if (!trace) return [];
  return trace.units.map((t, i) => ({ unit: units.find((u) => u.id === t.id), result: trace.results[i] }))
    .filter((t) => t.unit && t.result);
}

const mapCoords = (c, move) => (typeof c[0] === 'number' ? move(c) : c.map((x) => mapCoords(x, move)));

/**
 * The map's layers with a figure added or updated. `figure` (its source, date
 * and credit) goes on every layer made from it. Each traced unit replaces the
 * figure's layer for that unit (keeping the layer's id, style and a name the
 * person changed), or is added; the layer of a unit removed in the dialog is
 * removed. A layer traced earlier and not traced again is moved by `move`
 * ([lng, lat] → [lng, lat], from the old fit to the new) when the fit changed.
 * `raster` replaces `replaceId`, or is added first.
 */
export function reconcileFigureLayers(layers, { figure, raster, replaceId, traced, unitIds, move }) {
  const byUnit = new Map(traced.map((t) => [t.unit.id, t]));
  const done = new Set();
  const out = [];
  for (const l of layers) {
    if (replaceId && l.id === replaceId) { if (raster) out.push(raster); continue; }
    if (l.figure?.id !== figure.id) { out.push(l); continue; }
    const unitId = l.figureUnit;
    if (unitId && unitIds && !unitIds.has(unitId)) continue;
    const t = unitId && byUnit.get(unitId);
    if (t) {
      const fresh = tracedLayer({ id: l.id, unit: t.unit, polygons: t.polygons, figure });
      const renamed = (l.displayName || l.name) !== l.name;
      out.push({ ...l, geojson: fresh.geojson, figure, ...(renamed ? {} : { name: fresh.name, displayName: fresh.displayName, legend: { ...l.legend, label: fresh.name } }) });
      done.add(unitId);
    } else {
      out.push({ ...l, figure, ...(move && l.geojson ? { geojson: { ...l.geojson, features: l.geojson.features.map((f) => (f.geometry ? { ...f, geometry: { ...f.geometry, coordinates: mapCoords(f.geometry.coordinates, move) } } : f)) } } : {}) });
    }
  }
  if (raster && !replaceId) out.push(raster);
  return [...out, ...traced.filter((t) => !done.has(t.unit.id)).map((t) => tracedLayer({ id: t.id, unit: t.unit, polygons: t.polygons, figure }))];
}

/** [lng, lat] under the old fit → the same figure pixel under the new fit. */
export function refitMover(oldFit, oldProjector, newFit, newProjector) {
  return ([lng, lat]) => {
    const [x, y] = invertFit(oldFit, ...oldProjector.toWork(lat, lng));
    const [la, ln] = newProjector.toLatLng(...applyFit(newFit, x, y));
    return [ln, la];
  };
}
