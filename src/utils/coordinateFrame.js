// The coordinate frame: the white margin around the map with UTM ticks and
// labels on all four edges, and the projection/datum text that goes with it.
//
// No React and no Leaflet imports on purpose. The editing stage, the shared
// read-only page, the PNG exporter and the SVG exporter all draw this frame,
// and each of them used to carry its own copy of the Transverse Mercator
// maths and its own idea of where a tick should land. They disagreed: the
// editor squeezed the map's full width into the frame, so a tick drifted up
// to the margin width from the easting it named at the edges, while the
// exporter shifted every tick right by the margin. One computation here, in
// container pixels, and each renderer only scales it.
//
// The frame was also the NI 43-101 template's private feature. Any template
// can now switch it on (layout.showCoordinateFrame); NI keeps it always on.

import { autoProjectionName } from './geo.js';

export const TICK_MARGIN = 28;
export const STRIP_H = 72;
export const NI_TEMPLATE_ID = 'ni_43101_technical';

export function hasCoordinateFrame(layout) {
  return layout?.templateId === NI_TEMPLATE_ID || !!layout?.showCoordinateFrame;
}

/**
 * Where the framed map sits on the stage, in stage pixels, or null when the
 * layout draws no frame. `area` is the region the map occupies before the
 * margin is taken (the whole stage, or the part left of a side panel) — the
 * white margin is painted inside it, never over a panel beside it.
 */
export function getMapFrame(layout, stage, opts = {}) {
  const width = stage?.width || 1000;
  const height = stage?.height || 600;
  if (layout?.templateId === NI_TEMPLATE_ID) {
    const stripPos = layout?.titleStripPosition || 'bottom';
    const top = TICK_MARGIN + (stripPos === 'top' ? STRIP_H : 0);
    const bottom = height - TICK_MARGIN - (stripPos === 'bottom' ? STRIP_H : 0);
    return {
      left: TICK_MARGIN, top, right: width - TICK_MARGIN, bottom,
      area: { left: 0, top: top - TICK_MARGIN, right: width, bottom: bottom + TICK_MARGIN },
    };
  }
  if (!layout?.showCoordinateFrame) return null;
  const areaRight = layout?.templateId === 'side_panel'
    ? Math.round(width * (1 - (opts.sidebarFrac ?? 0.28)))
    : width;
  return {
    left: TICK_MARGIN, top: TICK_MARGIN, right: areaRight - TICK_MARGIN, bottom: height - TICK_MARGIN,
    area: { left: 0, top: 0, right: areaRight, bottom: height },
  };
}

export function scaleFrame(frame, scale) {
  if (!frame) return null;
  const s = (v) => v * scale;
  return {
    left: s(frame.left), top: s(frame.top), right: s(frame.right), bottom: s(frame.bottom),
    area: { left: s(frame.area.left), top: s(frame.area.top), right: s(frame.area.right), bottom: s(frame.area.bottom) },
  };
}

// ── UTM ─────────────────────────────────────────────────────────────────────

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = 2 * F - F * F;
const K0 = 0.9996;

export function utmZone(lng) {
  return Math.floor((lng + 180) / 6) + 1;
}

/** `zone` forces the zone (a map's ticks stay in its centre's zone). */
export function latlngToUTM(lat, lng, zone = utmZone(lng)) {
  const cm = (zone - 1) * 6 - 180 + 3;
  const latR = lat * Math.PI / 180;
  const dLng = (lng - cm) * Math.PI / 180;
  const N = A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = E2 / (1 - E2) * Math.cos(latR) ** 2;
  const a = dLng * Math.cos(latR);
  const e1sq = E2 / (1 - E2);
  const M = A * (
    (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * latR
    - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * latR)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * latR)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * latR));
  const easting = K0 * N * (a + (1 - T + C) * a ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * e1sq) * a ** 5 / 120) + 500000;
  const northing = K0 * (M + N * Math.tan(latR) * (a ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * a ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * e1sq) * a ** 6 / 720)) + (lat < 0 ? 10000000 : 0);
  return { easting, northing, zone, hemisphere: lat >= 0 ? 'N' : 'S' };
}

