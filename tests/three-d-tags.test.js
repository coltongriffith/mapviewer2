import { describe, it, expect, beforeEach } from 'vitest';
import { shouldMerge, placePills } from '../src/three-d/layout.js';
import { init, drawPills, legendRows, tagShown, idShown, pendingGroups, weight, fade, highlightOf, set as setTags } from '../src/three-d/tags.js';
import { readLegendFiles, applyLegendFile } from '../src/three-d/geology.js';
import { refineRole } from '../src/three-d/roles.js';

describe('merged legend', () => {
  const sec = (key, n) => ({ key, rows: Array.from({ length: n }, () => ({})) });
  it('merges automatically once three blocks have something to show', () => {
    expect(shouldMerge([sec('holes', 1), sec('assays', 5), sec('model', 1)])).toBe(false); // the plain collar row does not count
    expect(shouldMerge([sec('holes', 3), sec('assays', 5), sec('model', 1)])).toBe(true);
    expect(shouldMerge([sec('holes', 1), sec('assays', 5), sec('model', 1), sec('lithology', 4)])).toBe(true);
    expect(shouldMerge([sec('holes', 1), sec('assays', 5), sec('model', 0), sec('lithology', 4)])).toBe(false);
  });
  it('follows an explicit choice', () => {
    expect(shouldMerge([sec('assays', 5)], 'one')).toBe(true);
    expect(shouldMerge([sec('holes', 3), sec('assays', 5), sec('model', 1)], 'separate')).toBe(false);
  });
});

describe('pill placement', () => {
  it('drops the lowest-priority pills rather than drawing one over another', () => {
    const items = [{ x: 100, y: 100, w: 40, h: 20 }, { x: 100, y: 100, w: 40, h: 20 }, { x: 100, y: 100, w: 40, h: 20 }];
    const wall = [[0, 0, 400, 50], [0, 95, 400, 400], [0, 0, 70, 400], [131, 0, 400, 400]]; // room for one pill only
    const out = placePills(items, wall, { W: 400, H: 400, drop: true });
    expect(out).toHaveLength(1);
    expect(placePills(items, wall, { W: 400, H: 400 })).toHaveLength(3); // without drop they overlap
  });
});

describe('grouped pending tags', () => {
  it('groups pending collars within the radius, in metres', () => {
    const pts = [[0, 0], [120, 0], [250, 0], [900, 0]];
    expect(pendingGroups(pts, 140).map((g) => g.length).sort()).toEqual([1, 3]);
    expect(pendingGroups(pts, 100).map((g) => g.length).sort()).toEqual([1, 1, 1, 1]);
    expect(pendingGroups(pts, 1000)).toHaveLength(1); // a radius of 400 or more makes the Star figure's tags one
  });
});

// A stand-in for studio.js: holes on a line, a canvas context that only measures text.
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const K = { u: 1, font: () => {} };
function host(holes, tags = {}, extra = {}) {
  const S = { designVersion: extra.designVersion ?? 2, ids: true, pendingLabels: true, accent: '#c65322', primary: '#142126', tags: { at: 'collar', style: 'dark', status: {}, fadePrevious: false, newLabel: '', prevLabel: 'Previously released', plannedLabel: 'Planned', groups: [], groupRadius: 140, idMode: 'auto', showId: {}, showTag: {}, hideRows: [], pending: 'collar', ...tags } };
  const fills = [];
  ctx.fillText = (t) => fills.push(t);
  init({ S, project: { holes }, G: { V: (x, y, z) => ({ x, y, z }) }, proj: (v) => [v.x, 500 - v.y / 10, 0], shownCallouts: () => extra.callouts || [], isPending: (h) => /pending/.test(h.note),
    roundRect: () => {}, textOn: () => '#fff', setSpacing: () => {}, INK: '#142126', brandTone: () => S.accent });
  return { S, fills, draw: () => { fills.length = 0; drawPills(ctx, K, { placed: [], occ: [], W: 2000, H: 1000 }); return fills.slice(); } };
}
const hole = (id, x, year, note = '') => ({ id, note, c: { x, y: 0, z: 1000, raw: { Year: String(year), Status: note } }, ints: [{}] });

