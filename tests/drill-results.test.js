import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import {
  computeResults, defaultRecipe, checkRecipe, eqSetup, holeIntervals, notes, resultsText, tableRows, toTsv, toCsv,
  toPublishedRecords, toPublishedFile, PUBLISHED_HEADER, byHole,
} from '../shared/drillResults.js';
import { fmtGrade, gradeText, intercept, runs, samples } from '../shared/intercepts.js';
import { eqFactors, eqFormula } from '../shared/metalEq.js';
import * as threeDIntercepts from '../src/three-d/intercepts.js';
import * as threeDEq from '../src/three-d/metal-eq.js';
import { readResults, pubCols, pubCallouts, pubLines, headline } from '../src/three-d/published-results.js';
import { matchCols } from '../src/three-d/roles.js';
import { resultsTableDocument } from '../shared/drillResultsHtml.js';

// The property's results calculator (shared/drillResults.js): the drill database's current assays, one
// recipe, the news-release table, and the same results as /3d's published-results records.

const RECIPE = {
  version: 1, primary: 'Cu', equivalent: true,
  elements: [{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 70 }],
  cutoff: 0.2, minLength: 2, maxDilution: 6, inclCutoff: 1, inclMinLength: 2, inclMaxDilution: 0,
  bdl: 'stored', lengthDecimals: 1, gradeDecimals: {}, trueWidth: 'True widths are estimated at 70–90% of the core lengths.',
};
// Assay rows as the drill database stores them.
const row = (hole, from, to, values, extra = {}) => ({ hole_id: hole, from_m: from, to_m: to, values, bdl: {}, units: { Cu: '%', Au: 'g/t' }, ...extra });
// One hole, 2 m samples: waste to 34 m, 122 m of mineralisation with an 18 m high-grade core, waste to 200 m.
function textbookHole(hole = 'RC-24-001') {
  const out = [];
  for (let d = 0; d < 200; d += 2) {
    const v = d < 34 || d >= 156 ? { Cu: 0.02, Au: 0.01 } : d >= 80 && d < 98 ? { Cu: 1.0, Au: 0.42 } : { Cu: 0.355, Au: 0.174 };
    out.push(row(hole, d, d + 2, v));
  }
  return out;
}
const simple = (vals, extra = {}) => vals.map((cu, i) => row('H-1', i, i + 1, { Cu: cu }, extra));
const CU = { ...RECIPE, equivalent: false, elements: [RECIPE.elements[0]], inclCutoff: null, minLength: 1 };
// A run by the dilution rule that averages below the cut-off, with an "incl." that would average below its own.
const SPLIT = simple([0.3, 0, 0, 0, 0, 0, 0, 0.3, 1.1, 0.3, 0.3, 0.3, 1.1]);
const SPLIT_RECIPE = { ...CU, cutoff: 0.3, maxDilution: 6, inclCutoff: 1, inclMinLength: 1, inclMaxDilution: 3 };

