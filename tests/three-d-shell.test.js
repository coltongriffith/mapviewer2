import { describe, it, expect } from 'vitest';
import { composite, collarGroups, autoCell, autoSearch, estimate } from '../src/three-d/shell-core.js';
import { marchingCubes, smoothMesh, buildShell } from '../src/three-d/shell-mesh.js';
import { unitValue, eqFactors, eqFormula, eqValue, fmtFactor } from '../src/three-d/metal-eq.js';

// Synthetic fixtures only: vertical holes with made-up grades.
const iv = (from, to, v) => ({ from, to, vals: { g: v } });
const hole = (x, y, group, values, z0 = 100) => ({ group, pts: values.flatMap((v, k) => [x, y, z0 - 5 - 10 * k, v]) });

describe('composite', () => {
  it('length-weights 10 m composites from the assayed length', () => {
    const c = composite([iv(0, 2, 1), iv(2, 10, 0), iv(10, 15, 0.4), iv(15, 20, 0.6)], 'g');
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ from: 0, to: 10, length: 10 });
    expect(c[0].value).toBeCloseTo(0.2);
    expect(c[1].value).toBeCloseTo(0.5);
    expect(c[1].mid).toBeCloseTo(15);
  });
  it('splits an interval across composite boundaries', () => {
    const c = composite([iv(5, 15, 1), iv(15, 25, 3)], 'g');
    expect(c.map((x) => x.from)).toEqual([0, 10, 20]);
    expect(c[0].value).toBeCloseTo(1); // only 5-10 assayed; exactly half the length
    expect(c[1].value).toBeCloseTo(2);
    expect(c[2].value).toBeCloseTo(3);
  });
  it('leaves out missing values instead of reading them as zero, and needs half the length assayed', () => {
    const c = composite([iv(0, 6, 0.5), iv(6, 10, NaN), iv(10, 14, 2)], 'g');
    expect(c).toHaveLength(1);
    expect(c[0].value).toBeCloseTo(0.5);
    expect(c[0].length).toBeCloseTo(6);
  });
});

describe('collar groups and defaults', () => {
  it('groups collars within 20 m, chained', () => {
    expect([...collarGroups([[0, 0], [15, 0], [30, 0], [100, 0]])]).toEqual([0, 0, 0, 1]);
    expect([...collarGroups([[0, 0], [25, 0]])]).toEqual([0, 1]);
  });
  it('picks cell size and search radius from the block and the drill spacing', () => {
    expect(autoCell(400, 300)).toBe(10);
    expect(autoCell(100, 80)).toBe(5);
    expect(autoCell(3000, 2000)).toBe(25);
    const tight = [[0, 0], [40, 0], [0, 40], [40, 40]];
    expect(autoSearch(tight, collarGroups(tight))).toBe(75);
    const wide = [[0, 0], [140, 0], [0, 140], [140, 140]];
    expect(autoSearch(wide, collarGroups(wide))).toBe(210);
  });
});

describe('estimate', () => {
  const grid = { x0: 0, y0: 0, z0: 0, cell: 10, nx: 11, ny: 11, nz: 11 };
  it('combines the nearest groups by inverse distance squared, with a 5 m minimum distance', () => {
    const holes = [hole(50, 50, 0, Array(10).fill(1)), hole(60, 50, 1, Array(10).fill(2)), hole(50, 60, 2, Array(10).fill(4))];
    const f = estimate(holes, grid, { search: 75 });
    // At (50, 50, 50): hole 0's nearest composite is 5 m away (weight 1/25); holes 1 and 2 are
    // sqrt(10² + 5²) away (weight 1/125 each).
    const v = f[(5 * 11 + 5) * 11 + 5];
    expect(v).toBeCloseTo((1 / 25 + 2 / 125 + 4 / 125) / (1 / 25 + 2 / 125), 5);
  });
  it('needs three collar groups in range, and counts holes from one pad once', () => {
    const pad = [hole(50, 50, 0, Array(10).fill(1)), hole(52, 50, 0, Array(10).fill(9)), hole(60, 50, 1, Array(10).fill(2))];
    expect(estimate(pad, grid, { search: 75 }).some(Number.isFinite)).toBe(false);
    const three = [...pad, hole(50, 60, 2, Array(10).fill(4))];
    const f = estimate(three, grid, { search: 75 });
    // The pad gives its nearest value (1, at 5 m), not the 9 from its hole 2 m further off.
    expect(f[(5 * 11 + 5) * 11 + 5]).toBeCloseTo((1 / 25 + 2 / 125 + 4 / 125) / (1 / 25 + 2 / 125), 5);
  });
  it('uses at most four groups and only within the search radius', () => {
    const holes = [hole(50, 50, 0, Array(10).fill(1)), hole(60, 50, 1, Array(10).fill(1)), hole(50, 60, 2, Array(10).fill(1)), hole(40, 50, 3, Array(10).fill(1)), hole(50, 40, 4, Array(10).fill(100))];
    const f = estimate(holes, grid, { search: 75 });
    expect(f[(5 * 11 + 5) * 11 + 5]).toBeCloseTo(1, 5); // the fifth (equidistant, last) group is left out
    const far = estimate(holes, grid, { search: 5 });
    expect(Number.isFinite(far[(5 * 11 + 5) * 11 + 5])).toBe(false);
  });
  it('estimates nothing above the surface', () => {
    const holes = [hole(50, 50, 0, Array(10).fill(1)), hole(60, 50, 1, Array(10).fill(1)), hole(50, 60, 2, Array(10).fill(1))];
    const top = new Float32Array(11 * 11).fill(40);
    const f = estimate(holes, grid, { search: 75, top });
    expect(Number.isFinite(f[(4 * 11 + 5) * 11 + 5])).toBe(true);
    expect(Number.isFinite(f[(5 * 11 + 5) * 11 + 5])).toBe(false);
  });
});

