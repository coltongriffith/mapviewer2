// The scale bar's one decision — how many metres the bar stands for — made in
// one place. The editor card, the shared page and both exporters each kept a
// copy of this picker; three copies of the same table is how the export and
// the preview drift a step apart.
//
// The bar is drawn in two halves and labelled at 0, the midpoint and the end
// ("0 · 2.5 · 5 km"), which is how a technical figure's bar reads.

import { haversineMeters } from './coordinateFrame.js';

export const SCALE_STEPS = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000, 1000000];
const TARGET_PX = 120;

export function formatScaleLength(metres) {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

/** The midpoint label in the end label's unit, without repeating the unit. */
export function formatScaleHalf(metres) {
  const half = metres / 2;
  return metres >= 1000 ? `${half / 1000}` : `${half}`;
}

export function pickScaleBar(map, target = TARGET_PX) {
  const size = map.getSize();
  const cy = size.y / 2;
  const a = map.containerPointToLatLng([0, cy]);
  const b = map.containerPointToLatLng([200, cy]);
  const metresAcross = typeof a.distanceTo === 'function' ? a.distanceTo(b) : haversineMeters(a.lat, a.lng, b.lat, b.lng);
  const metersPerPx = metresAcross / 200;
  const nice = SCALE_STEPS.reduce((best, n) => (
    Math.abs(n / metersPerPx - target) < Math.abs(best / metersPerPx - target) ? n : best
  ), SCALE_STEPS[0]);
  return {
    metres: nice,
    widthPx: Math.max(40, Math.min(220, Math.round(nice / metersPerPx))),
    label: formatScaleLength(nice),
    half: formatScaleHalf(nice),
  };
}
