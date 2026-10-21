import { describe, it, expect, vi } from 'vitest';
import { gradeRank, joinIds, padMerge, crowded } from '../src/three-d/section-fit.js';
import { secFrame } from '../src/three-d/section-geometry.js';
import { gridTicks, barSpan, isPlanView } from '../src/three-d/plan.js';
import { due, stampOf, watchVersion } from '../src/three-d/version-check.js';
import { DESIGN_VERSION, LEGACY_V4, FEATURES, uses, withDefaults } from '../src/three-d/design-version.js';
import { pubLines, staleNotes } from '../src/three-d/published-results.js';

// A straight hole down from (x, y, 1000) at the given dip, with 10 m intervals of the given grades.
function hole(id, x, y, grades, dip = -90) {
  const len = grades.length * 10, r = dip * Math.PI / 180, at = (d) => ({ x, y: y + Math.cos(r) * d * 0, z: 1000 + Math.sin(r) * d });
  const path = Array.from({ length: len / 2 + 1 }, (_, i) => ({ d: i * 2, ...at(i * 2) }));
  return { id, c: { x, y, z: 1000 }, len, path, posAt: at, ints: grades.map((g, i) => ({ from: i * 10, to: i * 10 + 10, vals: { cu: g } })) };
}

describe('section holes ranked by grade and nearness', () => {
  const F = secFrame({ x: -500, y: 0 }, { x: 500, y: 0 }); // an east-west line
  it('keeps a high-grade hole a little further out over a barren one on the line', () => {
    const barren = hole('B-1', 0, 3, [0, 0, 0.01]), rich = hole('R-1', 50, 35, [0.2, 1.8, 0.4]), far = hole('F-1', 100, 60, [0.1]);
    const r = gradeRank(F, [barren, rich, far], 50, 'cu');
    expect(r.get(rich)).toBeLessThan(r.get(barren));
    expect(r.get(rich)).toBeCloseTo(0.07, 2); // the best weighted score: 0 for grade, 0.1 × 0.7 for distance
    // Holes picked by the rank, as the section fills in its labels: the rich one first.
    expect([barren, rich].sort((a, b) => r.get(a) - r.get(b)).map((h) => h.id)).toEqual(['R-1', 'B-1']);
    // Intervals outside the width count for nothing; equally barren holes go by distance.
    expect(r.get(far)).toBeCloseTo(0.8 + 0.1, 5);
    const two = gradeRank(F, [hole('A', 0, 2, [0]), hole('B', 0, 30, [0])], 50, 'cu');
    expect([...two.values()][0]).toBeLessThan([...two.values()][1]);
  });
  it('weights the same grade by nearness', () => {
    const near = hole('N', 0, 5, [1]), out = hole('O', 0, 45, [1]), r = gradeRank(F, [near, out], 50, 'cu');
    expect(r.get(near)).toBeLessThan(r.get(out));
  });
});

describe('section IDs from one pad', () => {
  it('joins IDs after their common prefix, whole numbers kept', () => {
    expect(joinIds(['S-001', 'S-002'])).toBe('S-001/002');
    expect(joinIds(['S-001', 'S-002', 'S-003'])).toBe('S-001/002/003');
    expect(joinIds(['DDH21-01', 'DDH21-02'])).toBe('DDH21-01/02');
    expect(joinIds(['EX-014', 'EX-014A'])).toBe('EX-014/014A');
    expect(joinIds(['A1', 'B2'])).toBe('A1/B2');
    expect(joinIds(['S-019'])).toBe('S-019');
  });
  const lab = (id, x, y, sx, bw = 40) => ({ h: { id, c: { x, y } }, t: id, at: [sx, 100], bw });
  it('merges labels whose collars are within a few metres, in ID order', () => {
    const out = padMerge([lab('S-002', 1.5, 1, 100), lab('S-001', 0, 0, 102), lab('S-004', 120, 0, 300), lab('S-005', 122.5, 0, 305), lab('S-006', 180, 0, 400)]);
    expect(out.map((l) => l.t)).toEqual(['S-001/002', 'S-004/005', 'S-006']);
    expect(out[0].h.id).toBe('S-001');
    expect(out[0].hs.map((h) => h.id)).toEqual(['S-001', 'S-002']);
    expect(padMerge([lab('S-1', 0, 0, 0), lab('S-2', 8, 0, 10)]).length).toBe(2); // 8 m apart: two pads
  });
  it('staggers only labels of nearby collars that would overlap', () => {
    expect(crowded([lab('S-1', 0, 0, 100), lab('S-2', 12, 0, 120)], 10)).toBe(true); // 20 px apart, 40 px wide
    expect(crowded([lab('S-1', 0, 0, 100), lab('S-2', 12, 0, 160)], 10)).toBe(false); // room between them
    expect(crowded([lab('S-1', 0, 0, 100), lab('S-2', 300, 0, 120)], 10)).toBe(false); // far apart, only projected close
  });
});

