// Property drill database: reading a CSV, mapping its columns, checking it,
// and a thin client over supabase/migrations/20261027100000_drill_database.sql
// (dry run, commit, roll back, summary, column templates).
//
// The browser turns a file into canonical rows (hole_id, x, y, ... /
// from_m, to_m, values, bdl, units) and checks them first, with the file's own
// line numbers; drill_import_batch checks them again, returns the diff, and
// commits atomically. Column detection is the 3D maker's (src/three-d/roles.js),
// so a file reads the same way in both places.
//
// CSV and Excel feed the same string-table contract; the Excel adapter is lazy.

import { matchCols, roleOf, refineRole } from '../three-d/roles.js';

export const MAX_ROWS = 20000;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export const KINDS = [
  { value: 'collars', label: 'Collars' },
  { value: 'surveys', label: 'Downhole surveys' },
  { value: 'assays', label: 'Assays' },
  { value: 'lithology', label: 'Lithology' },
  { value: 'alteration', label: 'Alteration' },
  { value: 'structure', label: 'Structure' },
];
export const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label || k;

// Fields per kind. `from` is the roles.js column key that fills it.
export const FIELDS = {
  collars: [
    { key: 'hole_id', label: 'Hole ID', required: true, from: 'hole' },
    { key: 'x', label: 'Easting / X', required: true, from: 'east' },
    { key: 'y', label: 'Northing / Y', required: true, from: 'north' },
    { key: 'z', label: 'Elevation / Z', from: 'elev' },
    { key: 'azimuth', label: 'Azimuth', from: 'az' },
    { key: 'dip', label: 'Dip', from: 'dip' },
    { key: 'depth', label: 'Depth', from: 'depth' },
    { key: 'status', label: 'Status', re: /^(status|hole_status|drill_status)$/ },
    { key: 'planned', label: 'Planned', re: /^(planned|is_planned|proposed)$/ },
  ],
  surveys: [
    { key: 'hole_id', label: 'Hole ID', required: true, from: 'hole' },
    { key: 'depth_m', label: 'Depth', required: true, from: 'depth' },
    { key: 'azimuth', label: 'Azimuth', from: 'az' },
    { key: 'dip', label: 'Dip', from: 'dip' },
  ],
  assays: [
    { key: 'hole_id', label: 'Hole ID', required: true, from: 'hole' },
    { key: 'from_m', label: 'From', required: true, from: 'from' },
    { key: 'to_m', label: 'To', required: true, from: 'to' },
    { key: 'sample_id', label: 'Sample ID', re: /^(sample|sample_id|sampleid|sample_no|sample_number|samp_id|sample_num)$/ },
  ],
  lithology: [
    { key: 'hole_id', label: 'Hole ID', required: true, from: 'hole' },
    { key: 'from_m', label: 'From', required: true, from: 'from' },
    { key: 'to_m', label: 'To', required: true, from: 'to' },
    { key: 'code', label: 'Code', from: 'code' },
    { key: 'description', label: 'Description', from: 'desc' },
  ],
  alteration: [
    { key: 'hole_id', label: 'Hole ID', required: true, from: 'hole' },
    { key: 'from_m', label: 'From', required: true, from: 'from' },
    { key: 'to_m', label: 'To', required: true, from: 'to' },
    { key: 'code', label: 'Code', re: /^(alteration|alteration_code|alteration_type|alt_code|code)$/ },
    { key: 'description', label: 'Description', re: /^(alteration_description|alteration_desc|alt_description|alt_desc|description|desc)$/ },
    { key: 'intensity', label: 'Intensity (text)', re: /^(alteration_intensity|alt_intensity|intensity)$/ },
  ],
  structure: [
    { key: 'hole_id', label: 'Hole ID', required: true, from: 'hole' },
    { key: 'depth_m', label: 'Depth', required: true, from: 'depth' },
    { key: 'type', label: 'Type (text)', re: /^(structure|structure_type|struct|struct_type|type|feature|feature_type)$/ },
    { key: 'alpha', label: 'Alpha', re: /^(alpha|alpha_angle|alpha_deg|alpha_core_axis)$/ },
    { key: 'beta', label: 'Beta', re: /^(beta|beta_angle|beta_deg)$/ },
    { key: 'dip', label: 'Dip', re: /^(dip|true_dip|dip_deg|structure_dip|struct_dip)$/ },
    { key: 'dip_direction', label: 'Dip direction', re: /^(dip_direction|dipdirection|dip_dir|dipdir|dip_azimuth|dip_az|dd|azimuth|azi|az)$/ },
    { key: 'description', label: 'Description', re: /^(description|desc|comments?|notes?|remarks?)$/ },
  ],
};
const NUMERIC = new Set(['x', 'y', 'z', 'azimuth', 'dip', 'depth', 'depth_m', 'from_m', 'to_m', 'alpha', 'beta', 'dip_direction']);
const TEXT_MAX = { hole_id: 60, status: 40, sample_id: 60, code: 60, description: 500, intensity: 60, type: 60 };