export const UTM_INTERVALS = [250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];

export function pickUTMInterval(totalM, count) {
  const target = totalM / count;
  return UTM_INTERVALS.find((s) => s >= target) || UTM_INTERVALS[UTM_INTERVALS.length - 1];
}

export function fmtUTMEasting(e) {
  const s = Math.round(e).toString().padStart(6, '0');
  return `${s.slice(0, -3)} ${s.slice(-3)}E`;
}

export function fmtUTMNorthing(n) {
  const s = Math.round(n).toString();
  if (s.length <= 6) return `${s.slice(0, -3)} ${s.slice(-3)}N`;
  return `${s.slice(0, -6)} ${s.slice(-6, -3)} ${s.slice(-3)}N`;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * The ticks to draw on a frame: where each one sits (in output pixels, i.e.
 * container pixels times `scale`) and what it says, edge by edge. Only ticks
 * on the frame are returned, so a renderer draws what it is given.
 *
 * A tick is where a UTM grid line crosses the frame rule. The map is Web
 * Mercator and the grid is Transverse Mercator, so grid lines are neither
 * straight nor parallel to the frame: they converge on the zone's central
 * meridian, and easting along a parallel is not linear in longitude. Ticks
 * used to be placed with a flat metres-per-degree at the centre's latitude
 * and drawn at that one position on both opposite edges, which put 663 250E
 * about 14 m (54 px) off at zoom 17.5 at 50.6°N. Now each edge is walked in
 * container pixels, each point projected to UTM, and every tick value solved
 * for where that edge reaches it (solveEdge). The top and bottom ticks of one
 * grid line differ by the grid convergence, as on a printed sheet.
 *
 * Eastings are computed in the zone of the map centre, so a map straddling a
 * 6° zone boundary does not jump. (The single `x` and `y` lists drawn on both
 * opposite edges are gone; every renderer reads top/bottom/left/right.)
 *
 * A frame wider than a zone (more than 6° of longitude), or reaching more than
 * 6° from the zone's central meridian or past 84°N/80°S, gets no ticks
 * (`suppressed`): the Transverse Mercator series is meaningless out there and
 * a world view used to come back with ~140 000 crossings.
 */
export const UTM_MAX_SPAN_DEG = 6;
export const MAX_TICKS_PER_EDGE = 50;

export function computeGridTicks(map, frame, scale = 1) {
  if (!map || !frame) return null;
  const size = map.getSize?.();
  if (!size || !size.x || !size.y) return null;
  const s = scale;
  const centerLL = map.containerPointToLatLng([size.x / 2, size.y / 2]);
  const centre = latlngToUTM(centerLL.lat, centerLL.lng);
  const cm = (centre.zone - 1) * 6 - 180 + 3;
  const result = {
    zone: centre.zone, hemisphere: centre.hemisphere, xInterval: null, yInterval: null,
    top: [], bottom: [], left: [], right: [], suppressed: true,
    frame: { left: frame.left * s, top: frame.top * s, right: frame.right * s, bottom: frame.bottom * s },
  };
  const corners = [[frame.left, frame.top], [frame.right, frame.top], [frame.left, frame.bottom], [frame.right, frame.bottom]]
    .map((p) => map.containerPointToLatLng(p));
  const lngs = corners.map((ll) => ll.lng);
  if (Math.max(...lngs) - Math.min(...lngs) > UTM_MAX_SPAN_DEG
    || corners.some((ll) => !(Math.abs(ll.lng - cm) <= UTM_MAX_SPAN_DEG && ll.lat <= 84 && ll.lat >= -80))) return result;

  // Northings on one continuous axis: the southern hemisphere's 10 000 000 m
  // false northing is removed for the arithmetic and put back for the label,
  // so a map across the equator still gets its ticks.
  const utmAt = (x, y) => {
    const ll = map.containerPointToLatLng([x, y]);
    const u = latlngToUTM(ll.lat, ll.lng, centre.zone);
    return ll.lat < 0 ? { ...u, northing: u.northing - 10000000 } : u;
  };
  const eAt = (y) => (x) => utmAt(x, y).easting;
  const nAt = (x) => (y) => utmAt(x, y).northing;
  // The interval comes from the grid range each pair of edges actually spans:
  // ~6 ticks across and ~5 down the frame.
  const xInterval = pickUTMInterval(Math.max(edgeRange(eAt(frame.top), frame.left, frame.right), edgeRange(eAt(frame.bottom), frame.left, frame.right)), 6);
  const yInterval = pickUTMInterval(Math.max(edgeRange(nAt(frame.left), frame.top, frame.bottom), edgeRange(nAt(frame.right), frame.top, frame.bottom)), 5);
  const across = (y) => solveEdge(eAt(y), frame.left, frame.right, xInterval)
    .map(({ t, v }) => ({ px: t * s, easting: v, label: fmtUTMEasting(v) }));
  const down = (x) => solveEdge(nAt(x), frame.top, frame.bottom, yInterval)
    .map(({ t, v }) => ({ py: t * s, northing: v, label: fmtUTMNorthing(v >= 0 ? v : v + 10000000) }));
  return {
    ...result, xInterval, yInterval, suppressed: false,
    top: across(frame.top), bottom: across(frame.bottom), left: down(frame.left), right: down(frame.right),
  };
}

/** How far `value(t)` ranges over t from `a` to `b` (sampled). */
function edgeRange(value, a, b, samples = 16) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= samples; i += 1) {
    const v = value(a + ((b - a) * i) / samples);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return hi - lo;
}

