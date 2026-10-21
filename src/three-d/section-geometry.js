// Section A–A′ geometry for Exploration Maps 3D: pure plan-view maths for the page (studio.js) and the
// section panel (section.js, with section-fit.js). Points are { x: easting, y: northing, z } in the files' metres; azimuths are
// degrees clockwise from north, a section line's taken 0-179.

const RAD = Math.PI / 180;
export const dirOf = (az) => ({ x: Math.sin(az * RAD), y: Math.cos(az * RAD) });

// Orthogonal least-squares line through plan points: { az, cx, cy }, or null for fewer than two distinct
// points (the caller keeps its azimuth).
export function fitLine(pts) {
  const n = pts.length; if (n < 2) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n, cy = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0; pts.forEach((p) => { sxx += (p.x - cx) ** 2; syy += (p.y - cy) ** 2; sxy += (p.x - cx) * (p.y - cy); });
  if (sxx + syy < 1e-9) return null;
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // the major axis, from east
  return { az: ((90 - ang / RAD) % 180 + 180) % 180, cx, cy };
}

// The line through o at az, half its length either side; A is the west-ish end so the section reads left
// to right.
export function lineThrough(o, az, half) {
  const d = dirOf(az), p1 = { x: o.x - d.x * half, y: o.y - d.y * half }, p2 = { x: o.x + d.x * half, y: o.y + d.y * half };
  return p1.x <= p2.x + 1e-9 ? [p1, p2] : [p2, p1];
}

// A section's frame from its ends, and a point in it: t along A→A′ and off, the signed distance off the line.
export function secFrame(A, B) { const L = Math.hypot(B.x - A.x, B.y - A.y) || 1, d = { x: (B.x - A.x) / L, y: (B.y - A.y) / L }; return { A, L, d, n: { x: -d.y, y: d.x } }; }
export const toSection = (F, p) => ({ t: (p.x - F.A.x) * F.d.x + (p.y - F.A.y) * F.d.y, off: (p.x - F.A.x) * F.n.x + (p.y - F.A.y) * F.n.y });
export const lerp = (p, q, s) => ({ x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s, z: p.z + (q.z - p.z) * s });

// The part of segment p→q inside the slab |off| ≤ w: [s0, s1], fractions along it, or null.
export function clipSlab(F, p, q, w) {
  const a = toSection(F, p).off, db = toSection(F, q).off - a;
  if (Math.abs(db) < 1e-12) return Math.abs(a) <= w ? [0, 1] : null;
  const lo = (-w - a) / db, hi = (w - a) / db, s0 = Math.max(0, Math.min(lo, hi)), s1 = Math.min(1, Math.max(lo, hi));
  return s1 - s0 > 1e-9 ? [s0, s1] : null;
}
// A polyline (a drill trace) cut to the slab: the runs inside, with a point added where it crosses a boundary.
export function clipPath(F, pts, w) {
  const runs = []; let run = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = clipSlab(F, pts[i], pts[i + 1], w); if (!c) { run = null; continue; }
    const b = c[1] === 1 ? pts[i + 1] : lerp(pts[i], pts[i + 1], c[1]);
    if (run && c[0] === 0) run.push(b); else runs.push(run = [c[0] === 0 ? pts[i] : lerp(pts[i], pts[i + 1], c[0]), b]);
    if (c[1] < 1) run = null;
  }
  return runs;
}

// S.section as saved: { holes: [ids], a, b } (the chosen holes and the line's ends), each part optional;
// anything else is dropped, and an empty section is null (the line through the block centre, holes within
// the width).
export function cleanSection(s) {
  if (!s || typeof s !== 'object') return null;
  const pt = (p) => (p && Number.isFinite(+p.x) && Number.isFinite(+p.y) ? { x: +p.x, y: +p.y } : null), out = {};
  if (Array.isArray(s.holes)) out.holes = [...new Set(s.holes.filter((h) => typeof h === 'string'))];
  const a = pt(s.a), b = pt(s.b); if (a && b && Math.hypot(b.x - a.x, b.y - a.y) > 1) Object.assign(out, a.x <= b.x ? { a, b } : { a: b, b: a });
  return Object.keys(out).length ? out : null;
}
