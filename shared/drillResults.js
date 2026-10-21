// A property's drill results (pure): one recipe (elements with prices and recoveries, the metal equivalent,
// cut-offs, dilution and rounding) turns the drill database's current assays into the intercepts a news
// release reports, the text it prints, and the published-results table Exploration Maps 3D draws callouts
// from. The compositing is /3d's own (shared/intercepts.js runs and avgOver, sampled metres only) and the
// metal equivalent its formula (shared/metalEq.js), so the table and a figure cannot disagree.
//
// Recipe (stored in drill_result_recipes.recipe, supabase/migrations/20261028100000_drill_intercepts.sql):
//   { version: 1, primary: 'Cu', equivalent: true,
//     elements: [{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 80 }],
//     cutoff: 0.2, minLength: 2, maxDilution: 6,            // on the equivalent (or the primary element without one)
//     inclCutoff: 1, inclMinLength: 2, inclMaxDilution: 2,  // "incl." intervals inside each one; inclCutoff null: none
//     bdl: 'stored' | 'half' | 'zero' | 'dl',               // below-detection samples (the drill database's bdl flags)
//     lengthDecimals: 1, gradeDecimals: { CuEq: 2, '*': 2 }, // per column, '*' for the rest; none: as /3d writes grades
//     trueWidth: 'True widths are estimated at 70–90% of the core lengths.' }
// Element names are the drill database's ("Cu", "Au"); prices are US$/lb, or US$/oz for Au, Ag, Pt and Pd
// (priceUnit); recoveries in %. A stored grade in another unit (Cu in ppm) is converted to the recipe's.

import { samples, runs, avgOver, gradeText, fmtGrade, TOL } from './intercepts.js';
import { eqFactors, eqFormula, eqValue, priceUnit, defaultUnit, METAL_DEFAULTS } from './metalEq.js';

export const RECIPE_VERSION = 1;
export const UNITS = ['%', 'g/t', 'ppm', 'ppb'];
export const BDL_RULES = [
  { value: 'stored', label: 'As stored at import' },
  { value: 'half', label: 'Half the detection limit' },
  { value: 'zero', label: 'Zero' },
  { value: 'dl', label: 'The detection limit' },
];
const GPT = { '%': 10000, 'g/t': 1, ppm: 1, ppb: 0.001 };
const num = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? d : +v);

/** Hole IDs in natural order (DDH-2 before DDH-10). */
export const byHole = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });

/** A first recipe for a property's elements (units: element → the unit most of its assays are stored in). */
export function defaultRecipe(elements = [], units = {}) {
  const priced = elements.filter((e) => METAL_DEFAULTS[e] !== undefined);
  const primary = ['Cu', 'Au', 'Zn', 'Mo', 'Ag'].find((e) => elements.includes(e)) || elements[0] || 'Cu';
  const els = [primary, ...priced.filter((e) => e !== primary)].map((name) => ({ name, unit: units[name] || defaultUnit(name), price: METAL_DEFAULTS[name] ?? null, recovery: 100 }));
  const gpt = els[0].unit !== '%';
  return { version: RECIPE_VERSION, primary, equivalent: els.length > 1, elements: els, cutoff: gpt ? 0.3 : 0.2, minLength: 2, maxDilution: 6,
    inclCutoff: gpt ? 1.5 : 1, inclMinLength: 2, inclMaxDilution: 2, bdl: 'stored', lengthDecimals: 1, gradeDecimals: {}, trueWidth: '' };
}

/** The equivalent's name ("CuEq"), or null when the recipe reports the primary element alone. */
export const eqName = (r) => (r.equivalent && r.elements.length > 1 ? `${r.primary}Eq` : null);
const primaryEl = (r) => r.elements.find((e) => e.name === r.primary);

