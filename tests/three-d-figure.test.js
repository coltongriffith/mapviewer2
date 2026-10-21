import { describe, it, expect } from 'vitest';
import { isClick, makeLayout, hits, legendRows, wrapNotes } from '../src/three-d/layout.js';
import { foldCodes, deepen, OTHER } from '../src/three-d/geology.js';

describe('click or drag on the preview', () => {
  it('treats a press under 4 px, or under 150 ms, as a click', () => {
    expect(isClick(2, 2, 400)).toBe(true); // a small wobble, however long
    expect(isClick(40, 0, 90)).toBe(true); // a flick shorter than 150 ms
    expect(isClick(3, 2.5, 160)).toBe(true);
    expect(isClick(6, 0, 160)).toBe(false); // a real drag
    expect(isClick(0, 30, 600)).toBe(false);
  });
});

describe('hidden lithology codes', () => {
  const legend = [{ code: 'COV', show: true }, { code: 'LPD', show: false }, { code: 'POT', show: true }, { code: 'ENR', show: false }];
  const codes = ['COV', 'LPD', 'POT', 'ENR'];
  it('leaves hidden codes out by default, so the nearest visible units fill their place', () => {
    const f = foldCodes(legend, codes);
    expect(f.classes).toEqual(['COV', 'POT']);
    expect([...f.index]).toEqual([['COV', 0], ['POT', 1]]);
    expect(f.other).toBe(false);
  });
  it('folds every hidden code into one "Other" unit when asked', () => {
    const f = foldCodes(legend, codes, 'other');
    expect(f.classes).toEqual(['COV', 'POT', OTHER]);
    expect(f.index.get('LPD')).toBe(2);
    expect(f.index.get('ENR')).toBe(2);
    expect(f.other).toBe(true);
  });
  it('leaves hidden codes unpainted in place for figures made before October 2026 ("clear")', () => {
    const f = foldCodes(legend, codes, 'clear');
    expect(f.classes).toEqual(codes);
    expect([...f.index.values()]).toEqual(codes.map((_, i) => i));
    expect([...f.clear]).toEqual(['LPD', 'ENR']);
  });
  it('adds no "Other" unit when nothing is hidden, and keeps unknown codes visible', () => {
    expect(foldCodes([], ['A', 'B'], 'other')).toMatchObject({ classes: ['A', 'B'], other: false });
  });
  it('deepens pastel colours by the colour strength, and keeps them at 1', () => {
    expect(deepen('#f1dca2', 1)).toBe('#f1dca2');
    expect(deepen('#f1dca2', 2)).toBe('#e3b945');
    expect(deepen('#ffffff', 1.5)).toBe('#ffffff');
  });
});

describe('assay legend rows', () => {
  const C = ['g', 'y', 'o', 'r', 'm'], bins = [0.1, 0.3, 0.6, 1];
  const labels = (dc) => legendRows(bins, dc, C).map((r) => r[0]);
  it('lists every class without a cut-off', () => {
    expect(labels(null)).toEqual(['≥ 1', '0.6 – 1', '0.3 – 0.6', '0.1 – 0.3', '< 0.1']);
  });
  it('leaves exactly one "<" row once low grades draw as the trace (the caller adds "< cut-off: trace only")', () => {
    for (const dc of [0.05, 0.1, 0.2]) expect(labels(dc).filter((t) => t.startsWith('<'))).toEqual([]);
    expect(labels(0.05)).toEqual(['≥ 1', '0.6 – 1', '0.3 – 0.6', '0.1 – 0.3', '0.05 – 0.1']);
    expect(labels(0.1)).toEqual(['≥ 1', '0.6 – 1', '0.3 – 0.6', '0.1 – 0.3']);
    expect(labels(0.2)).toEqual(['≥ 1', '0.6 – 1', '0.3 – 0.6', '0.2 – 0.3']);
  });
});

describe('automatic footnotes', () => {
  const measure = (t) => t.length; // one unit a character
  it('joins the notes on one line with " · "', () => {
    expect(wrapNotes(['Grade shell: not a resource.', 'Geology: schematic.'], measure, 100)).toEqual(['Grade shell: not a resource. · Geology: schematic.']);
  });
  it('wraps to at most two lines, else asks for a Notes block (null)', () => {
    const notes = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)];
    expect(wrapNotes(notes, measure, 70)).toEqual([`${'a'.repeat(30)} · ${'b'.repeat(30)}`, 'c'.repeat(30)]);
    expect(wrapNotes(notes, measure, 40)).toBeNull();
    expect(wrapNotes(notes, measure, 40, 99)).toHaveLength(3);
    expect(wrapNotes([], measure, 40)).toEqual([]);
  });
});

describe('figure layout pass', () => {
  it('pads collisions', () => {
    expect(hits([0, 0, 10, 10], [12, 0, 20, 10])).toBe(false);
    expect(hits([0, 0, 10, 10], [12, 0, 20, 10], 3)).toBe(true); // "touching" counts
  });
  it('nudges an item to its first clear spot', () => {
    const L = makeLayout(100, 100, 2, [[0, 0, 50, 50]]);
    expect(L.place([[10, 10, 30, 30], [60, 10, 80, 30]], 1)).toEqual([60, 10, 80, 30]);
    expect(L.boxes).toHaveLength(2);
  });
  it('keeps off soft areas (the block) when it can, and uses them when it must', () => {
    const L = makeLayout(100, 100, 0, []), block = [[0, 0, 60, 100]];
    expect(L.place([[10, 10, 20, 20], [70, 10, 80, 20]], 1, null, block)).toEqual([70, 10, 80, 20]);
    expect(L.place([[10, 30, 20, 40]], 1, null, block)).toEqual([10, 30, 20, 40]);
  });
  it('hides the lowest-priority item when nothing else fits, and never draws it', () => {
    const drawn = [], L = makeLayout(100, 100, 0, [[0, 0, 100, 40]]);
    L.add([10, 50, 30, 60], 0, () => drawn.push('tick'));
    L.add([60, 50, 80, 60], 5, () => drawn.push('legend'));
    expect(L.place([[0, 0, 20, 20], [5, 45, 35, 65]], 2, () => drawn.push('scale'))).toEqual([5, 45, 35, 65]);
    expect(L.place([[55, 45, 85, 65]], 2, () => drawn.push('nope'))).toBeNull(); // a higher-priority item stays
    L.flush();
    expect(drawn).toEqual(['legend', 'scale']);
  });
  it('leaves out an item that falls outside the frame', () => {
    expect(makeLayout(100, 100).place([[90, 90, 120, 110]], 9)).toBeNull();
  });
});
