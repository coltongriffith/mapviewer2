// The section A–A′ for chosen holes: the fitted line and how far each hole lies off it (pure; used through
// the lazy section panel, section.js, so it stays out of the page). Plan points are { x: easting, y: northing }, azimuths degrees from north, 0-179.
import { fitLine, dirOf, lineThrough, toSection } from './section-geometry.js';

const RAD = Math.PI / 180;

// The section for chosen holes: a line fitted through one plan point per hole (az0 kept for a single hole),
// through their middle, running a margin past the outermost of `extent` (points along their traces).
export function fitSection(pts, extent, az0, minHalf = 60) {
  if (!pts.length) return null;
  const f = fitLine(pts), az = f ? Math.round(f.az) % 180 : az0, c = f ? { x: f.cx, y: f.cy } : pts[0], d = dirOf(az);
  const ts = (extent.length ? extent : pts).map((p) => (p.x - c.x) * d.x + (p.y - c.y) * d.y);
  let t0 = Math.min(...ts), t1 = Math.max(...ts); const pad = Math.max(25, (t1 - t0) * 0.08); t0 -= pad; t1 += pad;
  const half = Math.max(minHalf, (t1 - t0) / 2), tm = (t0 + t1) / 2, origin = { x: c.x + d.x * tm, y: c.y + d.y * tm };
  return { az, origin, half, ends: lineThrough(origin, az, half) };
}

// Where a hole lies off the section: the nearest approach of its trace, in metres, and that side's compass
// point ("12 m NE"); '' when it touches the plane.
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function offText(F, pts) {
  const o = pts.map((p) => toSection(F, p).off).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a), Infinity), m = Math.round(Math.abs(o));
  return m >= 1 && Number.isFinite(m) ? `${m} m ${POINTS[Math.round((Math.atan2(F.n.x * o, F.n.y * o) / RAD + 360) % 360 / 45) % 8]}` : '';
}
