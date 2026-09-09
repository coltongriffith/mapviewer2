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

export function latlngToUTM(lat, lng) {
  const zone = utmZone(lng);
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
 * container pixels times `scale`) and what it says. Only ticks inside the
 * frame are returned, so a renderer draws what it is given.
 *
 * Eastings are computed in the zone of the map centre, so a map straddling a
 * 6° zone boundary does not jump; northings are stepped from the centre with
 * a flat metres-per-degree, which is within a pixel at any map scale a tick
 * frame is used at.
 */
export function computeGridTicks(map, frame, scale = 1) {
  if (!map || !frame) return null;
  const size = map.getSize?.();
  if (!size || !size.x || !size.y) return null;
  const cx = size.x / 2, cy = size.y / 2;
  const centerLL = map.containerPointToLatLng([cx, cy]);
  const leftLL = map.containerPointToLatLng([0, cy]);
  const rightLL = map.containerPointToLatLng([size.x, cy]);
  const topLL = map.containerPointToLatLng([cx, 0]);
  const botLL = map.containerPointToLatLng([cx, size.y]);
  const totalW = haversineMeters(leftLL.lat, leftLL.lng, rightLL.lat, rightLL.lng);
  const totalH = haversineMeters(topLL.lat, topLL.lng, botLL.lat, botLL.lng);
  // Aim for ~6 across and ~5 down the FRAME, not the container.
  const frameW = Math.max(1, frame.right - frame.left);
  const frameH = Math.max(1, frame.bottom - frame.top);
  const xInterval = pickUTMInterval(totalW * (frameW / size.x), 6);
  const yInterval = pickUTMInterval(totalH * (frameH / size.y), 5);

  const centre = latlngToUTM(centerLL.lat, centerLL.lng);
  const cm = (centre.zone - 1) * 6 - 180 + 3;
  const refLatR = centerLL.lat * Math.PI / 180;
  const nRef = A / Math.sqrt(1 - E2 * Math.sin(refLatR) ** 2);
  const mPerLngRad = K0 * nRef * Math.cos(refLatR);
  const eastingAt = (lng) => 500000 + mPerLngRad * (lng - cm) * (Math.PI / 180);
  const lngAt = (e) => cm + ((e - 500000) / mPerLngRad) * (180 / Math.PI);

  const f = { left: frame.left * scale, top: frame.top * scale, right: frame.right * scale, bottom: frame.bottom * scale };
  const tol = 1;

  const x = [];
  const leftE = eastingAt(leftLL.lng);
  const rightE = eastingAt(rightLL.lng);
  for (let e = Math.ceil(leftE / xInterval) * xInterval; e <= rightE + xInterval * 0.1; e += xInterval) {
    const pt = map.latLngToContainerPoint([centerLL.lat, lngAt(e)]);
    const px = pt.x * scale;
    if (px < f.left - tol || px > f.right + tol) continue;
    x.push({ px, easting: e, label: fmtUTMEasting(e) });
  }

  const y = [];
  // Northings are stepped on one continuous axis: the southern hemisphere's
  // 10 000 000 m false northing is removed for the arithmetic and put back
  // for the label, so a map across the equator still gets its ticks.
  const continuous = (u) => (u.hemisphere === 'S' ? u.northing - 10000000 : u.northing);
  const topN = continuous(latlngToUTM(topLL.lat, topLL.lng));
  const botN = continuous(latlngToUTM(botLL.lat, botLL.lng));
  const centreN = continuous(centre);
  for (let n = Math.floor(topN / yInterval) * yInterval; n >= botN - yInterval * 0.1; n -= yInterval) {
    const lat = centerLL.lat + (n - centreN) / 111132;
    const pt = map.latLngToContainerPoint([lat, centerLL.lng]);
    const py = pt.y * scale;
    if (py < f.top - tol || py > f.bottom + tol) continue;
    y.push({ py, northing: n, label: fmtUTMNorthing(n >= 0 ? n : n + 10000000) });
  }

  return { zone: centre.zone, hemisphere: centre.hemisphere, xInterval, yInterval, x, y, frame: f };
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
