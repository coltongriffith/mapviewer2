import { describe, it, expect } from 'vitest';
import { intercept, calloutText, avgOver } from '../src/three-d/intercepts.js';

// The calculation as it stood in studio.js before it moved here (7d595fda), for comparison.
function before(ints, col, cut, inclCut, minLen) {
  const seq = ints.map((it) => ({ ...it, v: it.vals[col] })).filter((it) => Number.isFinite(it.v));
  let best = null, start = -1, lastHit = -1;
  const close = () => {
    if (start < 0) return; const run = seq.slice(start, lastHit + 1), L = run[run.length - 1].to - run[0].from;
    const metal = run.reduce((s, x) => s + x.v * (x.to - x.from), 0);
    if (L >= minLen && (!best || metal > best.metal)) best = { run, metal, L }; start = -1;
  };
  seq.forEach((it, i) => {
    if (it.v >= cut) { if (start < 0) start = i; lastHit = i; }
    else if (start >= 0 && it.to - seq[lastHit].to > 6) close();
  });
  close();
  if (!best) return null;
  const run = best.run, len = run[run.length - 1].to - run[0].from;
  const broad = { len, avg: best.metal / run.reduce((s, x) => s + (x.to - x.from), 0), from: run[0].from, mid: (run[0].from + run[run.length - 1].to) / 2 };
  let incl = null;
  for (let i = 0; i < run.length; i++) { let m = 0, l = 0;
    for (let j = i; j < run.length; j++) { m += run[j].v * (run[j].to - run[j].from); l += run[j].to - run[j].from; const span = run[j].to - run[i].from;
      if (span >= Math.min(minLen / 2, 10) && span < len * 0.8 && m / l >= inclCut && (!incl || span > incl.len)) incl = { len: span, avg: m / l, from: run[i].from }; } }
  return { broad, incl };
}
// Random holes: 1-3 m samples, some with gaps (and, optionally, overlaps) between them.
function randomHole(seed, { gaps, overlaps }) {
  let x = seed; const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647), out = [];
  for (let d = 0, i = 0; i < 60; i++) {
    const len = 1 + Math.floor(rnd() * 3), v = rnd() < 0.4 ? rnd() * 0.15 : rnd() * 2;
    out.push({ from: d, to: d + len, vals: { Cu: v } });
    d += len + (gaps && rnd() < 0.1 ? 5 + Math.floor(rnd() * 40) : 0) - (overlaps && rnd() < 0.1 ? 1 : 0);
  }
  return out;
}
const ints = (...rows) => rows.map(([from, to, v]) => ({ from, to, vals: { Cu: v } }));
const run = (rows, { cut = 0.2, incl = 0.5, min = 1 } = {}, sampled = true) => intercept(ints(...rows), 'Cu', cut, incl, min, sampled);