/** What is wrong with a recipe, in words (empty when it can be used and saved). */
export function checkRecipe(r) {
  const p = [], names = (r.elements || []).map((e) => String(e.name || '').trim());
  if (!names.length) p.push('Add at least one element.');
  if (names.some((n) => !n)) p.push('Every element needs a name.');
  if (new Set(names).size !== names.length) p.push('An element is listed twice.');
  if (!names.includes(r.primary)) p.push('Choose the primary element from the elements listed.');
  (r.elements || []).forEach((e) => { if (!UNITS.includes(e.unit)) p.push(`${e.name || 'An element'}: choose its unit (%, g/t, ppm or ppb).`); });
  if (eqName(r)) {
    (r.elements || []).forEach((e) => {
      if (!(num(e.price, 0) > 0)) p.push(`${e.name}: the metal equivalent needs a price above zero.`);
      if (!(num(e.recovery, 0) > 0 && num(e.recovery, 0) <= 100)) p.push(`${e.name}: recovery must be above 0 and at most 100%.`);
    });
  }
  for (const [k, label] of [['cutoff', 'The cut-off'], ['minLength', 'The minimum length'], ['maxDilution', 'The internal dilution']]) {
    if (!(num(r[k], -1) >= 0)) p.push(`${label} must be a number, 0 or more.`);
  }
  if (r.inclCutoff !== null && r.inclCutoff !== undefined && r.inclCutoff !== '') {
    if (!(num(r.inclCutoff, -1) > num(r.cutoff, 0))) p.push('The "incl." cut-off must be above the cut-off.');
    if (!(num(r.inclMinLength, -1) >= 0) || !(num(r.inclMaxDilution, -1) >= 0)) p.push('The "incl." minimum length and dilution must be numbers, 0 or more.');
  }
  const dp = (v) => v === undefined || v === null || v === '' || (Number.isInteger(+v) && +v >= 0 && +v <= 4);
  if (!dp(r.lengthDecimals) || Object.values(r.gradeDecimals || {}).some((v) => !dp(v))) p.push('Decimals must be whole numbers from 0 to 4.');
  return p;
}

/** The metal equivalent: { name, unit, factors, formula, note } (null without one). Throws on a bad price. */
export function eqSetup(r) {
  const name = eqName(r);
  if (!name) return null;
  const base = primaryEl(r), others = r.elements.filter((e) => e !== base);
  const factors = eqFactors({ metal: base.name, unit: base.unit, price: num(base.price, 0), recovery: num(base.recovery, 0) },
    others.map((e) => ({ metal: e.name, unit: e.unit, price: num(e.price, 0), recovery: num(e.recovery, 0) })));
  const money = (v) => `US$${v.toLocaleString('en-US', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const formula = eqFormula(base.name, factors);
  const ordered = [base, ...others];
  const note = `${formula}, with ${name} and ${base.name} in ${base.unit}${others.map((e) => `, ${e.name} in ${e.unit}`).join('')}. Prices ${ordered.map((e) => `${e.name} ${money(num(e.price, 0))}/${priceUnit(e.name)}`).join(', ')}; recoveries ${ordered.map((e) => `${e.name} ${num(e.recovery, 0)}%`).join(', ')}.`;
  return { name, unit: base.unit, factors, formula, note };
}

/**
 * The drill database's current assay rows ({ hole_id, from_m, to_m, values, bdl, units }) as /3d's intervals,
 * per hole: { holes: Map(hole → [{ from, to, vals, bdl }]), problems }. Each element in the recipe's unit;
 * a sample below detection (bdl flagged) by the recipe's rule, never as unsampled; a value missing and not
 * flagged is unsampled. vals[col]: the column the cut-off applies to (the equivalent, or the primary).
 */
export function holeIntervals(rows, r, eq = eqSetup(r)) {
  const holes = new Map(), noUnit = new Set(), badUnit = new Set();
  const col = eq ? eq.name : r.primary;
  for (const row of rows || []) {
    const vals = {}; let bdl = false;
    for (const e of r.elements) {
      const flag = row.bdl?.[e.name], stored = row.values?.[e.name];
      let v = Number.isFinite(stored) ? stored : NaN;
      if (flag !== undefined && flag !== null && flag !== false) {
        bdl = true;
        const dl = typeof flag === 'number' ? flag : 0;
        v = r.bdl === 'half' ? dl / 2 : r.bdl === 'zero' ? 0 : r.bdl === 'dl' ? dl : Number.isFinite(stored) ? stored : 0;
      }
      const u = row.units?.[e.name];
      if (!u && Number.isFinite(v)) noUnit.add(e.name);
      else if (u && u !== e.unit && Number.isFinite(v)) {
        if (GPT[u] === undefined) { badUnit.add(`${e.name} (${u})`); v = NaN; } else v = (v * GPT[u]) / GPT[e.unit];
      }
      vals[e.name] = v;
    }
    if (eq) vals[col] = eqValue(vals[r.primary], eq.factors.map((f) => vals[f.metal]), eq.factors);
    if (!holes.has(row.hole_id)) holes.set(row.hole_id, []);
    holes.get(row.hole_id).push({ from: row.from_m, to: row.to_m, vals, bdl });
  }
  holes.forEach((l) => l.sort((a, b) => a.from - b.from));
  const problems = [];
  if (noUnit.size) problems.push(`Some ${[...noUnit].join(', ')} assays have no unit; they are read as the recipe's unit.`);
  if (badUnit.size) problems.push(`Assays stored in a unit the recipe cannot convert are left out: ${[...badUnit].join(', ')}.`);
  return { holes, col, problems };
}