export const BDL_MODES = [
  { value: 'half', label: 'Half the detection limit' },
  { value: 'dl', label: 'The detection limit' },
  { value: 'zero', label: 'Zero' },
  { value: 'null', label: 'No value (flag only)' },
];

const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Reads CSV / delimited text into { header, rows, lines } (rows of strings;
 * lines[i] is the file line row i starts on, past blank lines and quoted
 * values that span lines).
 *
 * A file whose structure is broken is refused, naming the line, rather than
 * read in part: an unclosed quote would swallow every row after it into one
 * value, and a row with more or fewer values than the header has its values
 * under the wrong columns. Extra empty cells at the end of a row (as
 * spreadsheets leave them) are the only tolerance.
 */
export async function parseCsv(text) {
  const { default: Papa } = await import('papaparse');
  const src = String(text).replace(/^\uFEFF/, '');
  // File line of a character position, counted forward as rows arrive.
  let at = 0, line = 1;
  const lineOf = (pos) => { for (; at < pos; at++) if (src[at] === '\n') line++; return line; };
  const data = [], lines = [], problems = [];
  let start = 0;
  Papa.parse(src, {
    skipEmptyLines: 'greedy',
    step: (r) => {
      while (src[start] === '\n' || src[start] === '\r') start++;
      const first = lineOf(start);
      for (const e of r.errors || []) {
        const where = Number.isInteger(e.index) ? lineOf(e.index) : first;
        if (e.code === 'MissingQuotes') problems.push(`Line ${where}: a quoted value starts here and is never closed, so every row after it would be read as part of it. Close the quote (") or remove it.`);
        else if (e.code === 'InvalidQuotes') problems.push(`Line ${where}: a quoted value is not closed properly (text after the closing quote). Fix the quotes on that line.`);
        else if (e.code === 'UndetectableDelimiter') problems.push('Could not tell how the columns are separated. Save the file as CSV with commas, tabs or semicolons between columns.');
        else problems.push(`Line ${where}: ${e.message}.`);
      }
      data.push((r.data || []).map((v) => (v == null ? '' : String(v))));
      lines.push(first);
      start = r.meta.cursor;
    },
  });
  if (problems.length) throw new Error(problems[0] + (problems.length > 1 ? ` (${problems.length - 1} more problem${problems.length > 2 ? 's' : ''} in the file.)` : ''));
  const header = (data.shift() || []).map((h) => h.trim());
  lines.shift();
  const bad = [];
  const rows = data.map((r, i) => {
    if (r.length > header.length && r.slice(header.length).every((v) => !v.trim())) return r.slice(0, header.length);
    if (r.length !== header.length) bad.push(`line ${lines[i]} has ${r.length} value${r.length === 1 ? '' : 's'}`);
    return r;
  });
  if (bad.length) {
    throw new Error(`The header has ${header.length} columns but ${bad[0]}${bad.length > 1 ? ` (and ${bad.length - 1} more row${bad.length > 2 ? 's' : ''} do not match)` : ''}. Check that line for a stray comma or quote; nothing was imported.`);
  }
  return { header, rows, lines };
}

// ── Detection ──────────────────────────────────────────────────────────────
const ROLE_KIND = { collar: 'collars', survey: 'surveys', assay: 'assays', litho: 'lithology' };