/**
 * Every multiple of `interval` that `value(t)` passes for t from `a` to `b`,
 * with the t where it does, sorted by t. The edge is sampled first so each
 * value is bracketed even where the projection bends, then each crossing is
 * bisected to under a thousandth of a pixel. Never interpolated. Stops at
 * `max` crossings, so a runaway projection cannot flood the frame.
 */
export function solveEdge(value, a, b, interval, samples = 32, max = MAX_TICKS_PER_EDGE) {
  const out = [];
  if (!(b > a) || !(interval > 0)) return out;
  let t0 = a;
  let v0 = value(a);
  for (let i = 1; i <= samples; i += 1) {
    const t1 = a + ((b - a) * i) / samples;
    const v1 = value(t1);
    for (let k = Math.ceil(Math.min(v0, v1) / interval); k * interval <= Math.max(v0, v1) && out.length < max; k += 1) {
      const v = k * interval;
      // A value on a sample point belongs to the segment before it.
      if (v === v0 && i > 1) continue;
      let ta = t0, tb = t1, va = v0;
      while (tb - ta > 1e-4) {
        const tm = (ta + tb) / 2;
        const vm = value(tm);
        if ((vm - v) * (va - v) <= 0) tb = tm;
        else { ta = tm; va = vm; }
      }
      out.push({ t: (ta + tb) / 2, v });
    }
    t0 = t1;
    v0 = v1;
  }
  return out.sort((p, q) => p.t - q.t);
}

// ── Projection / datum text ─────────────────────────────────────────────────

/** What the map says its coordinates are in: the user's text, else derived. */
export function projectionLabel(layout, map) {
  const custom = String(layout?.projectionName || '').trim();
  return custom || autoProjectionName(map);
}

/** Height of the scale bar card: taller when the projection sits under it. */
export function scaleBarHeight(layout, base = 48) {
  if (layout?.scaleBarHeightPx != null) return layout.scaleBarHeightPx;
  return base + (layout?.showProjectionLabel ? 16 : 0);
}

export const FRAME_FONT = "'Courier New', Courier, monospace";
export const FRAME_FONT_PX = 9;
export const FRAME_TICK_PX = 8;