describe('the textbook composite', () => {
  const { results, columns, eq, problems } = computeResults(textbookHole(), RECIPE);

  it('reads as a news release prints it', () => {
    expect(problems).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m, incl. 18.0 m @ 1.32% CuEq');
    expect(resultsText(results, RECIPE).split('\n')[0]).toBe('RC-24-001: 122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m, incl. 18.0 m @ 1.32% CuEq');
    expect(columns).toEqual([{ key: 'CuEq', unit: '%' }, { key: 'Cu', unit: '%' }, { key: 'Au', unit: 'g/t' }]);
  });

  it('weights grades by length, by hand', () => {
    const f = eqFactors({ metal: 'Cu', unit: '%', price: 4.5, recovery: 90 }, [{ metal: 'Au', unit: 'g/t', price: 3000, recovery: 70 }])[0].factor;
    const cu = (18 * 1.0 + 104 * 0.355) / 122, au = (18 * 0.42 + 104 * 0.174) / 122;
    const r = results[0];
    expect([r.from, r.to, r.len]).toEqual([34, 156, 122]);
    expect(r.grades.Cu).toBeCloseTo(cu, 12);
    expect(r.grades.Au).toBeCloseTo(au, 12);
    expect(r.grades.CuEq).toBeCloseTo(cu + f * au, 12);
    expect(r.incl).toHaveLength(1);
    expect(r.incl[0]).toMatchObject({ id: 'RC-24-001:1.1', parentId: 'RC-24-001:1', from: 80, to: 98, len: 18 });
    expect(r.incl[0].grades.CuEq).toBeCloseTo(1.0 + f * 0.42, 12);
  });

  it('shows the formula /3d uses, and the notes', () => {
    const f = eqFactors({ metal: 'Cu', unit: '%', price: 4.5, recovery: 90 }, [{ metal: 'Au', unit: 'g/t', price: 3000, recovery: 70 }]);
    expect(eq.formula).toBe(eqFormula('Cu', f));
    expect(eq.formula).toBe('CuEq = Cu + 0.756 × Au');
    expect(notes(RECIPE)).toEqual([
      'CuEq = Cu + 0.756 × Au, with CuEq and Cu in %, Au in g/t. Prices Cu US$4.50/lb, Au US$3,000/oz; recoveries Cu 90%, Au 70%.',
      'Composited at 0.2% CuEq over at least 2 m, with up to 6 m of consecutive internal dilution (split where that would bring the average below the cut-off); lengths are sampled core lengths and grades are length-weighted. "incl." intervals at 1% CuEq over at least 2 m, with up to 0 m of internal dilution.',
      'Below-detection assays: as stored at import.',
      'True widths are estimated at 70–90% of the core lengths.',
    ]);
  });

  it('as a table, TSV and CSV, with the same rounded numbers', () => {
    const t = tableRows(results, columns);
    expect(t).toEqual([
      ['Hole ID', '', 'From (m)', 'To (m)', 'Length (m)', 'CuEq (%)', 'Cu (%)', 'Au (g/t)', 'Interval'],
      ['RC-24-001', '', '34.0', '156.0', '122.0', '0.61', '0.45', '0.21', '122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m'],
      ['RC-24-001', 'incl.', '80.0', '98.0', '18.0', '1.32', '1.00', '0.42', 'incl. 18.0 m @ 1.32% CuEq'],
    ]);
    expect(toTsv(t).split('\n')[2]).toBe('RC-24-001\tincl.\t80.0\t98.0\t18.0\t1.32\t1.00\t0.42\tincl. 18.0 m @ 1.32% CuEq');
    expect(toCsv(t).split('\r\n')[1]).toBe('RC-24-001,,34.0,156.0,122.0,0.61,0.45,0.21,"122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m"');
  });
});