/** The kind of drill data a table holds, by the 3D maker's rules (null when unclear). */
export function detectKind(header, rows, name = '') {
  const entry = { header, rows, cols: matchCols(header) };
  // Only explicit alteration signals suggest the new log. A generic Code or
  // Intensity column does not reclassify legacy lithology/assay files.
  if (entry.cols.hole !== undefined && entry.cols.from !== undefined && entry.cols.to !== undefined
    && (header.some(h => /^(alteration(?:_code|_type|_description|_desc|_intensity)?|alt_(?:code|description|desc|intensity))$/.test(norm(h)))
      || /(?:^|[^a-z])alteration(?:[^a-z]|$)/i.test(name))) return 'alteration';
  // Point structures: hole and depth with core angles, a dip direction or a structure column.
  if (entry.cols.hole !== undefined && entry.cols.depth !== undefined && entry.cols.from === undefined
    && (header.some(h => /^(alpha|beta|dip_?dir(ection)?|structure(_type)?|struct(_type)?)$/.test(norm(h))) || /struct/i.test(name))) return 'structure';
  const kind = ROLE_KIND[refineRole(entry, roleOf(entry.cols, name), name)];
  if (kind) return kind;
  const n = String(name).toLowerCase();
  return /collar/.test(n) ? 'collars' : /survey/.test(n) ? 'surveys' : /assay/.test(n) ? 'assays' : /lith|geol|log/.test(n) ? 'lithology' : null;
}

const UNIT_WORDS = [[/^(%|pct|percent|wt_?%|wt_?pct)$/, '%'], [/^ppm$/, 'ppm'], [/^ppb$/, 'ppb'], [/^(g_?t|gpt|g\/t|gt)$/, 'g/t'], [/^(oz_?t|opt|oz\/t)$/, 'oz/t']];
const unitWord = (w) => (UNIT_WORDS.find(([re]) => re.test(w)) || [])[1] || null;
const NOT_ELEMENT = /^(weight|wt|wt_kg|weight_kg|recovery|rec|rqd|length|interval|width|batch|certificate|cert|job|lab|lab_id|qc|qaqc|type|sample_type|density|sg|year|date)$/;

/** "Cu_pct" → { name: 'Cu', unit: '%' }; "Au (g/t)" → Au, g/t; "Ag" → Ag, null. */
export function parseElementHeader(h) {
  const s = String(h).trim();
  const m = s.match(/^(.*?)[\s_-]*[([]\s*([^)\]]+)\s*[)\]]$/);
  if (m && unitWord(m[2].toLowerCase().replace(/\s+/g, ''))) return { name: m[1].trim() || s, unit: unitWord(m[2].toLowerCase().replace(/\s+/g, '')) };
  if (/%$/.test(s)) return { name: s.replace(/[\s_-]*%$/, '') || s, unit: '%' };
  const parts = s.split(/[\s_]+/);
  if (parts.length > 1) {
    const u = unitWord(parts[parts.length - 1].toLowerCase());
    if (u) return { name: parts.slice(0, -1).join('_'), unit: u };
  }
  return { name: s, unit: null };
}

const cell = (v) => String(v ?? '').trim();
const looksNumeric = (v) => /^[<>]?\s*-?\d*\.?\d+(e[-+]?\d+)?$/i.test(cell(v)) || BDL_WORDS.test(cell(v));
// Every row is read, not a sample: a column blank for its first few hundred
// rows (an element assayed only in the last batch) is still found.
const share = (rows, i, test) => {
  let n = 0, tot = 0;
  for (const r of rows) { const v = cell(r[i]); if (!v || MISSING.test(v)) continue; tot++; if (test(v)) n++; }
  return tot ? n / tot : 0;
};

/**
 * A first mapping for a table of `kind`: { columns: { field: header }, elements,
 * bdl, crs }. Columns are kept by header name, so a template fits the next file.
 */
