import { describe, it, expect } from 'vitest';
import { nextId, nameOf, letters, geomOf, legacyOf, fromLegacy, cleanSections, clipToBox, lookingWord, FENCE_OPACITY } from '../shared/sectionGeometry.js';
import { cleanSection, lineThrough } from '../src/three-d/section-geometry.js';
import { withDefaults } from '../src/three-d/design-version.js';

// Named sections (A–A′, B–B′ …) and fences for Exploration Maps 3D (src/three-d/sections.js).
const near = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('the single section A–A′ as the first named section', () => {
  it('takes a centre line as it is: azimuth and width, no ends and no holes, fence off', () => {
    const S = { secAz: 135, secW: 75, section: null };
    const e = fromLegacy(S);
    expect(e).toEqual({ id: 'A', name: 'A–A′', az: 135, width: 75, fence: false, opacity: FENCE_OPACITY });
    expect(legacyOf(e)).toEqual(S);
  });
  it('keeps a fitted line and its chosen holes exactly, and gives them back unchanged', () => {
    const section = cleanSection({ holes: ['EX-014', 'EX-021'], a: { x: 412050.3, y: 6421700.1 }, b: { x: 412410.9, y: 6421990.4 } });
    const S = { secAz: 51, secW: 40, section }, e = fromLegacy(S);
    expect(e).toMatchObject({ az: 51, width: 40, holes: ['EX-014', 'EX-021'], a: section.a, b: section.b });
    expect(legacyOf(e)).toEqual(S);
    expect(JSON.stringify(legacyOf(e).section)).toBe(JSON.stringify(section)); // same key order as cleanSection
    // Copies, so a later change to the figure's section never reaches the saved entry.
    e.holes.push('EX-001'); e.a.x = 0; expect(section.holes).toHaveLength(2); expect(section.a.x).toBe(412050.3);
  });
  it('keeps a line set by hand with every hole within the width (ends, no holes)', () => {
    const S = { secAz: 10, secW: 75, section: { a: { x: 0, y: 0 }, b: { x: 10, y: 100 } } };
    expect(geomOf(S)).toEqual({ az: 10, width: 75, a: { x: 0, y: 0 }, b: { x: 10, y: 100 } });
    expect(legacyOf(geomOf(S))).toEqual(S);
  });
  it('an earlier figure has no named sections: the settings default fills null', () => {
    const saved = { title: 'OLD', secAz: 120, secW: 75, section: null };
    const out = withDefaults(saved, { title: '', secAz: 135, secW: 75, section: null, sections: null, secActive: null });
    expect(out.sections).toBeNull(); expect(out.secActive).toBeNull(); expect(out.secAz).toBe(120);
  });
});

describe('section names and letters', () => {
  it('takes the next free letter', () => {
    expect(nextId([])).toBe('A'); expect(nextId([{ id: 'A' }])).toBe('B'); expect(nextId([{ id: 'A' }, { id: 'C' }])).toBe('B');
    expect(nextId([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((id) => ({ id })))).toBeNull();
    expect(nameOf('C')).toBe('C–C′');
  });
  it('letters the ends from the name, or from the id', () => {
    expect(letters({ id: 'B', name: 'B–B′' })).toEqual(['B', 'B′']);
    expect(letters({ id: 'B', name: "D-D'" })).toEqual(['D', 'D′']);
    expect(letters({ id: 'C', name: 'Line 1000N' })).toEqual(['C', 'C′']);
    expect(letters({ id: 'C', name: 'X–Y′' })).toEqual(['C', 'C′']);
  });
  it('names the looking direction', () => {
    expect([0, 29, 45, 81, 90, 179, 225, 316, 359, -45].map(lookingWord)).toEqual(['N', 'NE', 'NE', 'E', 'E', 'S', 'SW', 'NW', 'N', 'NW']);
  });
});

describe('saved sections', () => {
  it('are checked: unique letters, names, numbers in range, ends only as a pair', () => {
    const out = cleanSections([
      { id: 'A', name: 'A–A′', az: 120, width: 75, fence: false, opacity: 0.35 },
      { id: 'B', name: '  ', az: 400, width: 1, a: { x: 1, y: 2 }, holes: ['EX-1', 'EX-1', 3], fence: 1, opacity: 7 },
      { id: 'B', name: 'dup' }, { id: 'AB' }, null, 'C',
    ]);
    expect(out).toEqual([
      { id: 'A', name: 'A–A′', az: 120, width: 75, fence: false, opacity: 0.35 },
      { id: 'B', name: 'B–B′', az: 40, width: 5, holes: ['EX-1'], fence: true, opacity: 1 },
    ]);
    expect(cleanSections([])).toBeNull(); expect(cleanSections(null)).toBeNull(); expect(cleanSections({})).toBeNull();
  });
  it('round-trip unchanged through JSON', () => {
    const list = [fromLegacy({ secAz: 30, secW: 60, section: { holes: ['H1'], a: { x: 1.5, y: 2 }, b: { x: 300, y: 400.1 } } }), { id: 'B', name: 'Line 1000N', az: 120, width: 75, fence: true, opacity: 0.5 }];
    expect(cleanSections(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });
});

describe('a fence cut to the block', () => {
  const B = { x0: 0, x1: 1000, y0: 0, y1: 500 };
  it('keeps a line inside the block whole', () => { expect(clipToBox({ x: 100, y: 100 }, { x: 900, y: 400 }, B)).toEqual([0, 1]); });
  it('cuts a line running past the block at its sides', () => {
    const [s0, s1] = clipToBox({ x: -500, y: 250 }, { x: 1500, y: 250 }, B);
    near(s0, 0.25); near(s1, 0.75);
    const c = clipToBox(...lineThrough({ x: 500, y: 250 }, 45, 2000), B), [a, b] = lineThrough({ x: 500, y: 250 }, 45, 2000);
    const at = (f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    near(at(c[0]).y, 0, 1e-6); near(at(c[1]).y, 500, 1e-6); near(at(c[0]).x, 250, 1e-6);
  });
  it('is null for a line missing the block', () => {
    expect(clipToBox({ x: -10, y: -10 }, { x: -5, y: 900 }, B)).toBeNull();
    expect(clipToBox({ x: 1200, y: 0 }, { x: 1300, y: 0 }, B)).toBeNull();
  });
});
