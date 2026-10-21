// Named sections (A–A′, B–B′ …) for Exploration Maps 3D: pure data and plan-view maths for the lazy sections
// module (src/three-d/sections.js). A section is { id: "B", name: "B–B′", az, width, a, b, holes, fence, opacity }:
// its azimuth (degrees from north, 0-179), metres either side, the line's ends a and b ({ x: easting, y: northing };
// absent for the line through the block centre), the chosen holes (absent for every hole within the width), and
// whether it shows as a fence in the 3D block. The line maths (fitting, slabs) is src/three-d/section-geometry.js.

export const IDS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const nextId = (list = []) => [...IDS].find((c) => !list.some((s) => s.id === c)) || null;
export const nameOf = (id) => `${id}–${id}′`;
export const FENCE_OPACITY = 0.35;

// The letters at the ends: "B" and "B′" from a name like "B–B′" (or "B-B'"), else the id and the id primed.
export function letters(s) {
  const m = /^\s*(\S{1,4})\s*[–—-]\s*(\S{1,5})\s*$/.exec(s.name || '');
  return m && m[2].replace(/['’]/g, '′') === `${m[1]}′` ? [m[1], `${m[1]}′`] : [s.id, `${s.id}′`];
}

// The single section's fields (secAz, secW and section: { holes, a, b } as studio.js keeps them) as a section's
// geometry, and back. A centre line has no ends; within the width, no holes.
const pt = (p) => ({ x: p.x, y: p.y });
export const geomOf = ({ secAz, secW, section: s }) => ({ az: secAz, width: secW, ...(s?.a && { a: pt(s.a), b: pt(s.b) }), ...(s?.holes && { holes: [...s.holes] }) });
export const legacyOf = (e) => ({ secAz: e.az, secW: e.width, section: e.a || e.holes ? { ...(e.holes && { holes: [...e.holes] }), ...(e.a && { a: pt(e.a), b: pt(e.b) }) } : null });
// The figure's one section as the first named one, A–A′, with its fence off (so the 3D figure looks the same).
export const fromLegacy = (S, id = 'A') => ({ id, name: nameOf(id), ...geomOf(S), fence: false, opacity: FENCE_OPACITY });

// Saved sections checked: ids unique letters, a name, numbers in range, ends kept only as a pair. Anything
// unreadable is dropped; null when none is left.
export function cleanSections(list) {
  if (!Array.isArray(list)) return null;
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, +v)) : d), ok = (p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y), seen = new Set();
  const out = list.filter((s) => s && typeof s === 'object' && typeof s.id === 'string' && s.id.length === 1 && IDS.includes(s.id) && !seen.has(s.id) && seen.add(s.id)).map((s) => ({
    id: s.id, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : nameOf(s.id), az: ((Math.round(num(s.az, -1e4, 1e4, 0)) % 180) + 180) % 180, width: num(s.width, 5, 5000, 75),
    ...(ok(s.a) && ok(s.b) && { a: { x: +s.a.x, y: +s.a.y }, b: { x: +s.b.x, y: +s.b.y } }), ...(Array.isArray(s.holes) && { holes: [...new Set(s.holes.filter((h) => typeof h === 'string'))] }),
    fence: !!s.fence, opacity: num(s.opacity, 0.05, 1, FENCE_OPACITY),
  }));
  return out.length ? out : null;
}

// The part of the plan segment a→b inside the box { x0, x1, y0, y1 }: [s0, s1] as fractions along it, or null.
export function clipToBox(a, b, B) {
  const dx = b.x - a.x, dy = b.y - a.y; let s0 = 0, s1 = 1;
  for (const [p, q] of [[-dx, a.x - B.x0], [dx, B.x1 - a.x], [-dy, a.y - B.y0], [dy, B.y1 - a.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p; if (p < 0) s0 = Math.max(s0, r); else s1 = Math.min(s1, r);
  }
  return s1 - s0 > 1e-6 ? [s0, s1] : null;
}

// The compass point a section looks toward ("NE"), from the looking azimuth in degrees.
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const lookingWord = (az) => POINTS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
