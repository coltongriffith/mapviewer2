import { describe, it, expect } from 'vitest';
import { init, setBlock, BLOCK, shortIds, joinAnd, clipToBox, pads, releaseSecs, assayRows, colorOf } from '../src/three-d/block.js';
import { init as initTags, noFrom, joinIncl, RELEASE, releaseClass, classRuns } from '../src/three-d/tags.js';

// Exploration Maps 3D round 5H: a colour per hole, thick bars in the release palette, elevation ticks, the section's ends,
// a common pad's pill, the release legend, incl. lines without "from", the flat scale bar. All off until set.

const HOLES = [{ id: 'BS-077', c: { x: 0, y: 0 } }, { id: 'BS-078', c: { x: 3, y: 2 } }, { id: 'BS-061', c: { x: -140, y: 120 } }];
const host = (block = structuredClone(BLOCK), extra = {}) => {
  const S = { holesShown: null, block, accent: '#3f9a3c', valueLabel: 'Au g/t', calloutMode: 'published', histograms: true, bins: [0.4, 1, 3, 10] };
  const H = { S, G: {}, project: { holes: HOLES }, rebuild: () => {}, setStyle: () => {}, renderExtUI: () => {}, status: () => {}, holeOn: (h) => !S.holesShown || S.holesShown.includes(h.id), shownCallouts: () => [{}], INK: '#142126', paper: () => '#fff', ...extra };
  init(H); initTags(H); return S;
};

