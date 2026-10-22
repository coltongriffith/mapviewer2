import { describe, it, expect } from 'vitest';
import { parseTable, guessKind, needsCrs, buildPlan, figureSections, crsDef } from '../src/utils/drillPlanData.js';
import { planLayout, padsOf, panelBoxes, FAN_PX } from '../src/utils/drillPlan.js';
import { drillPlanLegendItems, holeColors, binsOf, RELEASE_COLORS, OTHER_COLOR } from '../src/utils/drillPlanLegend.js';
import { paintSvg } from '../src/utils/studioCards.js';
import { CRS, COLLARS_CSV, SURVEYS_CSV, ASSAYS_CSV, RESULTS_CSV, FIGURE_SETTINGS } from './fixtures/tower-drill.js';

// The 2D drill plan (Tower Fig 2): plan-projected traces with assay bars, colour per hole, the common pad, interval
// tags, the results card, the highlight card and section A–A′. Opt-in: a map without project.drillPlan gets nothing.

async function tables() {
  const files = [['collars.csv', COLLARS_CSV], ['surveys.csv', SURVEYS_CSV], ['assays.csv', ASSAYS_CSV], ['release.csv', RESULTS_CSV]];
  return Promise.all(files.map(async ([name, text]) => { const t = await parseTable(text); return { name, ...t, kind: guessKind(t.header, t.rows, name) }; }));
}
const tower = async (extra = {}) => ({ ...(await buildPlan(await tables(), { crs: CRS })).plan, ...extra });

// A view 1600 × 1000 px centred on the pad, about 0.6 m a px, north up.
function view(plan, extra = {}) {
  const lng0 = plan.holes.find((h) => h.id === '077').lng, lat0 = plan.holes.find((h) => h.id === '077').lat, mpp = 0.6;
  const kx = (111320 * Math.cos((lat0 * Math.PI) / 180)) / mpp, ky = 110540 / mpp;
  return { pt: (lng, lat) => [800 + (lng - lng0) * kx, 520 - (lat - lat0) * ky], W: 1600, H: 1000, panels: [], family: 'Inter', ...extra };
}
const texts = (prims) => prims.filter((p) => p.t === 'text').map((p) => p.s);
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

describe('reading drill files as the 3D maker reads them', () => {
  it('tells collars, surveys, assays and a release table apart', async () => {
    const t = await tables();
    expect(t.map((x) => x.kind)).toEqual(['collars', 'surveys', 'assays', 'published']);
    expect(needsCrs(t)).toBe(true);
  });

  it('builds the plan: holes in hole order, straight or desurveyed paths in longitude/latitude, assays and results', async () => {
    const { plan, problems } = await buildPlan(await tables(), { crs: CRS });
    expect(problems).toEqual([]);
    expect(plan.holes.map((h) => h.id)).toEqual(['055', '059', '060', '063', '064', '065', '068', '077', '078']);
    const h77 = plan.holes.find((h) => h.id === '077'), h55 = plan.holes.find((h) => h.id === '055');
    // Rabbit North, near Kamloops, B.C.
    expect(h77.lat).toBeCloseTo(50.6, 1);
    expect(h77.lng).toBeCloseTo(-120.71, 1);
    // A straight hole is its collar and toe; its plan length is the horizontal part of its length.
    expect(h77.desurveyed).toBe(false);
    expect(h77.path).toHaveLength(2);
    const m = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110540);
    expect(m(h77.path[0], h77.path[1])).toBeCloseTo(420 * Math.cos((50 * Math.PI) / 180), -0.5);
    // Toward the northwest: west and north of the collar.
    expect(h77.path[1][0]).toBeLessThan(h77.path[0][0]);
    expect(h77.path[1][1]).toBeGreaterThan(h77.path[0][1]);
    // 055 has surveys: minimum curvature, every 5 m.
    expect(h55.desurveyed).toBe(true);
    expect(h55.path.length).toBeGreaterThan(50);
    expect(plan.crs).toBe(CRS);
    expect(plan.assays.elements).toEqual([{ name: 'Au', unit: 'g/t' }, { name: 'Cu', unit: '%' }]);
    expect(plan.element).toBe('Au');
    expect(plan.results).toHaveLength(9);
    expect(plan.results.find((r) => r.resultId === '077-L').domain).toBe('Lower Blue Sky');
  });

  it('asks for the coordinate system of easting/northing collars rather than guessing it', async () => {
    await expect(buildPlan(await tables(), {})).rejects.toThrow(/choose their coordinate system/);
    expect(crsDef('EPSG:26910')).toMatch(/zone=10 \+datum=NAD83/);
    expect(crsDef('EPSG:32755')).toMatch(/zone=55 \+south/);
  });

  it('reads positive-down dips as downward, as 3D does', async () => {
    const t = await tables(), c = t[0];
    c.rows = c.rows.map((r) => r.map((v, i) => (i === 5 ? String(Math.abs(+v)) : v)));
    const { plan, notes } = await buildPlan([c], { crs: CRS });
    expect(notes.join(' ')).toMatch(/positive down/);
    expect(plan.holes.find((h) => h.id === '077').dip).toBe(-50);
  });

  it('keeps the choices made on the plan when it is rebuilt', async () => {
    const prev = await tower({ fan: { 'pad:077+078': true }, show: { card: true }, release: { title: 'Blue Sky' } });
    prev.holes.find((h) => h.id === '064').color = '#ff0000';
    const { plan } = await buildPlan(await tables(), { crs: CRS, prev });
    expect(plan.fan).toEqual({ 'pad:077+078': true });
    expect(plan.release.title).toBe('Blue Sky');
    expect(plan.holes.find((h) => h.id === '064').color).toBe('#ff0000');
  });

  it('takes a section with fixed ends from a saved 3D figure, in longitude/latitude', async () => {
    const [a, b] = await figureSections(FIGURE_SETTINGS);
    expect(a.name).toBe('A–A′');
    expect(a.ends.a.lat).toBeGreaterThan(a.ends.b.lat);
    expect(a.ends.a.lng).toBeLessThan(a.ends.b.lng);
    expect(a.grid.a).toEqual({ x: 663200, y: 5608010 });
    expect(b.ends).toBeNull(); // a line through the block centre has no ends to share
  });
});