describe('compositing rules', () => {
  it('a textbook run with internal dilution, and the same split when dilution is shorter', () => {
    const vals = [0.1, 0.5, 0.3, 0.05, 0.05, 0.6, 0.1];
    let r = computeResults(simple(vals), { ...CU, maxDilution: 2 }).results;
    expect(r.map((x) => [x.from, x.to, x.len, +x.grades.Cu.toFixed(6)])).toEqual([[1, 6, 5, 0.3]]);
    expect(r[0].text).toBe('5.0 m @ 0.30% Cu from 1.0 m');
    r = computeResults(simple(vals), { ...CU, maxDilution: 1 }).results;
    expect(r.map((x) => [x.from, x.to, +x.grades.Cu.toFixed(6)])).toEqual([[1, 3, 0.4], [5, 6, 0.6]]);
    // The minimum length drops the short one.
    expect(computeResults(simple(vals), { ...CU, maxDilution: 1, minLength: 2 }).results.map((x) => x.from)).toEqual([1]);
  });

  it('internal dilution up to the limit joins; one sample more ends the run (as /3d)', () => {
    const at = (waste, v = 0.9) => [v, ...Array(waste).fill(0), v];
    expect(computeResults(simple(at(6)), CU).results.map((x) => [x.from, x.to, +x.grades.Cu.toFixed(6)])).toEqual([[0, 8, 0.225]]);
    expect(computeResults(simple(at(7)), CU).results.map((x) => [x.from, x.to])).toEqual([[0, 1], [8, 9]]);
    // The run ends on its last sample above the cut-off: trailing waste is never reported.
    expect(computeResults(simple([0.5, 0.5, 0.1, 0.1]), CU).results.map((x) => [x.from, x.to])).toEqual([[0, 2]]);
    // /3d's intercept() is the run of these holding the most metal.
    const ints = simple(at(7, 0.5)).map((x) => ({ from: x.from_m, to: x.to_m, vals: x.values }));
    expect(intercept(ints, 'Cu', 0.2, 1, 1).broad).toMatchObject({ from: 0, len: 1 });
    expect(runs(samples(ints, 'Cu'), 0.2, 1).map((x) => x.metal)).toEqual([0.5, 0.5]);
  });

  it('never reports a composite averaging below the cut-off: it is split at its dilution', () => {
    // 0.5, 6 m of waste, 0.5: one run by the dilution rule, but it averages 0.125% at a 0.2% cut-off.
    const long = simple([0.5, 0, 0, 0, 0, 0, 0, 0.5]);
    expect(computeResults(long, CU).results.map((x) => [x.from, x.to, x.line])).toEqual([[0, 1, '1.0 m @ 0.50% Cu from 0.0 m'], [7, 8, '1.0 m @ 0.50% Cu from 7.0 m']]);
    // /3d's own intercept() is unchanged: its figures join them, as before.
    const ints = long.map((x) => ({ from: x.from_m, to: x.to_m, vals: x.values }));
    expect(intercept(ints, 'Cu', 0.2, 1, 1).broad).toMatchObject({ from: 0, len: 8, avg: 0.125 });
    // Split at the longest dilution first, keeping the parts that still meet the cut-off.
    const two = simple([0.5, 0, 0, 0.5, 0, 0, 0, 0, 0, 0.5]);
    expect(computeResults(two, CU).results.map((x) => [x.from, x.to, +x.grades.Cu.toFixed(6)])).toEqual([[0, 4, 0.25], [9, 10, 0.5]]);
    // Recursing where a part still falls short; the minimum length drops short parts.
    const deep = simple([0.3, 0, 0, 0, 0.3, 0, 0, 0, 0, 0.3]);
    expect(computeResults(deep, CU).results.map((x) => [x.from, x.to])).toEqual([[0, 1], [4, 5], [9, 10]]);
    expect(computeResults(deep, { ...CU, minLength: 2 }).results).toEqual([]);
    // Every reported interval and "incl." meets its cut-off.
    const r = computeResults(SPLIT, SPLIT_RECIPE).results;
    expect(r.map((x) => [x.from, x.to])).toEqual([[0, 1], [7, 13]]); // all 13 m would average 0.285% at a 0.3% cut-off
    expect(r[1].incl.map((x) => [x.from, x.to])).toEqual([[8, 9], [12, 13]]); // 1.1, 3 m at 0.3, 1.1 averages 0.62%: split
    r.forEach((x) => { expect(x.grades.Cu).toBeGreaterThanOrEqual(0.3); x.incl.forEach((y) => expect(y.grades.Cu).toBeGreaterThanOrEqual(1)); });
  });

  it('an unsampled gap ends an interval; overlapping samples count once', () => {
    const rows = [row('H', 0, 2, { Cu: 0.5 }), row('H', 2, 4, { Cu: 0.5 }), row('H', 14, 16, { Cu: 0.5 })];
    expect(computeResults(rows, { ...CU, maxDilution: 20 }).results.map((x) => [x.from, x.to, x.len])).toEqual([[0, 4, 4], [14, 16, 2]]);
    const over = [row('H', 0, 2, { Cu: 1 }), row('H', 1, 3, { Cu: 0.4 })];
    expect(computeResults(over, CU).results.map((x) => [x.from, x.to, x.len, +x.grades.Cu.toFixed(6)])).toEqual([[0, 3, 3, 0.8]]);
  });

  it('"incl." intervals lie inside, each at the higher cut-off, never the whole interval again', () => {
    const rows = simple([0.3, 1.5, 1.2, 0.3, 0.3, 2.0, 0.3]);
    const r = computeResults(rows, { ...CU, inclCutoff: 1, inclMinLength: 1, inclMaxDilution: 0 }).results;
    expect(r).toHaveLength(1);
    expect(r[0].incl.map((x) => [x.from, x.to, x.line])).toEqual([[1, 3, '2.0 m @ 1.35% Cu'], [5, 6, '1.0 m @ 2.00% Cu']]);
    expect(r[0].text).toBe('7.0 m @ 0.84% Cu from 0.0 m, incl. 2.0 m @ 1.35% Cu; incl. 1.0 m @ 2.00% Cu');
    // With dilution allowed they join into one "incl."; an "incl." the length of the interval is left out.
    expect(computeResults(rows, { ...CU, inclCutoff: 1, inclMinLength: 1, inclMaxDilution: 2 }).results[0].incl.map((x) => [x.from, x.to])).toEqual([[1, 6]]);
    expect(computeResults(simple([1.5, 1.2]), { ...CU, inclCutoff: 1, inclMinLength: 1 }).results[0].incl).toEqual([]);
  });

  it('lists holes in natural order, each by depth', () => {
    const rows = ['DDH-10', 'DDH-2', 'DDH-1'].flatMap((h) => [row(h, 10, 11, { Cu: 0.5 }), row(h, 0, 1, { Cu: 0.5 })]);
    expect(computeResults(rows, CU).results.map((x) => `${x.holeId}@${x.from}`)).toEqual(['DDH-1@0', 'DDH-1@10', 'DDH-2@0', 'DDH-2@10', 'DDH-10@0', 'DDH-10@10']);
    expect(['b-10', 'B-9', 'a'].sort(byHole)).toEqual(['a', 'B-9', 'b-10']);
  });
});