describe('hole tags', () => {
  let holes;
  beforeEach(() => { holes = [hole('S-073', 0, 2026), hole('S-076', 60, 2026, 'assays pending'), hole('S-079', 120, 2026, 'assays pending'), hole('S-037', 400, 2014), hole('S-048', 600, 2014)]; });
  it('gives each hole its own tag setting, apart from its ID', () => {
    host(holes); expect(holes.filter(tagShown).map((h) => h.id)).toEqual(['S-073', 'S-076', 'S-079', 'S-037', 'S-048']); // pending holes keep their pills beside the group tag
    const H = host(holes, { showTag: { 'S-037': true, 'S-048': false } });
    expect(holes.filter(tagShown).map((h) => h.id)).toEqual(['S-073', 'S-076', 'S-079', 'S-037']);
    expect(holes.every(idShown)).toBe(true);
    H.S.ids = false; expect(H.draw()).toContain('S-073'); // hole IDs off keeps the tags
  });
  it('status "none" means no status pill', () => {
    host(holes, { status: { 'S-073': 'none' } });
    expect(tagShown(holes[0])).toBe(false);
  });
  it('draws one "2026 · ASSAYS PENDING" tag for pending holes within the radius', () => {
    expect(host(holes).draw().filter((t) => /PENDING/.test(t))).toEqual(['2026 · ASSAYS PENDING']);
    expect(host(holes, { groupRadius: 20 }).draw().filter((t) => /PENDING/.test(t))).toHaveLength(2);
  });
  it('keeps the earlier tags on a figure made before October 2026 (design version 1)', () => {
    const v1 = { designVersion: 1 };
    expect(host(holes, {}, v1).draw().filter((t) => /PENDING/.test(t))).toEqual(['ASSAYS PENDING']); // no year, grouped 70 px apart on screen
    expect(host(holes, { groupRadius: 20 }, v1).draw().filter((t) => /PENDING/.test(t))).toHaveLength(1);
    host(holes, { status: { 'S-073': 'none' } }, v1);
    expect(holes.filter(tagShown).map((h) => h.id)).toEqual(['S-076', 'S-079', 'S-037', 'S-048']);
    const plain = holes.map((h) => ({ ...h, c: { ...h.c, raw: {} } })); // no year column: only S-073 has a status
    host(plain, { status: { 'S-073': 'new' } });
    expect(plain.filter(tagShown).map((h) => h.id)).toEqual(['S-073']);
    host(plain, { status: { 'S-073': 'new' } }, v1);
    expect(plain.filter(tagShown)).toHaveLength(5); // a pill on every hole with an ID, as before
  });
  it('lists "Previously released" only when such a pill is drawn, and never when hidden', () => {
    const rows = () => legendRows().map((r) => r.label);
    const H = host(holes); H.draw();
    expect(rows()).toEqual(['2026 results', 'Previously released']);
    const H2 = host(holes, { showTag: { 'S-037': false, 'S-048': false } }); H2.draw();
    expect(rows()).toEqual(['2026 results']);
    const H3 = host(holes, { status: { 'S-037': 'none', 'S-048': 'none' } }); H3.draw();
    expect(rows()).toEqual(['2026 results']);
    const H4 = host(holes, { hideRows: ['previous'] }); H4.draw();
    expect(rows()).toEqual(['2026 results']);
    const H5 = host(holes, { at: 'toe' }); H5.draw();
    expect(rows()).toEqual([]);
  });
  it('defaults to key holes past 12 holes: callouts, new and planned ones', () => {
    const many = Array.from({ length: 20 }, (_, i) => hole(`H-${i}`, i * 50, i < 3 ? 2026 : 2014));
    host(many, {}, { callouts: [{ h: many[10] }] });
    expect(many.filter(idShown).map((h) => h.id)).toEqual(['H-0', 'H-1', 'H-2', 'H-10']);
    expect(many.filter(tagShown).map((h) => h.id)).toEqual(['H-0', 'H-1', 'H-2', 'H-10']);
  });
});

