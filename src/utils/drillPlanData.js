// The drill plan's data (project.drillPlan): collar, survey, assay and published-results tables read into the
// plan a 2D map draws (utils/drillPlan.js). Loaded by the Drill plan controls only.
//
// Tables are read as the 3D maker reads them: the same column matcher (three-d/roles.js), the same
// minimum-curvature desurvey when a hole has surveys (shared/desurvey.js), the same positive-down dip rule,
// the same hole length (collar depth, else the deepest assay or survey station, else 200 m), and the release
// table through the 3D page's own reader (three-d/published-results.js), so a 2D plan and a 3D figure built
// from the same files put a hole and its intervals in the same place.
//
// Collars in easting/northing are converted with the coordinate system the user picks (never guessed); the
// desurveyed offsets are added in that grid, as 3D adds them, and each hole's plan path is stored as
// longitude/latitude, so drawing it needs no projection library.

import { matchCols, roleOf, refineRole } from '../three-d/roles.js';
import { readResults, isApproved } from '../three-d/published-results.js';
import { desurveyPath } from '../../shared/desurvey.js';
import { parseAssay, parseElementHeader } from './drillDb.js';
import { releaseColumns } from './publishedCallouts.js';
import { destination } from './drillTraces.js';
import { byHole, DEFAULT_BINS } from './drillPlanLegend.js';

export const PLAN_VERSION = 1;
export const KINDS = { collars: 'Collars', surveys: 'Downhole surveys', assays: 'Assays', published: 'Published results', ignore: 'Not used' };
export const LIMITS = { holes: 500, assays: 30000, results: 500 };

// Coordinate systems a collar file can be in: longitude/latitude, or a UTM zone (NAD83 or WGS 84), BC Albers.
const UTM_ZONES = Array.from({ length: 60 }, (_, i) => i + 1);
export const CRS_OPTIONS = [
  { code: 'EPSG:4326', label: 'Longitude / latitude (WGS 84)' },
  ...UTM_ZONES.filter((z) => z <= 23).map((z) => ({ code: `EPSG:${26900 + z}`, label: `NAD83 / UTM zone ${z}N` })),
  ...UTM_ZONES.map((z) => ({ code: `EPSG:${32600 + z}`, label: `WGS 84 / UTM zone ${z}N` })),
  ...UTM_ZONES.map((z) => ({ code: `EPSG:${32700 + z}`, label: `WGS 84 / UTM zone ${z}S` })),
  { code: 'EPSG:3005', label: 'NAD83 / BC Albers' },
];
export function crsDef(code) {
  const n = Number(String(code || '').replace(/^EPSG:/i, ''));
  if (n >= 26901 && n <= 26923) return `+proj=utm +zone=${n - 26900} +datum=NAD83 +units=m +no_defs`;
  if (n >= 32601 && n <= 32660) return `+proj=utm +zone=${n - 32600} +datum=WGS84 +units=m +no_defs`;
  if (n >= 32701 && n <= 32760) return `+proj=utm +zone=${n - 32700} +south +datum=WGS84 +units=m +no_defs`;
  if (n === 3005) return '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs';
  return null;
}
/** (x, y) in the collars' system → [lng, lat], and the reverse; null for longitude/latitude. */
export async function projector(code) {
  if (!code || code === 'EPSG:4326') return null;
  const def = crsDef(code);
  if (!def) throw new Error(`${code} is not a coordinate system the drill plan can convert. Choose a UTM zone or longitude/latitude.`);
  const { default: proj4 } = await import('proj4');
  const p = proj4(def, 'EPSG:4326');
  return { toLngLat: (x, y) => p.forward([x, y]), fromLngLat: (lng, lat) => p.inverse([lng, lat]) };
}