describe('below detection, units and missing values', () => {
  // The drill database stores "<0.01" as half the limit (by default) with bdl: { Cu: 0.01 }; "BDL" with no
  // limit as bdl: { Cu: true } and no value; a missing value has neither.
  const rows = [row('H', 0, 1, { Cu: 0.9 }), row('H', 1, 2, { Cu: 0.005 }, { bdl: { Cu: 0.01 } }), row('H', 2, 3, {}, { bdl: { Cu: true } }), row('H', 3, 4, { Cu: 0.9 })];
  it('a flagged sample is assayed (never a gap), valued by the recipe', () => {
    const at = (bdl) => computeResults(rows, { ...CU, maxDilution: 2, bdl }).results[0];
    expect(at('stored')).toMatchObject({ from: 0, to: 4, len: 4, bdl: 2 });
    expect(at('stored').grades.Cu).toBeCloseTo((0.9 + 0.005 + 0 + 0.9) / 4, 12);
    expect(at('zero').grades.Cu).toBeCloseTo(1.8 / 4, 12);
    expect(at('dl').grades.Cu).toBeCloseTo(1.81 / 4, 12);
    expect(at('half').grades.Cu).toBeCloseTo(1.805 / 4, 12);
  });
  it('a value missing and not flagged is unsampled, and ends the interval', () => {
    const gap = [row('H', 0, 1, { Cu: 0.9 }), row('H', 1, 2, { Au: 0.1 }), row('H', 2, 3, { Cu: 0.9 })];
    expect(computeResults(gap, { ...CU, maxDilution: 5 }).results.map((x) => [x.from, x.to])).toEqual([[0, 1], [2, 3]]);
    // A missing component of the equivalent gives no equivalent there (never read as zero), as in /3d.
    const eq = [row('H', 0, 2, { Cu: 0.5, Au: 0.2 }), row('H', 2, 4, { Cu: 0.5 }), row('H', 4, 6, { Cu: 0.5, Au: 0.2 })];
    const { holes } = holeIntervals(eq, RECIPE);
    expect(Number.isNaN(holes.get('H')[1].vals.CuEq)).toBe(true);
    expect(computeResults(eq, RECIPE).results.map((x) => [x.from, x.to])).toEqual([[0, 2], [4, 6]]);
  });
  it('converts a grade stored in another unit, and says what it cannot read', () => {
    const mixed = [row('H', 0, 2, { Cu: 4500 }, { units: { Cu: 'ppm' } }), row('H', 2, 4, { Cu: 0.45 }), row('H', 4, 6, { Cu: 0.45 }, { units: {} }), row('H', 6, 8, { Cu: 3 }, { units: { Cu: 'lb/t' } })];
    const out = computeResults(mixed, { ...CU, maxDilution: 0 });
    expect(out.results.map((x) => [x.from, x.to, +x.grades.Cu.toFixed(9)])).toEqual([[0, 6, 0.45]]);
    expect(out.problems).toEqual(['Some Cu assays have no unit; they are read as the recipe\'s unit.', 'Assays stored in a unit the recipe cannot convert are left out: Cu (lb/t).']);
  });
});