describe('colours, bins and the legend', () => {
  it('gives the release holes green and cyan in hole order, the others white, and keeps a chosen colour', async () => {
    const plan = await tower();
    const c = holeColors(plan);
    expect(c.get('077')).toBe(RELEASE_COLORS[0]);
    expect(c.get('078')).toBe(RELEASE_COLORS[1]);
    expect(c.get('055')).toBe(OTHER_COLOR);
    plan.holes.find((h) => h.id === '055').color = '#123456';
    expect(holeColors(plan).get('055')).toBe('#123456');
  });

  it('labels the bins low to high and the legend rows', async () => {
    const plan = await tower({ section: { name: 'A–A′', a: { lng: 0, lat: 0 }, b: { lng: 1, lat: 1 } } });
    expect(binsOf(plan).map((b) => b.label)).toEqual(['0.4 – 1', '1 – 3', '3 – 10', '≥ 10']);
    const rows = drillPlanLegendItems(plan);
    expect(rows.map((r) => r.label)).toEqual([
      'Hole 077, dip −50° (this release)', 'Hole 078, dip −70° (this release)', 'Drill trace, plan projection (desurveyed, else collar az/dip)',
      '≥ 10', '3 – 10', '1 – 3', '0.4 – 1', 'Section line A–A′',
    ]);
    expect(rows[0].style.stroke).toBe(RELEASE_COLORS[0]);
    expect(rows.find((r) => r.label === '≥ 10').group).toBe('Assay · Au g/t');
    expect(drillPlanLegendItems(undefined)).toEqual([]);
    expect(drillPlanLegendItems({ ...plan, legend: false })).toEqual([]);
  });
});