const label = (name, unit) => `${name} ${unit}`;

/**
 * The intercepts: per hole (natural order) and depth, every composite at the cut-off at least the minimum
 * length (internal dilution up to maxDilution m; a gap ends one), each with its "incl." composites at the
 * "incl." cut-off inside it (not the whole interval again). Grades are length-weighted over sampled metres.
 * Every number is rounded once here, and the text, the table, the CSV and the published results all use
 * those strings.
 * line: the interval in words ("122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m"; an "incl." one without its
 * components and depth, as releases print it); text: the line with its "incl." lines, as /3d's callout reads.
 * → { results: [{ id, holeId, from, to, len, grades, bdl, cells, line, text, incl: [same, with parentId] }], columns, eq, problems }
 */
export function computeResults(rows, r) {
  let eq = null; const problems = checkRecipe(r);
  if (problems.length) return { results: [], columns: [], eq: null, problems };
  try { eq = eqSetup(r); } catch (e) { return { results: [], columns: [], eq: null, problems: [e.message] }; }
  const { holes, col, problems: unitProblems } = holeIntervals(rows, r, eq);
  problems.push(...unitProblems);
  const lenDp = num(r.lengthDecimals, 1), gdp = (k) => { const v = r.gradeDecimals?.[k] ?? r.gradeDecimals?.['*']; return v === undefined || v === null || v === '' ? undefined : +v; };
  const main = { key: col, unit: eq ? eq.unit : primaryEl(r).unit };
  const others = eq ? r.elements : r.elements.filter((e) => e.name !== r.primary);
  const columns = [main, ...others.map((e) => ({ key: e.name, unit: e.unit }))];
  const g = (c, v) => (Number.isFinite(v) ? gradeText(v, label(c.key, c.unit), gdp(c.key)) : null);
  const cellOf = (c, v) => (Number.isFinite(v) ? fmtGrade(v, gdp(c.key)) : '');
  const L = (v) => v.toFixed(lenDp);
  const build = (ints, run, len, metal, id, holeId, parentId) => {
    const from = run[0].from, to = run[run.length - 1].to;
    const grades = { [col]: metal / run.reduce((s, x) => s + (x.to - x.from), 0) };
    for (const c of columns.slice(1)) grades[c.key] = avgOver(ints, c.key, from, to);
    const bdl = ints.filter((it) => it.bdl && it.from < to - TOL && it.to > from + TOL).length;
    const comps = columns.slice(1).map((c) => g(c, grades[c.key])).filter(Boolean);
    const head = `${L(len)} m @ ${g(main, grades[col])}`;
    const line = parentId ? head : `${head}${comps.length ? (eq ? ` (${comps.join(', ')})` : `, ${comps.join(', ')}`) : ''} from ${L(from)} m`;
    const cells = { from: L(from), to: L(to), len: L(len), ...Object.fromEntries(columns.map((c) => [c.key, cellOf(c, grades[c.key])])) };
    return { id, holeId, from, to, len, grades, bdl, cells, line, ...(parentId ? { parentId } : {}) };
  };
  const results = [];
  const inclOn = r.inclCutoff !== null && r.inclCutoff !== undefined && r.inclCutoff !== '';
  [...holes.keys()].sort(byHole).forEach((holeId) => {
    const ints = holes.get(holeId);
    runs(samples(ints, col), num(r.cutoff, 0), num(r.minLength, 0), true, num(r.maxDilution, 0)).forEach((x, i) => {
      const id = `${holeId}:${i + 1}`, res = build(ints, x.run, x.L, x.metal, id, holeId);
      res.incl = !inclOn ? [] : runs(x.run, num(r.inclCutoff, 0), num(r.inclMinLength, 0), true, num(r.inclMaxDilution, 0))
        .filter((y) => !(Math.abs(y.run[0].from - res.from) <= TOL && Math.abs(y.run[y.run.length - 1].to - res.to) <= TOL))
        .map((y, j) => build(ints, y.run, y.L, y.metal, `${id}.${j + 1}`, holeId, id));
      res.text = [res.line, ...(res.incl.length ? [res.incl.map((y) => `incl. ${y.line}`).join('; ')] : [])].join(', ');
      results.push(res);
    });
  });
  return { results, columns, eq, problems };
}