export function autoMapping(kind, header, rows, { name = '', crs = null, decimalComma = false } = {}) {
  const entry = { header, rows, cols: matchCols(header) };
  refineRole(entry, roleOf(entry.cols, name), name); // adds code / desc for logs
  const n = header.map(norm), cols = {};
  for (const f of FIELDS[kind]) {
    const i = f.from ? entry.cols[f.from] : n.findIndex((h) => f.re.test(h));
    if (i !== undefined && i >= 0) cols[f.key] = header[i];
  }
  if (kind === 'alteration') {
    // Prefer explicitly named alteration fields when the file also contains
    // generic/lithology columns; never infer a code from numeric intensity.
    for (const key of ['code', 'description', 'intensity']) {
      const field = FIELDS.alteration.find(f => f.key === key);
      const explicit = n.findIndex(h => /^(alteration|alt_)/.test(h) && field.re.test(h));
      if (explicit >= 0) cols[key] = header[explicit];
    }
  }
  if (kind === 'structure') {
    const dd = n.findIndex(h => /^(dip_?dir|dipdirection|dip_az|dd$)/.test(h));
    if (dd >= 0) cols.dip_direction = header[dd];
  }
  const mapping = { columns: cols, bdl: 'half', ...(decimalComma ? { decimalComma: true } : {}) };
  // Collars in latitude / longitude: x is longitude, y latitude, in WGS 84.
  if (kind === 'collars' && !cols.x && entry.cols.lon !== undefined && entry.cols.lat !== undefined) {
    Object.assign(cols, { x: header[entry.cols.lon], y: header[entry.cols.lat] });
    mapping.crs = 'EPSG:4326';
  } else if (kind === 'collars' && crs) mapping.crs = crs;
  if (kind === 'assays') {
    const used = new Set(Object.values(cols));
    const unitCols = new Map(header.map((h, i) => [norm(h), i]).filter(([h]) => /_?units?$/.test(h)));
    // Every other column is listed, so nothing is dropped out of sight: the ones
    // that read as assay values are ticked, the rest (weights, lab codes, an
    // empty column) are there to tick by hand.
    mapping.elements = header.flatMap((h, i) => {
      if (used.has(h) || /units?$/.test(n[i])) return [];
      const el = parseElementHeader(h);
      const uc = [`${n[i]}_unit`, `${n[i]}_units`, `${norm(el.name)}_unit`, `${norm(el.name)}_units`].find((k) => unitCols.has(k));
      const isValue = !NOT_ELEMENT.test(n[i]) && !/(^|_)id$/.test(n[i]) && share(rows, i, v => looksNumeric(decimalValue(v, decimalComma))) >= 0.8;
      return [{ column: h, name: el.name, unit: el.unit, unitColumn: uc ? header[unitCols.get(uc)] : null, ...(isValue ? {} : { skip: true }) }];
    });
  }
  return mapping;
}

/**
 * Applies a saved template's mapping to this file's header; columns not in the
 * file are dropped. `candidates` (autoMapping's elements for this file) adds the
 * file's other columns, unticked, so a column the template does not know is
 * still there to tick.
 */
export function applyTemplate(template, header, candidates = null) {
  const byNorm = new Map(header.map((h) => [norm(h), h]));
  const pick = (c) => (c ? byNorm.get(norm(c)) || null : null);
  const m = template?.mapping || template || {};
  const columns = Object.fromEntries(Object.entries(m.columns || {}).map(([k, c]) => [k, pick(c)]).filter(([, c]) => c));
  const elements = (m.elements || []).flatMap((e) => (pick(e.column) ? [{ ...e, column: pick(e.column), unitColumn: pick(e.unitColumn) }] : []));
  if (candidates) {
    const have = new Set(elements.map((e) => e.column));
    const taken = new Set(Object.values(columns));
    for (const c of candidates) if (!have.has(c.column) && !taken.has(c.column)) elements.push({ ...c, skip: true });
  }
  return { ...m, columns, ...(m.elements || candidates ? { elements } : {}) };
}

// ── Values ─────────────────────────────────────────────────────────────────
const MISSING = /^(|-|--|na|n\/a|ns|is|nr|lnr|nss|\*|null|none|nan)$/i;
const BDL_WORDS = /^(bdl|bld|nd|<dl|<lod|<ld|lod|trace|tr)$/i;

// Opt-in and numeric fields only. Never strip punctuation from identifiers or
// guess whether a comma means a decimal point or a thousands separator.
const decimalValue = (value, comma) => comma ? cell(value).replace(/^([<>]?\s*[-+]?\d+),(\d+(?:e[-+]?\d+)?)$/i, '$1.$2') : value;

// Database "no value" codes, never read as a negative detection limit. A
// preset (shared/drillPresets.json) or mapping can replace them with `missing`.
export const MISSING_SENTINELS = ['-99', '-999', '-9999'];

/**
 * One assay cell → { value, dl?, over?, missing?, raw?, error? }. "<0.005" is below
 * detection (dl 0.005) and stored by `mode`; a negative number is the same
 * (labs write -0.005 for <0.005) unless it is a sentinel (-999: missing);
 * "BDL" has no known limit and keeps no value; IS, NSS, NS, LNR are missing
 * with their text in `raw`; ">10" is over the upper limit, kept as 10 and flagged.
 */