describe('Star sample: pending holes S-076 and S-079', () => {
  // The Star collars (star_main_collars.csv): two holes with assays pending, about 105 m apart.
  const star = () => [hole('S-073', 0, 2026), { ...hole('S-076', 0, 2026, 'Complete, assays pending'), c: { x: 339740, y: 6458372, z: 1175, raw: { Year: '2026' } } },
    { ...hole('S-079', 0, 2026, 'In progress, assays pending'), c: { x: 339661, y: 6458442, z: 1183, raw: { Year: '2026' } } }, hole('S-037', 400, 2014)];
  it('draws one grouped ASSAYS PENDING tag with groupRadius 400 (and with the default)', () => {
    expect(host(star(), { groupRadius: 400 }).draw().filter((t) => /PENDING/.test(t))).toEqual(['2026 · ASSAYS PENDING']);
    expect(host(star()).draw().filter((t) => /PENDING/.test(t))).toEqual(['2026 · ASSAYS PENDING']);
  });
});

describe('hole display', () => {
  const many = () => Array.from({ length: 20 }, (_, i) => hole(`H-${i}`, i * 50, i < 3 ? 2026 : 2014));
  it('past 12 holes, key holes are bold and the previously released ones thin and grey by default', () => {
    const hs = many(); host(hs);
    expect(weight(hs[0])).toBeGreaterThan(1); expect(fade(hs[0])).toBe(false);
    expect(weight(hs[8])).toBeLessThan(1); expect(fade(hs[8])).toBe(true);
    setTags({ emphasis: 'none' });
    expect(weight(hs[8])).toBe(1); expect(fade(hs[8])).toBe(false);
  });
  it('highlights holes in the brand colour, live, or a colour of their own', () => {
    const hs = many(), H = host(hs, { emphasis: 'none' });
    setTags({ highlightNew: 'brand', highlight: { 'H-9': '#336699' } });
    expect(hs.map(highlightOf).filter(Boolean)).toEqual(['#c65322', '#c65322', '#c65322', '#336699']);
    H.S.accent = '#0b7a75'; expect(highlightOf(hs[0])).toBe('#0b7a75'); // follows the brand
    expect(() => setTags({ highlight: { 'H-1': 'gold' } })).toThrow(/hex colour/);
  });
});

describe('lithology legend file', () => {
  const file = (header, rows) => { const e = { header, rows, cols: {} }; return { e, role: refineRole(e, 'unknown', 'lith_legend.csv') }; };
  it('is detected as its own role', () => {
    const { e, role } = file(['Code', 'Name', 'Colour'], [['QMD', 'Quartz monzodiorite', '#e3b8c8'], ['POT', 'Potassic core', '']]);
    expect(role).toBe('lithlegend');
    expect(e.cols).toEqual({ code: 0, desc: 1, color: 2 });
  });
  it('names the units, and manual names in the legend editor still win', () => {
    const { e } = file(['Code', 'Name', 'Colour'], [['QMD', 'Quartz monzodiorite', 'e3b8c8'], ['POT', 'Potassic core', '']]);
    const m = readLegendFiles([e]);
    const out = applyLegendFile([{ code: 'QMD', name: 'QMD', color: '#f1dca2' }, { code: 'POT', name: 'My potassic', color: '#e8b7a2', nameSet: true }, { code: 'X', name: 'X', color: '#ffffff' }], m);
    expect(out[0]).toMatchObject({ name: 'Quartz monzodiorite', color: '#e3b8c8' });
    expect(out[1]).toMatchObject({ name: 'My potassic', color: '#e8b7a2' });
    expect(out[2]).toMatchObject({ name: 'X' });
  });
});