const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');
const cell = (v) => String(v ?? '').trim();
const num = (v) => { const t = cell(v).replace(/,/g, ''); return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? +t : NaN; };
const key = (id) => cell(id).toLowerCase();
const NOT_ELEMENT = /^(weight|wt|wt_kg|weight_kg|recovery|rec|rqd|length|interval|width|batch|certificate|cert|job|lab|lab_id|qc|qaqc|type|sample_type|density|sg|year|date|sample|sample_id|sampleid|sample_no|sample_number)$/;
const DOMAIN = /^(domain|zone|heading|domain_name|zone_name|domain_heading|mineralized_zone)$/;

/** A delimited text file as { header, rows } (strings). */
export async function parseTable(text) {
  const { default: Papa } = await import('papaparse');
  const data = Papa.parse(String(text).replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' }).data.map((r) => r.map((v) => String(v ?? '')));
  return { header: (data.shift() || []).map((h) => h.trim()), rows: data };
}

/** What a table holds, as the 3D maker decides it; a release table (Result ID, approval ...) is "published". */
export function guessKind(header, rows, name = '') {
  const entry = { header, rows, cols: matchCols(header) };
  const role = refineRole(entry, roleOf(entry.cols, name), name);
  if (entry.hint === 'published') return 'published';
  return { collar: 'collars', survey: 'surveys', assay: 'assays' }[role] || 'ignore';
}

/** Whether collars give easting/northing only (so a coordinate system has to be chosen). */
export function needsCrs(tables) {
  return tables.some((t) => {
    if (t.kind !== 'collars') return false;
    const c = matchCols(t.header);
    return !(c.lat !== undefined && c.lon !== undefined) && c.east !== undefined && c.north !== undefined;
  });
}

// ── Reading each kind ───────────────────────────────────────────────────────
function readCollars(t, problems) {
  const c = matchCols(t.header), ll = c.lat !== undefined && c.lon !== undefined, out = new Map();
  if (c.hole === undefined || (!ll && (c.east === undefined || c.north === undefined))) { problems.push(`${t.name}: no hole ID and coordinate columns, so it is not read as collars.`); return out; }
  for (const r of t.rows) {
    const id = cell(r[c.hole]); if (!id || out.has(key(id))) continue;
    const x = num(r[ll ? c.lon : c.east]), y = num(r[ll ? c.lat : c.north]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.set(key(id), { id, x, y, ll, az: num(r[c.az]), dip: num(r[c.dip]), depth: num(r[c.depth]) });
  }
  return out;
}
function readSurveys(t, problems) {
  const c = matchCols(t.header), out = new Map();
  if (c.hole === undefined || c.depth === undefined) { problems.push(`${t.name}: no hole ID and depth columns, so it is not read as surveys.`); return out; }
  for (const r of t.rows) {
    const id = key(r[c.hole]), d = num(r[c.depth]), az = num(r[c.az]), dip = num(r[c.dip]);
    if (!id || !Number.isFinite(d) || (!Number.isFinite(az) && !Number.isFinite(dip))) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ d, az, dip });
  }
  return out;
}
// Assays: every numeric column besides hole, from and to is an element ("Au_gpt" → Au in g/t).
function readAssays(t, problems) {
  const c = matchCols(t.header), n = t.header.map(norm), used = new Set([c.hole, c.from, c.to]);
  if (c.hole === undefined || c.from === undefined || c.to === undefined) { problems.push(`${t.name}: no hole ID, From and To columns, so it is not read as assays.`); return { elements: [], rows: new Map() }; }
  const cols = t.header.map((h, i) => ({ h, i })).filter(({ i }) => !used.has(i) && !NOT_ELEMENT.test(n[i]) && !/(^|_)id$/.test(n[i]) && !/units?$/.test(n[i]))
    .filter(({ i }) => { let k = 0, tot = 0; for (const r of t.rows) { const v = cell(r[i]); if (!v) continue; tot++; if (parseAssay(v).value !== null || parseAssay(v).dl) k++; } return tot && k / tot >= 0.8; });
  const elements = cols.map(({ h }) => parseElementHeader(h)), rows = new Map();
  for (const r of t.rows) {
    const id = key(r[c.hole]), f = num(r[c.from]), to = num(r[c.to]);
    if (!id || !Number.isFinite(f) || !(to > f)) continue;
    if (!rows.has(id)) rows.set(id, []);
    rows.get(id).push([f, to, ...cols.map(({ i }) => { const v = parseAssay(r[i]).value; return v === null ? null : +v.toPrecision(6); })]);
  }
  return { elements: elements.map((e) => ({ name: e.name, unit: e.unit })), rows };
}
// Two assay tables as one: elements matched by name (a new one adds a column), intervals of a hole together in
// depth order, and an interval in both (same hole, from and to) one row with each table's values.
export function mergeAssays(a, b) {
  if (!a.elements.length && !a.rows.size) return b;
  const elements = [...a.elements], at = b.elements.map((e) => { let i = elements.findIndex((x) => x.name === e.name); if (i < 0) { elements.push(e); i = elements.length - 1; } return i; });
  const n = elements.length, rows = new Map();
  const pad = (r) => [r[0], r[1], ...Array.from({ length: n }, (_, i) => r[2 + i] ?? null)];
  a.rows.forEach((l, id) => rows.set(id, l.map(pad)));
  b.rows.forEach((l, id) => {
    const list = rows.get(id) || [];
    l.forEach((r) => {
      const v = Array(n).fill(null); at.forEach((i, j) => { v[i] = r[2 + j] ?? null; });
      const same = list.find((x) => Math.abs(x[0] - r[0]) < 1e-6 && Math.abs(x[1] - r[1]) < 1e-6);
      if (same) v.forEach((x, i) => { if (x !== null && same[2 + i] === null) same[2 + i] = x; });
      else list.push([r[0], r[1], ...v]);
    });
    rows.set(id, list.sort((p, q) => p[0] - q[0]));
  });
  return { elements, rows };
}

