// Marks on the terrain for Exploration Maps 3D: the plan geometry shared by the map overlays (overlays.js) and
// the annotation shapes (shapes.js). Pure functions of plan points [x, y] in the files' metres, the block B
// ({ x0, x1, y0, y1 }) and the page's surface; nothing here touches the page or three.js.

// A polyline cut to the block: the runs inside it (Liang–Barsky on each segment).
export function clipLine(pts, B) {
  const runs = []; let run = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], dx = pts[i + 1][0] - x0, dy = pts[i + 1][1] - y0; let t0 = 0, t1 = 1;
    const ok = [[-dx, x0 - B.x0], [dx, B.x1 - x0], [-dy, y0 - B.y0], [dy, B.y1 - y0]].every(([p, q]) => {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r); return t0 <= t1;
    });
    if (!ok) { run = null; continue; }
    const a = [x0 + dx * t0, y0 + dy * t0], b = [x0 + dx * t1, y0 + dy * t1];
    if (run && t0 === 0) run.push(b); else runs.push(run = [a, b]);
    if (t1 < 1) run = null;
  }
  return runs;
}
// A polygon ring cut to the block (Sutherland–Hodgman); the result may be empty.
export function clipRing(ring, B) {
  let out = ring;
  for (const [k, lim, keep] of [[0, B.x0, 1], [0, B.x1, -1], [1, B.y0, 1], [1, B.y1, -1]]) {
    const inp = out; out = [];
    const ins = (p) => (p[k] - lim) * keep >= 0;
    inp.forEach((p, i) => {
      const q = inp[(i + inp.length - 1) % inp.length];
      if (ins(p) !== ins(q)) { const t = (lim - q[k]) / (p[k] - q[k]); out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]); }
      if (ins(p)) out.push(p);
    });
    if (!out.length) return out;
  }
  return out;
}
// Points every `step` metres along a polyline, keeping its vertices (closed: back to the first).
export function densify(pts, step, closed = false) {
  const P = closed && pts.length > 2 ? [...pts, pts[0]] : pts, out = [];
  P.forEach((p, i) => {
    if (i) { const q = P[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step); for (let k = 1; k < n; k++) out.push([q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n]); }
    out.push(p);
  });
  return out;
}
// Whether a point on (or above) the surface can be seen: a march from it toward the eye (a point [x, y, z])
// or, for a parallel projection, along a direction toward it, over the surface surf(x, y). Hidden where the
// terrain rises above the ray before it leaves the block or climbs past its highest point (zmax).
export function sightTest(B, surf, zmax, { eye, dir }, tol = 1) {
  const cell = Math.min(B.x1 - B.x0, B.y1 - B.y0) / 120;
  return (x, y, z) => {
    let d = dir || [eye[0] - x, eye[1] - y, eye[2] - z]; const l = Math.hypot(...d); if (!(l > 0)) return true; d = d.map((v) => v / l);
    const hl = Math.hypot(d[0], d[1]); if (hl < 1e-4) return true;
    const s = cell / hl;
    for (let k = 1.5; k < 600; k++) {
      const qx = x + d[0] * s * k, qy = y + d[1] * s * k, qz = z + d[2] * s * k;
      if (qx < B.x0 || qx > B.x1 || qy < B.y0 || qy > B.y1 || qz > zmax) return true;
      if (surf(qx, qy) > qz + tol) return false;
    }
    return true;
  };
}
// Screen runs of a plan line draped on the surface: each point taken to the surface (z, or surf when z is
// absent), dropped where hidden or behind the camera, the line broken there. toScreen(x, y, z) -> [sx, sy, depth].
export function drapeRuns(pts, { surf, toScreen, seen }) {
  const runs = []; let run = null;
  for (const p of pts) {
    const z = p[2] ?? surf(p[0], p[1]), s = toScreen(p[0], p[1], z);
    if (s[2] > 1 || (seen && !seen(p[0], p[1], z))) { run = null; continue; }
    if (!run) runs.push(run = []);
    run.push([s[0], s[1]]);
  }
  return runs.filter((r) => r.length > 1);
}