describe('intercepts', () => {
  it('never joins samples across an unsampled gap (sampled metres only)', () => {
    const rows = [[0, 10, 1], [100, 110, 2]];
    const ic = run(rows);
    expect(ic.broad).toMatchObject({ len: 10, avg: 2, from: 100, mid: 105 });
    expect(ic.incl).toBeNull();
    expect(ic.gap).toBeUndefined();
    // A minimum length neither zone reaches on its own: no callout, never one 110 m interval.
    expect(run(rows, { min: 20 })).toBeNull();
  });

  it('keeps the earlier numbers for version 1 figures, and says they span the gap', () => {
    const ic = run([[0, 10, 1], [100, 110, 2]], {}, false);
    expect(ic.broad).toMatchObject({ len: 110, avg: 1.5, from: 0, mid: 55 });
    expect(ic.incl).toMatchObject({ len: 10, avg: 1, from: 0 });
    expect(ic).toMatchObject({ gap: 90, overlap: false });
  });

  it('a contiguous control reads the same either way', () => {
    const rows = [[0, 10, 1], [10, 20, 2]];
    for (const sampled of [true, false]) {
      const ic = run(rows, {}, sampled);
      expect(ic.broad).toMatchObject({ len: 20, avg: 1.5, from: 0, mid: 10 });
      expect(ic.incl).toMatchObject({ len: 10, avg: 1, from: 0 });
    }
    expect(run(rows, {}, false)).toMatchObject({ gap: 0, overlap: false });
    // Gaps under the 0.01 m tolerance are rounding, not unsampled core.
    expect(run([[0, 10, 1], [10.005, 20, 2]]).broad.len).toBeCloseTo(19.995, 6);
  });

  it('counts an overlapping sample once: trimmed to start where the last ended, dropped if inside it', () => {
    const rows = [[0, 10, 1], [5, 15, 3], [6, 8, 9]];
    const ic = run(rows, { min: 1 });
    expect(ic.broad.len).toBe(15); // 0-10, then 10-15 of the 5-15 sample; 6-8 lies inside 0-10
    expect(ic.broad.avg).toBeCloseTo((10 * 1 + 5 * 3) / 15, 9);
    const legacy = run(rows, { min: 1 }, false);
    expect(legacy.overlap).toBe(true);
    expect(legacy.broad.len).toBe(8); // the earlier numbers: the last sample's end less the first's start
    expect(legacy.broad.avg).toBeCloseTo((10 + 30 + 18) / 22, 9); // ...with 5-10 and 6-8 counted twice
    // Unsorted input is sorted first.
    expect(run([[10, 20, 2], [0, 10, 1]]).broad).toMatchObject({ len: 20, from: 0 });
  });

  it('keeps the "incl." interval inside the reported run', () => {
    const rows = [[0, 10, 0.3], [10, 20, 1.2], [20, 30, 0.3], [100, 110, 0.3]];
    const ic = run(rows, { min: 20 });
    expect(ic.broad).toMatchObject({ len: 30, from: 0 });
    expect(ic.broad.avg).toBeCloseTo(0.6, 9);
    expect(ic.incl).toMatchObject({ len: 20, from: 0 });
    expect(ic.incl.avg).toBeCloseTo(0.75, 9);
    expect(ic.incl.from + ic.incl.len).toBeLessThanOrEqual(ic.broad.from + ic.broad.len);
    const legacy = run(rows, { min: 20 }, false);
    expect(legacy).toMatchObject({ broad: { len: 110, from: 0 }, gap: 70 });
    // A nested stretch in a contiguous run, the same either way.
    const c = [[0, 10, 0.3], [10, 20, 1.2], [20, 40, 0.3]];
    for (const sampled of [true, false]) expect(run(c, { min: 20 }, sampled)).toMatchObject({ broad: { len: 40, from: 0 }, incl: { len: 30, from: 10 } });
  });

  it('keeps the selection rules: up to 6 m of internal dilution, the run with the most metal', () => {
    const rows = [[0, 10, 1], [10, 16, 0.05], [16, 20, 1], [20, 28, 0.05], [28, 30, 3], [30, 40, 0.05]];
    // 10-16 is 6 m of dilution (kept); 20-28 ends 8 m past the last hit (the run closes at 20).
    expect(run(rows, { min: 1 }).broad).toMatchObject({ len: 20, from: 0 });
    expect(run(rows, { min: 1 }, false).broad).toMatchObject({ len: 20, from: 0 });
    expect(run([[0, 10, 0.1]])).toBeNull();
    expect(intercept(ints([0, 10, 1]).map((it) => ({ ...it, vals: {} })), 'Cu', 0.2, 0.5, 1)).toBeNull(); // no values in the column
  });

  it('changes no other numbers: version 1 as before everywhere, sampled as before on contiguous samples', () => {
    for (let seed = 1; seed < 200; seed++) {
      const [cut, incl, min] = [[0.2, 0.5, 20], [0.1, 1, 5], [0.3, 0.6, 1]][seed % 3];
      const messy = randomHole(seed, { gaps: true, overlaps: true }), clean = randomHole(seed, { gaps: false, overlaps: false });
      const strip = (ic) => ic && { broad: ic.broad, incl: ic.incl };
      expect(strip(intercept(messy, 'Cu', cut, incl, min, false))).toEqual(before(messy, 'Cu', cut, incl, min));
      const now = intercept(clean, 'Cu', cut, incl, min), then = before(clean, 'Cu', cut, incl, min);
      expect(!!now).toBe(!!then);
      if (now) { expect(now.broad).toMatchObject({ from: then.broad.from, mid: then.broad.mid }); expect(now.broad.len).toBeCloseTo(then.broad.len, 9); expect(now.broad.avg).toBeCloseTo(then.broad.avg, 9); expect(!!now.incl).toBe(!!then.incl); }
      if (now?.incl) { expect(now.incl.from).toBe(then.incl.from); expect(now.incl.len).toBeCloseTo(then.incl.len, 9); expect(now.incl.avg).toBeCloseTo(then.incl.avg, 9); }
    }
  });

  it('a callout reworded by hand keeps its text', () => {
    const ic = run([[0, 10, 1], [10, 20, 2]]), text = (x) => `${x.len} m @ ${x.avg}`;
    expect(calloutText(ic, {}, text)).toEqual({ l1: '20 m @ 1.5', l1b: ' from 0 m', l2: 'incl. 10 m @ 1' });
    expect(calloutText(ic, { line1: '20 m of 1.5% Cu', line2: 'incl. high grade' }, text)).toEqual({ l1: '20 m of 1.5% Cu', l1b: '', l2: 'incl. high grade' });
    expect(calloutText(ic, { incl: false }, text).l2).toBeNull();
  });
});

describe('second element average', () => {
  // 0–10 m and a re-assay at 5–15 m: the intercept is 15 m, so the second grade is over 15 m, not 20.
  const ints = [{ from: 0, to: 10, vals: { cu: 1, au: 1 } }, { from: 5, to: 15, vals: { cu: 1, au: 4 } }];
  it('counts overlapping metres once when sampled', () => {
    const ic = intercept(ints, 'cu', 0.2, 0.5, 1, true);
    expect(ic.broad.len).toBe(15);
    expect(avgOver(ints, 'au', ic.broad.from, ic.broad.from + ic.broad.len, true)).toBeCloseTo((10 * 1 + 5 * 4) / 15);
  });
  it('keeps the earlier weighting for version 1 figures', () => {
    expect(avgOver(ints, 'au', 0, 15, false)).toBeCloseTo((10 * 1 + 10 * 4) / 20);
  });
});