export function parseAssay(raw, mode = 'half', sentinels = MISSING_SENTINELS) {
  const v = cell(raw);
  if (MISSING.test(v)) return v ? { value: null, missing: true, raw: v } : { value: null, missing: true };
  if (BDL_WORDS.test(v)) return { value: null, dl: true };
  if (sentinels.some((s) => Number(s) === Number(v))) return { value: null, missing: true, raw: v };
  const m = v.match(/^([<>])\s*(.+)$/);
  const num = Number(m ? m[2] : v);
  if (!Number.isFinite(num) || Math.abs(num) >= 1e12) return { value: null, error: `"${v}" is not a number` };
  if (m?.[1] === '>') return { value: num, over: true };
  if (m || num < 0) {
    const dl = Math.abs(num);
    return { value: mode === 'half' ? dl / 2 : mode === 'dl' ? dl : mode === 'zero' ? 0 : null, dl };
  }
  return { value: num };
}

const toNum = (v) => {
  const t = cell(v).replace(/^\+/, '');
  if (t === '' || MISSING.test(t)) return null;
  const n = Number(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : NaN;
};
const toBool = (v) => {
  const t = cell(v).toLowerCase();
  return t === '' ? null : /^(y|yes|true|1|planned|proposed|p)$/.test(t) ? true : /^(n|no|false|0)$/.test(t) ? false : undefined;
};

// ── Building and checking an import ────────────────────────────────────────
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const list = (ids) => `${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}`;

/**
 * The canonical rows for `kind` from a parsed table and a mapping, with what is
 * wrong (errors stop the import, by file line) and what looks odd (warnings,
 * by hole, in the 3D data checks' terms).
 * → { rows, lines, errors: [{ line, message }], errorCount, warnings: [{ kind, message, holes }], stats }
 */
export function buildImport(kind, { header, rows, lines: fileLines = null }, mapping, { firstLine = 2 } = {}) {
  const fields = FIELDS[kind];
  const col = (k) => (mapping.columns?.[k] ? header.indexOf(mapping.columns[k]) : -1);
  const idx = Object.fromEntries(fields.map((f) => [f.key, col(f.key)]));
  const errors = [], warnings = [], out = [], lines = [];
  let errorCount = 0;
  const err = (line, message) => { errorCount++; if (errors.length < 200) errors.push({ line, message }); };
  const warn = (k, holes, message) => { holes = [...new Set(holes)]; if (holes.length) warnings.push({ kind: k, holes: holes.slice(0, 50), message: `${message(holes.length)}: ${list(holes)}` }); };

  for (const f of fields) if (f.required && idx[f.key] < 0) err(null, `Choose the column for ${f.label}.`);
  const elements = kind === 'assays' ? (mapping.elements || []).filter((e) => !e.skip && e.column && header.includes(e.column) && cell(e.name)) : [];
  if (kind === 'assays' && !elements.length) err(null, 'Choose at least one element column.');
  if (['lithology', 'alteration'].includes(kind) && idx.code < 0 && idx.description < 0) err(null, 'Choose the column for Code or Description.');
  if (rows.length > MAX_ROWS) err(null, `The file has ${rows.length.toLocaleString('en-US')} rows; one import takes at most 20,000. Split files over 20,000 rows and import each part.`);
  const crs = cell(mapping.crs);
  if (kind === 'collars' && crs && !/^EPSG:\d{4,6}$/.test(crs)) err(null, 'The coordinate system must be written EPSG:<code>, for example EPSG:26910.');
  if (errorCount) return { rows: [], lines: [], errors, errorCount, warnings, stats: {} };

  const names = elements.map((e) => cell(e.name));
  const dupNames = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupNames.length) err(null, `Two columns are both named ${dupNames[0]}; give each element its own name.`);
  // Units: the unit column (one unit per element) wins over the unit in the header.
  const units = {};
  for (const e of elements) {
    let unit = cell(e.unit) || null;
    if (e.unitColumn && header.includes(e.unitColumn)) {
      const ui = header.indexOf(e.unitColumn);
      const seen = [...new Set(rows.map((r) => cell(r[ui])).filter(Boolean))];
      if (seen.length > 1) err(null, `${e.column}: mixed units in ${e.unitColumn} (${seen.slice(0, 4).join(', ')}). Import one unit at a time.`);
      else if (seen.length === 1) {
        if (unit && unit !== seen[0]) warnings.push({ kind: 'unit-mismatch', holes: [], message: `${e.name}: ${e.unitColumn} says ${seen[0]}, the header says ${unit}; ${seen[0]} is used` });
        unit = seen[0];
      }
    }
    if (unit && unit.length > 20) err(null, `${e.name}: the unit "${unit}" is longer than 20 characters.`);
    units[cell(e.name)] = unit;
  }
  const noUnit = names.filter((n) => !units[n]);
  if (noUnit.length) warnings.push({ kind: 'no-unit', holes: [], message: `No unit for ${noUnit.join(', ')}. Set one so grades are never read in the wrong unit` });

  const mode = mapping.bdl || 'half';
  const sentinels = Array.isArray(mapping.missing) ? mapping.missing.map(String) : MISSING_SENTINELS;
  const stats = { bdl: 0, over: 0, missing: {}, skipped: 0, dipsFlipped: false }, overElements = new Set();
  const dips = [];
  const seen = new Map();
  rows.forEach((r, i) => {
    const line = fileLines?.[i] ?? i + firstLine;
    if (r.every((v) => !cell(v))) { stats.skipped++; return; }
    const o = {};
    let bad = false;
    const fail = (m) => { bad = true; err(line, m); };
    for (const f of fields) {
      if (idx[f.key] < 0) continue;
      const raw = r[idx[f.key]];
      if (NUMERIC.has(f.key)) {
        const n = toNum(decimalValue(raw, mapping.decimalComma));
        if (Number.isNaN(n)) fail(`${f.label} "${cell(raw)}" is not a number`);
        else if (n === null && f.required) fail(`${f.label} is empty`);
        else if (n !== null) o[f.key] = n;
      } else if (f.key === 'planned') {
        const b = toBool(raw);
        if (b === undefined) fail(`Planned "${cell(raw)}" is not yes or no`);
        else if (b !== null) o.planned = b;
      } else {
        const t = cell(raw);
        if (t.length > TEXT_MAX[f.key]) fail(`${f.label} is longer than ${TEXT_MAX[f.key]} characters`);
        else if (t) o[f.key] = t;
      }
    }
    if (!o.hole_id && !bad) fail('Hole ID is empty');
    for (const k of ['depth', 'depth_m', 'from_m', 'to_m']) if (o[k] < 0) fail(`Negative depth (${k.replace('_m', '')} ${o[k]})`);
    if (o.from_m !== undefined && o.to_m !== undefined && !(o.to_m > o.from_m)) fail(`To (${o.to_m}) must be greater than From (${o.from_m})`);
    if (o.azimuth !== undefined && !(o.azimuth >= 0 && o.azimuth <= 360)) fail(`Azimuth ${o.azimuth} is outside 0 to 360`);
    if (kind === 'structure') {
      for (const [k, max] of [['alpha', 90], ['beta', 360], ['dip', 90], ['dip_direction', 360]]) if (o[k] !== undefined && !(o[k] >= 0 && o[k] <= max)) fail(`${FIELDS.structure.find(f => f.key === k).label} ${o[k]} is outside 0 to ${max}`);
      if (o.beta !== undefined && o.alpha === undefined) fail('Beta needs an alpha');
      if (o.dip_direction !== undefined && o.dip === undefined) fail('Dip direction needs a dip');
      if (o.alpha === undefined && o.dip === undefined && !o.description && !bad) fail('No alpha, dip or description');
    } else if (o.dip !== undefined && !(o.dip >= -90 && o.dip <= 90)) fail(`Dip ${o.dip} is outside -90 to 90`);
    if (kind === 'surveys' && o.azimuth === undefined && o.dip === undefined && !bad) fail('A survey station needs an azimuth or a dip');
    if (['lithology', 'alteration'].includes(kind) && !o.code && !o.description && !bad) fail('No code or description');
    if (kind === 'collars') {
      if (crs) o.crs = crs;
      if (o.planned === undefined && /^(planned|proposed)$/i.test(o.status || '')) o.planned = true;
    }
    if (kind === 'assays') {
      const values = {}, bdl = {};
      for (const e of elements) {
        const p = parseAssay(decimalValue(r[header.indexOf(e.column)], mapping.decimalComma), mode, sentinels);
        const name = cell(e.name);
        if (p.error) { fail(`${e.column}: ${p.error}`); continue; }
        if (p.dl !== undefined) { bdl[name] = p.dl; stats.bdl++; }
        if (p.over) { stats.over++; overElements.add(name); }
        if (p.raw) { const k = p.raw.toUpperCase(); stats.missing[k] = (stats.missing[k] || 0) + 1; }
        if (p.value !== null) values[name] = p.value;
      }
      o.values = values;
      if (Object.keys(bdl).length) o.bdl = bdl;
      o.units = Object.fromEntries(Object.entries(units).filter(([el, u]) => u && (el in values || el in bdl)));
    }
    if (bad) return;
    const key = [o.hole_id, o.depth_m ?? o.from_m ?? '', o.to_m ?? ''].join('|');
    if (seen.has(key)) { err(line, `${kind === 'collars' ? `Hole ${o.hole_id}` : `This ${['surveys', 'structure'].includes(kind) ? 'depth' : 'interval'} of ${o.hole_id}`} is also on line ${seen.get(key)}`); return; }
    seen.set(key, line);
    if (o.dip !== undefined) dips.push(o.dip);
    out.push(o);
    lines.push(line);
  });

  // Positive-down dips (as the 3D maker reads them): stored negative, the
  // database's convention, when nearly all are positive.
  if ((kind === 'collars' || kind === 'surveys') && dips.length && dips.filter((d) => d > 0).length / dips.length > 0.9) {
    out.forEach((o) => { if (o.dip !== undefined) o.dip = -Math.abs(o.dip); });
    stats.dipsFlipped = true;
    warnings.push({ kind: 'dips-positive', holes: [], message: 'Dips are written positive down; they are stored negative (downward)' });
  }
  // Intervals: overlaps and gaps down each hole.
  if (['assays', 'lithology', 'alteration'].includes(kind)) {
    const by = new Map();
    out.forEach((o) => { if (!by.has(o.hole_id)) by.set(o.hole_id, []); by.get(o.hole_id).push(o); });
    const overlap = [], gap = [];
    by.forEach((l, id) => {
      l.sort((a, b) => a.from_m - b.from_m);
      for (let i = 1; i < l.length; i++) {
        if (l[i].from_m < l[i - 1].to_m - 1e-6) { overlap.push(id); break; }
      }
      let coveredTo = l[0].to_m;
      for (let i = 1; i < l.length; i++) {
        // Nested alteration intervals do not create a gap in the outer log.
        if (l[i].from_m > (kind === 'alteration' ? coveredTo : l[i - 1].to_m) + 0.01) { gap.push(id); break; }
        coveredTo = Math.max(coveredTo, l[i].to_m);
      }
    });
    warn('overlapping-intervals', overlap, (n) => `Overlapping intervals in ${plural(n, 'hole')}`);
    warn('gaps', gap, (n) => `${kind === 'alteration' ? 'Gaps between logged intervals' : 'Unsampled gaps between intervals'} in ${plural(n, 'hole')}`);
  }
  if (stats.over) warnings.push({ kind: 'over-limit', holes: [], message: `${plural(stats.over, 'value')} over the upper detection limit (">") in ${[...overElements].join(', ')} kept at the limit, not a measured grade; re-assay by an over-limit method` });
  const codes = Object.entries(stats.missing);
  if (codes.length) warnings.push({ kind: 'no-value-codes', holes: [], message: `${plural(codes.reduce((t, [, c]) => t + c, 0), 'value')} stored as no value: ${codes.map(([k, c]) => `${k} ×${c.toLocaleString('en-US')}`).join(', ')}` });
  if (stats.bdl) warnings.push({ kind: 'bdl', holes: [], message: `${plural(stats.bdl, 'value')} below detection, stored as ${BDL_MODES.find((m) => m.value === mode)?.label.toLowerCase()} and flagged` });
  if (!out.length && !errorCount) err(null, 'The file has no data rows.');
  return { rows: out, lines, errors, errorCount, warnings, stats };
}

