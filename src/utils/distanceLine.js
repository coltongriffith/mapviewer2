// A two-point line on the map, in one of two readings: a measurement (dashed,
// dots at the ends, the length in the middle) or a bracket (solid, a tick
// across each end, an optional caption) — the "Untested strike length >1.5 km"
// mark a target map carries. Shared by the editor and both exporters.

import { haversineMeters } from './coordinateFrame.js';

export function distanceLineKm(line) {
  return haversineMeters(line.p1.lat, line.p1.lng, line.p2.lat, line.p2.lng) / 1000;
}

export function formatDistance(km, units) {
  if (units === 'mi') return `${(km * 0.621371).toFixed(1)} mi`;
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
}

/** What the line is captioned, or '' when the caption is switched off. */
export function distanceLineLabel(line) {
  if (line.showLabel === false) return '';
  const custom = String(line.label || '').trim();
  return custom || formatDistance(distanceLineKm(line), line.units);
}

export function isBracket(line) {
  return line?.style === 'bracket';
}

/**
 * The two short strokes across the ends of a bracket, perpendicular to the
 * line, each `len` long and centred on its endpoint. Screen coordinates in.
 */
export function bracketTicks(x1, y1, x2, y2, len = 10) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  const h = len / 2;
  return [
    { x1: x1 - nx * h, y1: y1 - ny * h, x2: x1 + nx * h, y2: y1 + ny * h },
    { x1: x2 - nx * h, y1: y2 - ny * h, x2: x2 + nx * h, y2: y2 + ny * h },
  ];
}

/** Where the caption sits: beside the midpoint, offset off the line. */
export function bracketLabelAnchor(x1, y1, x2, y2, offset = 14) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1;
  // Offset toward the top of the screen so the caption reads above the bar.
  let nx = -dy / d, ny = dx / d;
  if (ny > 0) { nx = -nx; ny = -ny; }
  return { x: (x1 + x2) / 2 + nx * offset, y: (y1 + y2) / 2 + ny * offset };
}