describe('block settings of round 5H', () => {
  it('are all off on a new block, and a block with them off is the same as before', () => {
    ['colors', 'ticks', 'ends', 'pad', 'legend', 'inclFrom', 'scale', 'scaleNote'].forEach((k) => expect(k in BLOCK).toBe(false));
    const S = host(), was = structuredClone(S.block);
    setBlock({ colors: { 'BS-077': '#3f9a3c' }, ticks: 'elevation', ends: true, pad: true, legend: true, inclFrom: false, scale: 'flat', scaleNote: '' });
    setBlock({ colors: null, ticks: 'depth', ends: false, pad: false, legend: null, inclFrom: true, scale: 'face', scaleNote: null });
    expect(S.block).toEqual(was);
  });
  it('checks hole colours, merges them and removes one with null', () => {
    const S = host();
    setBlock({ colors: { 'BS-077': '#3f9a3c' } }); setBlock({ colors: { 'BS-078': '#1fb0c6' } });
    expect(S.block.colors).toEqual({ 'BS-077': '#3f9a3c', 'BS-078': '#1fb0c6' }); expect(colorOf({ id: 'BS-078' })).toBe('#1fb0c6'); expect(colorOf({ id: 'BS-061' })).toBe(null);
    setBlock({ colors: { 'BS-077': null } }); expect(S.block.colors).toEqual({ 'BS-078': '#1fb0c6' });
    expect(() => setBlock({ colors: { 'BS-078': 'green' } })).toThrow(/colour like "#3f9a3c"/);
    expect(() => setBlock({ colors: { 'XX-1': '#000000' } })).toThrow(/No hole "XX-1"/);
    expect(() => setBlock({ colors: ['#000000'] })).toThrow(/colors must be/);
    expect(S.block.colors).toEqual({ 'BS-078': '#1fb0c6' }); // a refused patch changes nothing
  });
  it('drops colours for holes no longer in the data instead of refusing the next change (Codex review)', () => {
    const S = host(); setBlock({ colors: { 'BS-077': '#3f9a3c', 'BS-078': '#1fb0c6' } });
    const S2 = host(S.block, { project: { holes: [{ id: 'NEW-1', c: { x: 0, y: 0 } }, { id: 'BS-078', c: { x: 3, y: 2 } }] } }); // another dataset, the same block
    setBlock({ colors: { 'NEW-1': '#e07a1f' } }); expect(S2.block.colors).toEqual({ 'BS-078': '#1fb0c6', 'NEW-1': '#e07a1f' });
    expect(() => setBlock({ colors: { 'BS-077': null } })).not.toThrow(); // removing a colour that is already gone
    expect(() => setBlock({ colors: { 'BS-077': '#000000' } })).toThrow(/No hole "BS-077"/); // a new colour still needs the hole
  });
  it('checks the ticks, the scale bar and the bars, and keeps the texts', () => {
    const S = host();
    setBlock({ ticks: 'none', scale: 'flat', scaleNote: 'Scale at block centre', pad: '  077 & 078 ', legend: { assay: 'ASSAY · Au g/t', geology: 'GEOLOGY (AFTER TOWER)' }, hist: { style: 'thick', palette: 'release' } });
    expect(S.block).toMatchObject({ ticks: 'none', scale: 'flat', scaleNote: 'Scale at block centre', pad: '077 & 078', legend: { assay: 'ASSAY · Au g/t', geology: 'GEOLOGY (AFTER TOWER)' }, hist: { style: 'thick', palette: 'release' } });
    setBlock({ legend: { assay: null, holes: 'Holes 077 & 078 (this release)' } }); expect(S.block.legend).toEqual({ geology: 'GEOLOGY (AFTER TOWER)', holes: 'Holes 077 & 078 (this release)' });
    setBlock({ legend: true }); expect(S.block.legend).toEqual({ geology: 'GEOLOGY (AFTER TOWER)', holes: 'Holes 077 & 078 (this release)' }); // kept
    expect(() => setBlock({ ticks: 'left' })).toThrow(/ticks must be "depth"/);
    expect(() => setBlock({ scale: 'screen' })).toThrow(/scale must be "face"/);
    expect(() => setBlock({ hist: { style: 'fat' } })).toThrow(/"thick" \(wide bars/);
    setBlock({ hist: { width: 9 } }); expect(S.block.hist.width).toBe(3); setBlock({ hist: { width: 0 } }); expect(S.block.hist.width).toBe(0.3);
    expect(() => setBlock({ hist: { width: 'wide' } })).toThrow(/hist.width must be a number/);
    expect(() => setBlock({ hist: { palette: 'rainbow' } })).toThrow(/"release" \(yellow, orange, red, magenta/);
  });
});

describe('hole IDs on a pad', () => {
  it('drops the prefix the IDs share up to a separator', () => {
    expect(shortIds(['BS-077', 'BS-078'])).toEqual(['077', '078']);
    expect(shortIds(['DDH 12', 'DDH 9', 'DDH 101'])).toEqual(['12', '9', '101']);
    expect(shortIds(['077', '078'])).toEqual(['077', '078']); // no separator: kept whole
    expect(shortIds(['BS-077'])).toEqual(['BS-077']);
    expect(joinAnd(['077', '078'])).toBe('077 & 078'); expect(joinAnd(['1', '2', '3'])).toBe('1, 2 & 3'); expect(joinAnd(['1'])).toBe('1');
  });
  it('groups shown holes within 20 m in plan, two or more, in the first hole\'s colour', () => {
    const S = host({ ...structuredClone(BLOCK), pad: true, colors: { 'BS-077': '#3f9a3c' } });
    expect(pads().map((p) => [p.holes.map((h) => h.id), p.text, p.color])).toEqual([[['BS-077', 'BS-078'], '077 & 078', '#3f9a3c']]);
    S.block.pad = 'Pad 7'; expect(pads()[0].text).toBe('Pad 7');
    delete S.block.colors; expect(pads()[0].color).toBe('#3f9a3c'); // the accent
    S.holesShown = ['BS-077', 'BS-061']; expect(pads()).toEqual([]); // a pad of one is no pad
    delete S.block.pad; S.holesShown = null; expect(pads()).toEqual([]);
  });
});

describe('the section\'s ends on the block (clipToBox)', () => {
  const b = { x0: 0, x1: 100, y0: 0, y1: 50 };
  it('clips the line to the block\'s extent, in its direction', () => {
    expect(clipToBox({ x: -50, y: 25 }, { x: 150, y: 25 }, b)).toEqual([{ x: 0, y: 25 }, { x: 100, y: 25 }]);
    expect(clipToBox({ x: 10, y: 10 }, { x: 20, y: 20 }, b)).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }]); // inside: its own ends
    const d = clipToBox({ x: -10, y: -10 }, { x: 110, y: 110 }, b); expect(d[0]).toEqual({ x: 0, y: 0 }); expect(d[1].y).toBeCloseTo(50);
  });
  it('gives null for a line that misses the block', () => {
    expect(clipToBox({ x: -50, y: 80 }, { x: 150, y: 80 }, b)).toBe(null);
    expect(clipToBox({ x: 200, y: 0 }, { x: 300, y: 50 }, b)).toBe(null);
  });
});