// The release table, as the 3D page reads it, with each result's domain heading ("Upper Blue Sky") when the
// table has a Domain or Zone column.
function readRelease(t, problems) {
  const cols = releaseColumns(t.header), need = ['resultId', 'hole', 'from', 'to'].filter((k) => cols[k] === undefined);
  if (need.length) { problems.push(`${t.name}: no Result ID, Hole ID, From and To columns, so it is not read as published results.`); return []; }
  const { results, problems: p } = readResults(t.header, t.rows, cols, t.name);
  problems.push(...p.filter((x) => x.kind !== 'no-status-column' && x.kind !== 'not-approved').map((x) => x.message));
  const d = t.header.map(norm).findIndex((h) => DOMAIN.test(h));
  if (d >= 0) {
    const byId = new Map(t.rows.map((r) => [cell(r[cols.resultId]), cell(r[d])]));
    results.forEach((r) => { const v = byId.get(r.resultId); if (v) r.domain = v; });
  }
  return results;
}

// ── The plan ────────────────────────────────────────────────────────────────
const round = (v, k) => +v.toFixed(k);
const settings = (prev) => {
  if (!prev) return {};
  const { holes, assays, results, crs, files, v, ...rest } = prev;
  return rest;
};

/**
 * Builds project.drillPlan from tables ({ name, header, rows, kind }) and the collars' coordinate system.
 * prev: the plan being replaced, whose choices (colours, bins, what shows, positions, cards) are kept.
 * @returns {Promise<{ plan, notes: string[], problems: string[] }>}
 */
