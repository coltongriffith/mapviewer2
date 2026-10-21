import { describe, it, expect } from 'vitest';
import { roundBelow, depthTicks, extentAround, init, setBlock, setHolesShown, BLOCK, assayRows } from '../src/three-d/block.js';
import { histLength, bracketLines, mergeInts, orangeClass, ORANGE } from '../src/three-d/tags.js';
import { fadeAt, blurMasked, unitInk } from '../src/three-d/geology.js';
import { withDefaults } from '../src/three-d/design-version.js';

// Exploration Maps 3D round 5E: the block section (block.js), its bars, brackets and softer faces.

describe('block section furniture', () => {
  it('picks round lengths for the scale bar and depth ticks', () => {
    expect(roundBelow(180)).toBe(150);
    expect(roundBelow(74)).toBe(50);
    expect(roundBelow(5)).toBe(null);
    // 600 m under the corner: a tick every 150 m, none within 60 m of the base.
    expect(depthTicks(1600, 1000, 60)).toEqual([150, 300, 450]);
    expect(depthTicks(1030, 1000, 10)).toEqual([]);
  });
  it('fits the block round the holes, at least 75% as deep as it is long along them', () => {
    const line = [[{ x: 0, y: 0, z: 1000 }, { x: 0, y: 10, z: 600 }], [{ x: 500, y: 0, z: 1000 }, { x: 520, y: 5, z: 700 }]];
    const e = extentAround(line, 'x'), along = e.x1 - e.x0, across = e.y1 - e.y0;
    expect(e.x0).toBeLessThan(0); expect(e.x1).toBeGreaterThan(520);
    expect(across / along).toBeCloseTo(0.75, 2);
    expect(e.z0).toBe(576); // 24 m (6% of the 400 m drilled) under the deepest point
    const n = extentAround(line.map((h) => h.map((p) => ({ x: p.y, y: p.x, z: p.z }))), 'y');
    expect((n.x1 - n.x0) / (n.y1 - n.y0)).toBeCloseTo(0.75, 2);
  });
});

describe('block section settings', () => {
  const host = () => { const S = { holesShown: null, block: null }, calls = []; init({ S, G: {}, project: { holes: [{ id: 'A' }, { id: 'B' }] }, rebuild: () => calls.push('rebuild'), setStyle: () => calls.push('style'), renderExtUI: () => {}, status: () => {} }); return { S, calls }; };
  it('shows only the holes given, and every hole again with null', () => {
    const { S, calls } = host();
    setHolesShown(['B', 'B']); expect(S.holesShown).toEqual(['B']); expect(calls).toEqual(['rebuild', 'style']);
    expect(() => setHolesShown(['C'])).toThrow(/No hole "C"/);
    expect(() => setHolesShown([])).toThrow(/list of hole IDs/);
    setHolesShown(null); expect(S.holesShown).toBe(null);
  });
  it('patches the look, checks each value, and turns it off with null', () => {
    const { S } = host();
    setBlock({ brackets: 'card', hist: { scale: 'log', length: 9 } });
    expect(S.block).toEqual({ ...BLOCK, brackets: 'card', hist: { ...BLOCK.hist, scale: 'log', length: 3 } });
    expect(() => setBlock({ traces: 'thick' })).toThrow(/traces must be/);
    expect(() => setBlock({ hist: { side: 'up' } })).toThrow(/hist.side/);
    expect(S.block.brackets).toBe('card'); // a refused patch changes nothing
    setBlock({ holes: ['A'] }); expect(S.holesShown).toEqual(['A']);
    setBlock(null); expect(S.block).toBe(null);
  });
  it('leaves a figure saved before round 5E without holes hidden or a block look', () => {
    const out = withDefaults({ designVersion: 5, title: 'Old' }, { holesShown: null, block: null, title: '' });
    expect(out.holesShown).toBe(null); expect(out.block).toBe(null);
  });
});

describe('bars, brackets and faces', () => {
  it('sizes grade bars by grade, or on a log scale from the lowest colour limit', () => {
    expect(histLength(0.5, 0.1, 1, false)).toBe(0.5);
    expect(histLength(1, 0.1, 1, true)).toBeCloseTo(1, 9);
    expect(histLength(0.1, 0.1, 1, true)).toBe(0);
    expect(histLength(Math.sqrt(0.1), 0.1, 1, true)).toBeCloseTo(0.5, 9); // halfway, in log terms
    expect(histLength(0.01, 0.1, 1, true)).toBe(0);
  });
  it('splits a bracket\'s text at the "@", without the "incl." line', () => {
    expect(bracketLines({ l1: '154 m @ 0.51% Cu', l1b: ' from 120 m', l2: 'incl. 20 m @ 1.1% Cu' })).toEqual(['154 m @', '0.51% Cu']);
    expect(bracketLines({ l1: 'Open  at depth' })).toEqual(['Open at depth']);
  });
  it('fades toward white along a direction and blurs only across painted cells', () => {
    expect(fadeAt('down', 0, 0, 10, 11)).toBe(0); expect(fadeAt('down', 0, 10, 10, 11)).toBe(1);
    expect(fadeAt('up', 0, 0, 10, 11)).toBe(1); expect(fadeAt('right', 9, 3, 10, 11)).toBe(1); expect(fadeAt('left', 9, 3, 10, 11)).toBe(0);
    // Two units side by side and an unpainted cell: the contact softens, the empty cell does not bleed in.
    const a = Float32Array.from([0, 0, 0, 100, 100, 999]), m = Float32Array.from([1, 1, 1, 1, 1, 0]);
    const [b] = blurMasked([a], m, 6, 1, 1);
    expect(b[0]).toBe(0); expect(b[2]).toBeGreaterThan(0); expect(b[3]).toBeLessThan(100); expect(b[4]).toBeGreaterThan(50); expect(b[4]).toBeLessThanOrEqual(100); // never the 999 of the empty cell
    expect(blurMasked([a], m, 6, 1, 0)[0]).toBe(a);
  });
  it('merges dense assays into bars of at least the display interval, never across a gap', () => {
    const ints = [[0, 1, 1], [1, 2, 3], [2, 3, 0.5], [3, 4, 0.5], [6, 8, 2], [8, 9, NaN], [9, 10, 4]].map(([from, to, v]) => ({ from, to, vals: { cu: v } }));
    expect(mergeInts(ints, 'cu', 2)).toEqual([{ from: 0, to: 2, v: 2 }, { from: 2, to: 4, v: 0.5 }, { from: 6, to: 8, v: 2 }, { from: 9, to: 10, v: 4 }]);
    expect(mergeInts(ints, 'cu', 1).length).toBe(6); // already as long: one bar per assay
  });
  it('colours the bars in four orange classes from the colour limits, the legend the same', () => {
    const b = [0.05, 0.1, 0.2, 0.5];
    expect([0.01, 0.07, 0.15, 0.3, 0.6].map((v) => orangeClass(v, b))).toEqual([0, 1, 2, 2, 3]);
    const host = { S: { histograms: true, bins: b, block: { hist: { side: 'face', palette: 'orange' } } } };
    init(host);
    expect(assayRows()).toEqual([['≥ 0.5', ORANGE[3]], ['0.1 – 0.5', ORANGE[2]], ['0.05 – 0.1', ORANGE[1]], ['< 0.05', ORANGE[0]]]);
    host.S.block.hist.palette = 'bins'; expect(assayRows()).toBe(null);
  });
  it('writes unit names in a darker, stronger shade of their colour', () => {
    expect(unitInk('#c3d3d8')).toBe('#387689'); // the pale blue-grey cover: a deep slate blue
    expect(unitInk('#f1b5d3')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
