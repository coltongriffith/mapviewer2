// Drill traces: the surface projection of a hole from its collar, drawn as a
// line so a map reads as drilled ground rather than a scatter of collars.
//
// Built from four numbers a collar file already carries — azimuth, dip and
// length beside the coordinates — into a LineString beside each Point. The
// trace shares the collar's identity (same hole id, no id of its own), so
// removing a hole removes its trace and styling a collar styles its trace.
//
// No React and no Leaflet imports: the CSV importer, the GeoJSON importer
// and the demo data all pass through here.

import { featureKey, isFeatureHidden } from './featureIdentity.js';

const ORIENTATION_SYNONYMS = {
  azimuth: ['_azimuth', 'azimuth', 'azi', 'az', 'bearing', 'azim'],
  dip: ['_dip', 'dip', 'inclination', 'incl', 'plunge'],
  length: ['_length', 'length', 'length_m', 'depth', 'total_depth', 'totaldepth', 'eoh', 'td', 'hole_length', 'final_depth', 'depth_m', 'max_depth'],
};

const EARTH_R = 6371008.8;

function num(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  // "N/A", "-", "?" and friends strip to nothing, and Number('') is 0 — a
  // fabricated north-pointing hole. Nothing numeric left means no value.
  const cleaned = String(v).replace(/[^\d.eE+-]/g, '');
  if (!/\d/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** The first property matching one of the synonyms, as a number. */
export function readOrientation(props, role) {
  const p = props || {};
  const keys = Object.keys(p);
  for (const syn of ORIENTATION_SYNONYMS[role]) {
    const k = keys.find((key) => key.toLowerCase() === syn);
    if (k !== undefined) {
      const n = num(p[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

/** Destination of a great-circle step: [lng, lat] from a collar. */
export function destination([lng, lat], bearingDeg, metres) {
  const d = metres / EARTH_R;
  const b = bearingDeg * Math.PI / 180;
  const la1 = lat * Math.PI / 180;
  const lo1 = lng * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [lo2 * 180 / Math.PI, la2 * 180 / Math.PI];
}

/**
 * Where a hole ends in plan: the collar stepped along its azimuth by the
 * horizontal component of its length. Dip is degrees below horizontal (a
 * negative dip, the usual convention, means the same thing). A vertical hole
 * has no plan length and gets no trace.
 */
export function traceEnd(collar, azimuth, dip, length) {
  const horiz = Math.abs(length) * Math.cos(Math.abs(dip) * Math.PI / 180);
  if (!(horiz > 0.5)) return null;
  return destination(collar, azimuth, horiz);
}

export function isTrace(feature) {
  return !!feature?.properties?._trace;
}

/**
 * The same collection with a trace beside every collar that has an
 * orientation and a length. Idempotent: collars already accompanied by a
 * trace are left alone, so re-running on a saved layer adds nothing.
 */
export function addDrillTraces(fc, { maxFeatures = Infinity } = {}) {
  const feats = fc?.features || [];
  if (!feats.length) return fc;
  const hasTraces = feats.some(isTrace);
  if (hasTraces) return fc;
  const traces = [];
  for (const f of feats) {
    if (f?.geometry?.type !== 'Point') continue;
    const props = f.properties || {};
    const azimuth = readOrientation(props, 'azimuth');
    const dip = readOrientation(props, 'dip');
    const length = readOrientation(props, 'length');
    if (![azimuth, dip, length].every(Number.isFinite)) continue;
    const end = traceEnd(f.geometry.coordinates, azimuth, dip, length);
    if (!end) continue;
    traces.push([f, {
      type: 'Feature',
      // The collar's own key, so the two are one thing to hide or style —
      // whatever the file called its hole id, and whether or not it had one.
      id: featureKey(f),
      geometry: { type: 'LineString', coordinates: [f.geometry.coordinates, end] },
      properties: { ...props, _trace: true, _azimuth: azimuth, _dip: dip, _length: length },
    }]);
  }
  if (!traces.length) return fc;
  // The import ceiling was checked before this ran; a trace per collar must
  // not carry the collection past it.
  if (feats.length + traces.length > maxFeatures) {
    return { ...fc, meta: { ...(fc.meta || {}), tracesSkipped: traces.length } };
  }
  const byCollar = new Map(traces);
  const out = [];
  for (const f of feats) {
    out.push(f);
    const t = byCollar.get(f);
    if (t) out.push(t);
  }
  return { ...fc, features: out, meta: { ...(fc.meta || {}), traces: traces.length } };
}

/** Does the layer put a trace on the map — one that is not hidden? */
export function hasDrillTraces(layer) {
  const feats = layer?.geojson?.features || [];
  return feats.some((f) => isTrace(f) && !isFeatureHidden(layer, f));
}