export async function buildPlan(tables, { crs = null, prev = null, drillSource = null } = {}) {
  const problems = [], notes = [];
  const collars = new Map(), surveys = new Map();
  let assays = { elements: [], rows: new Map() }, results = [];
  for (const t of tables) {
    if (t.kind === 'collars') readCollars(t, problems).forEach((v, k) => { if (!collars.has(k)) collars.set(k, v); });
    else if (t.kind === 'surveys') readSurveys(t, problems).forEach((v, k) => surveys.set(k, [...(surveys.get(k) || []), ...v]));
    else if (t.kind === 'assays') assays = mergeAssays(assays, readAssays(t, problems));
    else if (t.kind === 'published') results = results.concat(readRelease(t, problems));
  }
  if (!collars.size) throw new Error('Add a collar table (hole ID with easting/northing or longitude/latitude).');
  const projected = [...collars.values()].some((c) => !c.ll);
  if (projected && (!crs || crs === 'EPSG:4326')) throw new Error('The collars are in easting/northing: choose their coordinate system.');
  const proj = projected ? await projector(crs) : null;

  // Positive-down dips (nearly all positive) are read as downward, as the 3D maker reads them.
  const dips = [...collars.values()].map((c) => c.dip).concat([...surveys.values()].flat().map((s) => s.dip)).filter(Number.isFinite);
  const posDown = dips.length > 0 && dips.filter((d) => d > 0).length / dips.length > 0.9;
  const fixDip = (d) => (Number.isFinite(d) ? (posDown ? -Math.abs(d) : d) : NaN);
  if (posDown) notes.push('Dips are written positive down; they are read as downward.');

  const list = [...collars.values()].sort((a, b) => byHole(a.id, b.id));
  if (list.length > LIMITS.holes) { notes.push(`The plan keeps the first ${LIMITS.holes} of ${list.length} holes.`); list.length = LIMITS.holes; }
  const ints = assays.rows;
  let kept = 0;
  const holes = list.map((c) => {
    const k = key(c.id), last = (ints.get(k) || []).reduce((m, r) => Math.max(m, r[1]), 0);
    let st = (surveys.get(k) || []).filter((s) => Number.isFinite(s.az) || Number.isFinite(s.dip)).sort((p, q) => p.d - q.d)
      .map((s) => ({ d: s.d, az: Number.isFinite(s.az) ? s.az : (c.az || 0), dip: Number.isFinite(fixDip(s.dip)) ? fixDip(s.dip) : (fixDip(c.dip) || -90) }));
    const desurveyed = st.length > 0;
    if (!st.length) st = [{ d: 0, az: Number.isFinite(c.az) ? c.az : 0, dip: Number.isFinite(fixDip(c.dip)) ? fixDip(c.dip) : -90 }];
    const len = Math.max(Number.isFinite(c.depth) ? c.depth : 0, last, st[st.length - 1].d) || 200;
    // Offsets from the collar (x east, y north, metres), in the collars' grid when projected.
    const offs = desurveyed ? desurveyPath(st, len, 5) : desurveyPath(st.slice(0, 1), len, len);
    const at = (o) => {
      if (!c.ll) return proj.toLngLat(c.x + o.x, c.y + o.y); // a collar table in longitude/latitude is never projected
      const h = Math.hypot(o.x, o.y);
      return h < 1e-6 ? [c.x, c.y] : destination([c.x, c.y], (Math.atan2(o.x, o.y) * 180) / Math.PI, h);
    };
    const path = offs.map((o) => { const [lng, lat] = at(o); return [round(lng, 7), round(lat, 7), round(o.d, 2)]; });
    const [lng, lat] = path[0];
    return { id: c.id, lng, lat, az: st[0].az, dip: st[0].dip, depth: Number.isFinite(c.depth) ? c.depth : null, len: round(len, 2), desurveyed, path };
  });
  // Assays on the plan's holes, in depth order, up to the limit.
  const onPlan = new Set(holes.map((h) => key(h.id))), rows = {};
  for (const h of holes) {
    const l = (ints.get(key(h.id)) || []).sort((a, b) => a[0] - b[0]);
    if (!l.length) continue;
    const room = LIMITS.assays - kept;
    if (room <= 0) break;
    rows[h.id] = l.slice(0, room); kept += rows[h.id].length;
  }
  if ([...ints.values()].reduce((s, l) => s + l.length, 0) > kept && kept >= LIMITS.assays) notes.push(`The plan keeps the first ${LIMITS.assays.toLocaleString('en-US')} assay intervals.`);
  const noCollar = [...ints.keys()].filter((k) => !onPlan.has(k));
  if (noCollar.length) problems.push(`${noCollar.length} hole${noCollar.length === 1 ? '' : 's'} in the assays ${noCollar.length === 1 ? 'has' : 'have'} no collar (${noCollar.slice(0, 3).join(', ')}${noCollar.length > 3 ? '…' : ''}).`);
  results = results.slice(0, LIMITS.results);
  const unplaced = [...new Set(results.filter((r) => isApproved(r) && !onPlan.has(key(r.holeId))).map((r) => r.holeId))];
  if (unplaced.length) problems.push(`No collar for ${unplaced.join(', ')}, so ${unplaced.length === 1 ? 'its results are' : 'their results are'} not drawn.`);

  const kept0 = settings(prev);
  const elements = assays.elements;
  const plan = {
    show: { traces: true, bars: true, pills: true, collars: true, tags: true, padTag: true, card: false },
    bins: DEFAULT_BINS.map((b) => ({ ...b })),
    pos: {},
    ...kept0,
    v: PLAN_VERSION,
    crs: projected ? crs : 'EPSG:4326',
    holes,
    assays: { elements, rows },
    element: elements.some((e) => e.name === kept0.element) ? kept0.element : elements[0]?.name || null,
    results,
    files: tables.filter((t) => t.kind !== 'ignore').map((t) => t.name).slice(0, 12),
  };
  // A rebuilt plan only claims provenance for the batch actually being built.
  // Uploaded files must not inherit a previous property's saved-recipe label.
  if (drillSource) plan.drillSource = structuredClone(drillSource);
  else delete plan.drillSource;
  // A hole's own colour is kept only while the hole is on the plan.
  if (prev?.holes) plan.holes.forEach((h) => { const o = prev.holes.find((p) => key(p.id) === key(h.id)); if (o?.color) h.color = o.color; });
  return { plan, notes, problems };
}