describe('rounding', () => {
  // /3d's callout grades as studio.js wrote them before they moved to shared/intercepts.js.
  const before = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2));
  const beforeText = (v, label) => { const unit = (label.match(/(%|g\/t|ppm|ppb)$/) || [''])[0], el = label.replace(/\s*(%|g\/t|ppm|ppb)$/, ''); return `${before(v)}${unit === '%' ? '%' : ' ' + unit} ${el}`; };
  it('writes grades exactly as /3d does', () => {
    let x = 7;
    for (let i = 0; i < 2000; i++) {
      x = (x * 16807) % 2147483647; const v = (x / 2147483647) * 10 ** ((i % 7) - 3);
      expect(fmtGrade(v)).toBe(before(v));
      expect(gradeText(v, 'CuEq %')).toBe(beforeText(v, 'CuEq %'));
      expect(gradeText(v, 'Au g/t')).toBe(beforeText(v, 'Au g/t'));
    }
    for (const v of [0, 0.005, 0.0099, 0.01, 0.125, 0.135, 1.005, 9.995, 10, 99.95, 100, 1234.5]) expect(fmtGrade(v)).toBe(before(v));
  });
  it('takes fixed decimals when the recipe sets them, for lengths and grades', () => {
    const r = computeResults(textbookHole(), { ...RECIPE, lengthDecimals: 0, gradeDecimals: { '*': 3, Au: 1 } }).results[0];
    expect(r.text).toBe('122 m @ 0.609% CuEq (0.450% Cu, 0.2 g/t Au) from 34 m, incl. 18 m @ 1.318% CuEq');
  });
  it('is the same module /3d loads', () => {
    expect(threeDIntercepts.intercept).toBe(intercept);
    expect(threeDIntercepts.gradeText).toBe(gradeText);
    expect(threeDEq.eqFactors).toBe(eqFactors);
  });
});

