// Minimum-curvature desurvey: a drill hole's path from its downhole survey stations, each pair joined by
// the circular arc that leaves one station in its direction and reaches the next in its own (the industry
// standard; Bourgoyne et al., Applied Drilling Engineering, 8.1). Pure, so it can be shared: /3d uses it
// for figures that take their holes from a property's drill database (src/three-d/property-data.js), when
// the hole has surveys. Figures made from uploaded files keep their earlier path (interpolated directions).
//
// Directions are /3d's: azimuth clockwise from north in degrees, dip from horizontal with negative down.
// Offsets are from the collar in metres: x east, y north, z up.

const RAD = Math.PI / 180;
export const direction = (az, dip) => {
  const a = az * RAD, p = dip * RAD;
  return [Math.sin(a) * Math.cos(p), Math.cos(a) * Math.cos(p), Math.sin(p)];
};
// The angle between two unit vectors (the dogleg), stable near 0 where acos is not.
const angle = (a, b) => 2 * Math.atan2(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), Math.hypot(a[0] + b[0], a[1] + b[1], a[2] + b[2]));
// The ratio factor 2/β·tan(β/2): 1 on a straight run. A hole that turns back on itself (β near 180°, never
// a real survey) falls back to the balanced tangential step rather than an infinite one.
const ratio = (b) => (b < 1e-7 || b > Math.PI - 1e-3 ? 1 : (2 / b) * Math.tan(b / 2));
// The direction a fraction f of the way round the arc from a to b.
function along(a, b, beta, f) {
  if (beta < 1e-7) return a;
  const s = Math.sin(beta), ka = Math.sin((1 - f) * beta) / s, kb = Math.sin(f * beta) / s;
  return [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];
}

/**
 * The stations' offsets from the collar. stations: [{ d, az, dip }] by depth. The hole runs from the collar
 * in the first station's direction; a second station at the same depth is ignored.
 * @returns {{ d: number, x: number, y: number, z: number, t: number[], beta: number }[]} from depth 0
 */
export function minCurvature(stations) {
  const st = [...stations].sort((p, q) => p.d - q.d);
  if (!st.length) return [{ d: 0, x: 0, y: 0, z: 0, t: [0, 0, -1], beta: 0 }];
  const out = [{ d: 0, x: 0, y: 0, z: 0, t: direction(st[0].az, st[0].dip), beta: 0 }];
  for (const s of st) {
    const a = out[out.length - 1], t = direction(s.az, s.dip), L = s.d - a.d;
    if (!(L > 0)) continue;
    const beta = angle(a.t, t), k = (L / 2) * ratio(beta);
    out.push({ d: s.d, x: a.x + k * (a.t[0] + t[0]), y: a.y + k * (a.t[1] + t[1]), z: a.z + k * (a.t[2] + t[2]), t, beta });
  }
  return out;
}

// The offset at depth d along the arc from station a to station b (straight on past the last station).
function between(a, b, d) {
  const u = d - a.d;
  if (!b) return { x: a.x + u * a.t[0], y: a.y + u * a.t[1], z: a.z + u * a.t[2] };
  const f = u / (b.d - a.d), phi = f * b.beta, t = along(a.t, b.t, b.beta, f), k = (u / 2) * ratio(phi);
  return { x: a.x + k * (a.t[0] + t[0]), y: a.y + k * (a.t[1] + t[1]), z: a.z + k * (a.t[2] + t[2]) };
}

/** The offset from the collar at depth d. pts: from minCurvature. */
export function offsetAt(pts, d) {
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1].d < d) i++;
  return between(pts[i], pts[i + 1], d);
}

/**
 * Offsets every `step` metres down to `len` (and at len), at the depths /3d samples a hole's path:
 * 0, step, 2·step, ... len.
 * @returns {{ d: number, x: number, y: number, z: number }[]}
 */
export function desurveyPath(stations, len, step = 2) {
  const pts = minCurvature(stations), out = [{ d: 0, x: 0, y: 0, z: 0 }];
  let i = 0;
  for (let d = 0; d < len; d += step) {
    const e = d + Math.min(step, len - d);
    while (i + 1 < pts.length && pts[i + 1].d < e) i++;
    out.push({ d: e, ...between(pts[i], pts[i + 1], e) });
  }
  return out;
}