describe('the release palette and legend', () => {
  it('classes grades from the second to the fourth colour limit, as 0.4–1, 1–3, 3–10, ≥ 10', () => {
    const b = [0.4, 1, 3, 10];
    expect([0.5, 1, 2.9, 3, 9.99, 10, 40].map((v) => releaseClass(v, b))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(RELEASE).toHaveLength(4);
  });
  it('lists the classes highest first, only with the release palette on the face', () => {
    const S = host({ ...structuredClone(BLOCK), hist: { ...BLOCK.hist, palette: 'release' } });
    expect(assayRows()).toEqual([['≥ 10', RELEASE[3]], ['3 – 10', RELEASE[2]], ['1 – 3', RELEASE[1]], ['0.4 – 1', RELEASE[0]]]);
    S.block.hist.side = 'screen'; expect(assayRows()).toBe(null);
    S.block.hist = { ...BLOCK.hist }; expect(assayRows()[3][0]).toBe('< 0.4'); // the orange ramp as before
  });
  it('makes one card: the assay classes two to a row, the geology, other sections, then the holes and the bracket', () => {
    host({ ...structuredClone(BLOCK), legend: { geology: 'GEOLOGY (AFTER TOWER)' }, colors: { 'BS-077': '#3f9a3c', 'BS-078': '#1fb0c6' } });
    const row = (label) => ({ label, draw: () => {} }), main = [{ key: 'holes', rows: [row('Drill hole collar')] }, { key: 'assays', title: 'Assay · Au g/t', rows: ['≥ 10', '3 – 10', '1 – 3', '0.4 – 1'].map(row) }, { key: 'model', title: 'Model', rows: [row('Shell')] }];
    const secs = releaseSecs(main, [{ key: 'lithology', title: 'Lithology', rows: [row('Nicola Group')] }]);
    expect(secs.map((s) => [s.key, s.title])).toEqual([['assays', 'ASSAY · Au g/t'], ['lithology', 'GEOLOGY (AFTER TOWER)'], ['model', 'Model'], ['holes', undefined]]);
    expect(secs[0].rows).toHaveLength(2); expect(secs[0].rows[0].full).toBeTypeOf('function');
    expect(secs[3].rows.map((r) => r.label)).toEqual(['Holes 077 & 078 (this release)', 'Published interval (down-hole)']);
  });
});

describe('thick bars: one per run of assays in one class (classRuns)', () => {
  const ints = [[0, 2, 0.5], [2, 4, 0.7], [4, 6, 1.5], [6, 8, 0.1], [8, 10, 0.6], [12, 14, 0.8], [14, 16, 0.9]].map(([from, to, v]) => ({ from, to, vals: { au: v } }));
  it('joins neighbours of one class end to end, keeps the peak, and breaks at a gap, a class change or nothing drawn', () => {
    const key = (v) => (v >= 0.4 ? releaseClass(v, [0.4, 1, 3, 10]) : null);
    expect(classRuns(ints, 'au', key)).toEqual([{ from: 0, to: 4, v: 0.7 }, { from: 4, to: 6, v: 1.5 }, { from: 8, to: 10, v: 0.6 }, { from: 12, to: 16, v: 0.9 }]);
    expect(classRuns([{ from: 0, to: 2, vals: {} }], 'au', key)).toEqual([]);
  });
});

describe('incl. lines without "from" (tags.js)', () => {
  const l2 = 'incl. 3.6 m @ 4.15 g/t Au from 70 m; incl. 10.0 m @ 2.29 g/t Au from 95 m';
  it('keeps "from" unless asked, and then joins the results with the unit once', () => {
    const S = host();
    expect(noFrom(l2)).toBe(l2); // as before
    S.block.inclFrom = false;
    expect(noFrom('incl. 8.0 m @ 7.16 g/t Au from 46 m')).toBe('incl. 8.0 m @ 7.16 g/t Au');
    expect(joinIncl(noFrom(l2))).toBe('incl. 3.6 m @ 4.15 & 10.0 m @ 2.29 g/t Au');
    expect(noFrom(null)).toBe(null);
  });
});