describe('the published results for /3d', () => {
  const { results, columns } = computeResults([...textbookHole('RC-24-001'), ...textbookHole('RC-24-002').map((x) => ({ ...x, from_m: x.from_m + 10, to_m: x.to_m + 10 }))], RECIPE);
  const SOURCE = 'Property results: Default v3';
  it('records in /3d\'s version 1 shape, the incl. under its parent', () => {
    const recs = toPublishedRecords(results, columns, SOURCE);
    expect(recs).toHaveLength(4);
    expect(recs[0]).toEqual({ version: 1, resultId: 'RC-24-001:1', holeId: 'RC-24-001', fromM: 34, toM: 156, publishedLengthText: '122.0', gradeText: '0.61', analyte: 'CuEq', unit: '%',
      parentResultId: null, approvedText: '122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m', releaseDate: null, sourceRef: SOURCE, approvalStatus: 'approved' });
    expect(recs[1]).toMatchObject({ resultId: 'RC-24-001:1.1', parentResultId: 'RC-24-001:1', fromM: 80, toM: 98, approvedText: '18.0 m @ 1.32% CuEq' });
  });
  it('read back by /3d as a "Published results" table, draws the table\'s exact wording at its depths', () => {
    const f = toPublishedFile(results, columns, SOURCE);
    expect(f).toMatchObject({ name: 'property-results.csv', role: 'published' });
    const data = Papa.parse(f.text.trim(), { skipEmptyLines: true }).data, header = data[0];
    expect(header).toEqual(PUBLISHED_HEADER);
    // As the page reads it: the core column matcher, then the release table's own columns.
    const cols = pubCols(header, matchCols(header));
    const { results: recs, problems } = readResults(header, data.slice(1), cols, f.name);
    expect(problems).toEqual([]);
    expect(recs).toEqual(toPublishedRecords(results, columns, SOURCE));
    const cards = pubCallouts(recs, [{ id: 'RC-24-001', len: 200 }, { id: 'RC-24-002', len: 210 }]);
    expect(cards.map((c) => c.key)).toEqual(['RC-24-001:1', 'RC-24-002:1']);
    cards.forEach((c, i) => {
      const lines = pubLines(c);
      expect(lines.l1 + lines.l1b).toBe(results[i].line);
      expect(`${lines.l1}${lines.l1b}, ${lines.l2}`).toBe(results[i].text);
      expect(c.ic.broad).toMatchObject({ from: results[i].from, len: results[i].to - results[i].from });
      expect(c.ic.incl).toMatchObject({ from: results[i].incl[0].from, len: 18 });
    });
    expect(headline(recs[0])).toEqual({ l1: results[0].line, l1b: '' });
  });
  it('round-trips intervals split at the cut-off with the same wording', () => {
    const split = computeResults(SPLIT, SPLIT_RECIPE);
    const f = toPublishedFile(split.results, split.columns, SOURCE);
    const data = Papa.parse(f.text.trim(), { skipEmptyLines: true }).data, header = data[0];
    const { results: recs, problems } = readResults(header, data.slice(1), pubCols(header, matchCols(header)), f.name);
    expect(problems).toEqual([]);
    const cards = pubCallouts(recs, [{ id: 'H-1', len: 13 }]);
    expect(cards.map((c) => { const l = pubLines(c); return l.l2 ? `${l.l1}${l.l1b}, ${l.l2}` : l.l1 + l.l1b; })).toEqual(split.results.map((x) => x.text));
    expect(split.results.map((x) => x.text)).toEqual(['1.0 m @ 0.30% Cu from 0.0 m', '6.0 m @ 0.57% Cu from 7.0 m, incl. 1.0 m @ 1.10% Cu; incl. 1.0 m @ 1.10% Cu']);
  });
});

