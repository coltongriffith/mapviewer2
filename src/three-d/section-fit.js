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

// ---- Hole IDs above the section (design version 5, through section.js) ----
// IDs of holes from one pad as one label: "S-001/002", the IDs after their common prefix (cut back to whole numbers).
export function joinIds(ids) {
  if (ids.length < 2) return ids[0] || '';
  const p = ids.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); }).replace(/\d+$/, '');
  return p + ids.map((id) => id.slice(p.length)).join('/');
}
// Labels ({ h, t, ... }, h.c the collar) whose collars lie within near metres of one in a group join it: one label,
// t the joined IDs, hs the holes, the rest from the first by ID.
export function padMerge(labs, near = 5) {
  const gs = [];
  labs.forEach((l) => { const g = gs.find((x) => x.some((o) => Math.hypot(o.h.c.x - l.h.c.x, o.h.c.y - l.h.c.y) <= near)); if (g) g.push(l); else gs.push([l]); });
  return gs.map((g) => { if (g.length < 2) return { ...g[0], hs: [g[0].h] }; g.sort((a, b) => (a.h.id < b.h.id ? -1 : 1)); return { ...g[0], t: joinIds(g.map((l) => l.h.id)), hs: g.map((l) => l.h) }; });
}
// Whether one row would crowd holes from one pad: two neighbouring labels (bw wide, centred over at[0]) closer than
// their widths and gap, whose collars lie within pad metres (holes far apart that only project close keep one row).
export function crowded(labs, gap = 0, pad = 30) {
  const s = labs.slice().sort((a, b) => a.at[0] - b.at[0]);
  return s.some((l, i) => i > 0 && l.at[0] - s[i - 1].at[0] < (l.bw + s[i - 1].bw) / 2 + gap && Math.hypot(l.h.c.x - s[i - 1].h.c.x, l.h.c.y - s[i - 1].h.c.y) <= pad);
}
// The holes of a section ranked for their IDs: the best grade (col) on the hole within w of the line, weighted by
// how near the hole comes (1 on the line, ½ at the width's edge). Returns a Map hole → 0-0.9, lower first: a
// high-grade hole a little further out comes before a barren one on the line; barren ones by distance.
export function gradeRank(F, holes, w, col) {
  const sc = new Map(), rel = (p) => Math.min(1, Math.abs(toSection(F, p).off) / (w || 1));
  holes.forEach((h) => {
    const d = Math.min(...h.path.map(rel)), best = Math.max(0, ...h.ints.filter((it) => rel(h.posAt((it.from + it.to) / 2)) < 1).map((it) => it.vals[col]).filter(Number.isFinite));
    sc.set(h, [best * (1 - 0.5 * d), d]);
  });
  const top = Math.max(0, ...[...sc.values()].map((v) => v[0]));
  return new Map([...sc].map(([h, [s, d]]) => [h, 0.8 * (top > 0 ? 1 - s / top : 1) + 0.1 * d]));
}
