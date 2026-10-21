import { describe, it, expect } from 'vitest';
import { segHits, routeLeader, placePills, leaderSpot } from '../src/three-d/leaders.js';
import { modeFilter, dropSpecks, refine, patches, labelSpots } from '../src/three-d/geology.js';
import { windOutward, shellOpacity, shade, patchScene, patchShell, tone } from '../src/three-d/look.js';
import { buildShell } from '../src/three-d/shell-mesh.js';

describe('leaders keep off cards', () => {
  it('finds whether a segment crosses a box', () => {
    expect(segHits([0, 50], [100, 50], [40, 40, 60, 60])).toBe(true);
    expect(segHits([0, 0], [100, 0], [40, 40, 60, 60])).toBe(false);
    expect(segHits([0, 0], [30, 30], [40, 40, 60, 60])).toBe(false); // stops short
    expect(segHits([50, 0], [50, 100], [40, 40, 60, 60])).toBe(true); // vertical
  });
  it('goes straight when clear, and bends around a card in the way', () => {
    expect(routeLeader([0, 0], [100, 0], [[40, 40, 60, 60]])).toEqual([[0, 0], [100, 0]]);
    const card = [40, -20, 60, 20], r = routeLeader([0, 0], [100, 0], [card], 2);
    expect(r.length).toBeGreaterThan(2);
    for (let i = 1; i < r.length; i++) expect(segHits(r[i - 1], r[i], card)).toBe(false);
    expect(r[0]).toEqual([0, 0]); expect(r[r.length - 1]).toEqual([100, 0]);
  });
  it('ignores a box holding the arrow tip (the label points into it)', () => {
    expect(routeLeader([0, 0], [100, 0], [[90, -10, 110, 10]])).toEqual([[0, 0], [100, 0]]);
  });
  it('moves a label whose leader would detour, unless it was dragged there', () => {
    const wall = [200, 0, 220, 380], opts = { frame: [0, 0, 600, 400], pad: 2 }; // a tall card between label and tip
    const moved = leaderSpot([100, 200], [300, 200], [60, 20], [wall], opts);
    expect(moved.at).not.toEqual([100, 200]);
    expect(moved.pts.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < moved.pts.length; i++) expect(segHits(moved.pts[i - 1], moved.pts[i], wall)).toBe(false);
    const pinned = leaderSpot([100, 200], [300, 200], [60, 20], [wall], { ...opts, pinned: true });
    expect(pinned.at).toEqual([100, 200]); expect(pinned.pts).toEqual([[100, 200], [300, 200]]); // straight, across the card
    expect(leaderSpot([100, 200], [300, 200], [60, 20], [], opts)).toEqual({ at: [100, 200], pts: [[100, 200], [300, 200]] });
  });
  it('prefers a pill spot whose leader does not cross a section marker', () => {
    const marker = [90, 40, 110, 60]; // straight above the collar
    const [p] = placePills([{ x: 100, y: 100, w: 30, h: 16 }], [marker, [70, 65, 130, 95]], { W: 400, H: 400, unit: 1, leaders: 'far' });
    expect(segHits([100, 100], [p.cx, p.cy], marker)).toBe(false);
  });
});