// ── The diff in words ──────────────────────────────────────────────────────
const NOUN = { collars: ['collar', 'collars'], surveys: ['survey station', 'survey stations'], assays: ['assay', 'assays'], lithology: ['lithology interval', 'lithology intervals'], alteration: ['alteration interval', 'alteration intervals'], structure: ['structure measurement', 'structure measurements'] };

/** "12 new holes, 1,340 new assays, 3 changed assays" (or "No changes: 120 assays already stored"). */
export function diffSentence(kind, d) {
  // Direct/historical imports may store provenance without the importer's diff.
  // Missing counts are unknown, not zero; never let one history row crash the workspace.
  const count = key => Number.isSafeInteger(d?.[key]) && d[key] >= 0 ? d[key] : null;
  const added = count('new'), changed = count('changed'), unchanged = count('unchanged'), holes = count('new_holes');
  const [one, many] = NOUN[kind] || ['row', 'rows'];
  const noun = (n) => (n === 1 ? one : many);
  const parts = [];
  if (kind === 'collars') {
    if (added) parts.push(`${plural(added, 'new hole')}`);
  } else {
    if (holes) parts.push(plural(holes, 'new hole'));
    if (added) parts.push(`${added.toLocaleString('en-US')} new ${noun(added)}`);
  }
  if (changed) parts.push(`${changed.toLocaleString('en-US')} changed ${noun(changed)}`);
  if (!parts.length) return unchanged === null ? 'Change counts unavailable.' : `No changes: ${unchanged.toLocaleString('en-US')} ${noun(unchanged)} already stored as they are`;
  if (unchanged) parts.push(`${unchanged.toLocaleString('en-US')} unchanged`);
  return parts.join(', ');
}