// ── Sections from a 3D figure ───────────────────────────────────────────────
// A saved /3d figure's named sections with fixed ends (shared/sectionGeometry.js: a, b in the figure's grid),
// converted to longitude/latitude with the figure's coordinate system. A section through the block's centre has
// no ends to share (they depend on the block), and is listed as such.
export async function figureSections(settings) {
  const s = settings?.settings || settings || {}, crs = s.crs || null;
  const list = Array.isArray(s.sections) && s.sections.length ? s.sections : s.section ? [{ id: 'A', name: 'A–A′', ...s.section }] : [];
  const proj = crs && crs !== 'EPSG:4326' ? await projector(crs).catch(() => null) : null;
  return list.map((x) => {
    const ok = x.a && x.b && Number.isFinite(+x.a.x) && Number.isFinite(+x.b.x);
    const ll = (p) => (proj ? proj.toLngLat(+p.x, +p.y) : crs === 'EPSG:4326' ? [+p.x, +p.y] : null);
    const a = ok ? ll(x.a) : null, b = ok ? ll(x.b) : null;
    return { id: x.id || 'A', name: x.name || `${x.id || 'A'}–${x.id || 'A'}′`, ends: a && b ? { a: { lng: a[0], lat: a[1] }, b: { lng: b[0], lat: b[1] } } : null, grid: ok ? { a: { x: +x.a.x, y: +x.a.y }, b: { x: +x.b.x, y: +x.b.y }, crs } : null };
  });
}

/** The figure's section ends in its grid, for EM3D.updateSection, from a plan section's longitude/latitude ends. */
export async function sectionGrid(section, crs) {
  const proj = await projector(crs);
  if (!proj) return { a: { x: section.a.lng, y: section.a.lat }, b: { x: section.b.lng, y: section.b.lat } };
  const [ax, ay] = proj.fromLngLat(section.a.lng, section.a.lat), [bx, by] = proj.fromLngLat(section.b.lng, section.b.lat);
  return { a: { x: round(ax, 2), y: round(ay, 2) }, b: { x: round(bx, 2), y: round(by, 2) } };
}