describe('shell surface', () => {
  it('closes a surface round a block above the level', () => {
    const grid = { x0: 0, y0: 0, z0: 0, cell: 1, nx: 4, ny: 4, nz: 4 }, field = new Float32Array(64).fill(NaN);
    for (let k = 1; k < 3; k++) for (let j = 1; j < 3; j++) for (let i = 1; i < 3; i++) field[(k * 4 + j) * 4 + i] = 1;
    const { positions, indices } = marchingCubes(field, grid, 0.5);
    expect(indices.length % 3).toBe(0);
    // Closed and manifold: every edge belongs to exactly two triangles.
    const edges = new Map();
    for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + (e + 1) % 3], k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, (edges.get(k) || 0) + 1);
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    const xs = []; for (let i = 0; i < positions.length; i += 3) xs.push(positions[i]);
    expect(Math.min(...xs)).toBeCloseTo(0.5); expect(Math.max(...xs)).toBeCloseTo(2.5);
    smoothMesh(positions, indices);
    expect(positions.every(Number.isFinite)).toBe(true);
  });
  it('builds a shell end to end and reports its statistics', () => {
    const holes = [hole(40, 40, 0, [0.1, 0.5, 0.6, 0.5, 0.1]), hole(60, 40, 1, [0.1, 0.4, 0.7, 0.4, 0.1]), hole(50, 60, 2, [0.1, 0.5, 0.5, 0.5, 0.1])];
    const r = buildShell({ holes, grid: { x0: 0, y0: 0, z0: 0, cell: 5, nx: 21, ny: 21, nz: 21 }, search: 75, iso: 0.3 });
    expect(r.stats.cells).toBeGreaterThan(0);
    expect(r.stats.triangles).toBeGreaterThan(0);
    expect(r.stats.estimated).toBeGreaterThanOrEqual(r.stats.cells);
  });
});

describe('metal equivalent', () => {
  it('uses 22.0462 lb/t per % and 31.1035 g per troy ounce', () => {
    expect(unitValue('Cu', '%', 4.5)).toBeCloseTo(99.2079, 3);
    expect(unitValue('Au', 'g/t', 3000)).toBeCloseTo(96.4522, 3);
    expect(unitValue('Au', 'ppb', 3000)).toBeCloseTo(0.0964522, 6);
    expect(unitValue('Mo', 'ppm', 20)).toBeCloseTo(0.0440924, 6);
  });
  it('gives CuEq = Cu + 0.972 × Au at US$4.50/lb Cu, US$3,000/oz Au and equal recoveries', () => {
    const f = eqFactors({ metal: 'Cu', unit: '%', price: 4.5, recovery: 90 }, [{ metal: 'Au', unit: 'g/t', price: 3000, recovery: 90 }]);
    expect(f[0].factor).toBeCloseTo(0.972222, 5);
    expect(eqFormula('Cu', f)).toBe('CuEq = Cu + 0.972 × Au');
    expect(eqValue(0.5, [0.2], f)).toBeCloseTo(0.5 + 0.972222 * 0.2, 5);
  });
  it('scales by recovery and handles several metals', () => {
    const f = eqFactors({ metal: 'Cu', unit: '%', price: 4.5, recovery: 90 }, [{ metal: 'Au', unit: 'g/t', price: 3000, recovery: 72 }, { metal: 'Ag', unit: 'g/t', price: 35, recovery: 90 }]);
    expect(f[0].factor).toBeCloseTo(0.972222 * 0.8, 5);
    expect(fmtFactor(f[1].factor)).toBe('0.0113');
  });
  it('gives no value when any component is missing', () => {
    const f = eqFactors({ metal: 'Cu', unit: '%', price: 4.5, recovery: 90 }, [{ metal: 'Au', unit: 'g/t', price: 3000, recovery: 90 }]);
    expect(eqValue(0.5, [NaN], f)).toBeNaN();
    expect(eqValue(NaN, [0.1], f)).toBeNaN();
    expect(eqValue(0.5, [0], f)).toBeCloseTo(0.5);
  });
});