/** The notes under a release table: the formula, prices and recoveries, the compositing rule, true widths. */
export function notes(r, eq = eqSetup(r)) {
  const c = eq ? eq.name : r.primary, u = eq ? eq.unit : primaryEl(r).unit, n = (v) => +num(v, 0).toFixed(4), at = (v) => `${n(v)}${u === '%' ? '%' : ` ${u}`} ${c}`;
  const out = [];
  if (eq) out.push(eq.note);
  out.push(`Composited at ${at(r.cutoff)} over at least ${n(r.minLength)} m, with up to ${n(r.maxDilution)} m of consecutive internal dilution; lengths are sampled core lengths and grades are length-weighted.`
    + (r.inclCutoff !== null && r.inclCutoff !== undefined && r.inclCutoff !== '' ? ` "incl." intervals at ${at(r.inclCutoff)} over at least ${n(r.inclMinLength)} m, with up to ${n(r.inclMaxDilution)} m of internal dilution.` : ''));
  out.push(`Below-detection assays: ${BDL_RULES.find((b) => b.value === (r.bdl || 'stored'))?.label.toLowerCase()}.`);
  if (String(r.trueWidth || '').trim()) out.push(String(r.trueWidth).trim());
  return out;
}

/** Plain text for a release: one line per intercept ("R-1: 122.0 m @ … from 34.0 m, incl. …"), then the notes. */
export function resultsText(results, r) {
  return [...results.map((x) => `${x.holeId}: ${x.text}`), '', ...notes(r)].join('\n');
}

/** The results table as rows of strings: header, then each intercept followed by its "incl." rows. */
export function tableRows(results, columns) {
  const head = ['Hole ID', '', 'From (m)', 'To (m)', 'Length (m)', ...columns.map((c) => `${c.key} (${c.unit})`), 'Interval'];
  const row = (x, kind) => [x.holeId, kind, x.cells.from, x.cells.to, x.cells.len, ...columns.map((c) => x.cells[c.key]), kind ? `incl. ${x.line}` : x.line];
  return [head, ...results.flatMap((x) => [row(x, ''), ...x.incl.map((y) => row(y, 'incl.'))])];
}
const quote = (t) => (/[",\r\n]|^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
export const toTsv = (rows) => rows.map((r) => r.map((c) => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
export const toCsv = (rows) => `${rows.map((r) => r.map((c) => quote(String(c))).join(',')).join('\r\n')}\r\n`;

/**
 * The results as /3d's published-results records (src/three-d/published-results.js, version 1): one per
 * intercept and one per "incl." (its parentResultId the intercept), the approved text the line printed above,
 * so a figure in "published" callout mode shows exactly the table's wording at the table's depths.
 * source: where they came from ("Property results: Default v3"); only a saved recipe's results are exported.
 */
export function toPublishedRecords(results, columns, source) {
  const main = columns[0];
  const rec = (x) => ({ version: 1, resultId: x.id, holeId: x.holeId, fromM: x.from, toM: x.to, publishedLengthText: x.cells.len, gradeText: x.cells[main.key], analyte: main.key, unit: main.unit,
    parentResultId: x.parentId || null, approvedText: x.line, releaseDate: null, sourceRef: source || null, approvalStatus: 'approved' });
  return results.flatMap((x) => [rec(x), ...x.incl.map(rec)]);
}
export const PUBLISHED_HEADER = ['Result ID', 'Hole ID', 'From', 'To', 'Published length', 'Grade', 'Analyte', 'Unit', 'Parent result', 'Approved text', 'Release date', 'Source', 'Approval status'];
/** The same as the release table /3d reads ("Published results" role): { name, text, role }. */
export function toPublishedFile(results, columns, source, name = 'property-results.csv') {
  const rows = toPublishedRecords(results, columns, source).map((p) => [p.resultId, p.holeId, String(p.fromM), String(p.toM), p.publishedLengthText, p.gradeText, p.analyte, p.unit,
    p.parentResultId || '', p.approvedText, p.releaseDate || '', p.sourceRef || '', p.approvalStatus]);
  return { name, text: toCsv([PUBLISHED_HEADER, ...rows]), role: 'published' };
}