/** Where the line numbers of the server's row errors point in the file. */
export const serverErrors = (diff, lines) => (diff?.errors || []).map((e) => ({ line: lines[e.row - 1] ?? null, message: e.message }));

// ── Client ─────────────────────────────────────────────────────────────────
const MESSAGES = [
  [/INVALID_KIND:\s*alteration\b/, 'Alteration imports are not available on this site yet. Ask the site administrator to enable the alteration database update; existing drill imports still work.'],
  [/INVALID_KIND:\s*structure\b/, 'Structure imports are not available on this site yet. Ask the site administrator to enable the structure database update; existing drill imports still work.'],
  [/ORG_READ_ONLY/, 'You have view-only access here. Ask an admin of the workspace for editor access.'],
  [/BATCH_TOO_LARGE/, 'One import takes at most 20,000 rows (13 MB). Split files over 20,000 rows and import each part.'],
  [/BATCH_SUPERSEDED: (.*)/, (m) => `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}.`],
  [/INVALID_ROWS/, 'Some rows have problems. Check the file again.'],
  [/EMPTY_IMPORT/, 'The file has no data rows.'],
  [/DRILL_PROPERTY_FULL/, 'This property holds the most drill data one property can (2,000,000 rows, history included). Contact us to raise it.'],
  [/DB_HEADROOM/, 'Imports are paused while the database makes room. Try again later.'],
  [/TOO_MANY_TEMPLATES/, 'A workspace keeps at most 100 column templates. Delete one first.'],
  [/NOT_FOUND/, 'That property or import was not found. It may have been deleted.'],
  [/forbidden|permission denied|row-level security/i, 'You do not have permission to do that in this workspace.'],
  [/statement timeout|canceling statement/i, 'The database took too long with this file. Try a smaller part of it.'],
];
export function drillError(err) {
  const msg = String(err?.message || err || '');
  let text = msg || 'Something went wrong.';
  for (const [re, out] of MESSAGES) { const m = msg.match(re); if (m) { text = typeof out === 'function' ? out(m) : out; break; } }
  const e = new Error(text);
  e.code = (msg.match(/^[A-Z_]{4,}/) || [])[0] || err?.code;
  e.cause = err;
  return e;
}

