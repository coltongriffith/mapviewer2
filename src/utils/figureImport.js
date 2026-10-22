// The browser side of "Import a company figure": the picture kept with the
// map, the coordinate systems, the tracer's worker and the layers it all
// becomes. Fetched only when the dialog opens (with proj4, lazily).
//
// The figure is stored as the picture itself (JPEG) plus the three corners
// its fit puts on the ground, so the map keeps the original pixels and the
// fit can be reopened and refined. Every layer made from it carries the same
// `figure` record, whose credit line is printed on the export.

import { rasterLayer, utmProjString } from './rasterOverlay.js';
import { applyFit } from './georef.js';
import { traceColours } from './figureTrace.js';

// Stored inside the project and in shared copies (2 MB limit per share), so
// the picture is kept to 2048 px on its long edge and about 1.2 MB as a data
// URL: JPEG, stepping quality then size down until it fits.
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

/** The figure's pixels at the tracer's working size. */
export async function figurePixels(dataUri, maxEdge = TRACE_MAX_EDGE) {
  const img = await loadImageEl(dataUri);
  const s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, width: w, height: h, scale: img.naturalWidth / w };
}

// ── coordinate systems ────────────────────────────────────────────────────
// What the person types in: UTM metres (zone, hemisphere, datum) or latitude
// and longitude. The fit itself always runs in UTM metres, so residuals are
// metres: latitude/longitude input is fitted in the UTM zone of the map.
export const utmZoneOf = (lng) => Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));

export async function makeProjector(crs, ref) {
  const { default: proj4 } = await import('proj4');
  const work = crs.kind === 'utm'
    ? { zone: Number(crs.zone), hemisphere: crs.hemisphere, datum: crs.datum }
    : { zone: utmZoneOf(ref.lng), hemisphere: ref.lat < 0 ? 'S' : 'N', datum: 'WGS84' };
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
/** Runs the tracer in a Web Worker; on the main thread only if workers are unavailable. */
export function runTrace(image, units, options) {
  const id = ++seq;
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() => traceColours(image, units, options));
  }
  if (!worker) worker = new Worker(new URL('./figureTrace.worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    };
    worker.addEventListener('message', onMessage);
    // The pixels are copied, not transferred: the dialog traces again with
    // other settings from the same buffer.
    worker.postMessage({ id, image: { data: image.data, width: image.width, height: image.height }, units, options });
  });
}

const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** A unit's fill: the average of its samples. */
export function unitColour(samples) {
  if (!samples?.length) return '#999999';
  const m = samples.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]).map((v) => v / samples.length);
  return hex(m);
}
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
  const fill = unitColour(unit.samples);
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
  };
}