describe('plan views', () => {
  it('counts 80° and steeper as a plan view', () => {
    expect([79, 80, 89].map(isPlanView)).toEqual([false, true, true]);
  });
  it('puts grid ticks on round steps inside the extent', () => {
    expect(gridTicks(411630, 412970, 5)).toEqual({ step: 200, values: [411800, 412000, 412200, 412400, 412600, 412800] });
    expect(gridTicks(6421340, 6422460, 5).values).toEqual([6421400, 6421600, 6421800, 6422000, 6422200, 6422400]);
    expect(gridTicks(0, 95, 5)).toEqual({ step: 20, values: [0, 20, 40, 60, 80] });
    expect(gridTicks(-0.3, 0.3, 3).values).toEqual([-0.2, 0, 0.2]);
    expect(gridTicks(5, 5)).toEqual({ step: 0, values: [] });
  });
  it('gives a steep hole\'s interval bar a visible length, clear of the collar', () => {
    expect(barSpan(0, 0, 9, 7)).toEqual([7, 16]); // a vertical hole: a bar beside the collar, not a dot on it
    expect(barSpan(30, 31, 9, 7)).toEqual([26, 35]); // grown about its middle
    expect(barSpan(40, 80, 9, 7)).toEqual([40, 80]); // long enough already
    expect(barSpan(20, 10, 9, 0)).toEqual([10, 20]);
  });
});

describe('version check', () => {
  it('reads the build stamp', () => {
    expect(stampOf('<head>\n<meta name="em-build" content="3d-D2w1vaY5">\n<meta charset="UTF-8">')).toBe('3d-D2w1vaY5');
    expect(stampOf('<html><head></head></html>')).toBeUndefined();
  });
  it('checks at most every 10 minutes', () => {
    expect(due(10 * 60 * 1000, 0)).toBe(true);
    expect(due(10 * 60 * 1000 - 1, 0)).toBe(false);
  });
  it('fetches on focus once due, tells once, and never without a stamp', async () => {
    let t = 0;
    const doc = Object.assign(new EventTarget(), { head: { innerHTML: '<meta name="em-build" content="3d-old">' }, hidden: false });
    const get = vi.fn(async () => '<meta name="em-build" content="3d-new">'), onNew = vi.fn();
    const check = watchVersion(onNew, doc, () => t, get);
    expect(check()).toBeUndefined(); // just loaded
    t = 5 * 60 * 1000; window.dispatchEvent(new Event('focus'));
    expect(get).not.toHaveBeenCalled();
    t = 11 * 60 * 1000; doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    expect(get).not.toHaveBeenCalled(); // a hidden tab waits
    doc.hidden = false; await check();
    expect(get).toHaveBeenCalledTimes(1); expect(onNew).toHaveBeenCalledTimes(1);
    t = 30 * 60 * 1000; await check();
    expect(get).toHaveBeenCalledTimes(1); // told once
    // The same stamp: nothing to say, and the next check waits again.
    const same = vi.fn(async () => '<meta name="em-build" content="3d-old">'), quiet = vi.fn();
    const c2 = watchVersion(quiet, doc, () => t, same); t += 10 * 60 * 1000; await c2(); await c2();
    expect(same).toHaveBeenCalledTimes(1); expect(quiet).not.toHaveBeenCalled();
    expect(watchVersion(onNew, { head: { innerHTML: '' }, addEventListener() {} })).toBeTypeOf('function'); // no stamp:
    const none = vi.fn(); const c3 = watchVersion(onNew, { head: { innerHTML: '' }, addEventListener() {}, hidden: false }, () => 1e9, none); await c3(); expect(none).not.toHaveBeenCalled();
  });
});

describe('design version 5', () => {
  it('keeps an earlier figure without the plan grid and the newer drawing rules', () => {
    expect(DESIGN_VERSION).toBe(5);
    const old = withDefaults({ designVersion: 4 }, { grid: true, title: 'x' });
    expect(old.grid).toBe(false);
    expect(LEGACY_V4).toEqual({ grid: false });
    ['planView', 'padIds', 'legendWrap', 'insetOutline'].forEach((f) => { expect(FEATURES[f]).toBe(5); expect(uses(old, f)).toBe(false); });
    expect(withDefaults({ designVersion: 4, grid: true }, { grid: true }).grid).toBe(true); // a saved choice wins
    const now = withDefaults({ designVersion: 5 }, { grid: true });
    expect(now.grid).toBe(true); expect(uses(now, 'planView')).toBe(true);
    expect(uses({ designVersion: 4, designOptIn: ['planView'] }, 'planView')).toBe(true); // taken early
  });
});

describe('published callouts: the second line', () => {
  const r = (id, from, to, parent = '') => ({ resultId: id, holeId: 'EX-021', fromM: from, toM: to, publishedLengthText: String(to - from), gradeText: '0.5', unit: '%', analyte: 'Cu', parentResultId: parent, approvedText: '', approvalStatus: 'approved' });
  const top = r('R1', 10, 110), kid = r('R2', 40, 60, 'R1');
  it('rewords per result, kept while the depths are those it was written for', () => {
    const c = { pub: top, kids: [kid] };
    expect(pubLines(c).l2).toBe('incl. 20 m @ 0.5% Cu from 40 m');
    expect(pubLines(c, { R1: { line2: 'incl. the high-grade core', at: [10, 110] } }).l2).toBe('incl. the high-grade core');
    expect(pubLines({ pub: top, kids: [] }, { R1: { line2: 'Open at depth', at: [10, 110] } }).l2).toBe('Open at depth'); // a second line where there was none
    expect(pubLines(c, { R1: { line2: 'old words', at: [0, 100] } }).l2).toBe('incl. 20 m @ 0.5% Cu from 40 m'); // the result moved
    expect(staleNotes([top], { R1: { line1: 'x', line2: 'y', at: [10, 110] } })).toEqual([]);
  });
});