describe('geology faces', () => {
  const grid = (rows) => Int16Array.from(rows.join('').split('').map((c) => (c === '.' ? -1 : +c)));
  it('clears single-cell blotches with the majority filter', () => {
    const g = grid(['0000', '0100', '0000', '0000']);
    expect([...modeFilter(g, 4, 4, 2, 1)]).toEqual(Array(16).fill(0));
  });
  it('keeps uncovered cells and merges small patches into their surroundings', () => {
    const g = grid(['....', '0000', '0110', '0000']);
    expect(patches(g, 4, 4).list.map((p) => [p.c, p.n])).toEqual([[0, 10], [1, 2]]);
    const out = dropSpecks(g, 4, 4, 3);
    expect([...out.slice(0, 4)]).toEqual([-1, -1, -1, -1]);
    expect([...out.slice(4)]).toEqual(Array(12).fill(0));
  });
  it('refines the grid with the classes and the uncovered edge kept', () => {
    const g = grid(['0011', '0011', '....', '....']), f = refine(g, 4, 4, 2, 3);
    expect(f.length).toBe(144);
    expect(f[0]).toBe(0); expect(f[11]).toBe(1); expect(f[143]).toBe(-1);
  });
  it('names each unit at the deepest point of its largest patch', () => {
    const rows = []; for (let j = 0; j < 20; j++) rows.push(j < 6 ? '0'.repeat(30) : '1'.repeat(30));
    const spots = labelSpots(grid(rows), 30, 20, 1, 1);
    const one = spots.find((s) => s.c === 1).spots[0];
    expect(one.j).toBeGreaterThan(9); expect(one.j).toBeLessThan(16); // middle of the lower band
    expect(spots.find((s) => s.c === 0)).toBeTruthy();
    expect(labelSpots(grid(rows), 30, 20, 1, 1, 0.5).map((s) => s.c)).toEqual([1]); // under half the face: no name
  });
});

describe('grade shell look', () => {
  // A tetrahedron wound inward: turned outward (positive signed volume).
  it('winds triangles outward', () => {
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], inward = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2], out = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    expect(windOutward(pos, inward.slice())).toEqual(out);
    expect(windOutward(pos, out.slice())).toEqual(out);
  });
  it('deepens nested solid shells toward the core', () => {
    expect(shellOpacity(0.6, 0, 1, true)).toBe(0.6);
    [0.3, 0.65, 1].forEach((v, r) => expect(shellOpacity(0.6, r, 3, true)).toBeCloseTo(v));
    expect(shellOpacity(0.3, 2, 3, false)).toBe(0.3);
    expect(shade('#c65322', 0.5)).toBe('#632a11');
  });
  it('builds one surface per cut-off from one estimate', () => {
    const holes = [[0, 0], [60, 0], [0, 60], [60, 60]].map(([x, y], g) => ({ group: g, pts: Float64Array.from([0, 20, 40, 60, 80].flatMap((z) => [x, y, z, z === 40 ? 2 : 0.5])) }));
    const r = buildShell({ holes, grid: { x0: -10, y0: -10, z0: 0, cell: 10, nx: 9, ny: 9, nz: 10 }, search: 100, isos: [0.4, 1] });
    expect(r.parts.map((p) => p.iso)).toEqual([0.4, 1]);
    expect(r.parts[0].cells).toBeGreaterThan(r.parts[1].cells);
    expect(r.positions).toBe(r.parts[0].positions);
  });
});

describe('scene settings', () => {
  it('clamps the numbers and names the valid options', () => {
    const sc = { sunAz: 315, sunAlt: 40, shadow: 0.35, ao: 0.5, haze: 0, theme: 'light' };
    patchScene(sc, { sunAz: -45, sunAlt: 120, haze: '0.4', theme: 'dark' });
    expect(sc).toMatchObject({ sunAz: 315, sunAlt: 85, haze: 0.4, theme: 'dark' });
    expect(() => patchScene(sc, { theme: 'blue' })).toThrow(/light/);
    expect(() => patchScene(sc, { fog: 1 })).toThrow(/sunAz/);
  });
});

describe('shell settings', () => {
  it('checks the shading, ramp and nested shells', () => {
    const sh = { shading: 'glass', shells: [], ramp: 'brand' };
    patchShell(sh, { shading: 'solid', shells: [{ cutoff: '0.5', color: '#ABCDEF', label: 'Core' }] });
    expect(sh).toMatchObject({ shading: 'solid', shells: [{ cutoff: 0.5, color: '#abcdef', label: 'Core' }] });
    expect(() => patchShell(sh, { shells: [1, 2, 3, 4].map((c) => ({ cutoff: c })) })).toThrow(/three/);
    expect(() => patchShell(sh, { shading: 'matte' })).toThrow(/glass/);
    expect(tone('green', '#c65322', 1)).toBe('#214e1c');
    expect(tone('brand', '#c65322', 0.5)).toBe('#c65322');
  });
});