describe('the plan as primitives', () => {
  it('finds the common pad (collars within 5 m) and nothing else', async () => {
    const pads = padsOf(await tower());
    expect(pads.map((p) => p.ids)).toEqual([['077', '078']]);
    expect(pads[0].key).toBe('pad:077+078');
  });

  it('draws traces in each hole colour, assay bars in bin colours, a split-colour pad collar and toe pills', async () => {
    const plan = await tower(), { base } = planLayout(plan, view(plan));
    const traces = base.filter((p) => p.role === 'trace');
    expect(traces).toHaveLength(9);
    expect(traces.map((p) => p.stroke)).toContain(RELEASE_COLORS[1]);
    const bars = base.filter((p) => p.role === 'bar');
    expect(new Set(bars.map((p) => p.stroke))).toEqual(new Set(['#f5c518', '#f08c00', '#e03131', '#c2255c']));
    // 077's 1.5 m @ 16.70 g/t: a short ≥ 10 bar, drawn at least 3 px long.
    const top = bars.filter((p) => p.stroke === '#c2255c');
    expect(top.length).toBeGreaterThan(0);
    // One collar disc for the pad, split into its two holes' colours.
    expect(base.filter((p) => p.t === 'path').map((p) => p.fill)).toEqual([RELEASE_COLORS[0], RELEASE_COLORS[1]]);
    expect(base.filter((p) => p.role === 'toe-pill').map((p) => p.s).sort()).toEqual(plan.holes.map((h) => h.id).sort());
  });

  it('fans the pad traces apart when asked, and says so on the pad tag', async () => {
    const plan = await tower(), off = planLayout(plan, view(plan)), on = planLayout({ ...plan, fan: { 'pad:077+078': true } }, view(plan));
    const start = (L, color) => L.base.find((p) => p.role === 'trace' && p.stroke === color).pts[0];
    const d0 = Math.hypot(...start(off, RELEASE_COLORS[0]).map((v, i) => v - start(off, RELEASE_COLORS[1])[i]));
    const d1 = Math.hypot(...start(on, RELEASE_COLORS[0]).map((v, i) => v - start(on, RELEASE_COLORS[1])[i]));
    expect(d1 - d0).toBeGreaterThan(FAN_PX * 0.8);
    expect(texts(off.over)).toContain('COMMON DRILL PAD');
    expect(texts(off.over)).not.toContain('traces offset for clarity');
    expect(texts(on.over)).toContain('traces offset for clarity');
    expect(texts(on.over)).toEqual(expect.arrayContaining(['077', '−50°', '/', '078', '−70°', '→ NW']));
  });

  it('puts a tag on each published interval, clear of each other and inside the frame, with the domain and incl. lines', async () => {
    const plan = await tower(), { over, targets } = planLayout(plan, view(plan));
    const tags = targets.filter((t) => t.key.startsWith('tag:'));
    expect(tags.map((t) => t.key)).toEqual(['tag:077-U', 'tag:077-L', 'tag:078-U', 'tag:078-L']);
    for (let i = 0; i < tags.length; i++) {
      expect(tags[i].box[0]).toBeGreaterThanOrEqual(4); expect(tags[i].box[3]).toBeLessThanOrEqual(996);
      for (let j = i + 1; j < tags.length; j++) expect(overlap(tags[i].box, tags[j].box), `${tags[i].key} / ${tags[j].key}`).toBe(false);
    }
    const t = texts(over);
    expect(t).toEqual(expect.arrayContaining(['LOWER BLUE SKY', '134.0 m @ 0.65 g/t Au', 'incl. 1.5 m @ 16.70 g/t Au', 'incl. 3.6 m @ 4.15 g/t Au; incl. 10.0 m @ 2.29 g/t Au']));
    // Each tag's leader runs to the middle of its interval.
    expect(over.filter((p) => p.role === 'leader').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps clear of the panels', async () => {
    const plan = await tower(), panels = [[1000, 0, 1600, 1000]];
    const { targets } = planLayout(plan, view(plan, { panels }));
    targets.filter((t) => t.key.startsWith('tag:')).forEach((t) => expect(overlap(t.box, panels[0]), t.key).toBe(false));
    expect(panelBoxes({ legend: { left: 10, top: 20, width: 100, height: 50 }, inset: { left: 0, top: 0, width: 50, height: 50 } }, { insetEnabled: false })).toEqual([[10, 20, 110, 70]]);
  });

  it('keeps a dragged tag where it was put (its offset from the interval)', async () => {
    const plan = await tower(), a = planLayout(plan, view(plan)).targets.find((t) => t.key === 'tag:077-L');
    const b = planLayout({ ...plan, pos: { 'tag:077-L': { dx: 40, dy: -90 } } }, view(plan)).targets.find((t) => t.key === 'tag:077-L');
    expect(b.anchor).toEqual(a.anchor);
    expect(b.box[0]).toBeCloseTo(a.anchor[0] + 40); expect(b.box[1]).toBeCloseTo(a.anchor[1] - 90);
  });

  it('draws the results card: NEW pill, release date, per-hole chips with domain headings, bold intervals and incl. lines', async () => {
    const plan = await tower({ show: { card: true }, release: { title: 'Blue Sky · Holes 077 & 078' } });
    const { over, targets } = planLayout(plan, view(plan));
    const t = texts(over);
    expect(t).toEqual(expect.arrayContaining(['NEW', 'RELEASED 15 OCT 2026', 'Blue Sky · Holes 077 & 078', 'UPPER BLUE SKY', '20.3 m @ 3.13 g/t Au', 'incl. 8.0 m @ 7.16 g/t Au']));
    // Upper before lower within each hole, 077 before 078.
    const results = over.filter((p) => p.role === 'result').map((p) => p.s);
    expect(results.indexOf('20.3 m @ 3.13 g/t Au')).toBeLessThan(results.indexOf('134.0 m @ 0.65 g/t Au'));
    // One leader, to the pad.
    const card = targets.find((x) => x.key === 'card'), pad = padsOf(plan)[0], p = view(plan).pt(pad.lng, pad.lat);
    expect(card.anchor[0]).toBeCloseTo(p[0]); expect(card.anchor[1]).toBeCloseTo(p[1]);
  });

  it('draws the highlight: a big star with a glow ring and its card', async () => {
    const h55 = (await tower()).holes.find((h) => h.id === '055');
    const plan = await tower({ highlight: { at: { lng: h55.lng, lat: h55.lat }, heading: 'Blue Sky Discovery', sub: 'Hole 055 · Discovery hole', main: '198.75 m @ 0.69 g/t Au', second: 'followed by 31.5 m @ 4.15 g/t Au' } });
    const { over, targets } = planLayout(plan, view(plan));
    expect(over.filter((p) => p.t === 'circle' && p.fo > 0)).toHaveLength(2); // glow ring and halo
    expect(over.some((p) => p.t === 'poly' && p.pts.length === 10 && p.stroke)).toBe(true); // the big star
    expect(texts(over)).toEqual(expect.arrayContaining(['BLUE SKY DISCOVERY', 'HOLE 055 · DISCOVERY HOLE', '198.75 m @ 0.69 g/t Au', 'followed by 31.5 m @ 4.15 g/t Au']));
    expect(targets.map((x) => x.key)).toEqual(expect.arrayContaining(['star', 'hl']));
  });

  it('draws section A–A′: dashed line, boxed ends and its name along the line, upright', async () => {
    const [sec] = await figureSections(FIGURE_SETTINGS);
    const plan = await tower({ section: { name: sec.name, ...sec.ends } }), { base } = planLayout(plan, view(plan));
    expect(base.some((p) => p.t === 'pline' && p.dash)).toBe(true);
    expect(base.filter((p) => p.role === 'section-end').map((p) => p.s)).toEqual(['A', 'A′']);
    const label = base.find((p) => p.role === 'section-label');
    expect(label.s).toBe('SECTION A–A′');
    expect(Math.abs(label.rot)).toBeLessThanOrEqual(90);
  });

  it('draws nothing without a plan', () => {
    expect(planLayout(undefined, { pt: () => [0, 0], W: 10, H: 10 })).toEqual({ base: [], over: [], targets: [] });
  });
});

describe('the painters for the plan', () => {
  it('writes polylines, rotated text and a circle fill opacity as SVG', () => {
    const svg = paintSvg([
      { t: 'pline', pts: [[0, 0], [10, 5]], stroke: '#ff0000', sw: 2, dash: [4, 2], cap: 'butt' },
      { t: 'text', x: 5, y: 6, s: 'A', size: 10, weight: 700, family: 'Inter', fill: '#fff', rot: -30 },
      { t: 'circle', cx: 1, cy: 1, r: 2, fill: '#f5c518', fo: 0.2 },
    ], 2);
    expect(svg).toContain('<polyline points="0,0 20,10" fill="none" stroke="#ff0000" stroke-width="4" stroke-linecap="butt" stroke-linejoin="round" stroke-dasharray="8 4" />');
    expect(svg).toContain('transform="rotate(-30 10 12)"');
    expect(svg).toContain('fill="#f5c518" fill-opacity="0.2"');
    // Primitives without the new fields are written as before.
    expect(paintSvg([{ t: 'circle', cx: 1, cy: 1, r: 2, fill: '#000000' }], 1)).toBe('<circle cx="1" cy="1" r="2" fill="#000000" />');
  });
});
