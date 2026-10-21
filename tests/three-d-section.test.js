import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fitLine, lineThrough, secFrame, toSection, clipSlab, clipPath, cleanSection, dirOf } from '../src/three-d/section-geometry.js';
import { fitSection, offText } from '../src/three-d/section-fit.js';
import { DESIGN_VERSION, uses, withDefaults } from '../src/three-d/design-version.js';

const near = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
// Points along a line at az through (x0, y0), with an optional sideways scatter.
const along = (az, x0, y0, ts, side = () => 0) => { const d = dirOf(az); return ts.map((t, i) => ({ x: x0 + d.x * t - d.y * side(i), y: y0 + d.y * t + d.x * side(i) })); };

describe('fitting the section line to chosen holes', () => {
  it('recovers the azimuth of collinear holes', () => {
    for (const az of [0, 30, 45, 90, 135, 170]) {
      const f = fitLine(along(az, 412000, 6421000, [-200, -60, 15, 140, 260]));
      near(f.az, az, 1e-6);
    }
    // A line drilled toward 225 is the same section as 45.
    near(fitLine(along(225, 0, 0, [0, 100, 200])).az, 45, 1e-6);
  });
  it('averages noisy holes to the least-squares line', () => {
    const noise = [6, -9, 4, -3, 8, -7, 2, -5];
    const f = fitLine(along(120, 500, 500, [-350, -250, -150, -50, 50, 150, 250, 350], (i) => noise[i]));
    expect(Math.abs(f.az - 120)).toBeLessThan(2);
    near(f.cx, 500 + noise.reduce((s, v) => s + v, 0) / 8 * -dirOf(120).y, 1);
  });
  it('runs through two holes exactly', () => {
    const f = fitLine([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    near(f.az, 45); near(f.cx, 50); near(f.cy, 50);
  });
  it('keeps the current azimuth for one hole (or holes at one point), through that hole', () => {
    expect(fitLine([{ x: 5, y: 5 }])).toBeNull();
    expect(fitLine([{ x: 5, y: 5 }, { x: 5, y: 5 }])).toBeNull();
    const s = fitSection([{ x: 1000, y: 2000 }], [], 135, 60);
    expect(s.az).toBe(135);
    const F = secFrame(...s.ends);
    near(toSection(F, { x: 1000, y: 2000 }).off, 0);
    near(F.L, 120); // the minimum length either side
  });
  it('runs the fitted line a little past the outermost traces, A at the west end', () => {
    const mids = along(60, 0, 0, [-150, 0, 150]), traces = along(60, 0, 0, [-260, -150, 0, 150, 240]);
    const s = fitSection(mids, traces, 135);
    expect(s.az).toBe(60);
    expect(s.ends[0].x).toBeLessThan(s.ends[1].x);
    const F = secFrame(...s.ends), ts = traces.map((p) => toSection(F, p).t);
    expect(Math.min(...ts)).toBeGreaterThan(20); expect(Math.max(...ts)).toBeLessThan(F.L - 20);
    near(F.L, 500 + 2 * 40, 1e-6); // 8% of the 500 m span either side
  });
});

describe('projecting onto the section', () => {
  const F = secFrame({ x: 0, y: 0 }, { x: 100, y: 0 }); // A–A′ due east
  it('gives distance along A→A′ and signed distance off the line', () => {
    expect(toSection(F, { x: 30, y: 12 })).toEqual({ t: 30, off: 12 });
    expect(toSection(F, { x: -5, y: -7 })).toEqual({ t: -5, off: -7 });
  });
  it('builds the line through a point at an azimuth, west end first', () => {
    const [a, b] = lineThrough({ x: 0, y: 0 }, 135, 50);
    expect(a.x).toBeLessThan(b.x); near(Math.hypot(b.x - a.x, b.y - a.y), 100); near(a.y, 50 * Math.SQRT1_2);
  });
  it('says how far, and which way, a hole lies off the section', () => {
    expect(offText(F, [{ x: 10, y: 40 }, { x: 20, y: 12.4 }])).toBe('12 m N');
    expect(offText(F, [{ x: 10, y: -9 }])).toBe('9 m S');
    expect(offText(F, [{ x: 10, y: 30 }, { x: 10, y: -2 }, { x: 10, y: 0.3 }])).toBe(''); // it crosses the plane
    const G = secFrame({ x: 0, y: 0 }, { x: 100, y: -100 }); // a line toward 135: off to the NE or SW
    expect(offText(G, [{ x: 50 + 10, y: -50 + 10 }])).toBe('14 m NE');
  });
});

describe('cutting traces at the slab', () => {
  const F = secFrame({ x: 0, y: 0 }, { x: 400, y: 0 });
  it('clips a segment to the slab and leaves out one outside it', () => {
    expect(clipSlab(F, { x: 0, y: -100, z: 0 }, { x: 0, y: 100, z: -200 }, 50)).toEqual([0.25, 0.75]);
    expect(clipSlab(F, { x: 0, y: 60, z: 0 }, { x: 10, y: 80, z: 0 }, 50)).toBeNull();
    expect(clipSlab(F, { x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }, 50)).toEqual([0, 1]);
  });
  it('cuts a deviated hole that crosses both boundaries exactly at them', () => {
    // From 80 m south of the line, curving north across the slab (±50 m) to 90 m north, every 2 m.
    const pts = []; for (let d = 0; d <= 400; d += 2) { const s = d / 400; pts.push({ x: 200 + 30 * Math.sin(s * 3), y: -80 + 170 * s * s * (3 - 2 * s), z: 1000 - d * 0.8 }); }
    const runs = clipPath(F, pts, 50);
    expect(runs).toHaveLength(1);
    const r = runs[0], first = toSection(F, r[0]), last = toSection(F, r[r.length - 1]);
    near(first.off, -50, 1e-9); near(last.off, 50, 1e-9);
    r.forEach((p) => expect(Math.abs(toSection(F, p).off)).toBeLessThanOrEqual(50 + 1e-9));
    // The boundary points are on the trace: z interpolated with the plan position.
    const i = pts.findIndex((p) => p.y > -50), k = (-50 - pts[i - 1].y) / (pts[i].y - pts[i - 1].y);
    near(r[0].z, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k, 1e-9);
    // The 2 m points inside the slab are all kept, between the two boundary points.
    expect(r.length).toBe(pts.filter((p) => Math.abs(p.y) <= 50).length + 2);
  });
  it('splits a hole that leaves the slab and comes back', () => {
    const pts = [0, 60, 0, -70, 0].map((y, i) => ({ x: i * 10, y, z: -i * 10 }));
    const runs = clipPath(F, pts, 50);
    expect(runs).toHaveLength(3);
    near(toSection(F, runs[1][0]).off, 50); near(toSection(F, runs[1][runs[1].length - 1]).off, -50);
  });
});

describe('saving the section', () => {
  const legacy = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
  const NOW = { designVersion: DESIGN_VERSION, designOptIn: [], secAz: 135, secW: 75, section: null };
  it('keeps chosen holes and the line through a save and reopen', () => {
    const section = { holes: ['S-037', 'S-048', 'S-043', 'S-037'], a: { x: 412300.5, y: 6421800 }, b: { x: 412100, y: 6422000 } };
    const reopened = JSON.parse(JSON.stringify({ settings: { ...NOW, section } }));
    const S = withDefaults(reopened.settings, NOW);
    expect(cleanSection(S.section)).toEqual({ holes: ['S-037', 'S-048', 'S-043'], a: { x: 412100, y: 6422000 }, b: { x: 412300.5, y: 6421800 } });
    expect(cleanSection({ holes: [] })).toEqual({ holes: [] }); // chosen mode with nothing ticked yet
    expect(cleanSection({ a: { x: 1, y: 2 } })).toBeNull(); // a line needs both ends
    expect(cleanSection({ holes: 'S-1', a: { x: 0, y: 0 }, b: { x: 0, y: 0 } })).toBeNull();
  });
  it('leaves an earlier figure as it was: no section field means holes within the width, the centre line', () => {
    expect(legacy.settings.section).toBeUndefined();
    const S = withDefaults(legacy.settings, NOW);
    expect(S.section).toBeNull();
    expect(cleanSection(S.section)).toBeNull();
    expect(uses(S, 'cleanSection')).toBe(false);
    expect(uses({ designVersion: 2 }, 'cleanSection')).toBe(false); // version 2 keeps its section drawing
    expect(uses({ designVersion: DESIGN_VERSION }, 'cleanSection')).toBe(true);
    expect(uses({ designVersion: 2, designOptIn: ['cleanSection'] }, 'cleanSection')).toBe(true);
  });
});