export function drillDb(sb) {
  if (!sb) throw new Error('The drill database needs an Exploration Maps account, which is not available on this site right now.');
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw drillError(error);
    return data;
  }
  const importArgs = ({ propertyId, kind, rows, mapping, filename }, dry, batch = null) => ({
    p_property: propertyId, p_kind: kind, p_rows: rows, p_mapping: mapping || {}, p_filename: filename || null, p_dry_run: dry, p_batch: batch,
  });
  return {
    summary: (propertyId) => rpc('drill_property_summary', { p_property: propertyId }),
    /** Validates and diffs against the stored rows; writes nothing. */
    dryRun: (args) => rpc('drill_import_batch', importArgs(args, true)),
    /** Commits atomically. Pass the same batchId to retry safely: it is never applied twice. */
    commit: ({ batchId = crypto.randomUUID(), ...args }) => rpc('drill_import_batch', importArgs(args, false, batchId)),
    rollback: (batchId) => rpc('drill_rollback_batch', { p_batch: batchId }),
    async templates(orgId, kind) {
      const { data, error } = await sb.from('drill_column_templates').select('id, name, kind, mapping, updated_at')
        .eq('org_id', orgId).eq('kind', kind).order('name');
      if (error) throw drillError(error);
      return data || [];
    },
    saveTemplate: (orgId, kind, name, mapping) => rpc('drill_save_template', { p_org: orgId, p_kind: kind, p_name: name, p_mapping: mapping }),
    async deleteTemplate(id) {
      const { error } = await sb.from('drill_column_templates').delete().eq('id', id);
      if (error) throw drillError(error);
    },
  };
}