describe('the portable HTML results table', () => {
  const out = computeResults(textbookHole(), RECIPE);
  const options = { propertyName: 'Example property', recipeName: 'Release', recipeVersion: 3, unsaved: false };
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

  it('preserves every canonical cell, incl. row and figure interval wording without recalculating', () => {
    const doc = parse(resultsTableDocument(out, RECIPE, options).html);
    const actual = [...doc.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent));
    expect(actual).toEqual(tableRows(out.results, out.columns).slice(1));
    expect(actual[0]).toEqual(['RC-24-001', '', '34.0', '156.0', '122.0', '0.61', '0.45', '0.21', out.results[0].line]);
    expect(actual[1][0]).toBe('RC-24-001');
    expect(actual[1][1]).toBe('incl.');
    const published = toPublishedRecords(out.results, out.columns, 'test');
    expect(actual.map((r) => r.at(-1))).toEqual(published.map((r, i) => `${i ? 'incl. ' : ''}${r.approvedText}`));
    expect([...doc.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Hole ID', 'Type', 'From (m)', 'To (m)', 'Length (m)', 'CuEq (%)', 'Cu (%)', 'Au (g/t)', 'Interval']);
  });

  it('carries the exact recipe notes, provenance and limitations into HTML and plain clipboard text', () => {
    const warnings = ['Incomplete assay load: only the first 200,000 assays are included.'];
    const limited = { ...out, problems: ['An interval was skipped.'] };
    const file = resultsTableDocument(limited, RECIPE, { ...options, warnings });
    const doc = parse(file.html);
    expect([...doc.querySelectorAll('li')].map((li) => li.textContent)).toEqual([...limited.problems, ...warnings, ...notes(RECIPE, out.eq)]);
    expect(doc.body.textContent).toContain('Saved recipe: Release, version 3. Calculated from current assays.');
    for (const note of [...limited.problems, ...warnings, ...notes(RECIPE, out.eq)]) expect(file.text).toContain(note);
    expect(file.text).toContain('RC-24-001\tincl.\t80.0\t98.0\t18.0\t1.32');
    expect(file.text).toContain('Saved recipe: Release, version 3.');
  });

  it('does not label unsaved edits as the saved recipe version', () => {
    const file = resultsTableDocument(out, RECIPE, { ...options, unsaved: true });
    expect(parse(file.html).body.textContent).toContain('Unsaved recipe: Release. Calculated from current assays.');
    expect(file.text).not.toContain('version 3');
    expect(file.html).not.toContain('Saved recipe:');
    expect(resultsTableDocument(out, RECIPE).text).toContain('Unsaved recipe: Default.');
  });

  it('escapes user content in metadata, cells, interval wording, warnings and recipe notes', () => {
    const attack = '"><img src=x onerror="alert(1)"><script>alert(2)</script>&\'';
    const recipe = { ...RECIPE, trueWidth: attack };
    const malicious = computeResults(textbookHole(attack), recipe);
    // Include a literal markup string in a formatted cell as an additional boundary check.
    malicious.results[0].cells.Cu = attack;
    malicious.results[0].line = attack;
    const file = resultsTableDocument(malicious, recipe, { propertyName: attack, recipeName: attack, warnings: [attack] });
    const doc = parse(file.html);
    expect(doc.querySelector('script,img,iframe,link,object')).toBeNull();
    expect(doc.querySelector('[onerror]')).toBeNull();
    expect(doc.title).toBe(`${attack} — drill results`);
    expect(doc.querySelector('tbody td').textContent).toBe(attack);
    expect([...doc.querySelectorAll('li')].at(-1).textContent).toBe(attack);
    expect(file.text).toContain(attack); // plain text is not interpreted as HTML
  });
});

describe('the recipe', () => {
  it('starts from the property\'s elements, with /3d\'s default prices', () => {
    const r = defaultRecipe(['Ag', 'Au', 'Cu', 'S'], { Cu: '%', Au: 'g/t', Ag: 'ppm' });
    expect(r).toMatchObject({ primary: 'Cu', equivalent: true, cutoff: 0.2, maxDilution: 6, bdl: 'stored' });
    expect(r.elements).toEqual([{ name: 'Cu', unit: '%', price: 4.5, recovery: 100 }, { name: 'Ag', unit: 'ppm', price: 35, recovery: 100 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 100 }]);
    expect(checkRecipe(r)).toEqual([]);
    expect(defaultRecipe(['Au'], {})).toMatchObject({ primary: 'Au', equivalent: false, elements: [{ name: 'Au', unit: 'g/t' }], cutoff: 0.3 });
    expect(eqSetup(defaultRecipe(['Au'], {}))).toBe(null);
  });
  it('says what is wrong in words, and computes nothing from a bad recipe', () => {
    const bad = { ...RECIPE, primary: 'Mo', cutoff: -1, elements: [{ name: 'Cu', unit: 'lb', price: 0, recovery: 120 }, { name: 'Cu', unit: '%' }] };
    expect(checkRecipe(bad)).toEqual([
      'An element is listed twice.', 'Choose the primary element from the elements listed.', 'Cu: choose its unit (%, g/t, ppm or ppb).',
      'Cu: the metal equivalent needs a price above zero.', 'Cu: recovery must be above 0 and at most 100%.', 'Cu: the metal equivalent needs a price above zero.',
      'Cu: recovery must be above 0 and at most 100%.', 'The cut-off must be a number, 0 or more.',
    ]);
    expect(checkRecipe({ ...RECIPE, inclCutoff: 0.1 })).toEqual(['The "incl." cut-off must be above the cut-off.']);
    expect(checkRecipe({ ...RECIPE, lengthDecimals: 1.5 })).toEqual(['Decimals must be whole numbers from 0 to 4.']);
    expect(computeResults(textbookHole(), bad)).toMatchObject({ results: [], problems: checkRecipe(bad) });
  });
});

describe('the elements stored in the assays', () => {
  it('lists every element, flagged ones too, with its most common unit', async () => {
    const { storedElements } = await import('../src/utils/drillResultsDb.js');
    const rows = [row('H', 0, 1, { Cu: 0.4 }), row('H', 1, 2, { Cu: 4000 }, { units: { Cu: 'ppm' } }), row('H', 2, 3, { Cu: 0.3 }), row('H', 3, 4, {}, { bdl: { Ag: 0.5 }, units: { Ag: 'ppm' } })];
    expect(storedElements(rows)).toEqual({ elements: ['Ag', 'Cu'], units: { Ag: 'ppm', Cu: '%' } });
  });
});

describe('edge cases', () => {
  it('samples exactly at the cut-off meet it, despite floating-point sums', () => {
    // Ten 1 m samples at 0.3% average 0.29999999999999993 at a 0.3% cut-off.
    const flat = simple(Array(10).fill(0.3));
    expect(flat.reduce((t, x) => t + x.values.Cu, 0) / 10).toBeLessThan(0.3);
    expect(computeResults(flat, { ...CU, cutoff: 0.3 }).results.map((x) => [x.from, x.to, x.line])).toEqual([[0, 10, '10.0 m @ 0.30% Cu from 0.0 m']]);
    const r = computeResults(flat, { ...CU, cutoff: 0.1, inclCutoff: 0.3, inclMinLength: 1 }).results;
    expect(r[0].incl).toEqual([]); // the whole interval again, so no "incl."
  });

  it('averages each component over the samples and lengths the equivalent used', () => {
    // 0–1 m has Cu only (no equivalent there); 0–2 m has both. The interval is the 0–2 m sample alone.
    const rows = [row('H', 0, 1, { Cu: 10 }), row('H', 0, 2, { Cu: 0.5, Au: 0.2 })];
    const r = computeResults(rows, RECIPE).results;
    expect(r.map((x) => [x.from, x.to, x.len])).toEqual([[0, 2, 2]]);
    expect(r[0].grades.Cu).toBe(0.5);
    expect(r[0].grades.Au).toBe(0.2);
    expect(r[0].grades.CuEq).toBeCloseTo(0.5 + eqSetup(RECIPE).factors[0].factor * 0.2, 12);
    expect(r[0].line).toBe('2.0 m @ 0.65% CuEq (0.50% Cu, 0.20 g/t Au) from 0.0 m');
    // A trimmed overlap counts its trimmed length for every component.
    const over = [row('H', 0, 2, { Cu: 1, Au: 0.4 }), row('H', 1, 3, { Cu: 0.4, Au: 0.1 })];
    const o = computeResults(over, RECIPE).results[0];
    expect([o.from, o.to, o.len]).toEqual([0, 3, 3]);
    expect(o.grades.Cu).toBeCloseTo((2 * 1 + 1 * 0.4) / 3, 12);
    expect(o.grades.Au).toBeCloseTo((2 * 0.4 + 1 * 0.1) / 3, 12);
  });
});
