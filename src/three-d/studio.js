// Exploration Maps 3D: drill CSVs in, a branded 3D drilling figure and section out.
// A standalone page (/3d), deliberately separate from the map editor bundle.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { composite, collarGroups, autoCell, autoSearch } from './shell-core.js';
import { METAL_DEFAULTS, defaultUnit, priceUnit, eqFactors, eqFormula, eqValue } from './metal-eq.js';
import { isXYZ, parseXYZ, refineRole } from './roles.js';
import { makeLayout, isClick, legendRows as binRows, wrapNotes, shouldMerge } from './layout.js';

const $ = (id) => document.getElementById(id);
// ============================================================
// 1. Reading files: CSV parsing, column matching, file roles
// ============================================================
function parseCSV(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((v) => v.trim() !== '')) rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.some((v) => v.trim() !== '')) rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.trim());
  return { header, rows };
}
const norm = (h) => h.toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');
const ALIASES = {
  hole: ['holeid', 'hole_id', 'hole', 'bhid', 'dhid', 'hole_name', 'holename', 'drillhole', 'drill_hole', 'hole_number', 'ddh', 'id'],
  east: ['easting', 'east', 'x', 'utm_e', 'utme', 'utm_east', 'xcollar', 'x_coord', 'e', 'easting_m', 'utm_easting'],
  north: ['northing', 'north', 'y', 'utm_n', 'utmn', 'utm_north', 'ycollar', 'y_coord', 'n', 'northing_m', 'utm_northing'],
  elev: ['elevation', 'elev', 'rl', 'z', 'zcollar', 'collar_rl', 'collar_elev', 'elevation_m', 'alt', 'altitude', 'collar_z'],
  lat: ['lat', 'latitude'], lon: ['lon', 'long', 'longitude', 'lng'],
  depth: ['depth', 'length', 'td', 'eoh', 'max_depth', 'total_depth', 'final_depth', 'depth_m', 'length_m', 'end_depth', 'hole_length', 'at', 'distance', 'survey_depth'],
  az: ['azimuth', 'azi', 'az', 'bearing', 'azim', 'azimuth_deg'],
  dip: ['dip', 'inclination', 'incl', 'inc', 'dip_deg'],
  from: ['from', 'depth_from', 'from_m', 'mfrom', 'start', 'from_depth', 'sample_from'],
  to: ['to', 'depth_to', 'to_m', 'mto', 'end', 'to_depth', 'sample_to'],
};
function matchCols(header) {
  const n = header.map(norm), out = {};
  for (const [key, list] of Object.entries(ALIASES)) {
    let idx = n.findIndex((h) => list.includes(h));
    if (idx < 0 && key !== 'hole') idx = n.findIndex((h) => list.some((a) => a.length > 2 && h.startsWith(a)));
    if (idx >= 0) out[key] = idx;
  }
  return out;
}
const GRADE_HINT = /(cueq|aueq|agEq|cu|au|ag|zn|pb|ni|co|mo|li2o|li|u3o8|pt|pd|fe|sn|w|grade|ppm|ppb|pct|gpt)/i;
function gradeCols(header, cols, rows) {
  const used = new Set(Object.values(cols));
  return header.map((h, i) => ({ h, i })).filter(({ i }) => !used.has(i)).filter(({ i }) => {
    let num = 0, tot = 0; for (const r of rows.slice(0, 200)) { const v = (r[i] || '').trim(); if (!v) continue; tot++; if (Number.isFinite(parseFloat(v.replace(/^</, '')))) num++; }
    return tot > 0 && num / tot > 0.8;
  }).sort((a, b) => (GRADE_HINT.test(b.h) ? 1 : 0) - (GRADE_HINT.test(a.h) ? 1 : 0)).map(({ h, i }) => ({ name: h, i }));
}
function roleOf(cols, name) {
  if (/\.obj$/i.test(name)) return 'mesh';
  const has = (...k) => k.every((x) => cols[x] !== undefined);
  if (has('hole', 'from', 'to')) return 'assay';
  if (has('hole') && (has('east', 'north') || has('lat', 'lon'))) return 'collar';
  if (has('hole', 'depth') && (has('az') || has('dip'))) return 'survey';
  if (has('east', 'north', 'elev')) return 'topo';
  return 'unknown';
}
const ROLE_LABEL = { collar: 'Collars', survey: 'Surveys', assay: 'Assays', topo: 'Topography', mesh: 'Model shape', unknown: 'Not recognised' };
const ROLE_FIELDS = { collar: ['hole', 'east', 'north', 'elev', 'depth', 'az', 'dip'], survey: ['hole', 'depth', 'az', 'dip'], assay: ['hole', 'from', 'to'], topo: ['east', 'north', 'elev'] };
const FIELD_LABEL = { hole: 'Hole ID', east: 'Easting', north: 'Northing', elev: 'Elevation', depth: 'Depth', az: 'Azimuth', dip: 'Dip', from: 'From', to: 'To', lat: 'Latitude', lon: 'Longitude' };
// EXT hook: lithology/alteration logs and geophysics points (detected in roles.js, drawn by geology.js and geophys.js).
// lithlegend: a code-to-name (and colour) list for the lithology legend.
Object.assign(ROLE_LABEL, { litho: 'Lithology / alteration', geophys: 'Geophysics', lithlegend: 'Lithology legend' }); Object.assign(FIELD_LABEL, { code: 'Code', desc: 'Description', value: 'Value', line: 'Line', color: 'Colour' });
Object.assign(ROLE_FIELDS, { litho: ['hole', 'from', 'to', 'code', 'desc'], geophys: ['east', 'north', 'elev', 'value', 'line'], lithlegend: ['code', 'desc', 'color'] });

function parseOBJ(text) {
  const v = [], f = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
    else if (line.startsWith('f ')) {
      const idx = line.trim().split(/\s+/).slice(1).map((t) => { const k = parseInt(t.split('/')[0], 10); return k < 0 ? v.length + k : k - 1; });
      for (let i = 1; i + 1 < idx.length; i++) f.push(idx[0], idx[i], idx[i + 1]);
    }
  }
  return { v, f };
}

// ============================================================
// 2. Sample project (illustrative), written out as real files
// ============================================================
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sampleFiles() {
  const rng = mulberry32(20261020), SQ2 = Math.SQRT2, E0 = 412300, N0 = 6421800;
  const H = (x, n) => { const p = ((x + 200) + (n - 100)) / SQ2, q = ((x - 650) - (n + 150)) / SQ2, al = ((x - 650) + (n + 150)) / SQ2;
    return 1020 + 330 * Math.exp(-((p / 620) ** 2)) - 170 * Math.exp(-((q / 150) ** 2)) * (0.6 + 0.4 * Math.tanh(al / 600 + 0.5)) + 38 * Math.sin(x / 260) * Math.cos(n / 310) + 22 * Math.sin((x + n) / 170) + 10 * Math.sin(x / 83 + n / 127); };
  const ZC = H(0, 0) - 330;
  const G = (x, n, z) => { const ux = (x - n) / SQ2, un = (x + n) / SQ2; let g = 0.62 * Math.exp(-((ux / 260) ** 2 + (un / 170) ** 2 + ((z - ZC) / 300) ** 2));
    const d = H(x, n) - z; if (d > 6 && d < 110) g += 0.6 * Math.exp(-((Math.hypot(x - 20, n + 10) / 175) ** 2)) * Math.pow(Math.sin(Math.PI * (d - 6) / 104), 0.6); return g; };
  const collars = ['HoleID,Easting,Northing,Elevation,Depth'], surveys = ['HoleID,Depth,Azimuth,Dip'], assays = ['HoleID,From,To,Cu_pct,Au_gpt'];
  let k = 1;
  const add = (x, n, az, dip, len) => {
    const id = `EX-${String(k++).padStart(3, '0')}`, top = H(x, n);
    collars.push(`${id},${(E0 + x).toFixed(1)},${(N0 + n).toFixed(1)},${top.toFixed(1)},${len.toFixed(1)}`);
    let a = az, d = dip;
    for (let s = 0; s <= len; s += 50) surveys.push(`${id},${Math.min(s, len).toFixed(0)},${(((a % 360) + 360) % 360).toFixed(1)},${d.toFixed(1)}`), a += (rng() - 0.5) * 2, d += 0.4;
    for (let from = 0; from + 2 <= len; from += 2) {
      const m = from + 1, ar = az * Math.PI / 180, dr = (dip + m / 125) * Math.PI / 180;
      const pt = { x: x + Math.sin(ar) * Math.cos(dr) * m, n: n + Math.cos(ar) * Math.cos(dr) * m, z: top + Math.sin(dr) * m };
      let g = G(pt.x, pt.n, pt.z) * (0.72 + 0.56 * rng()) + 0.02 * rng(); if (rng() < 0.04) g *= 1.9;
      if (from < 4) continue;
      assays.push(`${id},${from},${from + 2},${g.toFixed(3)},${(g * (0.25 + 0.2 * rng())).toFixed(3)}`);
    }
  };
  for (let gx = -3; gx <= 3; gx++) for (let gn = -3; gn <= 3; gn++) {
    const x = gx * 140 + (rng() - 0.5) * 50, n = gn * 140 + (rng() - 0.5) * 50;
    if (Math.hypot(x, n) > 440) continue;
    add(x, n, rng() < 0.5 ? 45 + (rng() - 0.5) * 30 : 225 + (rng() - 0.5) * 30, -(58 + rng() * 30), 280 + rng() * 300);
  }
  add(-560, 360, 135, -62, 500); add(520, -330, 315, -60, 460);
  const topo = ['X,Y,Z'];
  for (let n = -760; n <= 760; n += 40) for (let x = -900; x <= 900; x += 40) topo.push(`${E0 + x},${N0 + n},${H(x, n).toFixed(1)}`);
  // 0.2% shell as an OBJ mesh in project coordinates
  const qa = Math.sqrt(Math.log(0.62 / 0.2)), R = [260 * qa, 170 * qa, 300 * qa], obj = ['# 0.2% Cu shell (illustrative)'];
  const NU = 36, NV = 20;
  for (let j = 0; j <= NV; j++) for (let i = 0; i < NU; i++) {
    const th = Math.PI * j / NV, ph = 2 * Math.PI * i / NU, u = R[0] * Math.sin(th) * Math.cos(ph), w = R[1] * Math.sin(th) * Math.sin(ph), z = R[2] * Math.cos(th);
    const x = (u + w) / SQ2, n = (-u + w) / SQ2;
    obj.push(`v ${(E0 + x).toFixed(1)} ${(N0 + n).toFixed(1)} ${(ZC + z).toFixed(1)}`);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * NU + i + 1, b = j * NU + (i + 1) % NU + 1, c = a + NU, d = b + NU; obj.push(`f ${a} ${c} ${d} ${b}`); }
  return [
    { name: 'sample_collars.csv', text: collars.join('\n') },
    { name: 'sample_surveys.csv', text: surveys.join('\n') },
    { name: 'sample_assays.csv', text: assays.join('\n') },
    { name: 'sample_topography.csv', text: topo.join('\n') },
    { name: 'sample_shell_0.2pct.obj', text: obj.join('\n') },
  ];
}

// ============================================================
// 3. Project state built from the files
// ============================================================
let files = [];          // { name, text, role, header, rows, cols, grades, mesh }
let project = null;      // derived geometry
let usingSample = true;
const S = {              // style
  title: 'EXAMPLE RIDGE · MAIN ZONE', subtitle: '3D drilling model, looking northeast',
  valueCol: null, valueLabel: '', bins: [0.1, 0.2, 0.3, 0.5], coCount: 5, coMin: 20, coCut: 0.2, coIncl: 0.5,
  secAz: 135, secW: 75, surf: 1, walls: true, ids: true, inset: true, logo: null, meshes: {},
  ribbons: true, traceWidth: 1.4, pendingLabels: true, pendingNoAssays: false, valueCol2: null, elevTicks: true,
  terrain: 'natural', terrainSource: 'auto', vex: 1, crs: null, labels: [],
  collarFit: 'collars', blockStyle: 'glass', wallLabels: [], lockView: false,
  // Intervals below displayCutoff draw as the plain trace (null: all). eq: the metal-equivalent
  // recipe ({ base, baseCol, baseUnit, basePrice, baseRecovery, metals: { Au: { col, unit, price, recovery } } }).
  // shell: the grade shell from assays (cutoff/search/cell null = automatic). provisional: per-hole overrides.
  displayCutoff: null, eq: null, provisional: {},
  // legend: one card or several ("auto" merges three or more blocks), each card "auto", a corner or {x, y}.
  // coPlacement: where callouts go unless set per hole. Block: margin (m) around the drilling, extent limits.
  legend: { merge: 'auto', pos: {} }, coPlacement: 'column', blockMargin: null, blockExtent: null,
  // Files taken from the property's data library: { [file name]: { libFileId, version } } (library.js).
  libRefs: {},
  // shell.color null: the brand accent (brandTone). throughTerrain: a faint ghost where the terrain hides it.
  shell: { enabled: false, cutoff: null, opacity: 0.3, color: null, search: null, cell: null, throughTerrain: false },
  // Satellite imagery tone: saturation, contrast, warmth (-1 cool to 1 warm) and shaded-relief blend (0-1).
  imagery: { saturation: 1.05, contrast: 1.12, warmth: 0.25, relief: 0.55 },
};
const BIN_COLORS = ['#a3abaf', '#e2dc4f', '#ff9a1f', '#ef3b2c', '#e93ad1'];
const MESH_COLORS = ['#ff9a1f', '#e93ad1', '#2b8fd6', '#6aa84f', '#8e5bd6'];
const RIB_COLORS = ['#d6b48a', '#6aa84f']; // reported (broad) interval, "incl." interval

function addFiles(list) {
  for (const f of list) {
    const entry = { name: f.name, text: f.text };
    if (/\.obj$/i.test(f.name)) { entry.role = 'mesh'; entry.mesh = parseOBJ(f.text); }
    else {
      const { header, rows } = isXYZ(f.name, f.text) ? parseXYZ(f.text) : parseCSV(f.text); // EXT hook: Geosoft XYZ
      Object.assign(entry, { header, rows, cols: matchCols(header) });
      entry.role = refineRole(entry, roleOf(entry.cols, f.name), f.name); // EXT hook: lithology, geophysics
      entry.grades = entry.role === 'assay' ? gradeCols(header, entry.cols, rows) : [];
    }
    files = files.filter((x) => x.name !== entry.name);
    files.push(entry);
  }
}

const num = (s) => { if (s === undefined || s === null) return NaN; const t = String(s).trim().replace(/^</, ''); return t === '' ? NaN : parseFloat(t); };
function build() {
  const warnings = [];
  const byRole = (r) => files.filter((f) => f.role === r);
  const collarF = byRole('collar'), assayF = byRole('assay'), surveyF = byRole('survey'), topoF = byRole('topo'), meshF = byRole('mesh');
  // Collars
  const collars = new Map(), noXY = new Set(), dipBad = new Set(); let latlon = false;
  collarF.forEach((f) => { const ni = noteCol(f.header), fi = f.header.map(norm).findIndex((h) => /(^|_)(flags?|qualifications?|provisional)$/.test(h)); f.rows.forEach((r) => {
    const c = f.cols, id = (r[c.hole] || '').trim(); if (!id) return;
    let x = num(r[c.east]), y = num(r[c.north]);
    if ((!Number.isFinite(x) || !Number.isFinite(y)) && c.lat !== undefined) { x = num(r[c.lon]); y = num(r[c.lat]); latlon = true; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) { noXY.add(id); return; }
    if (Math.abs(num(r[c.dip])) > 90) dipBad.add(id);
    // A status or notes column last in the row keeps any unquoted commas ("Complete, assays pending").
    const note = ni < 0 ? '' : (ni === f.header.length - 1 ? r.slice(ni).join(',') : r[ni] || '').trim();
    collars.set(id, { id, x, y, z: num(r[c.elev]), depth: num(r[c.depth]), az: num(r[c.az]), dip: num(r[c.dip]), note, flags: fi < 0 || fi === ni ? '' : (r[fi] || '').trim(), raw: Object.fromEntries(f.header.map((k, i) => [k, r[i]])) }); // raw: EXT hook (hole status)
  }); });
  if (latlon) {
    const arr = [...collars.values()], lat0 = arr.reduce((s, c) => s + c.y, 0) / arr.length, lon0 = arr.reduce((s, c) => s + c.x, 0) / arr.length;
    arr.forEach((c) => { c.x = (c.x - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320; c.y = (c.y - lat0) * 110540; });
    latlon = { lat0, lon0 };
    warnings.push('Collars are in latitude/longitude; converted to metres. Topography and model files need UTM metres to line up.');
  }
  // Surveys
  const surveys = new Map();
  surveyF.forEach((f) => f.rows.forEach((r) => {
    const c = f.cols, id = (r[c.hole] || '').trim(), d = num(r[c.depth]); if (!id || !Number.isFinite(d)) return;
    if (!surveys.has(id)) surveys.set(id, []);
    const dip = num(r[c.dip]); if (Math.abs(dip) > 90) dipBad.add(id);
    surveys.get(id).push({ d, az: num(r[c.az]), dip });
  }));
  // Dip convention: if nearly every dip is positive, positive means down.
  const dips = [...[...surveys.values()].flat().map((s) => s.dip), ...[...collars.values()].map((c) => c.dip)].filter(Number.isFinite);
  const posDown = dips.length > 0 && dips.filter((d) => d > 0).length / dips.length > 0.9;
  const fixDip = (d) => (Number.isFinite(d) ? (posDown ? -Math.abs(d) : d) : NaN);
  // Assays
  const assays = new Map(), badRows = new Set(); let cols = [], assayRows = 0;
  assayF.forEach((f) => {
    cols = cols.concat(f.grades.map((g) => g.name));
    f.rows.forEach((r) => {
      const c = f.cols, id = (r[c.hole] || '').trim(), a = num(r[c.from]), b = num(r[c.to]);
      if (id) assayRows++;
      if (id && !(b > a)) badRows.add(id);
      if (!id || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
      const vals = {}; f.grades.forEach((g) => { vals[g.name] = num(r[g.i]); });
      if (!assays.has(id)) assays.set(id, []);
      assays.get(id).push({ from: a, to: b, vals });
    });
  });
  cols = [...new Set(cols)];
  applyEq(assays.values(), cols, warnings);
  if (!S.valueCol || !cols.includes(S.valueCol)) { S.valueCol = cols[0] || null; S.valueLabel = labelFor(S.valueCol); autoBins(assays); }
  if (S.valueCol2 && (!cols.includes(S.valueCol2) || S.valueCol2 === S.valueCol)) S.valueCol2 = null;
  const missing = [...assays.keys()].filter((id) => !collars.has(id));
  if (missing.length) warnings.push(`${missing.length} hole${missing.length > 1 ? 's' : ''} in the assays ${missing.length > 1 ? 'have' : 'has'} no collar (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}).`);
  const checks = dataChecks({ collars, noXY, assays, surveys, badRows, assayRows, dipBad, missing });
  if (!collars.size) return { warnings, empty: true, checks };
  // Elevations: fill missing collar Z from topography later
  const topoPts = [];
  topoF.forEach((f) => f.rows.forEach((r) => { const x = num(r[f.cols.east]), y = num(r[f.cols.north]), z = num(r[f.cols.elev]); if ([x, y, z].every(Number.isFinite)) topoPts.push([x, y, z]); }));

  // Desurvey each hole on a 2 m step (directions interpolated between stations).
  const holes = [];
  for (const c of collars.values()) {
    const ints = (assays.get(c.id) || []).sort((p, q) => p.from - q.from);
    let st = (surveys.get(c.id) || []).filter((s) => Number.isFinite(s.az) || Number.isFinite(s.dip)).sort((p, q) => p.d - q.d).map((s) => ({ d: s.d, az: Number.isFinite(s.az) ? s.az : (c.az || 0), dip: Number.isFinite(fixDip(s.dip)) ? fixDip(s.dip) : (fixDip(c.dip) || -90) }));
    if (!st.length) st = [{ d: 0, az: Number.isFinite(c.az) ? c.az : 0, dip: Number.isFinite(fixDip(c.dip)) ? fixDip(c.dip) : -90 }];
    const len = Math.max(Number.isFinite(c.depth) ? c.depth : 0, ints.length ? ints[ints.length - 1].to : 0, st[st.length - 1].d) || 200;
    const dirAt = (d) => {
      let i = 0; while (i + 1 < st.length && st[i + 1].d <= d) i++;
      const a = st[i], b = st[Math.min(i + 1, st.length - 1)], t = b.d > a.d ? Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d))) : 0;
      const v = (s) => { const az = s.az * Math.PI / 180, dp = s.dip * Math.PI / 180; return [Math.sin(az) * Math.cos(dp), Math.cos(az) * Math.cos(dp), Math.sin(dp)]; };
      const va = v(a), vb = v(b), m = va.map((x, k) => x + (vb[k] - x) * t), l = Math.hypot(...m) || 1; return m.map((x) => x / l);
    };
    holes.push({ id: c.id, c, ints, len, dirAt, path: null, note: c.note });
  }
  return { warnings, holes, topoPts, meshF, cols, posDown, latlon: latlon || null, checks };
}
// Data checks: what could not be placed and what looks wrong, by hole. Counts of intervals shown
// depend on the display cut-off, so getChecks() adds them when asked.
function dataChecks({ collars, noXY, assays, surveys, badRows, assayRows, dipBad, missing }) {
  const P = [], add = (kind, ids, text) => { ids = [...ids]; if (ids.length) P.push({ kind, count: ids.length, holes: ids.slice(0, 50), message: `${text(ids.length)}: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}` }); };
  const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const unplaced = [...noXY].filter((id) => !collars.has(id)), overlap = new Set(), beyond = new Set(), survey = new Set();
  assays.forEach((list, id) => {
    const l = list.slice().sort((p, q) => p.from - q.from), c = collars.get(id);
    for (let i = 1; i < l.length; i++) if (l[i].from < l[i - 1].to - 1e-6) { overlap.add(id); break; }
    if (c && Number.isFinite(c.depth) && l.some((it) => it.to > c.depth + 0.05)) beyond.add(id);
  });
  surveys.forEach((st, id) => {
    const at = new Map();
    st.forEach((x) => { const k = x.d.toFixed(2), o = at.get(k); if (!o) { at.set(k, x); return; }
      const daz = Math.abs(((o.az - x.az) % 360 + 540) % 360 - 180); if (daz > 0.5 || Math.abs(o.dip - x.dip) > 0.5) survey.add(id); });
  });
  // Outliers: a collar whose nearest neighbour is over 10 times the typical spacing (and 500 m) away.
  const cs = [...collars.values()], nn = cs.map((a) => cs.reduce((m, b) => (a === b ? m : Math.min(m, Math.hypot(a.x - b.x, a.y - b.y))), Infinity));
  const med = nn.slice().sort((a, b) => a - b)[Math.floor(nn.length / 2)], outliers = cs.length >= 4 ? cs.filter((c, i) => nn[i] > Math.max(500, 10 * med)).map((c) => c.id) : [];
  add('no-collar-coordinates', unplaced, (n) => `${s(n, 'hole has', 'holes have')} no collar coordinates and cannot be placed`);
  add('assays-without-collar', missing, (n) => `${s(n, 'hole', 'holes')} in the assays ${n === 1 ? 'has' : 'have'} no collar`);
  add('from-not-below-to', badRows, (n) => `Rows with From ≥ To (left out) in ${s(n, 'hole', 'holes')}`);
  add('overlapping-intervals', overlap, (n) => `Overlapping intervals in ${s(n, 'hole', 'holes')}`);
  add('beyond-hole-depth', beyond, (n) => `Intervals beyond the collar depth in ${s(n, 'hole', 'holes')}`);
  add('conflicting-survey-depths', survey, (n) => `Survey stations at one depth with different readings in ${s(n, 'hole', 'holes')}`);
  add('dip-out-of-range', dipBad, (n) => `Dips outside −90 to 90 in ${s(n, 'hole', 'holes')}`);
  add('collar-outlier', outliers, (n) => `${s(n, 'collar lies', 'collars lie')} far from the others (check the coordinates)`);
  const ids = new Set([...collars.keys(), ...noXY, ...assays.keys()]);
  let placed = 0; collars.forEach((c, id) => { placed += (assays.get(id) || []).length; });
  return { counts: { holes: ids.size, holesPlaced: collars.size, assaysLoaded: assayRows, assaysPlaced: placed }, problems: P };
}
// Metal equivalent: the derived column (e.g. CuEq_calc) on every interval. A missing component
// gives no value, never a zero.
const eqName = () => (S.eq ? `${S.eq.base}Eq_calc` : null);
let eqApplied = false; // whether eqName() on the project is ours (false when an uploaded column has that name)
const metalOf = (col) => (/eq/i.test(col) ? null : (col.match(/(?:^|[^a-z])(cu|au|ag|mo|zn|pb|ni|co|pt|pd)(?![a-z])/i) || [])[1]?.replace(/^./, (c) => c.toUpperCase()) || null);
const unitOf = (col) => (labelFor(col).match(/(%|g\/t|ppm|ppb)$/) || [])[0] || defaultUnit(metalOf(col));
function eqInfo(e = S.eq) {
  const ms = Object.entries(e.metals).map(([metal, m]) => ({ metal, ...m }));
  const factors = eqFactors({ metal: e.base, unit: e.baseUnit, price: e.basePrice, recovery: e.baseRecovery }, ms);
  const money = (v) => `US$${v.toLocaleString('en-US', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const prices = [{ metal: e.base, price: e.basePrice }, ...ms].map((m) => `${m.metal} ${money(m.price)}/${priceUnit(m.metal)}`).join(', ');
  const recs = [{ metal: e.base, recovery: e.baseRecovery }, ...ms].map((m) => `${m.metal} ${m.recovery}%`).join(', ');
  const formula = eqFormula(e.base, factors);
  return { name: `${e.base}Eq_calc`, factors, formula, note: `${formula} (calculated; ${e.base} ${e.baseUnit}, ${ms.map((m) => `${m.metal} ${m.unit}`).join(', ')}). Prices ${prices}; recoveries ${recs}. Assumptions are illustrative.` };
}
function applyEq(lists, cols, warnings) {
  if (!S.eq) return;
  const e = S.eq, comp = Object.values(e.metals).map((m) => m.col), miss = [e.baseCol, ...comp].filter((c) => !cols.includes(c));
  if (miss.length) { warnings?.push(`The metal equivalent needs ${miss.join(', ')}, which ${miss.length > 1 ? 'are' : 'is'} not in the assays.`); return; }
  const { name, factors } = eqInfo();
  // An uploaded column of the same name is the user's data: never overwrite it.
  if (cols.includes(name)) { eqApplied = false; warnings?.push(`The assays already have a column named ${name}, so the calculated equivalent was not added. Rename that column to use the calculator.`); return; }
  eqApplied = true;
  for (const list of lists) list.forEach((it) => { it.vals[name] = eqValue(it.vals[e.baseCol], comp.map((c) => it.vals[c]), factors); });
  if (!cols.includes(name)) cols.push(name);
}
const noteCol = (header) => header.map(norm).findIndex((h) => /(^|_)(status|notes?|comments?|remarks?)$/.test(h));
// "ASSAYS PENDING": the collar status or notes say so, or (when asked) the hole has no assays yet.
const isPending = (h) => /pending/i.test(h.note || '') || (S.pendingNoAssays && !h.ints.length);
// Provisional position: the collar status or flags say so, unless set by hand (S.provisional).
const PROV_RE = /provisional|projected|approximate|unverified|unsurveyed|hand-?held|flagged|uncertain/i;
const isProvisional = (h) => (typeof S.provisional[h.id] === 'boolean' ? S.provisional[h.id] : PROV_RE.test(`${h.note || ''} ${h.c.flags || ''}`));
function labelFor(col) {
  if (!col) return '';
  if (S.eq && col === eqName()) return `${S.eq.base}Eq ${S.eq.baseUnit}`;
  const el = (col.match(/(cueq|aueq|ageq|li2o|u3o8|cu|au|ag|zn|pb|ni|co|mo|pt|pd)/i) || [col])[0];
  const pretty = { cueq: 'CuEq', aueq: 'AuEq', ageq: 'AgEq', li2o: 'Li₂O', u3o8: 'U₃O₈' }[el.toLowerCase()] || el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
  const unit = /pct|%|_pc\b|percent/i.test(col) ? '%' : /gpt|g_t|gt\b|g\/t/i.test(col) ? 'g/t' : /ppm/i.test(col) ? 'ppm' : /ppb/i.test(col) ? 'ppb' : '';
  return unit ? `${pretty} ${unit}` : pretty;
}
function niceRound(v) { if (!(v > 0)) return 0; const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return +((m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 3 : m < 7.5 ? 5 : 10) * p).toPrecision(6); } // 0.30000000000000004 → 0.3
function autoBins(assays) {
  const vals = []; assays.forEach((list) => list.forEach((a) => { const v = a.vals[S.valueCol]; if (Number.isFinite(v)) vals.push(v); }));
  if (!vals.length) return;
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  let b = [q(0.4), q(0.6), q(0.78), q(0.92)].map(niceRound);
  for (let i = 1; i < 4; i++) if (b[i] <= b[i - 1]) b[i] = niceRound(b[i - 1] * 1.6);
  S.bins = b; S.coCut = b[2]; S.coIncl = b[3];
}

// ============================================================
// 4. Scene
// ============================================================
const stage = $('stage'), glCanvas = $('gl'), ov = $('ov'), secCanvas = $('section');
// alpha: the designer layers render the scene alone on transparent (scene.background = null);
// the preview and the figure keep the scene's white background.
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
let DPR = Math.min(window.devicePixelRatio || 1, 2); renderer.setPixelRatio(DPR);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
const camera = new THREE.PerspectiveCamera(32, 1, 1, 1e6);
scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4bb', 0.9));
const sun = new THREE.DirectionalLight('#ffffff', 0.55); sun.position.set(-1, 2, 1.2); scene.add(sun);
const controls = new OrbitControls(camera, glCanvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49;
let root = new THREE.Group(); scene.add(root);
let G = null; // geometry context: origin, block, surface, holes w/ paths, meshes

function rebuildScene(keepCam) {
  const cam0 = keepCam && G ? getCam() : null, fit0 = G?.fit || 1;
  scene.remove(root); root.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }); root = new THREE.Group(); scene.add(root);
  if (!project || project.empty) { G = null; return; }
  const holes = project.holes;
  // Elevations as read: an earlier build may have filled or hung them from a surface.
  holes.forEach((h) => { if (!('zRead' in h.c)) h.c.zRead = h.c.z; h.c.z = h.c.zRead; });
  // Paths every 2 m (from 0 when the collar has no elevation; shifted onto the surface below)
  holes.forEach((h) => {
    const z0 = Number.isFinite(h.c.z) ? h.c.z : 0, pts = [{ d: 0, x: h.c.x, y: h.c.y, z: z0 }]; let p = { x: h.c.x, y: h.c.y, z: z0 };
    for (let d = 0; d < h.len; d += 2) { const s = Math.min(2, h.len - d), v = h.dirAt(d + s / 2); p = { x: p.x + v[0] * s, y: p.y + v[1] * s, z: p.z + v[2] * s }; pts.push({ d: d + s, ...p }); }
    h.path = pts;
    h.posAt = (d) => { const i = Math.max(0, Math.min(pts.length - 2, Math.floor(d / 2))), a = pts[i], b = pts[i + 1], t = Math.max(0, Math.min(1, (d - a.d) / ((b.d - a.d) || 1))); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; };
  });
  // Block extent from the holes
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zmin = Infinity;
  holes.forEach((h) => h.path.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); if (Number.isFinite(p.z)) zmin = Math.min(zmin, p.z); }));
  // A located project gets more ground around the drilling, for the terrain and imagery to read; a margin
  // set by hand overrides it, and any extent limit set by hand wins.
  const pad = Number.isFinite(S.blockMargin) ? S.blockMargin : Math.max(60, (geo ? 0.25 : 0.14) * Math.max(x1 - x0, y1 - y0)), E = S.blockExtent || {};
  const B = { x0: E.x0 ?? x0 - pad, x1: E.x1 ?? x1 + pad, y0: E.y0 ?? y0 - pad, y1: E.y1 ?? y1 + pad };
  const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, bw = B.x1 - B.x0, bh = B.y1 - B.y0, diag = Math.hypot(bw, bh);
  // Surface: uploaded topography, else the real DEM (once a coordinate system is set and its tiles
  // load), else a fit to the collar elevations. terrainSource can force one.
  const topo = project.topoPts.filter(([x, y]) => x > B.x0 - pad && x < B.x1 + pad && y > B.y0 - pad && y < B.y1 + pad);
  const dem = realT.dem && realT.dem.ok && realT.dem.key === terrainKeyOf(B) ? realT.dem : null, want = S.terrainSource;
  const using = want === 'collars' ? 'collars' : want === 'dem' && dem ? 'dem' : topo.length >= 4 ? 'topo' : dem ? 'dem' : 'collars';
  let src = using === 'topo' ? topo : holes.filter((h) => Number.isFinite(h.c.z)).map((h) => [h.c.x, h.c.y, h.c.z]);
  if (!src.length) src = [[cx, cy, 0]];
  const NG = using === 'dem' ? 200 : 110, grid = new Float32Array((NG + 1) * (NG + 1));
  for (let j = 0; j <= NG; j++) for (let i = 0; i <= NG; i++) {
    const x = B.x0 + bw * i / NG, y = B.y0 + bh * j / NG; let sw = 0, sz = 0, exact = using === 'dem' ? dem.at(x, y) : null;
    if (Number.isFinite(exact)) { grid[j * (NG + 1) + i] = exact; continue; } exact = null;
    for (const [px, py, pz] of src) { const d2 = (px - x) ** 2 + (py - y) ** 2; if (d2 < 1) { exact = pz; break; } const w = 1 / d2; sw += w; sz += w * pz; }
    grid[j * (NG + 1) + i] = exact ?? sz / sw;
  }
  if (using !== 'dem' && src.length > 60) for (let pass = 0; pass < 2; pass++) { const r = NG + 1, cp = grid.slice();
    for (let j = 1; j < NG; j++) for (let i = 1; i < NG; i++) { const k = j * r + i; grid[k] = (cp[k] * 4 + cp[k - 1] + cp[k + 1] + cp[k - r] + cp[k + r]) / 8; } }
  const surf = (x, y) => {
    const fi = Math.max(0, Math.min(NG - 1e-6, (x - B.x0) / bw * NG)), fj = Math.max(0, Math.min(NG - 1e-6, (y - B.y0) / bh * NG)), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, r = NG + 1;
    return grid[j * r + i] * (1 - a) * (1 - b) + grid[j * r + i + 1] * a * (1 - b) + grid[(j + 1) * r + i] * (1 - a) * b + grid[(j + 1) * r + i + 1] * a * b;
  };
  // Surveyed collar elevations are data; a DEM tile is an approximation, often on another datum. By
  // default the DEM moves (by the median collar-minus-DEM offset) to pass through the collars; with
  // collarFit "terrain" each hole hangs from the DEM instead.
  let terrainNote = '';
  if (using === 'dem') {
    const off = holes.filter((h) => Number.isFinite(h.c.z)).map((h) => h.c.z - surf(h.c.x, h.c.y)).filter(Number.isFinite).sort((a, b) => a - b), med = off[Math.floor(off.length / 2)] || 0;
    if (S.collarFit !== 'terrain' && Math.abs(med) >= 1) {
      for (let k = 0; k < grid.length; k++) grid[k] += med;
      terrainNote = `Terrain shifted ${med > 0 ? '+' : '−'}${Math.round(Math.abs(med))} m to meet the collars.`;
    }
  }
  // Collars with no elevation take the surface; then shift their paths.
  holes.forEach((h) => { if (!Number.isFinite(h.c.z)) { const z = surf(h.c.x, h.c.y); h.path.forEach((p) => { p.z += z; }); h.c.z = z; } });
  if (using === 'dem' && S.collarFit === 'terrain') {
    const off = holes.map((h) => surf(h.c.x, h.c.y) - h.c.z).sort((a, b) => a - b), med = off[Math.floor(off.length / 2)] || 0;
    holes.forEach((h) => { const d = surf(h.c.x, h.c.y) - h.c.z; h.path.forEach((p) => { p.z += d; }); h.c.z += d; });
    if (Math.abs(med) >= 1) terrainNote = `Holes hung from the terrain: collars moved ${med > 0 ? '+' : '−'}${Math.round(Math.abs(med))} m (median) to the DEM surface.`;
  }
  zmin = Math.min(...holes.flatMap((h) => h.path.map((p) => p.z)));
  let zmax = -Infinity; for (const v of grid) zmax = Math.max(zmax, v);
  B.z0 = Number.isFinite(E.z0) && E.z0 < zmax - 10 ? E.z0 : zmin - Math.max(25, 0.05 * diag);
  const zref = (zmax + B.z0) / 2;
  const vex = S.vex, V = (x, y, z) => new THREE.Vector3(x - cx, (z - zref) * vex, -(y - cy));
  // diag sizes marks (tubes, labels) by the whole block; the camera distance
  // (baseDist) adds the depth only as far as it shows at the view's plunge, so a
  // tight collar pattern with 600 m holes (Star Main) is framed from the side
  // without shrinking the plan view.
  G = { B, cx, cy, bw, bh, diag: Math.max(diag, Math.hypot(bw, bh, zmax - B.z0)), diagH: diag, depth: (zmax - B.z0) * vex, surf, V, zref, zmax, using, terrainNote, fit: cam0 ? fit0 : 1 };

  // Terrain top: elevation and hillshade cached once per build; paintTerrain colours them by style.
  {
    const TW = 768, TH = Math.max(64, Math.round(768 * bh / bw)), cell = bw / TW, hs = new Float32Array(TW * TH), shade = new Float32Array(TW * TH);
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) hs[py * TW + px] = surf(B.x0 + px * cell, B.y1 - py * bh / TH);
    let lo = Infinity, hi = -Infinity; hs.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const sunv = [-0.5, 0.5, 0.71], rng = mulberry32(7), speck = new Uint8Array(TW * TH);
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const i = py * TW + px, hx = hs[py * TW + Math.min(px + 1, TW - 1)] - hs[py * TW + Math.max(px - 1, 0)], hy = hs[Math.max(py - 1, 0) * TW + px] - hs[Math.min(py + 1, TH - 1) * TW + px];
      const nx = -hx / (2 * cell), ny = -hy / (2 * bh / TH), l = Math.hypot(nx, ny, 1);
      shade[i] = Math.max(0, (nx * sunv[0] + ny * sunv[1] + sunv[2]) / l); speck[i] = rng() < 0.2 ? 1 : 0;
    }
    G.terr = { TW, TH, hs, shade, speck, lo, hi };
  }
  G.topBase = document.createElement('canvas'); G.topCanvas = document.createElement('canvas');
  G.topTex = new THREE.CanvasTexture(G.topCanvas); G.topTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const TS = using === 'dem' ? 220 : 140, tg = new THREE.PlaneGeometry(bw, bh, TS, Math.max(20, Math.round(TS * bh / bw)));
  { const pos = tg.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + cx, y = pos.getY(i) + cy, v = V(x, y, surf(x, y)); pos.setXYZ(i, v.x, v.y, v.z); } }
  G.top = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: G.topTex, side: THREE.DoubleSide, transparent: true })); G.top.renderOrder = 6; root.add(G.top);

  // Walls, base, edges, shadow
  G.walls = [];
  // Rows crowd toward the top so the solid block's thin soil band under the terrain stays crisp.
  const NJ = 30, FR = Array.from({ length: NJ + 1 }, (_, j) => 1 - (1 - j / NJ) ** 2);
  const wall = (p0, p1, face) => {
    const NI = 100, pos = [], col = [], idx = [];
    for (let i = 0; i <= NI; i++) { const x = p0[0] + (p1[0] - p0[0]) * i / NI, y = p0[1] + (p1[1] - p0[1]) * i / NI, top = surf(x, y);
      for (let j = 0; j <= NJ; j++) { const z = B.z0 + (top - B.z0) * FR[j], v = V(x, y, z); pos.push(v.x, v.y, v.z); col.push(1, 1, 1, 1); } }
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) { const a = i * (NJ + 1) + j, b = a + NJ + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); // RGBA: the solid block fades by row
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })); m.renderOrder = 5;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy); // corners run anticlockwise, so (dy, -dx) points out
    Object.assign(m.userData, { face, nj: NJ, fr: FR, n: new THREE.Vector3(dy / l, 0, dx / l), c: V((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (B.z0 + zmax) / 2) });
    root.add(m); G.walls.push(m);
  };
  const C = [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]];
  C.forEach((p, i) => wall(p, C[(i + 1) % 4], 'SENW'[i])); // in the order of geology.js FACE_KEYS
  const baseM = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ color: '#e9ecea', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  baseM.rotation.x = -Math.PI / 2; baseM.position.copy(V(cx, cy, B.z0)); root.add(baseM); G.walls.push(baseM);
  const seg = [];
  C.forEach(([x, y], i) => { const [x2, y2] = C[(i + 1) % 4]; seg.push(V(x, y, B.z0), V(x2, y2, B.z0), V(x, y, B.z0), V(x, y, surf(x, y)));
    for (let k = 0; k < 50; k++) { const a = k / 50, b = (k + 1) / 50; seg.push(V(x + (x2 - x) * a, y + (y2 - y) * a, surf(x + (x2 - x) * a, y + (y2 - y) * a)), V(x + (x2 - x) * b, y + (y2 - y) * b, surf(x + (x2 - x) * b, y + (y2 - y) * b))); } });
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: '#8f9a9f' })));
  {
    // The block floats: a soft, blurred footprint shadow a little below it. Drawn as the shadow of a
    // square held off-canvas, which blurs the same in every browser (ctx.filter does not).
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.shadowColor = 'rgba(28,36,40,0.5)'; g.shadowBlur = 30; g.shadowOffsetX = 1000; g.fillStyle = '#000'; g.fillRect(64 - 1000, 64, 128, 128);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(bw * 2, bh * 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.copy(V(cx + bw * 0.03, cy - bh * 0.03, B.z0 - diag * 0.07 / vex)); root.add(sh);
  }

  // Holes: grey trace, then coloured assay intervals. Provisional positions: dashed and fainter.
  const traceSeg = [[], [], [], []]; // EXT hook: [2] planned, [3] faded previously released
  holes.forEach((h) => { h.planned = isPlanned(h); }); // EXT hook: before extFade reads the statuses
  computeCallouts(); // the key holes (EXT hook: emphasis) include the callout holes
  holes.forEach((h) => { h.prov = isProvisional(h); for (let i = 0; i + 1 < h.path.length; i++) traceSeg[h.planned ? 2 : h.prov ? 1 : extFade(h) ? 3 : 0].push(V(h.path[i].x, h.path[i].y, h.path[i].z), V(h.path[i + 1].x, h.path[i + 1].y, h.path[i + 1].z)); });
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(traceSeg[0]), new THREE.LineBasicMaterial({ color: '#59646a' })));
  if (traceSeg[1].length) { const dl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(traceSeg[1]), new THREE.LineDashedMaterial({ color: '#59646a', dashSize: diag / 120, gapSize: diag / 180, transparent: true, opacity: 0.75 })); dl.computeLineDistances(); root.add(dl); }
  if (traceSeg[2].length) { const dl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(traceSeg[2]), new THREE.LineDashedMaterial({ color: S.primary, dashSize: diag / 90, gapSize: diag / 150 })); dl.computeLineDistances(); root.add(dl); } // EXT hook
  if (traceSeg[3].length) root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(traceSeg[3]), new THREE.LineBasicMaterial({ color: '#b7c0c3' }))); // EXT hook
  const nInt = holes.reduce((s, h) => s + h.ints.length, 0);
  // three 0.147 culls an InstancedMesh by its unit base geometry at the origin, not its instances.
  const tube = (mat) => { const t = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), mat, Math.max(1, nInt)); t.frustumCulled = false; root.add(t); return t; };
  G.tubes = tube(new THREE.MeshLambertMaterial()); G.tubesP = tube(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55 })); G.tubesP.renderOrder = 3;
  // Intercept ribbons: flat bars beside each trace, broad then "incl." nudged toward the camera.
  // Turned to face the view in placeRibbons, so capacity is one piece per 8 m of hole.
  const ribCap = holes.reduce((s, h) => s + Math.ceil(h.len / 8) + 1, 0), rg = new THREE.PlaneGeometry(1, 1);
  G.ribbons = RIB_COLORS.map((c, i) => { const rm = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 * i, polygonOffsetUnits: -2 * i }), Math.max(1, ribCap));
    rm.frustumCulled = false; rm.count = 0; rm.renderOrder = 1 + i; root.add(rm); return rm; });
  G.ribbonCap = ribCap; G.ribbonView = null;
  // Meshes
  G.meshes = [];
  project.meshF.forEach((f, k) => {
    const st = S.meshes[f.name] || (S.meshes[f.name] = { color: MESH_COLORS[k % MESH_COLORS.length], show: true, opacity: 0.25 });
    const pos = []; f.mesh.v.forEach(([x, y, z]) => { const v = V(x, y, z); pos.push(v.x, v.y, v.z); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(f.mesh.f); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: st.color, transparent: true, opacity: st.opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 4; m.visible = st.show; root.add(m); G.meshes.push({ name: f.name, m });
  });
  paintTerrain(); restyle(); buildWallLabels();
  if (cam0) setCamera(cam0, true); else applyView('a', true);
  syncRealTerrain(); syncShell(); extScene(); // EXT hook
}

// Terrain looks. Light and relief are paper hillshades; satellite and muted drape imagery when it has
// loaded and otherwise fall back to natural. Pale styles also whiten the glass sides.
const TERRAINS = { natural: 'Natural', light: 'Light relief', dark: 'Dark slate', relief: 'Shaded relief', satellite: 'Satellite', muted: 'Satellite, muted' };
const PALE = new Set(['light', 'relief', 'satellite', 'muted']);
// Satellite tone: lifted midtones, a touch of contrast and exposure, so forest reads green and tracks show.
const TONE = Uint8ClampedArray.from({ length: 256 }, (_, v) => 255 * (((v / 255) ** 0.74 - 0.5) * 1.08 + 0.53));
const imageryShown = () => !!G && (S.terrain === 'satellite' || S.terrain === 'muted') && !!realT.img?.ok && realT.img.key === terrainKeyOf(G.B);
function paintTerrain() {
  if (!G) return;
  const T = G.terr, img = imageryShown() ? realT.img : null, tw = img ? img.w : T.TW, th = img ? img.h : T.TH, st = S.terrain;
  if (G.topCanvas.width !== tw || G.topCanvas.height !== th) {
    G.topCanvas.width = G.topBase.width = tw; G.topCanvas.height = G.topBase.height = th;
    // A texture cannot change size in place.
    G.topTex.dispose(); G.topTex = new THREE.CanvasTexture(G.topCanvas); G.topTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (G.top) { G.top.material.map = G.topTex; G.top.material.needsUpdate = true; }
  }
  const ctx = G.topBase.getContext('2d'), out = ctx.createImageData(tw, th), d = out.data, { TW, TH, hs, shade, speck, lo, hi } = T;
  const step = Math.max(5, niceRound((hi - lo) / 14)), band = (v) => Math.floor(v / step);
  const natural = (i) => {
    const sh = shade[i], t = (hs[i] - lo) / ((hi - lo) || 1), right = hs[Math.min(i + 1, hs.length - 1)];
    const f = (0.42 + 0.8 * sh) * (speck[i] ? 0.9 : 1), contour = Math.floor(hs[i] / 25) !== Math.floor(right / 25) ? 0.82 : 1;
    return [(78 + 96 * t) * f * contour, (100 + 74 * t) * f * contour, (66 + 82 * t) * f * contour];
  };
  if (img) {
    const { saturation: sat = 1, contrast: con = 1, warmth: warm = 0, relief: rel = 0 } = S.imagery || {};
    for (let py = 0; py < th; py++) { const sy = Math.min(TH - 1, Math.floor(py * TH / th));
      for (let px = 0; px < tw; px++) {
        const i = py * tw + px, si = sy * TW + Math.min(TW - 1, Math.floor(px * TW / tw)), sh = shade[si];
        if (img.data[i * 4 + 3] < 128) { const c = natural(si); d[i * 4] = Math.min(255, c[0]); d[i * 4 + 1] = Math.min(255, c[1]); d[i * 4 + 2] = Math.min(255, c[2]); d[i * 4 + 3] = 255; continue; }
        let r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2], f = 0.9 + 0.14 * sh;
        if (st === 'satellite') {
          r = TONE[r]; g = TONE[g]; b = TONE[b]; const l = 0.3 * r + 0.59 * g + 0.11 * b;
          r = 128 + (l + (r - l) * sat - 128) * con + 16 * warm; g = 128 + (l + (g - l) * sat - 128) * con + 3 * warm; b = 128 + (l + (b - l) * sat - 128) * con - 16 * warm;
          f = 1 - 0.6 * rel + 0.85 * rel * sh; // the hillshade multiplied in, so slopes read
        }
        if (st === 'muted') { const l = 0.3 * r + 0.59 * g + 0.11 * b; r = (l + (r - l) * 0.4) * 0.6 + 98; g = (l + (g - l) * 0.4) * 0.6 + 100; b = (l + (b - l) * 0.4) * 0.6 + 97; f = 0.86 + 0.22 * sh; }
        d[i * 4] = Math.min(255, Math.max(0, r * f)); d[i * 4 + 1] = Math.min(255, Math.max(0, g * f)); d[i * 4 + 2] = Math.min(255, Math.max(0, b * f)); d[i * 4 + 3] = 255;
      } }
  } else {
    for (let i = 0; i < TW * TH; i++) {
      const sh = shade[i], t = (hs[i] - lo) / ((hi - lo) || 1), right = hs[Math.min(i + 1, hs.length - 1)], down = hs[Math.min(i + TW, hs.length - 1)];
      const edge = band(hs[i]) !== band(right) || band(hs[i]) !== band(down), index = edge && (Math.floor(hs[i] / (step * 5)) !== Math.floor(right / (step * 5)) || Math.floor(hs[i] / (step * 5)) !== Math.floor(down / (step * 5)));
      let c;
      if (st === 'light') { const v = Math.min(1, 0.3 + 0.95 * sh) * (edge ? (index ? 0.9 : 0.955) : 1); c = [154 + 88 * v, 163 + 81 * v, 166 + 77 * v]; }
      else if (st === 'relief') { const v = Math.max(0, Math.min(1, 1.25 * sh - 0.1)) * (edge ? (index ? 0.82 : 0.92) : 1); c = [(70 + 182 * v) + 8 * (t - 0.5), 78 + 175 * v, (84 + 166 * v) - 8 * (t - 0.5)]; }
      else if (st === 'dark') { const f = (0.42 + 0.85 * sh) * (edge ? 0.86 : 1); c = [(40 + 46 * t) * f, (55 + 44 * t) * f, (61 + 42 * t) * f]; }
      else c = natural(i); // natural, and satellite before its imagery arrives
      d[i * 4] = Math.min(255, c[0]); d[i * 4 + 1] = Math.min(255, c[1]); d[i * 4 + 2] = Math.min(255, c[2]); d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  G.walls.forEach((w) => { w.userData.tk = undefined; });
  faceWalls();
}
// Wall colour and alpha per row. Solid: pale cream rock, a shade darker at depth, under a dark soil band
// that traces the terrain profile on every face; the far faces near-opaque, the faces toward the camera
// almost clear apart from that band (the agency figures cut the near faces away), so holes stay visible.
// Glass: the even translucent sides. Re-run when a face turns between near and far. While geology or
// geophysics paints a face (clear), the near faces drop their veil and the painted face's own wall goes
// under the paint, so painted faces show their true colour.
function tintWall(w, near, clear) {
  const ca = w.geometry.attributes.color, { nj, fr } = w.userData, solid = S.blockStyle === 'solid', pale = PALE.has(S.terrain);
  for (let k = 0; k < ca.count; k++) {
    const j = fr[k % (nj + 1)];
    if (solid) {
      const soil = Math.min(1, Math.max(0, (j - 0.94) / 0.045)), r = 0.8 + 0.1 * j, g = 0.78 + 0.1 * j, b = 0.74 + 0.1 * j;
      ca.setXYZW(k, r + (0.42 - r) * soil, g + (0.36 - g) * soil, b + (0.29 - b) * soil, near ? (clear ? 0 : 0.1) + 0.85 * soil : 0.92 + 0.08 * soil);
    } else { const t = pale ? 0.965 + 0.035 * j : 0.92 + 0.07 * j; ca.setXYZW(k, t * (pale ? 0.995 : 0.98), t, t * 0.99, 1); }
  }
  ca.needsUpdate = true;
}
function faceWalls() {
  if (!G) return; extView(); // EXT hook: painted faces follow the near/far turn
  const solid = S.blockStyle === 'solid', eye = camera.position, painted = extPainted();
  G.walls.forEach((w) => {
    const d = w.userData;
    if (!d.n) { w.material.color.set(solid ? '#cfcac0' : PALE.has(S.terrain) ? '#f3f5f4' : '#e9ecea'); w.material.opacity = solid ? 0.9 : 0.6; w.renderOrder = solid ? 1 : 0; return; }
    const near = d.n.dot(eye.clone().sub(d.c)) > 0, clear = near && painted.size > 0, tk = `${solid && near}|${clear}`;
    if (d.tk !== tk) { tintWall(w, solid && near, clear); d.tk = tk; }
    // Far solid faces and painted faces go first, before the paint, the model shapes (which do not write
    // depth) and the holes' veils.
    w.material.opacity = solid ? 1 : clear ? 0.15 : 0.42; w.renderOrder = (solid && !near) || painted.has(d.face) ? 1 : 5;
  });
  (G.wallLabelMeshes || []).forEach(placeWallLabel); // keeps their minimum size as the view changes
}

// ============================================================
// 4b. Real terrain: coordinate system, DEM and satellite tiles
// ============================================================
// Tiles load as <img crossOrigin="anonymous">, not fetch(): the page's CSP allows https images but not
// these hosts in connect-src. A tile refused by CORS never loads at all, so the mosaic canvas is never
// tainted and exports keep working; missing tiles just leave gaps that fall back to the fitted surface.
const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const IMG_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const IMAGERY_CREDIT = 'Imagery: Esri, Maxar, Earthstar Geographics', DEM_CREDIT = 'Elevation: AWS Terrain Tiles';
let geo = null;          // { code, label, guessed, fwd(x, y) -> [lon, lat] } once a coordinate system is set
const realT = { dem: null, img: null, job: 0, promise: null, status: 'off', message: '' };
let P4 = null;           // proj4, loaded on first use
const UTM_FAMILIES = [   // [first EPSG code, last, first zone, south, datum, label]
  [32601, 32660, 1, false, '+datum=WGS84', 'WGS 84'], [32701, 32760, 1, true, '+datum=WGS84', 'WGS 84'],
  [26901, 26923, 1, false, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'NAD83'], [26703, 26722, 3, false, '+ellps=clrk66 +towgs84=-8,160,176,0,0,0,0', 'NAD27'],
  [25828, 25838, 28, false, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'ETRS89'], [28349, 28356, 49, true, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'GDA94 MGA'],
  [7846, 7859, 46, true, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'GDA2020 MGA'], [31965, 31976, 11, false, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'SIRGAS 2000'],
  [31977, 31985, 17, true, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0', 'SIRGAS 2000'], [24817, 24821, 17, false, '+ellps=intl +towgs84=-288,175,-376,0,0,0,0', 'PSAD56'],
  [24877, 24881, 17, true, '+ellps=intl +towgs84=-288,175,-376,0,0,0,0', 'PSAD56'],
];
const DATUM_WORDS = [[/nad\s*83/i, 26901], [/nad\s*27/i, 26703], [/etrs/i, 25828], [/gda\s*2020/i, 7846], [/gda|mga/i, 28349], [/sirgas/i, 31965], [/psad/i, 24817]];
// "EPSG:26909", 26909, "UTM 9N", "NAD83 / UTM zone 9N", "WGS84 UTM 19S", "EPSG:4326" or a proj4 string.
function parseCRS(input) {
  const t = String(input).trim(), utm = (zone, south, fam) => ({ def: `+proj=utm +zone=${zone}${south ? ' +south' : ''} ${fam[4]} +units=m +no_defs`, label: `${fam[5]} / UTM ${zone}${south ? 'S' : 'N'}`, utm: true });
  if (/^\+proj=/.test(t)) return { code: t, label: 'Custom (proj4)', def: t, utm: /utm/.test(t) };
  const m = t.match(/^(?:epsg:\s*)?(\d{4,5})$/i);
  if (m) {
    const n = +m[1]; if (n === 4326) return { code: 'EPSG:4326', label: 'WGS 84 latitude/longitude', latlon: true };
    const fam = UTM_FAMILIES.find((f) => n >= f[0] && n <= f[1]);
    if (!fam) throw new Error(`EPSG:${n} is not supported here. Use a UTM code (e.g. EPSG:326xx, 327xx, 269xx, 258xx, 283xx), "UTM 9N", EPSG:4326 or a proj4 string.`);
    return { code: `EPSG:${n}`, ...utm(fam[2] + n - fam[0], fam[3], fam) };
  }
  const u = t.match(/utm\s*(?:zone\s*)?(\d{1,2})\s*([ns])?\b/i);
  if (u) {
    const zone = +u[1], south = /s/i.test(u[2] || '') || /south/i.test(t); if (zone < 1 || zone > 60) throw new Error('UTM zones run from 1 to 60.');
    const hit = DATUM_WORDS.find(([re]) => re.test(t)), name = hit ? UTM_FAMILIES.find((f) => f[0] === hit[1])[5] : 'WGS 84';
    const fam = UTM_FAMILIES.find((f) => f[5] === name && f[3] === south && zone >= f[2] && zone <= f[2] + f[1] - f[0]);
    return fam ? { code: `EPSG:${fam[0] + zone - fam[2]}`, ...utm(zone, south, fam) } : { code: `UTM ${zone}${south ? 'S' : 'N'} ${name}`, ...utm(zone, south, UTM_FAMILIES.find((f) => f[5] === name)) };
  }
  if (/^(wgs\s*84|lat.?lon|latitude|geographic)/i.test(t)) return { code: 'EPSG:4326', label: 'WGS 84 latitude/longitude', latlon: true };
  throw new Error(`"${t}" is not a coordinate system this page knows. Try "EPSG:26909", "UTM 9N NAD83" or "EPSG:4326".`);
}
// The forward transform from project metres to [lon, lat]; checked against the collars.
function geoFor(c, P) {
  if (c.latlon) {
    const ll = P?.latlon; if (!ll) throw new Error('These collars are in metres, not latitude/longitude. Give the UTM zone or EPSG code of the files.');
    return (x, y) => [ll.lon0 + x / (Math.cos(ll.lat0 * Math.PI / 180) * 111320), ll.lat0 + y / 110540];
  }
  if (P?.latlon) throw new Error('These collars are in latitude/longitude; the coordinate system is set to EPSG:4326 automatically.');
  const f = P4(c.def, 'WGS84'), fwd = (x, y) => f.forward([x, y]);
  const h = P?.holes?.[0];
  if (h) {
    if (c.utm && (h.c.x < 100000 || h.c.x > 900000 || h.c.y < 0 || h.c.y > 10000000)) throw new Error(`Collar ${h.id} at ${Math.round(h.c.x)} E, ${Math.round(h.c.y)} N is not a UTM coordinate. Check the easting and northing columns.`);
    const [lon, lat] = fwd(h.c.x, h.c.y); if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 84) throw new Error(`${c.label} puts collar ${h.id} off the map. Check the zone and hemisphere.`);
  }
  return fwd;
}
async function setCRS(input, opts = {}) {
  if (input === null || input === undefined || input === '') {
    S.crs = null; geo = null; realT.dem = realT.img = null; realT.job++; realT.status = 'off';
    renderCRS(); if (project && !project.empty) rebuildScene(true); schedulePublish(); status('Coordinate system cleared. The surface is fitted to your files.'); return getState();
  }
  const c = parseCRS(input);
  if (!c.latlon && !P4) P4 = (await import('proj4')).default;
  const fwd = geoFor(c, project && !project.empty ? project : null);
  S.crs = c.code; geo = { ...c, guessed: !!opts.guessed, fwd }; realT.dem = realT.img = null;
  renderCRS(); schedulePublish();
  if (project && !project.empty) {
    const [lon, lat] = fwd(project.holes[0].c.x, project.holes[0].c.y);
    status(`${c.label}: collars near ${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}. Loading real terrain…`);
    rebuildScene(true); await realT.promise;
  }
  return getState();
}
// Re-check a set coordinate system against new collars; drop it with a message if it no longer fits.
function recheckCRS() {
  // Latitude/longitude collars locate themselves; the scene is built right after this.
  if (!S.crs) { if (project?.latlon) { const c = parseCRS('EPSG:4326'); geo = { ...c, guessed: true, fwd: geoFor(c, project) }; S.crs = c.code; realT.dem = realT.img = null; renderCRS(); } return; }
  // A coordinate system restored with a saved project (S.crs) is re-established here.
  // A different saved project's code (geo still describes the last one) is re-parsed too.
  if (!geo || geo.code !== S.crs) { geo = null; realT.dem = realT.img = null; setCRS(S.crs).catch((e) => { S.crs = null; renderCRS(); status(`Coordinate system cleared: ${e.message}`); }); return; }
  try { geo.fwd = geoFor(geo, project && !project.empty ? project : null); } catch (e) { S.crs = null; geo = null; renderCRS(); status(`Coordinate system cleared: ${e.message}`); }
}
const lon2t = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2t = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
// (x, y) -> [a, b] for a smooth transform, interpolated from a (n+1)² lattice over the box:
// exact to well under a pixel over a few kilometres, and thousands of times cheaper than proj4 per texel.
function lattice(B, fn, n = 16) {
  const A = new Float64Array((n + 1) * (n + 1) * 2), w = B.x1 - B.x0, h = B.y1 - B.y0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const [a, b] = fn(B.x0 + w * i / n, B.y0 + h * j / n), k = (j * (n + 1) + i) * 2; A[k] = a; A[k + 1] = b; }
  const at = (x, y) => {
    const fi = Math.max(0, Math.min(n - 1e-9, (x - B.x0) / w * n)), fj = Math.max(0, Math.min(n - 1e-9, (y - B.y0) / h * n)), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, r = n + 1;
    const k00 = (j * r + i) * 2, k10 = k00 + 2, k01 = k00 + r * 2, k11 = k01 + 2, w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    return [A[k00] * w00 + A[k10] * w10 + A[k01] * w01 + A[k11] * w11, A[k00 + 1] * w00 + A[k10 + 1] * w10 + A[k01 + 1] * w01 + A[k11 + 1] * w11];
  };
  let w0 = Infinity, e0 = -Infinity, s0 = Infinity, n0 = -Infinity; for (let k = 0; k < A.length; k += 2) { w0 = Math.min(w0, A[k]); e0 = Math.max(e0, A[k]); s0 = Math.min(s0, A[k + 1]); n0 = Math.max(n0, A[k + 1]); }
  at.bbox = { w: w0, e: e0, s: s0, n: n0 }; return at;
}
function loadImage(url, ms = 20000) {
  return new Promise((resolve) => {
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    const t = setTimeout(() => { im.onload = im.onerror = null; resolve(null); }, ms);
    im.onload = () => { clearTimeout(t); resolve(im); }; im.onerror = () => { clearTimeout(t); resolve(null); }; im.src = url;
  });
}
// Deepest zoom (<= maxZ) at which the box spans no more than px pixels.
function zoomFor(bb, px, maxZ) { for (let z = maxZ; z > 1; z--) if (Math.max(lon2t(bb.e, z) - lon2t(bb.w, z), lat2t(bb.s, z) - lat2t(bb.n, z)) * 256 <= px) return z; return 2; }
async function mosaic(urlFn, bb, z) {
  const x0 = Math.floor(lon2t(bb.w, z)), x1 = Math.floor(lon2t(bb.e, z)), y0 = Math.floor(lat2t(bb.n, z)), y1 = Math.floor(lat2t(bb.s, z)), jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  const c = document.createElement('canvas'); c.width = (x1 - x0 + 1) * 256; c.height = (y1 - y0 + 1) * 256; const g = c.getContext('2d', { willReadFrequently: true });
  let next = 0, ok = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) { const [tx, ty] = jobs[next++], im = await loadImage(urlFn(z, tx, ty)); if (im) { g.drawImage(im, (tx - x0) * 256, (ty - y0) * 256); ok++; } } }));
  if (!ok) throw new Error('no tiles loaded: offline, or the tile server is blocked');
  let data; try { data = g.getImageData(0, 0, c.width, c.height).data; } catch { throw new Error('the tiles were blocked by the browser'); }
  return { data, w: c.width, h: c.height, z, x0, y0, ok, total: jobs.length };
}
const pxOf = (M) => (x, y) => { const [lon, lat] = geo.fwd(x, y); return [(lon2t(lon, M.z) - M.x0) * 256 - 0.5, (lat2t(lat, M.z) - M.y0) * 256 - 0.5]; };
async function loadDem(key, B) {
  const bb = lattice(B, geo.fwd, 4).bbox, M = await mosaic(DEM_URL, bb, zoomFor(bb, 512, 15)), E = new Float32Array(M.w * M.h);
  for (let i = 0; i < E.length; i++) E[i] = M.data[i * 4 + 3] < 255 ? NaN : M.data[i * 4] * 256 + M.data[i * 4 + 1] + M.data[i * 4 + 2] / 256 - 32768;
  const toPx = lattice(B, pxOf(M));
  const at = (x, y) => {
    const [px, py] = toPx(x, y), i = Math.floor(px), j = Math.floor(py), a = px - i, b = py - j;
    if (i < 0 || j < 0 || i + 1 >= M.w || j + 1 >= M.h) return NaN;
    const k = j * M.w + i; return E[k] * (1 - a) * (1 - b) + E[k + 1] * a * (1 - b) + E[k + M.w] * (1 - a) * b + E[k + M.w + 1] * a * b;
  };
  return { key, ok: true, at, z: M.z, tiles: `${M.ok}/${M.total}` };
}
async function loadImagery(key, B) {
  const bb = lattice(B, geo.fwd, 4).bbox, M = await mosaic(IMG_URL, bb, zoomFor(bb, 2048, 17)), toPx = lattice(B, pxOf(M));
  const bw = B.x1 - B.x0, bh = B.y1 - B.y0, across = (lon2t(bb.e, M.z) - lon2t(bb.w, M.z)) * 256;
  let w = Math.max(768, Math.min(2048, Math.round(across * 1.25))), h = Math.round(w * bh / bw); if (h > 2048) { w = Math.round(w * 2048 / h); h = 2048; }
  const out = new Uint8ClampedArray(w * h * 4), src = M.data;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const [sx, sy] = toPx(B.x0 + (px + 0.5) / w * bw, B.y1 - (py + 0.5) / h * bh), i = Math.max(0, Math.min(M.w - 2, Math.floor(sx))), j = Math.max(0, Math.min(M.h - 2, Math.floor(sy)));
    const a = Math.max(0, Math.min(1, sx - i)), b = Math.max(0, Math.min(1, sy - j)), k = (j * M.w + i) * 4, o = (py * w + px) * 4, r = M.w * 4;
    // Weighted by each sample's alpha: a tile that failed to load is transparent,
    // and stays a gap (alpha 0) for paintTerrain to fill, not a black patch.
    const wt = [(1 - a) * (1 - b) * src[k + 3], a * (1 - b) * src[k + 7], (1 - a) * b * src[k + r + 3], a * b * src[k + r + 7]], ws = wt[0] + wt[1] + wt[2] + wt[3];
    for (let c = 0; c < 3; c++) out[o + c] = ws ? (src[k + c] * wt[0] + src[k + 4 + c] * wt[1] + src[k + r + c] * wt[2] + src[k + r + 4 + c] * wt[3]) / ws : 0;
    out[o + 3] = ws / 255;
  }
  return { key, ok: true, w, h, data: out, z: M.z, tiles: `${M.ok}/${M.total}` };
}
const terrainKeyOf = (B) => (geo ? `${S.crs}|${[B.x0, B.x1, B.y0, B.y1].map(Math.round).join(',')}` : '');
// Load what the current style and source need for this block; rebuild or repaint when it lands.
// Never blocks anything: exports taken meanwhile use the fitted surface.
function syncRealTerrain() {
  if (!G || !geo) { realT.status = 'off'; realT.message = geo ? '' : 'Set the coordinate system in step 1 for real terrain and satellite imagery.'; return Promise.resolve(); }
  const key = terrainKeyOf(G.B), hasTopo = G.using === 'topo';
  const needDem = S.terrainSource === 'dem' || (S.terrainSource === 'auto' && !hasTopo), needImg = S.terrain === 'satellite' || S.terrain === 'muted';
  const getDem = needDem && realT.dem?.key !== key, getImg = needImg && realT.img?.key !== key;
  if (!getDem && !getImg) {
    if (realT.status === 'off') realT.message = hasTopo && S.terrainSource === 'auto' ? `${geo.label}. The surface is your topography; choose Satellite, or "Real elevation", to load tiles.` : `${geo.label}.`;
    return realT.promise || Promise.resolve();
  }
  const job = ++realT.job; realT.status = 'loading'; realT.message = `Loading ${[getDem && 'real terrain', getImg && 'satellite imagery'].filter(Boolean).join(' and ')}…`; status(realT.message); schedulePublish();
  realT.promise = (async () => {
    const msgs = [], B = { ...G.B };
    if (getDem) { try { realT.dem = await loadDem(key, B); msgs.push(`real terrain (z${realT.dem.z}, ${realT.dem.tiles} tiles)`); } catch (e) { realT.dem = { key, ok: false, error: e.message }; } }
    if (getImg) { try { realT.img = await loadImagery(key, B); msgs.push(`satellite imagery (z${realT.img.z}, ${realT.img.tiles} tiles)`); } catch (e) { realT.img = { key, ok: false, error: e.message }; } }
    if (job !== realT.job || !G) return;
    const fails = [realT.dem && !realT.dem.ok && getDem && `real terrain (${realT.dem.error})`, realT.img && !realT.img.ok && getImg && `satellite imagery (${realT.img.error})`].filter(Boolean);
    realT.status = fails.length ? (msgs.length ? 'partial' : 'failed') : 'ready';
    if (getDem && realT.dem.ok) rebuildScene(true); else { paintTerrain(); restyle(); }
    realT.message = [msgs.length && `Loaded ${msgs.join(' and ')}.`, fails.length && `Could not load ${fails.join(' or ')}; showing the ${getImg && !realT.img.ok ? 'natural surface' : 'fitted surface'} instead.`, G.terrainNote].filter(Boolean).join(' ');
    status(realT.message); renderSummary(); schedulePublish();
  })();
  return realT.promise;
}
// ============================================================
// 4c. Labels painted on the block faces
// ============================================================
// Text on a canvas texture, laid flat on a wall a hair outside it so it foreshortens with the face. Faces
// are by compass (N, S, E, W: robust as the camera turns); u runs left to right as seen from outside,
// v from the block base (0) to the terrain (1). Front-side only, so a label never reads mirrored through glass.
const FACES = { S: [[0, 0], [1, 0], [0, -1]], E: [[1, 0], [1, 1], [1, 0]], N: [[1, 1], [0, 1], [0, 1]], W: [[0, 1], [0, 0], [-1, 0]] };
const faceGeom = (face) => {
  const [a, b, n] = FACES[face], P = ([i, j]) => [i ? G.B.x1 : G.B.x0, j ? G.B.y1 : G.B.y0];
  return { a: P(a), b: P(b), n: new THREE.Vector3(n[0], 0, -n[1]) };
};
// The face most squarely toward the camera.
const frontFace = () => { const d = camera.getWorldDirection(new THREE.Vector3()); return Object.keys(FACES).sort((p, q) => faceGeom(p).n.dot(d) - faceGeom(q).n.dot(d))[0]; };
function wallLabelMesh(L) {
  const title = L.size === 'title', lines = String(L.text).split('\n'), px = 96, c = document.createElement('canvas'), g = c.getContext('2d');
  const fontOf = () => { g.font = `${title ? 700 : 600} ${px}px ${SANS}`; if ('letterSpacing' in g) g.letterSpacing = title ? `${px * 0.06}px` : '0px'; };
  fontOf(); const shown = lines.map((t) => (title ? t.toUpperCase() : t)), tw = Math.max(...shown.map((t) => g.measureText(t).width)), lh = px * 1.15;
  c.width = Math.ceil(tw + px * 0.4); c.height = Math.ceil(lh * lines.length + px * 0.3); fontOf();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = unitInk(L.unit) || L.color || (title ? S.primary : '#4b585c'); // unitInk: EXT hook
  shown.forEach((t, i) => g.fillText(t, c.width / 2, px * 0.15 + lh * (i + 0.5)));
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  mesh.renderOrder = 7; mesh.matrixAutoUpdate = false; mesh.userData = { L, aspect: c.width / c.height, lines: lines.length }; placeWallLabel(mesh); return mesh;
}
function placeWallLabel(mesh) {
  const { L, aspect, lines } = mesh.userData, { a, b, n } = faceGeom(L.face), x = a[0] + (b[0] - a[0]) * L.u, y = a[1] + (b[1] - a[1]) * L.u;
  const z = G.B.z0 + (G.surf(x, y) - G.B.z0) * L.v, pos = G.V(x, y, z).addScaledVector(n, G.diag * 0.003);
  const right = new THREE.Vector3(b[0] - a[0], 0, -(b[1] - a[1])).normalize(), up = new THREE.Vector3(0, 1, 0), r = (L.rotation || 0) * Math.PI / 180;
  const R = right.clone().multiplyScalar(Math.cos(r)).addScaledVector(up, Math.sin(r)), U = up.clone().multiplyScalar(Math.cos(r)).addScaledVector(right, -Math.sin(r));
  // Letter height follows the face: about 7% of its width for a title, 4.5% for normal text.
  const faceW = Math.hypot(b[0] - a[0], b[1] - a[1]), h = (L.size === 'title' ? 0.07 : 0.045) * Math.max(faceW, 0.4 * (G.zmax - G.B.z0)) * (L.scale || 1) * (lines * 1.15 + 0.3) / 1.45;
  // Never smaller than about 22 px a line at the export size (30 px for a title), however far the camera.
  camera.updateMatrixWorld(); const a2 = proj(pos), b2 = proj(pos.clone().addScaledVector(U, h)), k = FORMATS[S.format].w / W;
  const linePx = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) * k * 1.45 / (lines * 1.15 + 0.3), minPx = L.size === 'title' ? 30 : 22;
  const hh = linePx > 0 && linePx < minPx ? h * minPx / linePx : h;
  mesh.matrix.makeBasis(R.multiplyScalar(hh * aspect), U.multiplyScalar(hh), n).setPosition(pos); mesh.updateMatrixWorld(true);
}
// Screen boxes of the wall labels, so hole IDs can keep off them.
function wallLabelBoxes() {
  return (G?.wallLabelMeshes || []).map((m) => {
    const ps = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => proj(new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld)));
    return [Math.min(...ps.map((q) => q[0])), Math.min(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[1]))];
  });
}
function buildWallLabels() {
  if (!G) return;
  (G.wallLabelMeshes || []).forEach((m) => { root.remove(m); m.geometry.dispose(); m.material.map.dispose(); m.material.dispose(); });
  G.wallLabelMeshes = S.wallLabels.map((L) => { const m = wallLabelMesh(L); root.add(m); return m; });
  G.wallPrimary = S.primary;
}
function wallPatch(L, o) {
  if (o.text !== undefined) { const t = String(o.text).trim(); if (!t) throw new Error('A wall label needs some text.'); L.text = t.slice(0, 120); }
  if (o.face !== undefined) { const f = o.face === 'front' ? (G ? frontFace() : 'S') : String(o.face).toUpperCase(); if (!FACES[f]) throw new Error('face must be "N", "S", "E", "W" or "front".'); L.face = f; }
  if (o.size !== undefined) { if (!['title', 'normal'].includes(o.size)) throw new Error('size must be "title" or "normal".'); L.size = o.size; }
  ['u', 'v'].forEach((k) => { if (o[k] !== undefined) L[k] = clamp01(o[k], L[k]); });
  if (o.scale !== undefined) L.scale = Math.max(0.4, Math.min(3, +o.scale || 1));
  if (o.rotation !== undefined) L.rotation = Math.max(-90, Math.min(90, +o.rotation || 0));
  if (o.color !== undefined) { if (o.color !== null && !/^#[0-9a-f]{6}$/i.test(o.color)) throw new Error('color must be a hex colour like #5f6e72, or null.'); L.color = o.color; }
  if (o.unit !== undefined) { if (o.unit !== null && !S.geology.legend.some((e) => e.code === String(o.unit))) throw new Error(`unit must be a code in the geology legend (${S.geology.legend.map((e) => e.code).join(', ') || 'none loaded'}), or null.`); L.unit = o.unit === null ? null : String(o.unit); } // EXT hook
}
function addWallLabel(o = {}) {
  const n = S.wallLabels.reduce((mx, l) => Math.max(mx, +String(l.id).replace(/\D/g, '') || 0), 0) + 1;
  const L = { id: `W${n}`, text: '', face: 'S', u: 0.5, v: 0.55, size: 'title', scale: 1, rotation: 0, color: null };
  wallPatch(L, { face: 'front', ...o, text: o.text ?? '' });
  S.wallLabels.push(L); buildWallLabels(); renderWallLabelList(); schedulePublish(); status(`"${L.text}" painted on the ${{ N: 'north', S: 'south', E: 'east', W: 'west' }[L.face]} face. Drag it along the face to place it.`);
  return L.id;
}
function updateWallLabel(id, o = {}) {
  const L = S.wallLabels.find((l) => l.id === id); if (!L) throw new Error(`No wall label "${id}". Wall labels: ${S.wallLabels.map((l) => l.id).join(', ') || 'none'}.`);
  wallPatch(L, o); buildWallLabels(); renderWallLabelList(); schedulePublish(); return getState();
}
function removeWallLabel(id) {
  if (!S.wallLabels.some((l) => l.id === id)) throw new Error(`No wall label "${id}".`);
  S.wallLabels = S.wallLabels.filter((l) => l.id !== id); buildWallLabels(); renderWallLabelList(); schedulePublish(); return getState();
}

// ============================================================
// 4d. Grade shell: an exploratory envelope estimated from the assays
// ============================================================
// Composites and grouping here; the estimate and the marching-cubes surface in shell-worker.js, so the
// page never freezes. Results are cached by their inputs: a rebuilt scene (new vertical exaggeration,
// label, colour) reuses the mesh, and a new cut-off reuses the estimated grid.
const shell = { status: 'off', progress: 0, message: '', job: 0, worker: null, busy: false, field: null, mesh: null, waiters: [] };
const shellCut = () => (Number.isFinite(S.shell.cutoff) ? S.shell.cutoff : S.coCut);
const shellCutText = () => { const unit = (S.valueLabel.match(/(%|g\/t|ppm|ppb)$/) || [''])[0], el = S.valueLabel.replace(/\s*(%|g\/t|ppm|ppb)$/, ''); return `${+shellCut().toPrecision(4)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''} ${el}`.trim(); };
const shellShown = () => S.shell.enabled && !!G?.shellMesh;
function shellInput() {
  if (!G || !S.valueCol) return null;
  const used = project.holes.map((h) => ({ h, comps: composite(h.ints, S.valueCol) })).filter((x) => x.comps.length), xy = used.map(({ h }) => [h.c.x, h.c.y]);
  const groups = collarGroups(xy), holes = used.map(({ h, comps }, i) => {
    const pts = new Float64Array(comps.length * 4); comps.forEach((c, k) => { const p = h.posAt(c.mid); pts.set([p.x, p.y, p.z, c.value], k * 4); });
    return { group: groups[i], pts };
  });
  const { B } = G, search = S.shell.search || autoSearch(xy, groups);
  let cell = S.shell.cell || autoCell(G.bw, G.bh), n = () => (Math.ceil(G.bw / cell) + 1) * (Math.ceil(G.bh / cell) + 1) * (Math.ceil((G.zmax - B.z0) / cell) + 1);
  while (n() > 2.5e6) cell *= 1.25; // keeps a very large block to a few million grid points
  const grid = { x0: B.x0, y0: B.y0, z0: B.z0, cell, nx: Math.ceil(G.bw / cell) + 1, ny: Math.ceil(G.bh / cell) + 1, nz: Math.ceil((G.zmax - B.z0) / cell) + 1 };
  const top = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) top[j * grid.nx + i] = G.surf(B.x0 + i * cell, B.y0 + j * cell);
  let hsh = 0x811c9dc5; const mix = (v) => { hsh = Math.imul(hsh ^ (v * 1000 | 0), 0x01000193); };
  holes.forEach((h) => { mix(h.group); h.pts.forEach(mix); }); top.forEach(mix);
  return { holes, grid, top, search, key: `${(hsh >>> 0).toString(36)}|${search}|${cell}|${grid.nx},${grid.ny},${grid.nz}`, holesUsed: used.length, groups: groups.length ? Math.max(...groups) + 1 : 0, composites: used.reduce((t, x) => t + x.comps.length, 0) };
}
function settleShell(status, message = '') {
  shell.status = status; shell.message = message; shell.busy = status === 'building';
  renderShellUI(); schedulePublish();
  if (!shell.busy) shell.waiters.splice(0).forEach((res) => res(getState()));
}
const shellColor = () => S.shell.color || brandTone('shell');
function styleShell() {
  const m = G?.shellMesh; if (!m) return; m.material.color.set(shellColor()); m.material.opacity = S.shell.opacity;
  const gh = m.userData.ghost; gh.material.color.set(shellColor()); gh.material.opacity = Math.min(0.4, S.shell.opacity + 0.1); gh.visible = !!S.shell.throughTerrain;
}
function dropShell() { const m = G?.shellMesh; if (!m) return; root.remove(m); m.geometry.dispose(); m.material.dispose(); m.userData.ghost.material.dispose(); G.shellMesh = null; }
function placeShell() {
  dropShell();
  const M = shell.mesh; if (!M.indices.length) return;
  const pos = new Float32Array(M.positions.length), [ox, oy, oz] = M.origin;
  for (let i = 0; i < pos.length; i += 3) { const v = G.V(ox + M.positions[i], oy + M.positions[i + 1], oz + M.positions[i + 2]); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(M.indices, 1)); g.computeVertexNormals();
  G.shellMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  G.shellMesh.renderOrder = 4; G.shellMesh.userData.key = M.key;
  // The ghost: the same surface drawn after the terrain only where something nearer (the terrain) hides it.
  const gh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide }));
  gh.renderOrder = 6.5; G.shellMesh.userData.ghost = gh; G.shellMesh.add(gh); root.add(G.shellMesh); styleShell();
}
function stopWorker() { if (shell.worker && shell.busy) { shell.worker.terminate(); shell.worker = null; } shell.job++; }
function syncShell() {
  const drop = dropShell;
  if (!S.shell.enabled) { stopWorker(); drop(); if (shell.status !== 'cancelled') settleShell('off'); return; }
  const inp = shellInput(), iso = shellCut();
  if (!inp || inp.groups < 3) { stopWorker(); drop(); settleShell('empty', 'A grade shell needs assays in at least three separate collar locations (collars within 20 m count as one).'); return; }
  if (!(iso > 0)) { stopWorker(); drop(); settleShell('empty', 'Set a cut-off above zero.'); return; }
  const key = `${inp.key}|${iso}`, info = { holesUsed: inp.holesUsed, groups: inp.groups, composites: inp.composites, search: inp.search, cell: inp.grid.cell, grid: [inp.grid.nx, inp.grid.ny, inp.grid.nz] };
  // A cached result for these inputs: drop any build still running for older ones.
  if (shell.mesh?.key === key) { if (shell.busy) { stopWorker(); shell.pending = null; shell.status = ''; } if (G.shellMesh?.userData.key !== key) placeShell(); else styleShell(); if (shell.status !== 'ready' && shell.status !== 'empty') settleShell(shell.mesh.indices.length ? 'ready' : 'empty', shell.mesh.indices.length ? '' : 'No part of the grid reaches the cut-off.'); return; }
  if (shell.busy && shell.pending === key) return;
  stopWorker(); drop();
  if (!shell.worker) shell.worker = new Worker(new URL('./shell-worker.js', import.meta.url), { type: 'module' });
  const id = shell.job, t0 = performance.now(), field = shell.field?.key === inp.key ? shell.field.data : null;
  shell.pending = key; shell.progress = 0; settleShell('building');
  shell.worker.onmessage = (e) => {
    const d = e.data; if (d.id !== shell.job) return;
    if (d.type === 'progress') { shell.progress = d.p; renderShellUI(); return; }
    shell.pending = null;
    if (d.type === 'error') { settleShell('error', d.message); return; }
    shell.field = { key: inp.key, data: d.field };
    shell.mesh = { key, positions: d.positions, indices: d.indices, origin: [inp.grid.x0, inp.grid.y0, inp.grid.z0], stats: { ...info, ...d.stats, ms: Math.round(performance.now() - t0) } };
    if (G) placeShell();
    settleShell(d.indices.length ? 'ready' : 'empty', d.indices.length ? '' : 'No part of the grid reaches the cut-off. Lower it, or widen the search radius.');
  };
  shell.worker.onerror = (e) => { if (id !== shell.job) return; shell.pending = null; e.preventDefault?.(); settleShell('error', e.message || 'The shell could not be built.'); };
  shell.worker.postMessage({ id, holes: inp.holes, grid: inp.grid, top: inp.top, search: inp.search, iso, field });
}
function cancelShell() {
  if (!shell.busy) return getState();
  stopWorker(); shell.pending = null; S.shell.enabled = false; settleShell('cancelled', 'Cancelled.'); return getState();
}
function setShell(o = {}) {
  const sh = S.shell;
  if (o.enabled !== undefined) sh.enabled = !!o.enabled;
  [['cutoff', 0, 1e9], ['search', 5, 5000], ['cell', 2, 200]].forEach(([k, lo, hi]) => {
    if (o[k] === undefined) return; if (o[k] === null || o[k] === '' || o[k] === 'auto') { sh[k] = null; return; }
    const v = +o[k]; if (!Number.isFinite(v)) throw new Error(`${k} must be a number, or null for automatic.`); sh[k] = Math.max(lo, Math.min(hi, v));
  });
  if (o.opacity !== undefined) { const v = +o.opacity; if (!Number.isFinite(v)) throw new Error('opacity must be 0.05-0.9.'); sh.opacity = Math.max(0.05, Math.min(0.9, v > 1 ? v / 100 : v)); }
  if (o.color !== undefined) { if (o.color !== null && !/^#[0-9a-f]{6}$/i.test(String(o.color))) throw new Error('color must be a hex colour like #1f9e96, or null for the brand accent.'); sh.color = o.color && String(o.color).toLowerCase(); }
  if (o.throughTerrain !== undefined) sh.throughTerrain = !!o.throughTerrain;
  const done = new Promise((res) => shell.waiters.push(res));
  if (sh.enabled && shell.status === 'cancelled') shell.status = 'off';
  syncShell(); renderShellUI(); schedulePublish();
  if (!shell.busy) settleShell(shell.status, shell.message);
  return done;
}
function renderShellUI() {
  const sh = S.shell, busy = shell.busy, st = shell.mesh?.stats;
  $('shell-on').checked = sh.enabled; $('shell-color').value = shellColor(); $('shell-ghost').checked = !!sh.throughTerrain;
  if (document.activeElement?.id !== 'shell-cut') $('shell-cut').value = +shellCut().toPrecision(4);
  $('shell-unit').textContent = S.valueLabel; $('shell-op').value = Math.round(sh.opacity * 100); $('shell-op-out').textContent = `${Math.round(sh.opacity * 100)}%`;
  $('shell-search').value = sh.search ?? ''; $('shell-cell').value = sh.cell ?? '';
  $('shell-search').placeholder = `auto${st ? ` (${st.search} m)` : ''}`; $('shell-cell').placeholder = `auto${st ? ` (${+st.cell.toFixed(1)} m)` : ''}`;
  $('shell-prog').hidden = !busy; $('shell-prog').value = shell.progress; $('shell-cancel').hidden = !busy;
  $('shell-msg').textContent = busy ? `Estimating… ${Math.round(shell.progress * 100)}%` : shell.status === 'ready' && st
    ? `${st.cells.toLocaleString()} cells ≥ cut-off · ${st.triangles.toLocaleString()} triangles · ${st.holesUsed} holes (${st.groups} collar groups) · ${st.search} m search · ${+st.cell.toFixed(1)} m cells · ${st.ms} ms`
    : shell.message;
}

const terrainCredits = (withImagery) => [...new Set([withImagery && imageryShown() && IMAGERY_CREDIT, G?.using === 'dem' && DEM_CREDIT].filter(Boolean).concat(withImagery ? extCredits() : []))]; // EXT hook: map inset

const traceR = () => Math.max(1.5, G.diag / 330) * S.traceWidth;
// Ribbon pieces sit 3 tube radii to the screen-right of the trace, in the plane facing the camera,
// so they read as a bar beside the hole from any angle. Re-placed when the view turns (loop).
function placeRibbons() {
  if (!G?.ribbons) return;
  camera.updateMatrixWorld();
  const view = camera.getWorldDirection(new THREE.Vector3()), right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  G.ribbonView = view.clone();
  const r = traceR(), w = 2 * r, off = 3.2 * r, mx = new THREE.Matrix4(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), n = [0, 0];
  const put = (k, h, from, to) => {
    const pieces = Math.max(1, Math.ceil((to - from) / 8));
    for (let i = 0; i < pieces && n[k] < G.ribbonCap; i++) {
      const a = h.posAt(from + (to - from) * i / pieces), b = h.posAt(from + (to - from) * (i + 1) / pieces), va = G.V(a.x, a.y, a.z), vb = G.V(b.x, b.y, b.z), dir = vb.clone().sub(va), len = dir.length();
      if (len < 1e-6) continue; dir.divideScalar(len);
      side.crossVectors(dir, view); if (side.lengthSq() < 1e-8) side.copy(right); side.normalize(); if (side.dot(right) < 0) side.negate();
      nrm.crossVectors(side, dir).normalize(); if (nrm.dot(view) > 0) nrm.negate();
      const c = va.add(vb).multiplyScalar(0.5).addScaledVector(side, off).addScaledVector(nrm, 0.4 * r * k);
      mx.makeBasis(side.clone().multiplyScalar(w), dir.clone().multiplyScalar(len * 1.01), nrm).setPosition(c);
      G.ribbons[k].setMatrixAt(n[k]++, mx);
    }
  };
  if (S.ribbons) callouts.forEach(({ h, ic }) => { put(0, h, ic.broad.from, ic.broad.from + ic.broad.len); if (ic.incl) put(1, h, ic.incl.from, ic.incl.from + ic.incl.len); });
  G.ribbons.forEach((rb, k) => { rb.count = n[k]; rb.instanceMatrix.needsUpdate = true; });
  EXT.tags?.placeHistograms(); // EXT hook: grade histogram bars
}
// The display cut-off: intervals below it draw as the plain trace. Callouts are unaffected.
const intervalShown = (it) => { const v = it.vals[S.valueCol]; return Number.isFinite(v) && !(S.displayCutoff !== null && v < S.displayCutoff); };
const binIndex = (v) => { if (!Number.isFinite(v)) return -1; let k = 0; S.bins.forEach((b, i) => { if (v >= b) k = i + 1; }); return k; };
function restyle() {
  if (!G) return;
  computeCallouts(); // first: the key holes (EXT hook: emphasis) include the callout holes
  // Title wall labels without their own colour are painted in the brand colour.
  if (G.wallPrimary !== S.primary && S.wallLabels.some((L) => !L.color)) buildWallLabels();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const r = traceR(), n = [0, 0];
  project.holes.forEach((h) => h.ints.forEach((it) => {
    const v = it.vals[S.valueCol], bi = intervalShown(it) ? binIndex(v) : -1, T = h.prov ? G.tubesP : G.tubes, k = n[+h.prov]++;
    const a = h.posAt(it.from), b = h.posAt(it.to), va = G.V(a.x, a.y, a.z), vb = G.V(b.x, b.y, b.z), dir = vb.clone().sub(va), len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    const rw = r * (EXT.tags?.weight(h) ?? 1); sc.set(bi < 0 ? 0.001 : rw, Math.max(0.01, len), bi < 0 ? 0.001 : rw); // EXT hook: key holes bold
    m.compose(va.clone().add(vb).multiplyScalar(0.5), q, sc);
    T.setMatrixAt(k, m); col.set(BIN_COLORS[Math.max(0, bi)]); if (extFade(h)) col.lerp(new THREE.Color('#b9c1c4'), 0.7); T.setColorAt(k, col); // EXT hook: fade
  }));
  [G.tubes, G.tubesP].forEach((T, i) => { T.count = n[i]; T.instanceMatrix.needsUpdate = true; if (T.instanceColor) T.instanceColor.needsUpdate = true; });
  styleShell();
  G.walls.forEach((w) => { w.visible = S.walls; });
  G.top.material.opacity = S.surf; G.top.material.depthWrite = S.surf >= 0.99;
  if (controls.enabled === !!S.lockView) { controls.enabled = !S.lockView; if (S.lockView) stopOrbit(); } $('lock-view').setAttribute('aria-pressed', String(!!S.lockView));
  G.meshes.forEach(({ name, m: mesh }) => { const st = S.meshes[name]; mesh.visible = st.show; mesh.material.color.set(st.color); mesh.material.opacity = st.opacity; });
  // Section line on the top surface
  const ctx = G.topCanvas.getContext('2d'); ctx.drawImage(G.topBase, 0, 0);
  const [A, Bp] = sectionEnds(), P = (p) => [(p.x - G.B.x0) / G.bw * G.topCanvas.width, (G.B.y1 - p.y) / G.bh * G.topCanvas.height];
  const lk = G.topCanvas.width / 768;
  ctx.setLineDash([14 * lk, 9 * lk]); const dk = S.terrain === 'dark'; // a dark line would vanish on dark slate
  ctx.lineWidth = 5 * lk; ctx.strokeStyle = dk ? '#fff' : S.primary; ctx.beginPath(); ctx.moveTo(...P(A)); ctx.lineTo(...P(Bp)); ctx.stroke();
  ctx.lineWidth = 2 * lk; ctx.strokeStyle = dk ? S.accent : '#fff'; ctx.stroke(); ctx.setLineDash([]); G.topTex.needsUpdate = true;
  placeRibbons(); extRestyle(); // EXT hook
  drawSectionView();
}
function sectionEnds() {
  const a = S.secAz * Math.PI / 180, d = { x: Math.sin(a), y: Math.cos(a) };
  const half = Math.min(Math.abs(G.bw / 2 / (d.x || 1e-9)), Math.abs(G.bh / 2 / (d.y || 1e-9))) * 0.92;
  // A is the west-ish end so the section reads left to right.
  const p1 = { x: G.cx - d.x * half, y: G.cy - d.y * half }, p2 = { x: G.cx + d.x * half, y: G.cy + d.y * half };
  return p1.x <= p2.x ? [p1, p2] : [p2, p1];
}

// Intercepts: the run above the broad cut-off holding the most metal (internal dilution up to 6 m),
// then the longest stretch inside it at or above the "incl." cut-off.
function intercept(ints, col, cut, inclCut, minLen) {
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
let callouts = [];
function computeCallouts() {
  callouts = [];
  if (!G || !S.valueCol) return;
  project.holes.forEach((h) => { const ic = intercept(h.ints, S.valueCol, S.coCut, S.coIncl, S.coMin); if (ic) callouts.push({ h, ic }); });
  callouts.sort((a, b) => b.ic.broad.len * b.ic.broad.avg - a.ic.broad.len * a.ic.broad.avg);
}
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2));
const gradeText = (v, label) => { const unit = (label.match(/(%|g\/t|ppm|ppb)$/) || [''])[0], el = label.replace(/\s*(%|g\/t|ppm|ppb)$/, ''); return `${fmt(v)}${unit === '%' ? '%' : ' ' + unit} ${el}`; };
// Length-weighted average of another column over the same depths, for the second element in a callout.
function avgOver(ints, col, from, to) {
  let m = 0, l = 0; ints.forEach((it) => { const v = it.vals[col], a = Math.max(from, it.from), b = Math.min(to, it.to); if (b > a && Number.isFinite(v)) { m += v * (b - a); l += b - a; } });
  return l > 0 ? m / l : null;
}
const icText = (x, h) => {
  let t = `${x.len.toFixed(x.len < 10 ? 1 : 0)} m @ ${gradeText(x.avg, S.valueLabel)}`;
  const v2 = h && S.valueCol2 ? avgOver(h.ints, S.valueCol2, x.from, x.from + x.len) : null;
  if (v2 !== null) t += `, ${gradeText(v2, labelFor(S.valueCol2))}`;
  return t.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
};


// ============================================================
// 5. Brand, figure sizes, preview frame, camera
// ============================================================
Object.assign(S, {
  subtitle: $('subtitle').value, company: $('company').value, footnote: $('footnote').value,
  primary: '#142126', accent: '#c65322', credit: true, format: 'slide', coOverrides: {}, view: '3d',
});
const FORMATS = {
  slide: { w: 1920, h: 1080, label: 'Slide 16:9', use: 'Presentations and decks' },
  release: { w: 2400, h: 1600, label: 'News release 3:2', use: 'News releases and the website' },
  square: { w: 2000, h: 2000, label: 'Square 1:1', use: 'LinkedIn and X posts' },
  portrait: { w: 1600, h: 2000, label: 'Portrait 4:5', use: 'Instagram and fact sheets' },
  a4: { w: 3508, h: 2480, label: 'Print A4 landscape', use: '300 dpi print' },
};
const frameEl = $('frame');
let W = 1, H = 1;
const pad3 = (v) => String(Math.round(v)).padStart(3, '0');
function layoutFrame() {
  const f = FORMATS[S.format], a = f.w / f.h, sw = stage.clientWidth, sh = stage.clientHeight;
  const top = 56, side = 20, bottom = 44, aw = Math.max(60, sw - side * 2), ah = Math.max(60, sh - top - bottom);
  const fw = Math.floor(Math.min(aw, ah * a)), fh = Math.floor(fw / a);
  Object.assign(frameEl.style, { width: `${fw}px`, height: `${fh}px`, left: `${Math.round((sw - fw) / 2)}px`, top: `${Math.round(top + (ah - fh) / 2)}px` });
  W = fw; H = fh;
  renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  ov.width = Math.round(W * DPR); ov.height = Math.round(H * DPR);
  $('frame-label').textContent = `${f.w} × ${f.h} px · ${f.label} · preview ${Math.round(W / f.w * 100)}%`;
  drawSectionView();
}

let tween = null;
const lookVec = (az, pl) => { const a = az * Math.PI / 180, p = pl * Math.PI / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(p), -Math.sin(p), -Math.cos(a) * Math.cos(p)); };
// Depth counts only as far as it shows at this plunge; looking down, a quarter more
// room keeps a long, narrow footprint clear of the title and legend.
const baseDist = (plunge) => {
  const r = plunge * Math.PI / 180;
  return Math.hypot(G.diagH, G.depth * Math.cos(r)) * (1 + 0.25 * Math.sin(r)) * 1.65 * Math.pow(Math.max(1, 1.6 / (W / H)), 0.85) * (G.fit || 1);
};
// Aim a little above the block's middle so it sits below the title block, not under it.
const camTarget = () => G.V(G.cx, G.cy, (G.B.z0 + G.zmax) / 2 + 0.1 * (G.zmax - G.B.z0));
function getCam() {
  const d = controls.target.clone().sub(camera.position), dist = d.length();
  if (!G || dist < 1e-6) return { azimuth: ((S.secAz - 90) % 360 + 360) % 360, plunge: 20, zoom: 100 };
  d.normalize();
  const plunge = Math.asin(-d.y) * 180 / Math.PI;
  return { azimuth: Math.round((Math.atan2(d.x, -d.z) * 180 / Math.PI + 360) % 360), plunge: Math.round(plunge), zoom: Math.round(baseDist(plunge) / dist * 100) };
}
function setCamera(o = {}, instant = true) {
  if (!G) return;
  const cur = getCam(), pick = (v, d) => (v !== undefined && v !== null && Number.isFinite(+v) ? +v : d);
  const az = ((pick(o.azimuth, cur.azimuth) % 360) + 360) % 360, pl = Math.max(3, Math.min(89, pick(o.plunge, cur.plunge))), zoom = Math.max(40, Math.min(250, pick(o.zoom, cur.zoom)));
  const T = camTarget(), to = T.clone().sub(lookVec(az, pl).multiplyScalar(baseDist(pl) * 100 / zoom));
  controls.minDistance = baseDist(pl) * 0.39; controls.maxDistance = baseDist(pl) * 2.6;
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { tween = null; camera.position.copy(to); controls.target.copy(T); controls.update(); }
  else tween = { from: camera.position.clone(), fromT: controls.target.clone(), to, toT: T, t0: performance.now() };
}
// Presets. "Facing the section" looks perpendicular to A–A′ with A on the left, as in the section view.
const VIEWS = {
  a: () => ({ azimuth: S.secAz - 90, plunge: W / H < 1.15 ? 30 : 20, zoom: 100 }),
  b: () => ({ azimuth: S.secAz + 90, plunge: W / H < 1.15 ? 30 : 20, zoom: 100 }),
  low: () => ({ azimuth: S.secAz - 90, plunge: 7, zoom: 112 }),
  plan: () => ({ azimuth: 0, plunge: 89, zoom: 100 }),
};
// A preset frames the block between the title and the footer: the camera only ever pulls back (G.fit),
// for a tall or deep block whose base would otherwise cross the footer.
function blockOverflow() {
  camera.updateMatrixWorld(); const u = Math.sqrt(W * H) / 900, top = 118 * u, bot = H - 43 * u, cy = proj(controls.target)[1], ys = [];
  [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]].forEach(([x, y]) => { ys.push(proj(G.V(x, y, G.B.z0))[1], proj(G.V(x, y, G.surf(x, y)))[1]); });
  return Math.max(1, (Math.max(...ys) - cy) / Math.max(1, bot - cy), (cy - Math.min(...ys)) / Math.max(1, cy - top));
}
function applyView(which, instant) {
  if (!G) return;
  const v = (VIEWS[which] || VIEWS.a)(), from = camera.position.clone(), fromT = controls.target.clone();
  G.fit = 1; setCamera(v, true);
  for (let i = 0; i < 4; i++) { const f = blockOverflow(); if (f <= 1.005) break; G.fit *= f * 1.01; setCamera(v, true); }
  if (!instant && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const to = camera.position.clone(), toT = controls.target.clone(); camera.position.copy(from); controls.target.copy(fromT); controls.update();
    tween = { from, fromT, to, toT, t0: performance.now() };
  }
}
let lastCamKey = '';
function syncCamUI() {
  if (!G) return;
  const c = getCam(), key = `${c.azimuth}|${c.plunge}|${c.zoom}`; if (key === lastCamKey) return; lastCamKey = key;
  const act = document.activeElement && document.activeElement.id;
  if (act !== 'cam-az') $('cam-az').value = c.azimuth;
  if (act !== 'cam-pl') $('cam-pl').value = c.plunge;
  if (act !== 'cam-zoom') $('cam-zoom').value = c.zoom;
  $('cam-az-out').textContent = `${pad3(c.azimuth)}°`; $('cam-pl-out').textContent = `${c.plunge}°`; $('cam-zoom-out').textContent = `${c.zoom}%`;
  schedulePublish();
}

// ============================================================
// 6. Figure overlay (drawn on a canvas so exports match the preview exactly)
// ============================================================
const SANS = '"Source Sans 3", "Segoe UI", sans-serif', MONO = '"IBM Plex Mono", monospace';
const INK = '#142126', MUTED = '#5f6e72', RULE = '#c6cecf';
const tmpV = new THREE.Vector3();
const proj = (v) => { tmpV.copy(v).project(camera); return [(tmpV.x + 1) / 2 * W, (1 - tmpV.y) / 2 * H, tmpV.z]; };
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
// Everything is sized in u, which scales with the frame, so a figure keeps its proportions at any export size.
function kit(ctx, Wc, Hc) {
  const u = Math.sqrt(Wc * Hc) / 900;
  return { u, m: 28 * u, narrow: Wc / Hc < 1.15, font: (w, s, mono) => { ctx.font = `${w} ${s * u}px ${mono ? MONO : SANS}`; } };
}
function fitText(ctx, t, maxW) { if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1); return `${t}…`; }
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lumOf = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const textOn = (hex) => (lumOf(hexRgb(hex)) > 0.45 ? INK : '#ffffff');
// Brand colours for figure furniture (S.primary and S.accent, set from the logo): legend headers, highlighted
// (new) holes, the grade shell. Grade, geophysics and lithology colours stay scientific, never from here.
const brandTone = (kind) => ({ head: S.primary, highlight: S.accent, shell: S.accent }[kind] || S.accent);
function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function drawLogo(ctx, K, Wc, forExport) {
  const { u, m, font } = K, h = 52 * u, maxW = 230 * u;
  if (S.logo) {
    const r = (S.logo.naturalWidth / S.logo.naturalHeight) || 1; let w = h * r, hh = h; if (w > maxW) { w = maxW; hh = w / r; }
    ctx.drawImage(S.logo, Wc - m - w, m, w, hh); return { w, bottom: m + hh };
  }
  if (forExport) return { w: 0, bottom: m };
  const w = 150 * u; ctx.save(); ctx.setLineDash([5 * u, 4 * u]); ctx.strokeStyle = '#7c898c'; ctx.lineWidth = 1.5 * u; roundRect(ctx, Wc - m - w, m, w, h, 6 * u); ctx.stroke(); ctx.setLineDash([]);
  font(600, 13); ctx.fillStyle = '#7c898c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Your logo here', Wc - m - w / 2, m + h / 2); ctx.restore();
  return { w, bottom: m + h };
}
function drawHeader(ctx, K, Wc, title, subtitle, logoW) {
  const { u, m, font } = K, x = m + 16 * u, maxW = Wc - x - m - logoW - 24 * u; let y = m;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (S.company) { font(700, 13); setSpacing(ctx, 1.4 * u); ctx.fillStyle = S.accent; y += 12 * u; ctx.fillText(fitText(ctx, S.company.toUpperCase(), maxW), x, y); setSpacing(ctx, 0); y += 6 * u; }
  let ts = 30; font(700, ts); while (ts > 17 && ctx.measureText(title).width > maxW) { ts -= 1; font(700, ts); }
  y += ts * u * 0.98; ctx.fillStyle = S.primary; ctx.fillText(fitText(ctx, title, maxW), x, y);
  if (subtitle) { font(400, 16); ctx.fillStyle = MUTED; y += 22 * u; ctx.fillText(fitText(ctx, subtitle, maxW), x, y); }
  ctx.fillStyle = S.accent; ctx.fillRect(m, m, 5 * u, y - m + 5 * u);
  return y + 8 * u;
}
// Automatic footnote lines: the grade shell's disclosure (3D figure only, where it is drawn) and the
// metal-equivalent formula and assumptions whenever the derived column is in use.
function autoNotes(view) {
  const out = [];
  if (view === '3d' && shellShown()) out.push(`Grade shell: exploratory envelope interpolated from drill assays (≥${shellCutText()}); not a geological model or mineral resource.`);
  const en = eqName(); if (en && [S.valueCol, S.valueCol2].includes(en)) out.push(eqInfo().note);
  out.push(...extNotes(view)); // EXT hook: geology and geophysics disclosures
  return out;
}
// The automatic notes go on one line joined by " · ", wrapping to at most two; longer, they become a
// compact "Notes" block in smaller type.
function drawFooter(ctx, K, Wc, Hc, credits = [], notes = []) {
  const { u, m, font } = K, y = Hc - 17 * u, wide = Wc - 2 * m, mw = (t) => ctx.measureText(t).width;
  font(400, 10.5); let lines = wrapNotes(notes, mw, wide), block = !lines, lh = 15 * u;
  // Disclosures are never dropped: the block's type shrinks (to 8 pt) to stay within three lines,
  // and grows past three only if it still has to.
  let fs = 9.5;
  if (block) { for (;;) { font(400, fs); lines = wrapNotes(notes, mw, wide - 44 * u, 99); if (lines.length <= 3 || fs <= 8) break; fs -= 0.5; } lh = (fs + 3.5) * u; }
  const rule = y - 16 * u - lines.length * lh - (lines.length ? 3 * u : 0);
  // The footer is a white band: the block or its shadow never shows through the notes and credits.
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, rule, Wc, Hc - rule);
  ctx.strokeStyle = RULE; ctx.lineWidth = u; ctx.beginPath(); ctx.moveTo(m, rule); ctx.lineTo(Wc - m, rule); ctx.stroke();
  ctx.textBaseline = 'alphabetic'; let creditW = 0;
  // A white halo keeps the footer legible where the block or its shadow runs under it.
  const halo = (t, x, yy) => { ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 4 * u; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(t, x, yy); ctx.restore(); ctx.fillText(t, x, yy); };
  if (S.credit) {
    font(600, 11.5); ctx.textAlign = 'right'; ctx.fillStyle = '#7c898c'; const t = 'Made with Exploration Maps'; creditW = ctx.measureText(t).width + 17 * u; halo(t, Wc - m, y);
    const s = 10 * u, mx = Wc - m - creditW, my = y - s + u; ctx.fillStyle = INK; ctx.fillRect(mx, my, s, s); ctx.fillStyle = '#c65322'; ctx.fillRect(mx + s * 0.52, my + s * 0.18, s * 0.3, s * 0.3);
  }
  if (credits.length) { font(400, 10.5); ctx.textAlign = 'right'; ctx.fillStyle = '#7c898c'; const t = credits.join(' · '); halo(t, Wc - m - creditW - (creditW ? 10 * u : 0), y); creditW += ctx.measureText(t).width + 10 * u; }
  if (S.footnote) { font(400, 11.5); ctx.textAlign = 'left'; ctx.fillStyle = MUTED; halo(fitText(ctx, S.footnote, Wc - 2 * m - creditW - 24 * u), m, y); }
  ctx.textAlign = 'left'; ctx.fillStyle = MUTED; const ny = (i) => y - 3 * u - (lines.length - i) * lh;
  if (block && lines.length) { font(700, 9.5); ctx.fillStyle = INK; halo('Notes', m, ny(0)); ctx.fillStyle = MUTED; }
  font(400, block ? fs : 10.5); lines.forEach((t, i) => halo(t, m + (block ? 44 * u : 0), ny(i)));
  return rule;
}
function tagLabel(ctx, K, t, x, y) {
  const { u, font } = K; font(700, 15); const w = Math.max(24 * u, ctx.measureText(t).width + 12 * u);
  ctx.fillStyle = S.primary; roundRect(ctx, x - w / 2, y - 12 * u, w, 24 * u, 3 * u); ctx.fill();
  ctx.fillStyle = textOn(S.primary); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y + u); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// Callouts: the top intercepts, minus any hidden, plus any forced on, with optional reworded lines.
function shownCallouts() {
  const ov_ = (c) => S.coOverrides[c.h.id] || {};
  const list = callouts.filter((c) => ov_(c).show !== false).slice(0, S.coCount);
  callouts.forEach((c) => { if (ov_(c).show === true && !list.includes(c)) list.push(c); });
  return list;
}
function calloutLines(c) {
  const o = S.coOverrides[c.h.id] || {};
  return { l1: o.line1 || icText(c.ic.broad, c.h), l1b: o.line1 ? '' : ` from ${Math.round(c.ic.broad.from)} m`, l2: o.incl === false ? null : (o.line2 || (c.ic.incl ? `incl. ${icText(c.ic.incl, c.h)}` : null)) };
}
function measureCallout(ctx, K, c) {
  const { font, u } = K, L = calloutLines(c);
  font(700, 15); const w1 = ctx.measureText(L.l1).width; font('italic 400', 13); const w1b = ctx.measureText(L.l1b).width; font(600, 13.5); const w2 = L.l2 ? ctx.measureText(L.l2).width : 0;
  return { L, w1, bw: Math.max(w1 + w1b, w2) + 30 * u, bh: (L.l2 ? 50 : 31) * u };
}
function drawCallout(ctx, K, x, y, c, M, target) {
  const { u, font } = K, { L, w1, bw, bh } = M;
  // The leader leaves the side facing the hole.
  const r = target[0] >= x + bw / 2, x0 = r ? x + bw : x, y0 = y + bh / 2, xm = r ? Math.max(x0 + 16 * u, Math.min(target[0] - 30 * u, x0 + 60 * u)) : Math.min(x0 - 16 * u, Math.max(target[0] + 30 * u, x0 - 60 * u));
  ctx.strokeStyle = S.primary; ctx.lineWidth = 1.3 * u; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(xm, y0); ctx.lineTo(target[0], target[1]); ctx.stroke();
  M.leader = [[x0, y0, xm, y0], [xm, y0, target[0], target[1]]];
  ctx.beginPath(); ctx.arc(target[0], target[1], 3.6 * u, 0, Math.PI * 2); ctx.fillStyle = S.primary; ctx.fill(); ctx.lineWidth = 1.2 * u; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.strokeStyle = RULE; ctx.lineWidth = u; roundRect(ctx, x, y, bw, bh, 4 * u); ctx.fill(); ctx.stroke();
  ctx.fillStyle = S.accent; ctx.fillRect(x + 7 * u, y + 7 * u, 4 * u, bh - 14 * u);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  font(700, 15); ctx.fillStyle = INK; ctx.fillText(L.l1, x + 18 * u, y + 20 * u);
  if (L.l1b) { font('italic 400', 13); ctx.fillStyle = MUTED; ctx.fillText(L.l1b, x + 18 * u + w1, y + 20 * u); }
  if (L.l2) { font(600, 13.5); ctx.fillStyle = INK; ctx.fillText(L.l2, x + 18 * u, y + 40 * u); }
  font(600, 11, true); const tw = ctx.measureText(c.h.id).width + 12 * u;
  ctx.fillStyle = S.primary; ctx.fillRect(x, y + bh + u, tw, 17 * u); ctx.fillStyle = textOn(S.primary); ctx.fillText(c.h.id, x + 6 * u, y + bh + 13.5 * u);
}
const legendRows = () => binRows(S.bins, S.displayCutoff, BIN_COLORS); // rows under the cut-off merge into its "trace only" row
const meshName = (n) => n.replace(/\.obj$/i, '').replace(/^sample_/, '').replace(/_/g, ' ');
// Legend sections: { key, title, rows: [{ label, mono, sep, draw(ctx, x, cy, u) } or { h, full(ctx, K, x, y, w) }] },
// measured and drawn as cards the same way on the 3D figure and the section.
const swLine = (c, w, dash) => (ctx, x, cy, u) => { ctx.strokeStyle = c; ctx.lineWidth = w * u; ctx.setLineDash(dash ? [dash * u, 3 * u] : []); ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + 22 * u, cy); ctx.stroke(); ctx.setLineDash([]); };
function legendSecs() {
  const holes = [{ label: 'Drill hole collar', draw: (ctx, x, cy, u) => { ctx.beginPath(); ctx.arc(x + 11 * u, cy, 5 * u, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.4 * u; ctx.strokeStyle = INK; ctx.stroke(); } }];
  if (project.holes.some((h) => h.prov)) holes.push({ label: 'Provisional position', draw: swLine('#59646a', 2, 4) });
  holes.push(...extLegendRows()); // EXT hook: planned, new and previous rows
  const assays = legendRows().map(([label, c]) => ({ label, mono: true, draw: (ctx, x, cy, u) => { ctx.fillStyle = c; roundRect(ctx, x, cy - 4 * u, 22 * u, 8 * u, 4 * u); ctx.fill(); } }));
  if (S.displayCutoff !== null) assays.push({ label: `< ${S.displayCutoff}: trace only`, mono: true, draw: swLine('#59646a', 1.5) });
  if (S.ribbons && callouts.length) [['Reported interval', RIB_COLORS[0]], ...(callouts.some((c) => c.ic.incl) ? [['incl.', RIB_COLORS[1]]] : [])].forEach(([label, c], i) => assays.push({ label, sep: !i, draw: (ctx, x, cy, u) => { ctx.fillStyle = c; ctx.fillRect(x, cy - 3 * u, 22 * u, 6 * u); } }));
  const model = G.meshes.filter(({ name }) => S.meshes[name].show).map(({ name }) => [meshName(name), S.meshes[name].color]);
  if (shellShown()) model.unshift([`Grade shell ≥ ${shellCutText()}`, shellColor()]);
  return [{ key: 'holes', rows: holes }, { key: 'assays', title: `Assay · ${S.valueLabel}`, rows: assays },
    { key: 'model', title: 'Model', rows: model.map(([label, c]) => ({ label, draw: (ctx, x, cy, u) => { ctx.globalAlpha = 0.6; ctx.fillStyle = c; ctx.fillRect(x, cy - 6 * u, 22 * u, 12 * u); ctx.globalAlpha = 1; } })) }].filter((s) => s.rows.length);
}
function cardSize(ctx, K, secs) {
  const { u, font } = K; let h = 12 * u, w = 192 * u;
  secs.forEach((s, i) => {
    if (i) h += 6 * u;
    if (s.title) { font(700, 13); w = Math.max(w, ctx.measureText(s.title).width + 24 * u); h += 19 * u; }
    s.rows.forEach((r) => { h += ((r.h || 19) + (r.sep ? 6 : 0)) * u; if (r.label) { font(400, r.mono ? 12 : 13, r.mono); w = Math.max(w, ctx.measureText(r.label).width + 56 * u); } });
  });
  return [Math.min(w, 280 * u), h + 6 * u];
}
function drawCard(ctx, K, x, y, w, h, secs) {
  const { u, font } = K; let yy = y + 12 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.strokeStyle = RULE; ctx.lineWidth = u; roundRect(ctx, x, y, w, h, 5 * u); ctx.fill(); ctx.stroke();
  secs.forEach((s, i) => {
    if (i) yy += 6 * u;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (s.title) { font(700, 13); ctx.fillStyle = brandTone('head'); ctx.fillText(fitText(ctx, s.title, w - 24 * u), x + 12 * u, yy + 9.5 * u); yy += 19 * u; }
    s.rows.forEach((r) => {
      if (r.sep) yy += 6 * u;
      if (r.full) r.full(ctx, K, x + 12 * u, yy, w - 24 * u);
      else { r.draw(ctx, x + 12 * u, yy + 9.5 * u, u); font(400, r.mono ? 12 : 13, r.mono); ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(fitText(ctx, r.label, w - 56 * u), x + 44 * u, yy + 9.5 * u); }
      yy += (r.h || 19) * u;
    });
  });
  ctx.textBaseline = 'alphabetic';
}
// The block's box on screen (its base and terrain corners), which legends keep off where they can.
function blockBox() {
  const ps = []; [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]].forEach(([x, y]) => { ps.push(proj(G.V(x, y, G.B.z0)), proj(G.V(x, y, G.surf(x, y)))); });
  return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
}

// Scale bar along a base edge of the block: the nearest edge that reads roughly horizontal and whose bar
// fits inside the frame, under the edge if there is room and otherwise just above it.
// Placed in the figure's layout pass (lay): kept clear of everything placed before it, drawn at flush.
function drawScaleBar(ctx, K, footTop, lay) {
  const { u, m, font } = K, C = [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]];
  const edges = C.map((p, i) => { const q = C[(i + 1) % 4]; return { p, q, d: G.V((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, G.B.z0).distanceTo(camera.position) }; }).sort((a, b) => a.d - b.d).slice(0, 2);
  for (const off of [22, -24]) for (const { p, q } of edges) for (const f0 of [0.05, 0.3, 0.55]) {
    let e0 = p, e1 = q, s0 = proj(G.V(e0[0], e0[1], G.B.z0)), s1 = proj(G.V(e1[0], e1[1], G.B.z0));
    if (s0[0] > s1[0]) { [e0, e1] = [e1, e0]; [s0, s1] = [s1, s0]; }
    const el = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), ud = [(e1[0] - e0[0]) / el, (e1[1] - e0[1]) / el], ppm = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) / el;
    if (!(ppm > 0) || s0[2] > 1 || s1[2] > 1 || Math.abs(s1[1] - s0[1]) > 0.7 * Math.abs(s1[0] - s0[0])) continue;
    const D = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * ppm >= 120 * u) || 5000, st = [e0[0] + ud[0] * el * f0, e0[1] + ud[1] * el * f0];
    if (D > el * (0.95 - f0)) continue;
    const sp = [0, 0.5, 1].map((f) => { const r = proj(G.V(st[0] + ud[0] * D * f, st[1] + ud[1] * D * f, G.B.z0)); return [r[0], r[1] + off * u]; });
    const lab = off > 0 ? 19 : -9;
    if (sp.some(([x, y]) => x < m || x > W - m || Math.max(y, y + lab * u) + 4 * u > footTop || Math.min(y, y + lab * u) < 12 * u)) continue;
    const ys = sp.flatMap(([, y]) => [y - 4 * u, y + lab * u + (lab > 0 ? 2 : -12) * u]);
    const box = [Math.min(...sp.map(([x]) => x)) - 8 * u, Math.min(...ys), Math.max(...sp.map(([x]) => x)) + 28 * u, Math.max(...ys)];
    if (!lay.clear(box)) continue; // keeps clear of hole IDs, legends and labels
    return lay.add(box.map((v, i) => v + (i < 2 ? -6 : 6) * u), 2, () => { // a margin, so no tick crowds the "0"
      ctx.lineCap = 'butt'; ctx.lineWidth = 6 * u; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(...sp[0]); ctx.lineTo(...sp[1]); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(...sp[1]); ctx.lineTo(...sp[2]); ctx.stroke();
      ctx.lineWidth = u; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1] - 3 * u); ctx.lineTo(sp[2][0], sp[2][1] - 3 * u); ctx.lineTo(sp[2][0], sp[2][1] + 3 * u); ctx.lineTo(sp[0][0], sp[0][1] + 3 * u); ctx.closePath(); ctx.stroke();
      font(400, 12, true); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('0', sp[0][0], sp[0][1] + lab * u); ctx.fillText(String(D / 2), sp[1][0], sp[1][1] + lab * u); ctx.fillText(`${D} m`, sp[2][0], sp[2][1] + lab * u); ctx.textAlign = 'left';
    });
  }
  // No near edge has room: a flat bar at the scale of the block centre.
  // Measured along the screen's own horizontal, so a view looking along an axis is not foreshortened.
  const across = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(G.diag * 0.1);
  const c0 = proj(controls.target), c1 = proj(controls.target.clone().add(across)), ppm = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) / (G.diag * 0.1);
  if (!(ppm > 0)) return;
  const D = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * ppm >= 120 * u) || 5000, len = D * ppm, y = footTop - 26 * u;
  // Nudged along the bottom; with no room it pushes out lower-priority items (elevation ticks), or is left out.
  return lay.place([0.5, 0.35, 0.65, 0.2, 0.8].map((f) => W * f - len / 2).map((x) => [x - 10 * u, y - 20 * u, x + len + 90 * u, y + 8 * u]), 2, ([bx]) => {
    const x = bx + 10 * u;
    ctx.fillStyle = INK; ctx.fillRect(x, y, len / 2, 6 * u); ctx.fillStyle = '#fff'; ctx.fillRect(x + len / 2, y, len / 2, 6 * u); ctx.strokeStyle = INK; ctx.lineWidth = u; ctx.strokeRect(x, y, len, 6 * u);
    font(400, 12, true); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText('0', x, y - 5 * u); ctx.fillText(`${D} m (at block centre)`, x + len, y - 5 * u); ctx.textAlign = 'left';
  });
}
// "ASSAYS PENDING" on a white pill along a projected hole (pts: screen points down the hole), reading left to
// right or downward. Of a few spots along and beside the hole it takes the one crossing the fewest other holes
// (others: their screen points), so it does not hide another hole's assays. Shrinks to fit, else skipped.
function alongLabel(ctx, K, t, pts, others) {
  const { u, font } = K, acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = acc[acc.length - 1]; if (!(L > 0)) return;
  let sz = 11.5; font(700, sz); setSpacing(ctx, 1.4 * u); while (sz > 8.5 && ctx.measureText(t).width + 14 * u > L * 0.8) { sz -= 0.5; font(700, sz); }
  const w = ctx.measureText(t).width + 12 * u, hh = sz * 1.45 * u; if (w > L) { setSpacing(ctx, 0); return; }
  const at = (d) => { let i = 1; while (i < acc.length - 1 && acc[i] < d) i++; const f = (d - acc[i - 1]) / ((acc[i] - acc[i - 1]) || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; };
  let best = null;
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) for (const side of [0, -1, 1]) {
    const c = Math.min(L - w / 2, Math.max(w / 2, f * L)), a = at(c - w / 2), b = at(c + w / 2), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const dx = Math.cos(ang), dy = Math.sin(ang), off = side * (hh + 4 * u), cx = (a[0] + b[0]) / 2 - dy * off, cy = (a[1] + b[1]) / 2 + dx * off;
    let hits = 0; for (const o of others) { const rx = o[0] - cx, ry = o[1] - cy; if (Math.abs(rx * dx + ry * dy) < w / 2 + 3 * u && Math.abs(-rx * dy + ry * dx) < hh / 2 + 3 * u) hits++; }
    const score = hits * 10 + Math.abs(f - 0.5) * 4 + Math.abs(side) * 3;
    if (!best || score < best.score) best = { score, cx, cy, ang };
  }
  let { ang } = best; if (ang > Math.PI / 2 + 0.01 || ang < -Math.PI / 2 + 0.01) ang += Math.PI;
  ctx.save(); ctx.translate(best.cx, best.cy); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(255,255,255,0.94)'; roundRect(ctx, -w / 2, -hh / 2, w, hh, hh / 2); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = S.accent; ctx.fillText(t, 0.7 * u, 0.8 * u);
  ctx.restore(); setSpacing(ctx, 0); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
// Elevation ticks up the block's vertical edge at the left-front: of the two corners nearest the camera,
// the one whose top projects furthest left. True elevations, about five ticks.
// Each tick is the lowest-priority item of the layout pass: dropped where anything else needs the room.
function drawElevTicks(ctx, K, top, bottom, lay, lines = []) {
  const { u, font } = K, C = [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]];
  const c = C.map(([x, y]) => ({ x, y, d: G.V(x, y, G.B.z0).distanceTo(camera.position) })).sort((p, q) => p.d - q.d).slice(0, 2)
    .map((p) => ({ ...p, zt: G.surf(p.x, p.y), s: proj(G.V(p.x, p.y, G.surf(p.x, p.y))) })).sort((p, q) => p.s[0] - q.s[0])[0];
  const b0 = proj(G.V(c.x, c.y, G.B.z0));
  if (c.s[2] > 1 || b0[2] > 1 || Math.abs(c.s[1] - b0[1]) < 70 * u) return;
  const step = niceRound((c.zt - G.B.z0) / 5);
  font(500, 11.5, true);
  for (let z = Math.ceil(G.B.z0 / step) * step; z <= c.zt - step * 0.2; z += step) {
    const [x, y] = proj(G.V(c.x, c.y, z)); if (y < top + 8 * u || y > bottom - 8 * u || x < 60 * u) continue;
    const box = [x - 10 * u - ctx.measureText(`${Math.round(z)} m`).width - 4 * u, y - 9 * u, x + 2 * u, y + 9 * u];
    if (!lay.clear(box)) continue;
    // ...and none within about 12 px of a callout's leader line.
    const near = (x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (4 * u)));
      for (let i = 0; i <= n; i++) { const px = x0 + dx * i / n, py = y0 + dy * i / n; if (px > box[0] - 12 * u && px < box[2] + 12 * u && py > box[1] - 4 * u && py < box[3] + 4 * u) return true; } return false; };
    if (lines.some((l) => near(...l))) continue;
    lay.add(box, 0, () => {
      font(500, 11.5, true); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7 * u, y); ctx.stroke();
      const t = `${Math.round(z)} m`; ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(t, x - 10 * u, y); ctx.fillStyle = INK; ctx.fillText(t, x - 10 * u, y);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    });
  }
}
// Free-text labels, placed in 0-1 frame coordinates so they land in the same spot at every export size.
// "title": large bold capitals in the primary colour; "normal": a rounded white pill. An arrow runs from
// the label's edge to (ax, ay). In the preview the boxes are kept for dragging (labelHits).
let labelHits = [], overlayOcc = [];
function labelSize(ctx, K, L) {
  if (L.kind === 'stat' && EXT.tags) return EXT.tags.statSize(ctx, K, L); // EXT hook: stat boxes
  const { u, font } = K, title = L.size === 'title', lines = String(L.text).split('\n');
  if (title) { font(700, 26); setSpacing(ctx, 1.6 * u); } else font(600, 15);
  const lh = (title ? 29 : 19) * u, tw = Math.max(...lines.map((t) => ctx.measureText(title ? t.toUpperCase() : t).width)), padX = title ? 4 * u : 12 * u, padY = title ? 2 * u : 7 * u;
  return { title, lines, lh, padY, bw: tw + padX * 2, bh: lines.length * lh + padY * 2 };
}
// Where a new label goes when no position is given: the clear spot nearest the frame centre, away from
// collars, hole IDs, section markers, callouts, the legend, inset and other labels (as last drawn).
function freeSpot(L) {
  const c = document.createElement('canvas').getContext('2d'), K = kit(c, W, H), { bw, bh } = labelSize(c, K, L); setSpacing(c, 0);
  const pad = 10 * K.u, spots = [];
  for (let y = 0.18; y <= 0.86; y += 0.04) for (let x = 0.12; x <= 0.88; x += 0.04) spots.push([x, y]);
  spots.sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.5) - Math.hypot(b[0] - 0.5, b[1] - 0.5));
  return spots.find(([x, y]) => { const bx = [x * W - bw / 2 - pad, y * H - bh / 2 - pad, x * W + bw / 2 + pad, y * H + bh / 2 + pad];
    return bx[0] > 0 && bx[2] < W && !overlayOcc.some((b) => !(bx[2] < b[0] || bx[0] > b[2] || bx[3] < b[1] || bx[1] > b[3])); }) || [0.5, 0.5];
}
function drawLabels(ctx, K, forExport) {
  const { u } = K, hits = [];
  S.labels.forEach((L) => {
    if (L.kind === 'stat') { extStat(ctx, K, L, hits, forExport); return; } // EXT hook: stat boxes
    const cx = L.x * W, cy = L.y * H, { title, lines, lh, padY, bw, bh } = labelSize(ctx, K, L), box = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2];
    if (L.arrow) {
      const [tx, ty] = tipAt(L), dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy);
      if (d > 4 * u) {
        const t = Math.min(bw / 2 / (Math.abs(dx) || 1e-9), bh / 2 / (Math.abs(dy) || 1e-9)), sx = cx + dx * t + dx / d * 5 * u, sy = cy + dy * t + dy / d * 5 * u, ang = Math.atan2(dy, dx), hl = 13 * u;
        const ex = tx - Math.cos(ang) * hl * 0.8, ey = ty - Math.sin(ang) * hl * 0.8;
        if (Math.hypot(ex - sx, ey - sy) > 2 * u && (ex - sx) * dx + (ey - sy) * dy > 0) {
          ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.strokeStyle = S.primary; ctx.lineWidth = 2.6 * u; ctx.stroke(); ctx.lineCap = 'butt';
        }
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-hl, -hl * 0.42); ctx.lineTo(-hl, hl * 0.42); ctx.closePath();
        ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3 * u; ctx.stroke(); ctx.fillStyle = S.primary; ctx.fill(); ctx.restore();
      }
      if (!forExport) hits.push({ id: L.id, kind: 'tip', x: tx, y: ty, r: 12 * u + 6 });
    }
    if (!title) { ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.strokeStyle = RULE; ctx.lineWidth = u; roundRect(ctx, box[0], box[1], bw, bh, Math.min(bh / 2, 16 * u)); ctx.fill(); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    lines.forEach((t, i) => {
      const y = box[1] + padY + lh * (i + 0.5) + u, tt = title ? t.toUpperCase() : t;
      if (title) { ctx.lineWidth = 6 * u; ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.strokeText(tt, cx, y); ctx.fillStyle = S.primary; } else ctx.fillStyle = INK;
      ctx.fillText(tt, cx, y);
    });
    setSpacing(ctx, 0); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (!forExport) {
      hits.push({ id: L.id, kind: 'label', box: [box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4] });
      // Handles while laying out: a dashed frame says "drag me"; a ring marks the arrow tip.
      if (currentStep === 'layout') {
        ctx.setLineDash([4 * u, 3 * u]); ctx.strokeStyle = 'rgba(31,120,168,0.7)'; ctx.lineWidth = u; ctx.strokeRect(box[0] - 3 * u, box[1] - 3 * u, bw + 6 * u, bh + 6 * u); ctx.setLineDash([]);
        if (L.arrow) { ctx.beginPath(); ctx.arc(...tipAt(L).slice(0, 2), 6 * u, 0, Math.PI * 2); ctx.strokeStyle = '#1f78a8'; ctx.lineWidth = 1.6 * u; ctx.stroke(); }
      }
    }
  });
  if (!forExport) labelHits = hits;
}
function drawOverlay(ctx, k, forExport) {
  ctx.save(); ctx.scale(k, k); if (!forExport) ctx.clearRect(0, 0, W, H);
  const K = kit(ctx, W, H), { u, m, font, narrow } = K;
  if (!G) { font(600, 18); ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.fillText('Add a collar file and an assay file to build the figure.', W / 2, H / 2); ctx.restore(); return; }
  // Collars and hole IDs. occ collects what is drawn, so the scale bar and new labels can keep clear of it.
  const placed = wallLabelBoxes(), idBoxes = [], occ = [], hits = [];
  project.holes.forEach((h) => {
    const [cx, cy] = proj(G.V(h.c.x, h.c.y, h.c.z)), e = h.path[h.path.length - 1], [ex, ey] = proj(G.V(e.x, e.y, e.z));
    ctx.beginPath(); ctx.arc(cx, cy, 5 * u, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.4 * u; ctx.strokeStyle = EXT.tags?.highlightOf(h) || INK; if (h.prov || h.planned) ctx.setLineDash([2.5 * u, 2 * u]); ctx.stroke(); ctx.setLineDash([]);
    occ.push([cx - 8 * u, cy - 8 * u, cx + 8 * u, cy + 8 * u]);
    // EXT hook: key holes only (the default past 12 holes, when tags.js decides), and no ID where a pill is.
    if (!S.ids || (EXT.tags ? !EXT.tags.idShown(h) || (S.tags.at === 'collar' && EXT.tags.tagShown(h)) : S.tags.at === 'collar' || project.holes.length > 12)) return;
    const ang = Math.atan2(ey - cy, ex - cx), flip = Math.abs(ang) > Math.PI / 2, r = 26 * u, box = [ex - r, ey - r, ex + r, ey + r];
    // The ID is dropped where it would land on another ID or on a label painted on the block.
    const run = [ex + Math.cos(ang) * 6 * u, ey + Math.sin(ang) * 6 * u, ex + Math.cos(ang) * 60 * u, ey + Math.sin(ang) * 60 * u], tbox = [Math.min(run[0], run[2]), Math.min(run[1], run[3]), Math.max(run[0], run[2]), Math.max(run[1], run[3])];
    if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) return;
    if (placed.slice(0, G.wallLabelMeshes?.length || 0).some((b) => !(tbox[2] < b[0] || tbox[0] > b[2] || tbox[3] < b[1] || tbox[1] > b[3]))) return;
    placed.push(box);
    ctx.save(); ctx.translate(ex + Math.cos(ang) * 6 * u, ey + Math.sin(ang) * 6 * u); ctx.rotate(flip ? ang + Math.PI : ang);
    font(500, 11.5, true); ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.textAlign = flip ? 'right' : 'left';
    ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(h.id, 0, 0); ctx.fillText(h.id, 0, 0); ctx.restore();
    // The rotated text runs from 6u past the hole end along the trace direction.
    const tw = ctx.measureText(h.id).width, x0 = ex + Math.cos(ang) * 6 * u, y0 = ey + Math.sin(ang) * 6 * u, x1 = x0 + Math.cos(ang) * tw, y1 = y0 + Math.sin(ang) * tw;
    idBoxes.push([Math.min(x0, x1) - 8 * u, Math.min(y0, y1) - 8 * u, Math.max(x0, x1) + 8 * u, Math.max(y0, y1) + 8 * u]);
  });
  const pend = S.pendingLabels && S.tags.pending !== 'collar' ? project.holes.filter(isPending) : []; // EXT hook: or one tag per group at the collars (tags.js)
  if (pend.length) {
    const scr = new Map(project.holes.map((h) => [h, h.path.filter((p, i) => i % 3 === 0).map((p) => proj(G.V(p.x, p.y, p.z))).filter((p) => p[2] < 1)]));
    pend.forEach((h) => { const pts = scr.get(h).filter((p, i, a) => i > a.length * 0.06); if (pts.length > 2) alongLabel(ctx, K, 'ASSAYS PENDING', pts, project.holes.filter((o) => o !== h).flatMap((o) => scr.get(o))); });
  }
  // Section ends
  const [A, Bp] = sectionEnds();
  [[A, 'A'], [Bp, 'A′']].forEach(([p, t]) => { const [x, y] = proj(G.V(p.x, p.y, G.surf(p.x, p.y) + G.diag * 0.035)); tagLabel(ctx, K, t, x, y); occ.push([x - 22 * u, y - 14 * u, x + 22 * u, y + 14 * u]); });
  // Frame furniture
  const logo = drawLogo(ctx, K, W, forExport);
  const headBottom = drawHeader(ctx, K, W, S.title, S.subtitle, logo.w);
  const footTop = drawFooter(ctx, K, W, H, terrainCredits(true), autoNotes('3d'));
  // The layout pass: everything below registers its box in occ; the text labels, placed by hand, first.
  occ.push(...idBoxes, [0, 0, W, headBottom], [0, footTop, W, H], ...S.labels.map((L) => { const { bw, bh } = labelSize(ctx, K, L); setSpacing(ctx, 0); return [L.x * W - bw / 2, L.y * H - bh / 2, L.x * W + bw / 2, L.y * H + bh / 2]; }));
  const lay = makeLayout(W, H, 6 * u, occ);
  // Plan inset under the logo (EXT hook: or a map inset)
  if (S.inset && !EXT.tags?.drawInset(ctx, K, { W, top: logo.bottom + 16 * u, occ })) {
    const iw = (narrow ? 118 : 150) * u, sc = iw / Math.max(G.bw, G.bh), bw = G.bw * sc, bh = G.bh * sc, ix = W - m - iw, iy = logo.bottom + 16 * u, P = (x, y) => [ix + (iw - bw) / 2 + (x - G.B.x0) * sc, iy + (G.B.y1 - y) * sc];
    ctx.fillStyle = '#fff'; ctx.strokeStyle = RULE; ctx.lineWidth = u; roundRect(ctx, ix - 8 * u, iy - 8 * u, iw + 16 * u, bh + 34 * u, 5 * u); ctx.fill(); ctx.stroke(); occ.push([ix - 8 * u, 0, W, iy + bh + 26 * u]);
    ctx.strokeStyle = S.primary; ctx.lineWidth = 1.4 * u; ctx.strokeRect(ix + (iw - bw) / 2, iy, bw, bh);
    project.holes.forEach((h) => { ctx.strokeStyle = '#7c898c'; ctx.lineWidth = u; ctx.beginPath(); h.path.forEach((p, i) => { const [X, Y] = P(p.x, p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
      const [X, Y] = P(h.c.x, h.c.y); ctx.fillStyle = INK; ctx.fillRect(X - 1.5 * u, Y - 1.5 * u, 3 * u, 3 * u); });
    ctx.setLineDash([5 * u, 3 * u]); ctx.strokeStyle = S.accent; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.moveTo(...P(A.x, A.y)); ctx.lineTo(...P(Bp.x, Bp.y)); ctx.stroke(); ctx.setLineDash([]);
    font(700, 11); ctx.fillStyle = S.primary; ctx.fillText('N ↑', ix + (iw - bw) / 2 + 3 * u, iy + 12 * u);
    font(400, 11); ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.fillText('Plan of drilling', ix + iw / 2, iy + bh + 18 * u); ctx.textAlign = 'left';
  }
  // EXT hook: collar pills and pending tags, before the legends so those keep clear of them.
  EXT.tags?.drawPills(ctx, K, { placed: placed.concat(labelHits.filter((h) => h.box).map((h) => h.box)), occ, W, H });
  // Legends: one card (S.legend.merge "one", or "auto" with three or more blocks) or the main card and the
  // layers' cards (EXT hook: lithology, geophysics). A card docked to a corner or dragged stays put; the
  // others take the first spot clear of what is placed and, where they can, of the block itself.
  const trTop = Math.max(...occ.filter((b) => b[1] === 0 && b[2] >= W - 1).map((b) => b[3])) + 12 * u, soft = [blockBox()], main = legendSecs(), ext = extSections(), LG = S.legend;
  const hs = main.filter((s) => s.key === 'holes'), one = [...main.filter((s) => s.key !== 'holes'), ...ext, ...hs.map((s) => ({ ...s, title: 'Holes' }))];
  let merge = shouldMerge([...main, ...ext], LG.merge);
  if (merge && LG.merge === 'auto' && !LG.pos.main) { const [w, h] = cardSize(ctx, K, one); merge = lay.clear([W - m - w, footTop - 12 * u - h, W - m, footTop - 12 * u], soft) || lay.clear([W - m - w, trTop, W - m, trTop + h], soft); } // only where one card fits at the right
  const cards = merge ? [['main', one]] : [['main', main], ...ext.map((s) => [s.key, [s]])], cardBoxes = [];
  let prev = null;
  const fixed = (k) => +(!!LG.pos[k] && LG.pos[k] !== 'auto'); // cards placed by hand go first
  cards.sort((a, b) => fixed(b[0]) - fixed(a[0])).forEach(([key, secs]) => {
    const [w, h] = cardSize(ctx, K, secs), at = (x, y) => [x, y, x + w, y + h], p = LG.pos[key];
    const corner = { br: at(W - m - w, footTop - 12 * u - h), tr: at(W - m - w, trTop), bl: at(m, footTop - 72 * u - h), tl: at(m, headBottom + 18 * u) };
    const cands = [...(prev ? [at(prev[0] - 10 * u - w, prev[3] - h), at(prev[2] - w, prev[1] - 10 * u - h)] : []), corner.br, corner.tr, corner.bl, corner.tl];
    const box = p?.x !== undefined ? lay.add(at(Math.max(0, Math.min(W - w, p.x * W)), Math.max(0, Math.min(H - h, p.y * H)))) : corner[p] ? lay.add(corner[p]) : lay.place(cands, Infinity, null, soft) || lay.add(cands[0]);
    drawCard(ctx, K, box[0], box[1], w, h, secs); hits.push({ kind: 'legend', id: key, box }); cardBoxes.push(box); prev = box;
  });
  drawScaleBar(ctx, K, footTop, lay); // after the legends, so it keeps clear of them
  // Orientation, bottom left: north arrow plus view direction
  occ.push([0, footTop - 60 * u, m + 160 * u, footTop]);
  const cam = getCam(), ox = m + 22 * u, oy = footTop - 34 * u, T = controls.target, n0 = proj(T), n1 = proj(T.clone().add(new THREE.Vector3(0, 0, -G.diag * 0.1)));
  const ang = Math.atan2(n1[1] - n0[1], n1[0] - n0[0]);
  ctx.beginPath(); ctx.arc(ox, oy, 21 * u, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = RULE; ctx.lineWidth = u; ctx.stroke();
  ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang + Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(0, -15 * u); ctx.lineTo(6 * u, 7 * u); ctx.lineTo(0, 3 * u); ctx.closePath(); ctx.fillStyle = S.primary; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -15 * u); ctx.lineTo(-6 * u, 7 * u); ctx.lineTo(0, 3 * u); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = S.primary; ctx.lineWidth = u; ctx.stroke();
  ctx.restore();
  font(700, 10); ctx.fillStyle = S.primary; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', ox + Math.cos(ang) * 29 * u, oy + Math.sin(ang) * 29 * u);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  font(600, 13); ctx.fillStyle = INK; ctx.fillText(`Looking ${pad3(cam.azimuth)}°`, ox + 36 * u, oy - 2 * u);
  font(400, 12, true); ctx.fillStyle = MUTED; ctx.fillText(`plunge ${cam.plunge}°${S.vex !== 1 ? ` · VE ${S.vex}×` : ''}`, ox + 36 * u, oy + 14 * u);
  // Intercept callouts, left column between the title and the orientation box
  // Each box goes level with its hole where it can: stacked downward, then pulled up from the bottom.
  // Only if they still do not fit is the lowest-ranked callout dropped (ranking: metal in the interval).
  // The column keeps above and below any legend card on the left.
  const gap = 30 * u, left = cardBoxes.filter((b) => b[0] < W * 0.3), tag = 18 * u, boxes = [];
  const maxY = Math.min(oy - 36 * u, ...left.filter((b) => b[1] > H / 2).map((b) => b[1] - 12 * u)), top = Math.max(headBottom + 18 * u, ...left.filter((b) => b[1] <= H / 2).map((b) => b[3] + 12 * u));
  let items = shownCallouts().map((c, rank) => { const p = c.h.posAt(c.ic.broad.mid); return { c, rank, s: proj(G.V(p.x, p.y, p.z)), M: measureCallout(ctx, K, c) }; }).filter(({ s }) => s[2] < 1).sort((a, b) => a.s[1] - b.s[1]);
  items = extGroups(ctx, K, items); // EXT hook: grouped intercept boxes
  let free = []; if (EXT.tags) ({ col: items, free } = EXT.tags.splitCallouts(items)); // EXT hook: beside, bracket or dragged
  for (;;) {
    let y = top; items.forEach((it) => { it.y = Math.max(y, it.s[1] - it.M.bh / 2); y = it.y + it.M.bh + gap; });
    for (let i = items.length - 1; i >= 0; i--) items[i].y = Math.min(items[i].y, i === items.length - 1 ? maxY - tag - items[i].M.bh : items[i + 1].y - gap - items[i].M.bh);
    if (!items.length || items[0].y >= top - 1) break;
    const worst = items.reduce((a, b) => (b.rank > a.rank ? b : a)); items = items.filter((it) => it !== worst);
  }
  const leaders = [];
  items.forEach((it) => { const { c, s, M, y } = it; if (it.group) EXT.tags.drawGroup(ctx, K, m, y, it); else { drawCallout(ctx, K, m, y, c, M, s); hits.push({ kind: 'callout', id: c.h.id, box: [m, y, m + M.bw, y + M.bh] }); } boxes.push([m, y, m + M.bw, y + M.bh + tag]); leaders.push(...M.leader); });
  occ.push(...boxes.map((b) => [b[0], b[1], b[2] + 10 * u, b[3]]));
  // Callouts beside or bracketed on their hole: placed clear of the column and of its leaders.
  if (free.length) {
    leaders.forEach(([x0, y0, x1, y1]) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (12 * u)); for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; occ.push([x - 2 * u, y - 2 * u, x + 2 * u, y + 2 * u]); } });
    EXT.tags.drawFree(ctx, K, free, { lay, W, H, hits });
  }
  // Placed after the callouts so a tick never hides under a callout box; the deferred items (scale bar,
  // ticks) are drawn now, those pushed out by something more important left out.
  if (S.elevTicks) drawElevTicks(ctx, K, headBottom, footTop, lay, leaders);
  lay.flush();
  drawLabels(ctx, K, forExport);
  if (!forExport) { overlayOcc = occ.slice(); labelHits = labelHits.concat(hits); } // legends and callouts drag too
  ctx.restore();
}

// ============================================================
// 7. Section A–A′
// ============================================================
function drawSection(ctx, Wc, Hc, forExport) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, Wc, Hc);
  const K = kit(ctx, Wc, Hc), { u, m, font, narrow } = K;
  if (!G) { font(600, 18); ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.fillText('Add a collar file and an assay file to build the section.', Wc / 2, Hc / 2); ctx.textAlign = 'left'; return; }
  const [A, Bp] = sectionEnds(), L = Math.hypot(Bp.x - A.x, Bp.y - A.y), d = { x: (Bp.x - A.x) / L, y: (Bp.y - A.y) / L }, perp = { x: -d.y, y: d.x };
  const pr = (p) => ({ t: (p.x - A.x) * d.x + (p.y - A.y) * d.y, off: (p.x - A.x) * perp.x + (p.y - A.y) * perp.y });
  const lookAz = ((S.secAz - 90) % 360 + 360) % 360;
  const logo = drawLogo(ctx, K, Wc, forExport), head = S.title.split('·')[0].trim() || S.title;
  const headBottom = drawHeader(ctx, K, Wc, `${head} · SECTION A–A′`, `Looking ${pad3(lookAz)}° · ±${S.secW} m projection · ${S.valueLabel}`, logo.w);
  const footTop = drawFooter(ctx, K, Wc, Hc, terrainCredits(false), autoNotes('section'));
  const profile = []; let zMax = -Infinity;
  for (let i = 0; i <= 200; i++) { const t = i / 200 * L, z = G.surf(A.x + d.x * t, A.y + d.y * t); profile.push([t, z]); zMax = Math.max(zMax, z); }
  const shown = project.holes.map((h) => ({ h, pts: h.path.map((p) => ({ ...p, ...pr(p) })) })).filter(({ pts }) => pts.some((p) => Math.abs(p.off) <= S.secW));
  let zMin = Infinity; shown.forEach(({ pts }) => pts.forEach((p) => { if (Math.abs(p.off) <= S.secW) zMin = Math.min(zMin, p.z); }));
  if (!Number.isFinite(zMin)) zMin = G.B.z0;
  const zTop = zMax + (zMax - zMin) * 0.12, zBot = zMin - (zMax - zMin) * 0.05;
  const ml = narrow ? m + 8 * u : Math.min(330 * u, Wc * 0.27), mr = m + 70 * u, mt = Math.max(headBottom, logo.bottom) + 40 * u, mb = Hc - footTop + 56 * u;
  const s = Math.min((Wc - ml - mr) / L, (Hc - mt - mb) / (zTop - zBot)), ox = ml + ((Wc - ml - mr) - L * s) / 2, oy = mt + ((Hc - mt - mb) - (zTop - zBot) * s) / 2 + (zTop - zBot) * s;
  const X = (t) => ox + t * s, Y = (z) => oy - (z - zBot) * s;
  ctx.fillStyle = '#eef1f0'; ctx.beginPath(); ctx.moveTo(X(0), Y(zBot)); profile.forEach(([t, z]) => ctx.lineTo(X(t), Y(z))); ctx.lineTo(X(L), Y(zBot)); ctx.closePath(); ctx.fill();
  extSection(ctx, { A, Bp, X, Y, L, clip: () => { ctx.beginPath(); ctx.moveTo(X(0), Y(zBot)); profile.forEach(([t, z]) => ctx.lineTo(X(t), Y(z))); ctx.lineTo(X(L), Y(zBot)); ctx.closePath(); ctx.clip(); } }); // EXT hook
  ctx.strokeStyle = S.primary; ctx.lineWidth = 1.8 * u; ctx.beginPath(); profile.forEach(([t, z], i) => (i ? ctx.lineTo(X(t), Y(z)) : ctx.moveTo(X(t), Y(z)))); ctx.stroke();
  // Elevation ticks
  font(400, 11, true); ctx.fillStyle = MUTED; ctx.strokeStyle = RULE; ctx.lineWidth = u;
  const stepZ = niceRound((zTop - zBot) / 5);
  for (let z = Math.ceil(zBot / stepZ) * stepZ; z < zTop; z += stepZ) { ctx.beginPath(); ctx.moveTo(X(L) + 4 * u, Y(z)); ctx.lineTo(X(L) + 10 * u, Y(z)); ctx.stroke(); ctx.fillText(`${Math.round(z)} m`, X(L) + 14 * u, Y(z) + 4 * u); }
  const barW = Math.max(6 * u, Math.min(12 * u, s * 7));
  shown.forEach(({ h, pts }) => {
    ctx.strokeStyle = '#2c3d42'; ctx.lineWidth = u; ctx.beginPath(); let on = false; if (h.prov || h.planned) ctx.setLineDash([5 * u, 3 * u]);
    pts.forEach((p) => { if (Math.abs(p.off) > S.secW) { on = false; return; } on ? ctx.lineTo(X(p.t), Y(p.z)) : ctx.moveTo(X(p.t), Y(p.z)); on = true; }); ctx.stroke(); ctx.setLineDash([]);
    h.ints.forEach((it) => {
      const bi = intervalShown(it) ? binIndex(it.vals[S.valueCol]) : -1; if (bi < 1) return;
      const a = h.posAt(it.from), b = h.posAt(it.to), pa = pr(a), pb = pr(b); if (Math.abs(pa.off) > S.secW) return;
      const x0 = X(pa.t), y0 = Y(a.z), x1 = X(pb.t), y1 = Y(b.z), ang = Math.atan2(y1 - y0, x1 - x0), len = Math.max(1.5 * u, Math.hypot(x1 - x0, y1 - y0));
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(ang); ctx.fillStyle = BIN_COLORS[bi]; ctx.fillRect(0, -barW / 2, len + 0.5 * u, barW); ctx.restore();
    });
    // Reported interval and "incl." as bars to the right of the hole, as on the 3D figure.
    const co = S.ribbons && callouts.find((x) => x.h === h);
    if (co) [co.ic.broad, co.ic.incl].forEach((x, k) => {
      if (!x) return; const p0 = h.posAt(x.from), p1 = h.posAt(x.from + x.len), q0 = pr(p0), q1 = pr(p1);
      let nx = -(Y(p1.z) - Y(p0.z)), ny = X(q1.t) - X(q0.t); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; if (nx < 0) { nx = -nx; ny = -ny; }
      const off = barW * 1.45; ctx.strokeStyle = RIB_COLORS[k]; ctx.lineWidth = barW * 0.85; ctx.lineCap = 'butt'; ctx.beginPath(); let on = false;
      for (let d = x.from; d < x.from + x.len + 2; d += 2) { const p = h.posAt(Math.min(d, x.from + x.len)), q = pr(p); if (Math.abs(q.off) > S.secW) { on = false; continue; }
        const sx = X(q.t) + nx * off, sy = Y(p.z) + ny * off; on ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); on = true; }
      ctx.stroke();
    });
    const c = pr(h.c);
    if (Math.abs(c.off) <= S.secW) { ctx.save(); ctx.translate(X(c.t), Y(h.c.z) - 8 * u); ctx.rotate(-Math.PI / 4); ctx.fillStyle = INK; font(500, 12, true); ctx.fillText(h.id, 0, 0); ctx.restore(); }
  });
  // Pending labels last, placed clear of the other holes on the section.
  if (S.pendingLabels) {
    const scr = new Map(shown.map(({ h, pts }) => [h, pts.filter((p) => Math.abs(p.off) <= S.secW).map((p) => [X(p.t), Y(p.z)])]));
    shown.filter(({ h }) => isPending(h)).forEach(({ h }) => { const vis = scr.get(h).filter((p, i, a) => i > a.length * 0.06); if (vis.length > 2) alongLabel(ctx, K, 'ASSAYS PENDING', vis, shown.filter((o) => o.h !== h).flatMap((o) => scr.get(o.h))); });
  }
  // Callouts for holes on this section
  let by = mt; const maxY = Hc - mb;
  shownCallouts().filter((c) => shown.some((x) => x.h === c.h)).slice(0, narrow ? 2 : 4).forEach((c) => {
    const M = measureCallout(ctx, K, c); if (by + M.bh + 18 * u > maxY) return;
    const p = c.h.posAt(c.ic.broad.mid), q = pr(p); drawCallout(ctx, K, m, by, c, M, [X(q.t), Y(p.z)]); by += M.bh + 34 * u;
  });
  if (!narrow) { let x = m; extSections().forEach((s) => { const [w, h] = cardSize(ctx, K, [s]), y = footTop - 52 * u - h; if (y < by || x + w > ox - 10 * u) return; drawCard(ctx, K, x, y, w, h, [s]); x += w + 10 * u; }); } // EXT hook: lithology, geophysics
  tagLabel(ctx, K, 'A', X(0), Y(profile[0][1]) - 24 * u); tagLabel(ctx, K, 'A′', X(L), Y(profile[200][1]) - 24 * u);
  // Bottom strip: scale bar left, horizontal legend right
  const sy = footTop - 18 * u, sb = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * s >= 120 * u) || niceRound(L / 3);
  ctx.fillStyle = INK; ctx.fillRect(m, sy, sb * s / 2, 6 * u); ctx.fillStyle = '#fff'; ctx.fillRect(m + sb * s / 2, sy, sb * s / 2, 6 * u); ctx.strokeStyle = INK; ctx.lineWidth = u; ctx.strokeRect(m, sy, sb * s, 6 * u);
  font(400, 12, true); ctx.fillStyle = INK; ctx.fillText('0', m, sy - 6 * u); ctx.textAlign = 'right'; ctx.fillText(`${sb} m`, m + sb * s, sy - 6 * u); ctx.textAlign = 'left';
  let items = legendRows().slice(0, 4).reverse(); font(400, 12, true);
  // The interval bars join the strip when a hole on the section has them and there is room.
  const ribs = S.ribbons ? callouts.filter((c) => shown.some((x) => x.h === c.h)) : [];
  const withRibs = items.concat(ribs.length ? [['Reported interval', RIB_COLORS[0]], ...(ribs.some((c) => c.ic.incl) ? [['incl.', RIB_COLORS[1]]] : [])] : []);
  const widthOf = (list) => list.map(([t]) => ctx.measureText(t).width + 36 * u);
  if (withRibs.length > items.length && widthOf(withRibs).reduce((a, b) => a + b, 0) < Wc - 2 * m - sb * s - 200 * u) items = withRibs;
  const iw = widthOf(items); font(700, 13); const hw = ctx.measureText(S.valueLabel).width + 14 * u;
  let lx = Wc - m - hw - iw.reduce((a, b) => a + b, 0); const ly = sy + 3 * u;
  ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.fillText(S.valueLabel, lx, ly); lx += hw;
  items.forEach(([t, c], i) => { ctx.fillStyle = c; roundRect(ctx, lx, ly - 4 * u, 22 * u, 8 * u, 4 * u); ctx.fill(); font(400, 12, true); ctx.fillStyle = INK; ctx.fillText(t, lx + 28 * u, ly); lx += iw[i]; });
  ctx.textBaseline = 'alphabetic';
}
function drawSectionView() {
  if (secCanvas.hidden) return;
  secCanvas.width = Math.round(W * DPR); secCanvas.height = Math.round(H * DPR);
  const ctx = secCanvas.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawSection(ctx, W, H, false);
}

// ============================================================
// 8. Loop and export
// ============================================================
function loop(now) {
  if (tween) { const k = Math.min(1, (now - tween.t0) / 900), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(tween.from, tween.to, e); controls.target.lerpVectors(tween.fromT, tween.toT, e); if (k >= 1) tween = null; }
  controls.update();
  if (G && S.view === '3d') { camera.updateMatrixWorld(); if (!G.ribbonView || camera.getWorldDirection(tmpV).dot(G.ribbonView) < 0.99998) { placeRibbons(); faceWalls(); } }
  if (S.view === '3d') { renderer.render(scene, camera); drawOverlay(ov.getContext('2d'), DPR, false); syncCamUI(); }
  requestAnimationFrame(loop);
}
// One export canvas at the chosen size. layer "scene" is the WebGL render alone on transparent;
// "annotations" is the overlay alone (both for designers); "figure" is the two together.
function figureCanvas(view, layer = 'figure') {
  const f = FORMATS[S.format], out = document.createElement('canvas'); out.width = f.w; out.height = f.h; const ctx = out.getContext('2d');
  if (view === 'section') { ctx.scale(f.w / W, f.h / H); drawSection(ctx, W, H, true); return out; }
  const k = f.w / W; tween = null; controls.update(); placeRibbons(); faceWalls();
  if (layer !== 'annotations') {
    const bg = scene.background; if (layer === 'scene') scene.background = null; // the renderer has alpha, so this clears to transparent
    renderer.setPixelRatio(k); renderer.setSize(W, H, false); renderer.render(scene, camera);
    ctx.drawImage(glCanvas, 0, 0, f.w, f.h);
    scene.background = bg; renderer.setPixelRatio(DPR); renderer.setSize(W, H, false); renderer.render(scene, camera);
  }
  if (layer !== 'scene') drawOverlay(ctx, k, true);
  return out;
}
const fileSlug = () => (S.title.split('·')[0].trim() || 'figure').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure';
function downloadURL(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function exportPNG(opts = {}) {
  if (!G) throw new Error('Nothing to export yet: add a collar file and an assay file.');
  const view = opts.view === 'section' ? 'section' : opts.view === '3d' ? '3d' : S.view, f = FORMATS[S.format];
  const url = figureCanvas(view).toDataURL('image/png');
  if (opts.download) downloadURL(url, `${fileSlug()}-${view === 'section' ? 'section' : '3d'}-${S.format}.png`);
  status(`Exported ${view === 'section' ? 'section A–A′' : 'the 3D figure'} at ${f.w} × ${f.h} px.`);
  return url;
}
const canvasBlob = (c) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be encoded.'))), 'image/png'));
const blobDataURL = (b) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(b); });
// Designer handoff: the figure, its 3D render and annotations as separate transparent layers, the section,
// and the settings, in one ZIP at the chosen size. PNGs are stored, not deflated: they are compressed already.
const LAYER_FILES = { figure: 'figure.png', scene: 'scene.png', annotations: 'annotations.png', section: 'section.png', settings: 'figure-settings.json' };
async function exportLayers(opts = {}) {
  if (!G) throw new Error('Nothing to export yet: add a collar file and an assay file.');
  const { zipSync } = await import('fflate'), f = FORMATS[S.format];
  status(`Preparing layers at ${f.w} × ${f.h} px…`);
  const bytes = async (c) => new Uint8Array(await (await canvasBlob(c)).arrayBuffer());
  const png = { figure: await bytes(figureCanvas('3d')), scene: await bytes(figureCanvas('3d', 'scene')), annotations: await bytes(figureCanvas('3d', 'annotations')), section: await bytes(figureCanvas('section')) };
  const settings = { ...getState(), layers: { ...LAYER_FILES, note: 'scene.png and annotations.png are transparent and stack (scene below) to make figure.png.' }, exportedAt: new Date().toISOString() };
  const zip = zipSync({
    ...Object.fromEntries(Object.entries(png).map(([k, v]) => [LAYER_FILES[k], [v, { level: 0 }]])),
    [LAYER_FILES.settings]: new TextEncoder().encode(JSON.stringify(settings, null, 2)),
  });
  const blob = new Blob([zip], { type: 'application/zip' });
  if (opts.download) { const url = URL.createObjectURL(blob); downloadURL(url, `${fileSlug()}-layers-${S.format}.zip`); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  status(`Layers ready: ${Object.keys(LAYER_FILES).length} files, ${(blob.size / 1048576).toFixed(1)} MB.`);
  return opts.as === 'blob' ? blob : blobDataURL(blob);
}
$('export-layers').addEventListener('click', () => exportLayers({ download: true, as: 'blob' }).catch((e) => status(e.message)));

// ============================================================
// 8b. Send to the design desk (the Teams enquiry, with the figure and layers attached)
// ============================================================
// The desk lives in desk.js, loaded on first use: the form's submit or EM3D.sendToDesignDesk.
// A page cached from before a deploy may ask for a lazy chunk that is gone: reload once (not again within a
// minute, so it can never loop).
addEventListener('vite:preloadError', (e) => {
  try { const k = 'em3d.reloadedAt'; if (Date.now() - (+sessionStorage.getItem(k) || 0) < 60000) return; sessionStorage.setItem(k, String(Date.now())); } catch { return; }
  e.preventDefault(); location.reload();
});
const desk = () => import('./desk.js').then((m) => { m.init(host()); return m; });
const sendToDesignDesk = (o) => desk().then((m) => m.sendToDesignDesk(o));
$('desk').addEventListener('submit', (e) => { e.preventDefault(); desk().then((m) => m.submit(), (err) => status(err.message)); });
$('export-3d').addEventListener('click', () => exportPNG({ view: '3d', download: true }));
$('export-section').addEventListener('click', () => exportPNG({ view: 'section', download: true }));

// ============================================================
// 9. Logo colours
// ============================================================
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
function setLogo(src, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!src) { S.logo = null; $('logo-prev').textContent = 'No logo'; drawSectionView(); schedulePublish(); status('Logo removed.'); resolve(getState()); return; }
    const img = new Image();
    img.onload = async () => {
      S.logo = img; $('logo-prev').innerHTML = ''; const pv = new Image(); pv.src = src; pv.alt = 'Your logo'; $('logo-prev').appendChild(pv);
      let picked = null; // the colour picker (logo-colours.js) loads with the first logo
      if (opts.autoColor !== false) try { picked = (await import('./logo-colours.js')).brandFromLogo(img); } catch { /* keep the colours */ }
      if (picked) { setBrand({ primary: picked.primary, accent: picked.accent }); $('col-note').textContent = picked.note; }
      drawSectionView(); schedulePublish(); status(picked ? 'Logo added and brand colours applied.' : 'Logo added.'); resolve(getState());
    };
    img.onerror = () => { status('That logo could not be read. Use a PNG, JPG or SVG.'); reject(new Error('Logo image could not be loaded.')); };
    img.src = src;
  });
}
$('logo-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setLogo(r.result).catch(() => {}); r.readAsDataURL(f); e.target.value = ''; });
$('logo-clear').addEventListener('click', () => { setLogo(null); $('col-note').textContent = 'Picked automatically when you add a logo.'; });

// ============================================================
// 10. Panel UI
// ============================================================
const STEPS = ['data', 'brand', 'layout', 'export'];
let currentStep = 'data';
function showStep(name) {
  if (!STEPS.includes(name)) throw new Error(`Unknown step "${name}". Use one of: ${STEPS.join(', ')}.`);
  const idx = STEPS.indexOf(name); currentStep = name;
  STEPS.forEach((s, i) => { $(`pane-${s}`).hidden = s !== name; const b = $(`step-${s}`); b.setAttribute('aria-selected', String(s === name)); if (i < idx) b.classList.add('done'); });
  $(`pane-${name}`).scrollTop = 0; schedulePublish();
}
STEPS.forEach((s) => $(`step-${s}`).addEventListener('click', () => showStep(s)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.goto)));
function showView(v) {
  if (v !== '3d' && v !== 'section') throw new Error('View must be "3d" or "section".');
  S.view = v; const sec = v === 'section';
  $('view-3d').setAttribute('aria-selected', String(!sec)); $('view-section').setAttribute('aria-selected', String(sec));
  secCanvas.hidden = !sec; glCanvas.hidden = sec; ov.hidden = sec; if (sec) drawSectionView(); schedulePublish();
}
$('view-3d').addEventListener('click', () => showView('3d'));
$('view-section').addEventListener('click', () => showView('section'));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { showView('3d'); applyView(b.dataset.view); }));
['cam-az', 'cam-pl', 'cam-zoom'].forEach((id) => $(id).addEventListener('input', (e) => {
  showView('3d'); setCamera({ [{ 'cam-az': 'azimuth', 'cam-pl': 'plunge', 'cam-zoom': 'zoom' }[id]]: +e.target.value });
}));

let statusT = 0;
function status(msg) { const el = $('status'); el.textContent = msg; el.style.opacity = '1'; clearTimeout(statusT); statusT = setTimeout(() => { el.style.opacity = '0'; }, 6000); }
$('status').style.transition = 'opacity 0.4s';

function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderFiles() {
  const list = $('file-list');
  if (!files.length) { list.innerHTML = '<p class="muted">No files yet.</p>'; return; }
  list.innerHTML = '';
  files.forEach((f, fi) => {
    const div = document.createElement('div'); div.className = 'file';
    const roles = ['collar', 'survey', 'assay', 'topo', 'mesh', 'litho', 'lithlegend', 'geophys', 'unknown']; // EXT hook: litho, lithlegend, geophys
    let html = `<div class="file-head"><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
      <select data-role="${fi}" aria-label="File type for ${esc(f.name)}">${roles.map((r) => `<option value="${r}" ${r === f.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>`;
    if (f.role === 'mesh') html += `<span class="muted">${f.mesh.v.length.toLocaleString()} vertices · ${(f.mesh.f.length / 3).toLocaleString()} triangles</span>`;
    else {
      html += `<span class="muted">${f.rows.length.toLocaleString()} rows</span>`;
      const fields = ROLE_FIELDS[f.role] || [];
      if (fields.length) {
        html += '<div class="maps">' + fields.map((k) => `<label for="m-${fi}-${k}">${FIELD_LABEL[k]}</label><select id="m-${fi}-${k}" data-map="${fi}" data-key="${k}"><option value="">—</option>${f.header.map((h, i) => `<option value="${i}" ${f.cols[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('') + '</div>';
        const req = { collar: ['hole', 'east', 'north'], survey: ['hole', 'depth'], assay: ['hole', 'from', 'to'], topo: ['east', 'north', 'elev'], litho: ['hole', 'from', 'to', 'code'], lithlegend: ['code', 'desc'], geophys: ['east', 'north', 'elev', 'value'] }[f.role] || [];
        const miss = req.filter((k) => f.cols[k] === undefined);
        if (miss.length) html += `<span class="bad">Pick a column for ${miss.map((k) => FIELD_LABEL[k]).join(', ')}.</span>`;
        if (f.role === 'assay') html += f.grades.length ? `<span class="muted">Grade columns: ${f.grades.map((g) => esc(g.name)).join(', ')}</span>` : '<span class="bad">No numeric grade columns found.</span>';
      } else if (f.role === 'unknown') html += '<span class="warn">Choose what this file holds.</span>';
    }
    div.innerHTML = html; list.appendChild(div);
  });
  list.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', () => {
    const f = files[+s.dataset.role]; f.role = s.value; if (f.role === 'assay') f.grades = gradeCols(f.header, f.cols, f.rows); refresh();
  }));
  list.querySelectorAll('[data-map]').forEach((s) => s.addEventListener('change', () => {
    const f = files[+s.dataset.map]; if (s.value === '') delete f.cols[s.dataset.key]; else f.cols[s.dataset.key] = +s.value;
    if (f.role === 'assay') f.grades = gradeCols(f.header, f.cols, f.rows); refresh();
  }));
}
function renderSummary() {
  const sum = $('summary'), roles = new Set(files.map((f) => f.role));
  ['collar', 'assay', 'survey', 'topo', 'mesh', 'litho', 'geophys'].forEach((r) => $(`need-${r}`).classList.toggle('ok', roles.has(r)));
  if (!project || project.empty) { sum.innerHTML = '<span class="bad">Add a collar file to see your holes.</span>'; return; }
  const mt = project.holes.reduce((s, h) => s + h.len, 0), n = project.holes.reduce((s, h) => s + h.ints.length, 0);
  sum.innerHTML = [usingSample ? 'sample project' : null, `${project.holes.length} holes`, `${Math.round(mt).toLocaleString()} m drilled`, `${n.toLocaleString()} assay intervals`, project.posDown ? 'dips read as positive-down' : null].filter(Boolean).map((t) => `<span class="pill">${t}</span>`).join('')
    + project.warnings.concat(G?.terrainNote ? [G.terrainNote] : []).map((w) => `<p class="warn">${esc(w)}</p>`).join('');
}
function renderStyle() {
  const sel = $('value-col'); sel.innerHTML = (project?.cols || []).map((c) => `<option ${c === S.valueCol ? 'selected' : ''}>${esc(c)}</option>`).join('') || '<option>—</option>';
  $('value-label').value = S.valueLabel;
  $('bins').innerHTML = S.bins.map((b, i) => `<label class="field"><i style="background:${BIN_COLORS[i + 1]}"></i><input type="number" step="any" data-bin="${i}" value="${esc(b)}" aria-label="Lower limit of colour ${i + 1}"></label>`).join('');
  $('bins').querySelectorAll('[data-bin]').forEach((inp) => inp.addEventListener('change', () => { const b = S.bins.slice(); b[+inp.dataset.bin] = parseFloat(inp.value) || 0; setStyle({ bins: b }); }));
  $('co-cut').value = S.coCut; $('co-incl').value = S.coIncl; $('co-count').value = S.coCount; $('co-min').value = S.coMin;
  $('sec-az').value = S.secAz; $('sec-az-out').textContent = `${pad3(S.secAz)}°`; $('sec-w').value = S.secW;
  $('opt-walls').checked = S.walls; $('opt-ids').checked = S.ids; $('opt-inset').checked = S.inset; $('opt-ribbons').checked = S.ribbons;
  $('opt-pending').checked = S.pendingLabels; $('opt-pending-none').checked = S.pendingNoAssays; $('opt-elev').checked = S.elevTicks;
  $('value-col2').innerHTML = '<option value="">None</option>' + (project?.cols || []).filter((c) => c !== S.valueCol).map((c) => `<option ${c === S.valueCol2 ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('terrain').value = S.terrain; $('terrain-src').value = S.terrainSource; $('block-style').value = S.blockStyle; $('collar-fit').value = S.collarFit; $('vex').value = S.vex; $('vex-out').textContent = `${S.vex}×`;
  $('trace-w').value = Math.round(S.traceWidth * 100); $('trace-out').textContent = `${S.traceWidth.toFixed(1)}×`;
  $('surf').value = Math.round(S.surf * 100); $('surf-out').textContent = `${Math.round(S.surf * 100)}%`;
  // The grade column as one-click choices, the display cut-off's quick values, the shell and the
  // metal-equivalent builder.
  $('metric-chips').innerHTML = (project?.cols || []).map((c) => `<button type="button" class="chip" data-col="${esc(c)}" aria-pressed="${c === S.valueCol}" title="${esc(c)}">${esc(labelFor(c))}</button>`).join('');
  $('metric-chips').querySelectorAll('[data-col]').forEach((b) => b.addEventListener('click', () => setStyle({ valueCol: b.dataset.col })));
  const dc = S.displayCutoff;
  $('dcut-btns').innerHTML = [null, ...dcutChoices()].map((v) => `<button type="button" class="chip" data-dcut="${v ?? ''}" aria-pressed="${v === dc}">${v === null ? 'All' : v}</button>`).join('');
  $('dcut-btns').querySelectorAll('[data-dcut]').forEach((b) => b.addEventListener('click', () => setStyle({ displayCutoff: b.dataset.dcut === '' ? null : +b.dataset.dcut })));
  if (document.activeElement?.id !== 'dcut') $('dcut').value = dc ?? '';
  renderShellUI(); renderEq(); extUI(); renderLegendUI(); // EXT hook
  $('co-place').value = S.coPlacement; $('block-margin').value = S.blockMargin ?? ''; $('block-margin').placeholder = 'auto';
  document.querySelectorAll('[data-bx]').forEach((i) => { const k = i.dataset.bx; i.value = S.blockExtent?.[k] ?? ''; i.placeholder = G ? Math.round(G.B[k]) : ''; });
  const ml = $('mesh-list'); ml.innerHTML = '';
  (project?.meshF || []).forEach((f) => { const st = S.meshes[f.name]; if (!st) return;
    const d = document.createElement('label'); d.className = 'mesh';
    d.innerHTML = `<input type="checkbox" ${st.show ? 'checked' : ''} aria-label="Show ${esc(f.name)}"><span>${esc(meshName(f.name))}</span><input type="color" value="${esc(st.color)}" aria-label="Colour of ${esc(f.name)}">`;
    const [cb, , cp] = d.children; cb.addEventListener('change', () => { st.show = cb.checked; restyle(); schedulePublish(); }); cp.addEventListener('input', () => { st.color = cp.value; restyle(); schedulePublish(); });
    ml.appendChild(d); });
}
function renderCalloutEditor() {
  const el = $('callout-editor'), shownIds = new Set(shownCallouts().map((c) => c.h.id)), cands = callouts.slice(0, Math.max(6, S.coCount + 3));
  callouts.forEach((c) => { if (shownIds.has(c.h.id) && !cands.includes(c)) cands.push(c); });
  if (!cands.length) { el.innerHTML = '<p class="muted">No hole has an interval above the broad cut-off over the minimum length. Lower either one.</p>'; return; }
  el.innerHTML = '<p class="muted">Tick to show. Type over a line to reword it; leave it blank for the automatic text.</p>' + cands.map((c) => {
    const id = esc(c.h.id), o = S.coOverrides[c.h.id] || {}, a1 = `${icText(c.ic.broad, c.h)} from ${Math.round(c.ic.broad.from)} m`, a2 = c.ic.incl ? `incl. ${icText(c.ic.incl, c.h)}` : '(no "incl." line)';
    return `<div class="callout-ed"><input type="checkbox" data-co="${id}" ${shownIds.has(c.h.id) ? 'checked' : ''} aria-label="Show callout for ${id}"><span class="id">${id}</span>`
      + `<input type="text" data-co1="${id}" value="${esc(o.line1 || '')}" placeholder="${esc(a1)}" aria-label="First line for ${id}">`
      + `<input type="text" data-co2="${id}" value="${esc(o.line2 || '')}" placeholder="${esc(a2)}" aria-label="Second line for ${id}"></div>`;
  }).join('');
  el.querySelectorAll('[data-co]').forEach((cb) => cb.addEventListener('change', () => setCallout(cb.dataset.co, { show: cb.checked })));
  el.querySelectorAll('[data-co1],[data-co2]').forEach((inp) => inp.addEventListener('input', () => {
    const id = inp.dataset.co1 || inp.dataset.co2, key = inp.dataset.co1 ? 'line1' : 'line2';
    const o = S.coOverrides[id] || (S.coOverrides[id] = {}); if (inp.value) o[key] = inp.value; else delete o[key]; drawSectionView(); schedulePublish();
  }));
}
function renderSizes() {
  $('sizes').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<label><input type="radio" name="size" value="${k}" ${k === S.format ? 'checked' : ''}><span><b>${f.label}</b><br><span class="muted">${f.use}</span></span><small>${f.w} × ${f.h}</small></label>`).join('');
  $('sizes').querySelectorAll('input').forEach((r) => r.addEventListener('change', () => setFigureSize(r.value)));
}
function syncBrandUI() {
  $('company').value = S.company; $('title').value = S.title; $('subtitle').value = S.subtitle; $('footnote').value = S.footnote; $('credit').checked = S.credit;
  $('col-primary').value = S.primary; $('col-accent').value = S.accent;
}

function refresh() {
  project = build(); recheckCRS();
  if (!project.empty && project.holes.length) { const az = principalAz(project.holes); if (az !== null && !refresh.secSet) S.secAz = az; }
  rebuildScene(); renderFiles(); renderSummary(); renderChecks(); renderStyle(); renderCalloutEditor(); renderLabelList(); renderWallLabelList(); renderCRS(); schedulePublish();
}
function principalAz(holes) {
  const pts = holes.map((h) => [h.c.x, h.c.y]); if (pts.length < 3) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0; pts.forEach(([x, y]) => { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); });
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return Math.round(((90 - ang * 180 / Math.PI) % 180 + 180) % 180);
}
function addUserFiles(arr) {
  if (!Array.isArray(arr) || !arr.length || arr.some((f) => !f || typeof f.name !== 'string' || typeof f.text !== 'string')) throw new Error('addFiles expects [{ name: "collars.csv", text: "HoleID,Easting,..." }].');
  if (usingSample) { files = []; usingSample = false; S.meshes = {}; S.valueCol = null; S.coOverrides = {}; S.valueCol2 = null; resetDerived(); }
  arr.forEach((a) => { if (a.lib) S.libRefs[a.name] = { libFileId: String(a.lib.libFileId), version: +a.lib.version }; else delete S.libRefs[a.name]; });
  refresh.secSet = false; addFiles(arr); extAutoOn(arr); refresh(); // extAutoOn: EXT hook
  const added = files.filter((f) => arr.some((a) => a.name === f.name)).map((f) => `${f.name} → ${ROLE_LABEL[f.role]}`);
  status(project.empty ? `Added ${added.join(', ')}. Still need a collar file.` : `Added ${added.join(', ')}. ${project.holes.length} holes on the figure.`);
  return getState();
}
// A .zip is unpacked here, in the browser: its CSV, TXT and OBJ files load as if
// dropped one by one. Folders, Mac resource forks, READMEs and anything else are skipped.
const DATA_FILE = /\.(csv|txt|obj|xyz|dat)$/i; // xyz, dat: EXT hook (Geosoft XYZ geophysics)
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
async function unzipDataFiles(buffer) {
  const { unzipSync } = await import('fflate');
  let total = 0;
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (f) => {
      const keep = DATA_FILE.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) && !/(^|\/)readme[^/]*$/i.test(f.name);
      if (keep) total += f.originalSize;
      if (total > MAX_ZIP_BYTES) throw new Error('That ZIP unpacks to more than 200 MB. Send the drill files on their own.');
      return keep;
    },
  });
  const decoder = new TextDecoder();
  return Object.entries(entries).map(([path, bytes]) => ({ name: path.split('/').pop(), text: decoder.decode(bytes) }));
}
async function readFileList(fl) {
  try {
    const arr = (await Promise.all([...fl].map(async (f) => (/\.zip$/i.test(f.name)
      ? unzipDataFiles(await f.arrayBuffer())
      : [{ name: f.name, text: await f.text() }])))).flat();
    if (!arr.length) { status('No CSV, TXT or OBJ files found in that ZIP.'); return; }
    addUserFiles(arr);
  } catch (e) {
    status(e.message && !/^invalid/i.test(e.message) ? e.message : 'That file could not be read. Use CSV, TXT, OBJ or a ZIP of them.');
  }
}
// For assistants: a ZIP as a data URL, base64 string or ArrayBuffer.
async function addZip(zip) {
  let buf = zip;
  if (typeof zip === 'string') {
    const b64 = zip.replace(/^data:[^,]*,/, ''), bin = atob(b64);
    buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  }
  const arr = await unzipDataFiles(buf instanceof Uint8Array ? buf.buffer : buf);
  if (!arr.length) throw new Error('No CSV, TXT or OBJ files found in that ZIP.');
  return addUserFiles(arr);
}
$('file-input').addEventListener('change', (e) => { if (e.target.files.length) readFileList(e.target.files); e.target.value = ''; });
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) readFileList(e.dataTransfer.files); });
$('paste-add').addEventListener('click', () => {
  const text = $('paste-text').value.trim(), name = $('paste-name').value.trim() || 'pasted.csv';
  if (!text) { status('Paste CSV text with a header row first.'); return; }
  addUserFiles([{ name, text }]); $('paste-text').value = '';
});
function loadSample() {
  S.crs = null; geo = null; renderCRS();
  files = []; usingSample = true; S.valueCol = null; S.meshes = {}; S.coOverrides = {}; refresh.secSet = false; resetDerived();
  addFiles(sampleFiles()); refresh(); status('Sample project loaded · illustrative data. Add your CSVs in step 1 to replace it.');
  return getState();
}
// A new data set starts without the old one's equivalent recipe, display cut-off or provisional flags.
function resetDerived() {
  histReset(); // the history belongs to the old data
  S.eq = null; eqApplied = false; S.displayCutoff = null; S.provisional = {}; S.shell.cutoff = null; S.libRefs = {};
  S.tags.status = {}; S.tags.groups = []; S.geology.legend = []; // EXT hook: per-hole tags and codes belong to the old data
  // The shell belongs to the old data: switch it off and stop any build still running.
  S.shell.enabled = false; shell.pending = null; shell.mesh = null; shell.field = null; syncShell();
}
function clearFiles() { S.crs = null; geo = null; renderCRS(); files = []; usingSample = false; S.meshes = {}; S.coOverrides = {}; resetDerived(); refresh(); status('Files cleared. Add a collar file and an assay file.'); return getState(); }
$('load-sample').addEventListener('click', loadSample);
$('clear-files').addEventListener('click', clearFiles);

// Brand inputs
function setBrand(o = {}) {
  const hex = (v, k) => { const t = String(v).trim().toLowerCase(), m3 = t.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/); if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`; if (/^#[0-9a-f]{6}$/.test(t)) return t; throw new Error(`${k} must be a hex colour like #142126.`); };
  ['company', 'title', 'subtitle', 'footnote'].forEach((k) => { if (o[k] !== undefined) S[k] = String(o[k]); });
  if (o.credit !== undefined) S.credit = !!o.credit;
  if (o.primary !== undefined) S.primary = hex(o.primary, 'primary');
  if (o.accent !== undefined) S.accent = hex(o.accent, 'accent');
  syncBrandUI(); if (o.primary !== undefined || o.accent !== undefined) restyle(); drawSectionView(); schedulePublish(); // brand colours restyle live
  return getState();
}
[['company', 'company'], ['title', 'title'], ['subtitle', 'subtitle'], ['footnote', 'footnote']].forEach(([id, k]) => $(id).addEventListener('input', (e) => { S[k] = e.target.value; drawSectionView(); schedulePublish(); }));
$('credit').addEventListener('change', (e) => { S.credit = e.target.checked; drawSectionView(); schedulePublish(); });
$('col-primary').addEventListener('input', (e) => { S.primary = e.target.value; $('col-note').textContent = 'Custom colours.'; restyle(); schedulePublish(); });
$('col-accent').addEventListener('input', (e) => { S.accent = e.target.value; $('col-note').textContent = 'Custom colours.'; restyle(); drawSectionView(); schedulePublish(); });

// Layout inputs
function rebin() { const assays = new Map(); (project?.holes || []).forEach((h) => assays.set(h.id, h.ints)); autoBins(assays); }
function setStyle(o = {}, render = true) {
  if (o.valueCol !== undefined) {
    const av = project?.cols || []; if (!av.includes(o.valueCol)) throw new Error(`Unknown grade column "${o.valueCol}". Available: ${av.join(', ') || 'none'}.`);
    if (o.valueCol !== S.valueCol) { S.displayCutoff = null; S.shell.cutoff = null; }
    S.valueCol = o.valueCol; S.valueLabel = labelFor(o.valueCol); rebin();
  }
  if (o.valueLabel !== undefined) S.valueLabel = String(o.valueLabel);
  if (o.bins !== undefined) { if (!Array.isArray(o.bins) || o.bins.length !== 4 || o.bins.some((b) => !Number.isFinite(+b))) throw new Error('bins must be four numbers: the lower limit of each colour.'); S.bins = o.bins.map(Number).sort((a, b) => a - b); }
  if (o.autoBins) rebin();
  if (o.displayCutoff !== undefined) {
    const v = o.displayCutoff === null || o.displayCutoff === '' || o.displayCutoff === 'all' ? null : +o.displayCutoff;
    if (v !== null && !(v >= 0)) throw new Error('displayCutoff must be a grade of 0 or more, or null to show all intervals.'); S.displayCutoff = v;
  }
  [['coCount', 0, 12], ['coMin', 1, 1000], ['coCut', 0, 1e9], ['coIncl', 0, 1e9], ['secW', 5, 5000]].forEach(([k, lo, hi]) => { if (o[k] !== undefined) { const v = +o[k]; if (!Number.isFinite(v)) throw new Error(`${k} must be a number.`); S[k] = Math.max(lo, Math.min(hi, v)); } });
  if (o.secAz !== undefined) { S.secAz = ((Math.round(+o.secAz) % 180) + 180) % 180; refresh.secSet = true; }
  if (o.valueCol2 !== undefined) {
    const av = project?.cols || [], v = o.valueCol2 === '' || o.valueCol2 === 'none' ? null : o.valueCol2;
    if (v !== null && !av.includes(v)) throw new Error(`Unknown grade column "${v}". Available: ${av.join(', ') || 'none'}, or null for none.`);
    if (v !== null && v === S.valueCol) throw new Error('valueCol2 must differ from valueCol, the column the holes are coloured by.');
    S.valueCol2 = v;
  }
  if (S.valueCol2 === S.valueCol) S.valueCol2 = null;
  ['walls', 'ids', 'inset', 'ribbons', 'pendingLabels', 'pendingNoAssays', 'elevTicks', 'lockView'].forEach((k) => { if (o[k] !== undefined) S[k] = !!o[k]; });
  extStyle(o); // EXT hook: histograms, insetStyle
  if (o.coPlacement !== undefined) { if (!['column', 'beside', 'bracket'].includes(o.coPlacement)) throw new Error('coPlacement must be "column" (left column), "beside" (a box beside each hole) or "bracket" (a bracket on the hole with the grade beside it).'); S.coPlacement = o.coPlacement; extScene(); }
  if (o.legend !== undefined) {
    const l = o.legend || {}, LG = S.legend;
    if (l.merge !== undefined) { if (!['auto', 'one', 'separate'].includes(l.merge)) throw new Error('legend.merge must be "auto" (one card once three or more blocks show), "one" or "separate".'); LG.merge = l.merge; }
    Object.entries(l.pos || {}).forEach(([k, v]) => {
      if (!['main', 'lithology', 'geophys'].includes(k)) throw new Error('Legend cards are "main", "lithology" and "geophys".');
      if (v === null || v === 'auto') delete LG.pos[k]; else if (['tl', 'tr', 'bl', 'br'].includes(v)) LG.pos[k] = v;
      else if (v && Number.isFinite(+v.x) && Number.isFinite(+v.y)) LG.pos[k] = { x: clamp01(v.x, 0), y: clamp01(v.y, 0) };
      else throw new Error('A legend position is "auto", a corner ("tl", "tr", "bl", "br") or {x, y}: its top-left corner, 0-1 across and down the frame.');
    });
  }
  if (o.traceWidth !== undefined) { const v = +o.traceWidth; if (!Number.isFinite(v)) throw new Error('traceWidth must be a number from 0.5 to 3.'); S.traceWidth = Math.max(0.5, Math.min(3, v)); }
  if (o.surface !== undefined) S.surf = Math.max(0.15, Math.min(1, +o.surface > 1 ? +o.surface / 100 : +o.surface));
  let rebuild = false;
  if (o.imagery !== undefined) {
    const lim = { saturation: [0, 2], contrast: [0.5, 2], warmth: [-1, 1], relief: [0, 1] }, im = S.imagery;
    Object.entries(o.imagery || {}).forEach(([k, v]) => { if (!lim[k] || !Number.isFinite(+v)) throw new Error('imagery takes saturation (0-2), contrast (0.5-2), warmth (-1 to 1) and relief (0-1) as numbers.'); im[k] = Math.max(lim[k][0], Math.min(lim[k][1], +v)); });
    paintTerrain();
  }
  if (o.blockMargin !== undefined) { const v = [null, '', 'auto'].includes(o.blockMargin) ? null : +o.blockMargin; if (v !== null && !(v >= 0)) throw new Error('blockMargin must be metres around the drilling (0 or more), or null for automatic.'); rebuild = rebuild || v !== S.blockMargin; S.blockMargin = v === null ? null : Math.min(v, 20000); }
  if (o.blockExtent !== undefined) {
    const e = o.blockExtent ? Object.fromEntries(['x0', 'x1', 'y0', 'y1', 'z0'].map((k) => [k, [null, undefined, ''].includes(o.blockExtent[k]) ? null : +o.blockExtent[k]]).filter(([, v]) => v !== null)) : null;
    if (e && (Object.values(e).some((v) => !Number.isFinite(v)) || e.x0 >= e.x1 || e.y0 >= e.y1)) throw new Error('blockExtent is {x0, x1, y0, y1, z0}: easting and northing limits (x0 < x1, y0 < y1) and the base elevation, in the files\' units; null for any automatic.');
    S.blockExtent = e && Object.keys(e).length ? e : null; rebuild = true;
  }
  if (o.terrain !== undefined) { if (!TERRAINS[o.terrain]) throw new Error(`terrain must be one of: ${Object.keys(TERRAINS).join(', ')}.`); S.terrain = o.terrain; }
  if (o.terrainSource !== undefined) { if (!['auto', 'topo', 'dem', 'collars'].includes(o.terrainSource)) throw new Error('terrainSource must be auto, topo, dem or collars.'); rebuild = rebuild || S.terrainSource !== o.terrainSource; S.terrainSource = o.terrainSource; }
  const ve = o.verticalExaggeration ?? o.vex;
  if (ve !== undefined) { const v = +ve; if (!Number.isFinite(v)) throw new Error('verticalExaggeration must be a number from 1 to 5.'); const nv = Math.max(1, Math.min(5, v)); rebuild = rebuild || nv !== S.vex; S.vex = nv; }
  if (o.collarFit !== undefined) { if (!['collars', 'terrain'].includes(o.collarFit)) throw new Error('collarFit must be "collars" (move the terrain to the collars) or "terrain" (hang holes from the terrain).'); rebuild = rebuild || S.collarFit !== o.collarFit; S.collarFit = o.collarFit; }
  if (o.blockStyle !== undefined) { if (!['glass', 'solid'].includes(o.blockStyle)) throw new Error('blockStyle must be "glass" or "solid".'); S.blockStyle = o.blockStyle; }
  if (o.meshes) Object.entries(o.meshes).forEach(([name, v]) => { if (!S.meshes[name]) throw new Error(`No model shape named "${name}". Loaded: ${Object.keys(S.meshes).join(', ') || 'none'}.`); Object.assign(S.meshes[name], v); });
  if (rebuild) rebuildScene(true); else { if (o.terrain !== undefined || o.blockStyle !== undefined) paintTerrain(); if (o.terrain !== undefined) syncRealTerrain(); restyle(); }
  if (rebuild && G?.terrainNote) status(G.terrainNote);
  if (o.terrain !== undefined && (S.terrain === 'satellite' || S.terrain === 'muted') && !geo) status('Satellite imagery needs the coordinate system: set it in step 1 (e.g. EPSG:26909). Showing the natural surface.');
  if (S.shell.enabled) syncShell();
  if (render) renderStyle(); renderCalloutEditor(); renderChecks(); schedulePublish();
  return getState();
}
// Quick display cut-offs from the grade distribution: rounded 50th, 70th, 85th and 95th percentiles.
function dcutChoices() {
  const v = []; (project?.holes || []).forEach((h) => h.ints.forEach((it) => { const x = it.vals[S.valueCol]; if (Number.isFinite(x) && x > 0) v.push(x); }));
  if (!v.length) return []; v.sort((a, b) => a - b);
  return [...new Set([0.5, 0.7, 0.85, 0.95].map((p) => niceRound(v[Math.floor(p * (v.length - 1))])))].filter((x) => x > 0);
}
function renderLegendUI() { $('lg-merge').value = S.legend.merge; const p = S.legend.pos.main; $('lg-pos').value = p?.x !== undefined ? 'moved' : p || 'auto'; }
$('lg-merge').addEventListener('change', (e) => setStyle({ legend: { merge: e.target.value } }, false));
$('lg-pos').addEventListener('change', (e) => setStyle({ legend: { pos: { main: e.target.value } } }, false));
$('co-place').addEventListener('change', (e) => setStyle({ coPlacement: e.target.value }, false));
const tryStyle = (o) => { try { setStyle(o); } catch (err) { status(err.message); } };
$('block-margin').addEventListener('change', (e) => tryStyle({ blockMargin: e.target.value }));
document.querySelectorAll('[data-bx]').forEach((i) => i.addEventListener('change', () => tryStyle({ blockExtent: { ...(S.blockExtent || {}), [i.dataset.bx]: i.value } })));
$('block-reset').addEventListener('click', () => setStyle({ blockMargin: null, blockExtent: null }));
$('dcut').addEventListener('change', (e) => { try { setStyle({ displayCutoff: e.target.value === '' ? null : +e.target.value }); } catch (err) { status(err.message); } });
// Grade shell controls
$('shell-on').addEventListener('change', (e) => { setShell({ enabled: e.target.checked }); if (e.target.checked) status('Building the grade shell from the assays…'); });
$('shell-cut').addEventListener('change', (e) => { try { setShell({ cutoff: e.target.value === '' ? null : +e.target.value }); } catch (err) { status(err.message); } });
$('shell-op').addEventListener('input', (e) => setShell({ opacity: +e.target.value / 100 }));
$('shell-color').addEventListener('input', (e) => setShell({ color: e.target.value }));
[['shell-search', 'search'], ['shell-cell', 'cell']].forEach(([id, k]) => $(id).addEventListener('change', (e) => { try { setShell({ [k]: e.target.value === '' ? null : +e.target.value }); } catch (err) { status(err.message); } }));
$('shell-ghost').addEventListener('change', (e) => setShell({ throughTerrain: e.target.checked }));
$('shell-cancel').addEventListener('click', () => { cancelShell(); status('Grade shell cancelled.'); });
// Metal equivalent
const capMetal = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1).toLowerCase();
function metalCols() { const m = new Map(); (project?.cols || []).filter((c) => c !== eqName()).forEach((c) => { const k = metalOf(c); if (k && !m.has(k)) m.set(k, c); }); return m; }
function setEquivalent(o) {
  if (!project || project.empty) throw new Error('Load assays first.');
  const prev = eqApplied ? eqName() : null, strip = () => { project.cols = project.cols.filter((c) => c !== prev); project.holes.forEach((h) => h.ints.forEach((it) => { delete it.vals[prev]; })); };
  if (!o || o.enabled === false) {
    if (prev) { S.eq = null; strip(); eqApplied = false; if (S.valueCol2 === prev) S.valueCol2 = null; setStyle(S.valueCol === prev ? { valueCol: project.cols[0] } : {}); }
    else S.eq = null;
    return getState();
  }
  const present = metalCols(), list = [...present.keys()].map((k) => `${k} (${present.get(k)})`).join(', ') || 'none';
  const base = o.base ? (present.has(capMetal(o.base)) ? capMetal(o.base) : metalOf(String(o.base))) : present.has('Cu') ? 'Cu' : [...present.keys()][0];
  const baseCol = o.baseCol || (project.cols.includes(o.base) ? o.base : present.get(base));
  if (!base || !baseCol) throw new Error(`No ${o.base || 'metal'} column for the base. Metal columns: ${list}.`);
  const req = o.metals || Object.fromEntries([...present.keys()].filter((k) => k !== base && METAL_DEFAULTS[k]).map((k) => [k, {}])), metals = {};
  Object.entries(req).forEach(([k, m]) => {
    const metal = capMetal(k), mm = m || {}, col = mm.col || present.get(metal), price = mm.price ?? METAL_DEFAULTS[metal], recovery = mm.recovery ?? 90;
    if (metal === base) return;
    if (!col) throw new Error(`No ${metal} column in the assays. Metal columns: ${list}.`);
    if (!(+price > 0)) throw new Error(`Give a price for ${metal} (US$ per ${priceUnit(metal)}).`);
    if (!(+recovery > 0 && +recovery <= 100)) throw new Error(`${metal} recovery must be a percentage, 1-100.`);
    metals[metal] = { col, unit: mm.unit || unitOf(col), price: +price, recovery: +recovery };
  });
  if (!Object.keys(metals).length) throw new Error(`Pick at least one metal besides ${base}. Metal columns: ${list}.`);
  const next = { base, baseCol, baseUnit: o.baseUnit || unitOf(baseCol), basePrice: +(o.basePrice ?? METAL_DEFAULTS[base]), baseRecovery: +(o.baseRecovery ?? 90), metals };
  if (!(next.baseRecovery > 0 && next.baseRecovery <= 100)) throw new Error('baseRecovery must be a percentage, 1-100.');
  const nextName = eqInfo(next).name; // throws on a missing base price
  if (nextName !== prev && project.cols.includes(nextName)) throw new Error(`The assays already have a column named ${nextName}. Rename it in your file to use the calculator, or colour by that column directly.`);
  if (prev) strip();
  const usedAs = [S.valueCol === prev, S.valueCol2 === prev];
  S.eq = next; applyEq(project.holes.map((h) => h.ints), project.cols);
  const name = eqName();
  if (usedAs[1]) S.valueCol2 = name;
  setStyle(o.use !== false || usedAs[0] ? { valueCol: name } : {});
  if (S.valueCol === name) { S.valueLabel = labelFor(name); renderStyle(); }
  status(`${name}: ${eqInfo().formula}.`);
  return getState();
}
function eqForm() {
  const metals = {};
  $('eq-rows').querySelectorAll('[data-eqm]').forEach((r) => { if (r.querySelector('input[type=checkbox]').checked) metals[r.dataset.eqm] = { price: +r.querySelector('[data-p]').value, recovery: +r.querySelector('[data-r]').value }; });
  return { base: $('eq-base').value, basePrice: +$('eq-bprice').value, baseRecovery: +$('eq-brec').value, metals };
}
function eqPreview() {
  try {
    const f = eqForm(), present = metalCols(), ms = Object.entries(f.metals).map(([metal, m]) => ({ metal, unit: unitOf(present.get(metal)), ...m }));
    $('eq-formula').textContent = ms.length ? eqFormula(f.base, eqFactors({ metal: f.base, unit: unitOf(present.get(f.base)), price: f.basePrice, recovery: f.baseRecovery }, ms)) : 'Tick at least one other metal.';
  } catch (e) { $('eq-formula').textContent = e.message; }
}
function renderEq(baseOverride) {
  const present = metalCols(), e = S.eq, box = $('eq-body');
  if (present.size < 2) { box.innerHTML = '<p class="muted">Needs at least two metal columns in the assays (for example Cu and Au).</p>'; return; }
  const base = baseOverride || (e?.base && present.has(e.base) ? e.base : present.has('Cu') ? 'Cu' : [...present.keys()][0]), same = e?.base === base;
  const val = (m, k, d) => (e?.metals?.[m]?.[k] ?? d);
  box.innerHTML = `<div class="grid2"><label class="field" style="grid-column:1/-1"><span>Base metal</span><select id="eq-base">${[...present.keys()].map((m) => `<option ${m === base ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="field"><span>${base} US$/${priceUnit(base)}</span><input type="number" id="eq-bprice" step="any" min="0" value="${esc(same ? e.basePrice : METAL_DEFAULTS[base] ?? '')}"></label>
    <label class="field"><span>${base} recovery %</span><input type="number" id="eq-brec" min="1" max="100" value="${esc(same ? e.baseRecovery : 90)}"></label></div>
    <div id="eq-rows">${[...present.keys()].filter((m) => m !== base).map((m) => `<div class="eq-row" data-eqm="${m}"><label class="check"><input type="checkbox" ${(e ? !!e.metals[m] : !!METAL_DEFAULTS[m]) ? 'checked' : ''}>${m}</label>
      <label class="field"><span>US$/${priceUnit(m)}</span><input type="number" data-p step="any" min="0" value="${esc(val(m, 'price', METAL_DEFAULTS[m] ?? ''))}"></label><label class="field"><span>Recovery %</span><input type="number" data-r min="1" max="100" value="${esc(val(m, 'recovery', 90))}"></label></div>`).join('')}</div>
    <p class="mono" id="eq-formula"></p>
    <div class="row"><button class="btn" type="button" id="eq-apply">${e ? 'Update' : 'Add'} ${base}Eq_calc</button>${e ? '<button class="btn" type="button" id="eq-remove">Remove</button>' : ''}</div>`;
  $('eq-base').addEventListener('change', () => renderEq($('eq-base').value));
  box.querySelectorAll('input').forEach((i) => i.addEventListener('input', eqPreview));
  $('eq-apply').addEventListener('click', () => { try { setEquivalent(eqForm()); } catch (err) { status(err.message); } });
  $('eq-remove')?.addEventListener('click', () => setEquivalent(null));
  eqPreview();
}
function setProvisional(holeId, flag) {
  if (!project?.holes?.some((h) => h.id === holeId)) throw new Error(`No hole "${holeId}".`);
  if (flag === null || flag === undefined) delete S.provisional[holeId]; else S.provisional[holeId] = !!flag;
  rebuildScene(true); renderChecks(); schedulePublish(); return getState();
}
function getChecks() {
  const C = project?.checks; if (!C) return null;
  const hs = project.holes || [];
  return { counts: { ...C.counts, intervalsShown: hs.reduce((t, h) => t + h.ints.filter(intervalShown).length, 0) }, problems: C.problems, provisionalHoles: hs.filter((h) => h.prov).map((h) => h.id) };
}
function renderChecks() {
  const el = $('checks'), C = getChecks(), open = el.querySelector('details')?.open;
  if (!C) { el.innerHTML = '<p class="muted">Add files to check them.</p>'; return; }
  const c = C.counts;
  el.innerHTML = `<div class="summary">${[[c.holes, 'holes'], [c.holesPlaced, 'placed'], [c.assaysLoaded, 'assays loaded'], [c.assaysPlaced, 'assays placed'], [c.intervalsShown, 'intervals shown']].map(([n, t]) => `<span class="pill">${n.toLocaleString()} ${t}</span>`).join('')}</div>`
    + (C.problems.length ? `<ul class="checks">${C.problems.map((p) => `<li>${esc(p.message)}</li>`).join('')}</ul>` : '<p class="muted" style="margin-top:6px">No problems found.</p>')
    + (project.holes?.length ? `<details${open ? ' open' : ''}><summary>Provisional positions (${C.provisionalHoles.length})</summary><p class="muted">Ticked holes draw dashed and fainter, with a legend row. Read from a collar status or flags column; change any here.</p>
      <div class="prov-list">${project.holes.map((h) => `<label class="check"><input type="checkbox" data-prov="${esc(h.id)}" ${h.prov ? 'checked' : ''}>${esc(h.id)}</label>`).join('')}</div></details>` : '');
  el.querySelectorAll('[data-prov]').forEach((cb) => cb.addEventListener('change', () => setProvisional(cb.dataset.prov, cb.checked)));
}
$('value-col').addEventListener('change', (e) => setStyle({ valueCol: e.target.value }));
$('value-label').addEventListener('input', (e) => setStyle({ valueLabel: e.target.value }, false));
$('auto-bins').addEventListener('click', () => { setStyle({ autoBins: true }); status('Colour limits and cut-offs suggested from the data.'); });
[['co-cut', 'coCut'], ['co-incl', 'coIncl'], ['co-count', 'coCount'], ['co-min', 'coMin'], ['sec-w', 'secW']].forEach(([id, key]) =>
  $(id).addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setStyle({ [key]: v }); }));
$('sec-az').addEventListener('input', (e) => { setStyle({ secAz: +e.target.value }, false); $('sec-az-out').textContent = `${pad3(S.secAz)}°`; });
$('opt-walls').addEventListener('change', (e) => setStyle({ walls: e.target.checked }, false));
$('opt-ids').addEventListener('change', (e) => setStyle({ ids: e.target.checked }, false));
$('opt-inset').addEventListener('change', (e) => setStyle({ inset: e.target.checked }, false));
$('opt-ribbons').addEventListener('change', (e) => setStyle({ ribbons: e.target.checked }, false));
$('opt-pending').addEventListener('change', (e) => setStyle({ pendingLabels: e.target.checked }, false));
$('opt-pending-none').addEventListener('change', (e) => setStyle({ pendingNoAssays: e.target.checked }, false));
$('opt-elev').addEventListener('change', (e) => setStyle({ elevTicks: e.target.checked }, false));
$('terrain').addEventListener('change', (e) => setStyle({ terrain: e.target.value }, false));
$('terrain-src').addEventListener('change', (e) => setStyle({ terrainSource: e.target.value }, false));
$('block-style').addEventListener('change', (e) => setStyle({ blockStyle: e.target.value }, false));
$('collar-fit').addEventListener('change', (e) => setStyle({ collarFit: e.target.value }, false));
$('vex').addEventListener('change', (e) => { setStyle({ verticalExaggeration: +e.target.value }, false); $('vex-out').textContent = `${S.vex}×`; });
$('vex').addEventListener('input', (e) => { $('vex-out').textContent = `${e.target.value}×`; });
function renderCRS() {
  if (document.activeElement?.id !== 'crs') $('crs').value = geo ? (geo.code.startsWith('+') ? geo.code : geo.code) : '';
  $('crs-note').textContent = geo ? `${geo.label}${geo.guessed ? ' (from the latitude/longitude collars)' : ''}. Real terrain and satellite imagery are available in step 3.` : 'Set it to drape real terrain and satellite imagery (Layout → Terrain).';
}
const applyCRS = () => setCRS($('crs').value.trim() || null).catch((e) => { status(e.message); $('crs-note').textContent = e.message; });
$('crs-apply').addEventListener('click', applyCRS);
$('crs').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCRS(); } });
$('value-col2').addEventListener('change', (e) => setStyle({ valueCol2: e.target.value || null }));
$('trace-w').addEventListener('input', (e) => { setStyle({ traceWidth: +e.target.value / 100 }, false); $('trace-out').textContent = `${S.traceWidth.toFixed(1)}×`; });
$('surf').addEventListener('input', (e) => { setStyle({ surface: +e.target.value / 100 }, false); $('surf-out').textContent = `${e.target.value}%`; });
function setCallout(holeId, o = {}) {
  if (!project?.holes?.some((h) => h.id === holeId)) throw new Error(`No hole "${holeId}".`);
  const cur = S.coOverrides[holeId] || {};
  ['show', 'line1', 'line2', 'incl'].forEach((k) => { if (o[k] === null) delete cur[k]; else if (o[k] !== undefined) cur[k] = k === 'show' || k === 'incl' ? !!o[k] : String(o[k]); });
  if (o.placement === null) delete cur.placement; else if (o.placement !== undefined) { if (!['column', 'beside', 'bracket'].includes(o.placement)) throw new Error('placement must be "column", "beside" or "bracket", or null for the figure\'s setting.'); cur.placement = o.placement; }
  ['x', 'y'].forEach((k) => { if (o[k] === null) delete cur[k]; else if (o[k] !== undefined) cur[k] = clamp01(o[k], 0.5); }); // the box's top-left, 0-1 of the frame
  if (o.placement !== undefined || o.x !== undefined) extScene();
  S.coOverrides[holeId] = cur;
  if (cur.show && !callouts.some((c) => c.h.id === holeId)) status(`${holeId} has no interval above the broad cut-off, so it has no callout.`);
  renderCalloutEditor(); drawSectionView(); schedulePublish();
  return getState();
}
function setFigureSize(key) {
  if (!FORMATS[key]) throw new Error(`Unknown size "${key}". Use one of: ${Object.keys(FORMATS).join(', ')}.`);
  const c = G ? getCam() : null; S.format = key; layoutFrame(); if (c) setCamera(c, true);
  renderSizes(); status(`Figure size: ${FORMATS[key].label}, ${FORMATS[key].w} × ${FORMATS[key].h} px.`); schedulePublish();
  return getState();
}

// Text labels
const LABEL_SIZES = ['title', 'normal'];
const clamp01 = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(0, Math.min(1, +v)) : d);
function labelPatch(L, o) {
  if (o.title !== undefined && o.text === undefined) o = { ...o, text: o.title }; // EXT hook: stat box title
  if (o.text !== undefined) { const t = String(o.text).trim(); if (!t) throw new Error('A label needs some text.'); L.text = t.slice(0, 200); }
  if (o.size !== undefined) { if (!LABEL_SIZES.includes(o.size)) throw new Error('size must be "title" or "normal".'); L.size = o.size; }
  if (o.x !== undefined) L.x = clamp01(o.x, L.x); if (o.y !== undefined) L.y = clamp01(o.y, L.y);
  if (o.arrow !== undefined) L.arrow = !!o.arrow;
  if (o.rows !== undefined && L.kind === 'stat') L.rows = (Array.isArray(o.rows) ? o.rows : [o.rows]).map((r) => String(r).trim().slice(0, 120)).filter(Boolean).slice(0, 12); // EXT hook
  if (o.ax !== undefined) L.ax = clamp01(o.ax, L.ax); if (o.ay !== undefined) L.ay = clamp01(o.ay, L.ay);
}
// An arrow's tip stays on what it points at (aw: a point in project coordinates, from the terrain, the holes
// or the model shapes under it), so a crop, a new exaggeration or a camera turn keeps it there. With nothing
// under it, the tip stays put on the frame.
function anchorTip(L) {
  L.aw = null; if (!G || !L.arrow) return;
  const r = frameEl.getBoundingClientRect(); rayAt({ clientX: r.left + L.ax * W, clientY: r.top + L.ay * H });
  const p = raycaster.intersectObjects([G.top, G.tubes, G.tubesP, G.shellMesh, ...G.meshes.map((x) => x.m)].filter((o) => o?.visible), false)[0]?.point;
  if (p) L.aw = [p.x + G.cx, G.cy - p.z, p.y / S.vex + G.zref].map((v) => Math.round(v * 10) / 10);
}
const tipAt = (L) => (L.aw && G ? proj(G.V(...L.aw)) : [L.ax * W, L.ay * H]);
function addLabel(o = {}) {
  const n = S.labels.reduce((mx, l) => Math.max(mx, +String(l.id).replace(/\D/g, '') || 0), 0) + 1;
  const L = { id: `L${n}`, text: '', size: 'normal', x: 0.5, y: 0.5, arrow: false, ax: null, ay: null };
  labelPatch(L, { size: 'normal', ...o, text: o.text ?? '' });
  if (o.x === undefined && o.y === undefined && G) [L.x, L.y] = freeSpot(L);
  if (L.ax === null) L.ax = Math.min(0.97, L.x + 0.1); if (L.ay === null) L.ay = Math.min(0.97, L.y + 0.14);
  anchorTip(L);
  S.labels.push(L); renderLabelList(); schedulePublish(); status(`Label "${L.text}" added. Drag it on the preview to place it.`);
  return L.id;
}
function updateLabel(id, o = {}) {
  const L = S.labels.find((l) => l.id === id); if (!L) throw new Error(`No label "${id}". Labels: ${S.labels.map((l) => l.id).join(', ') || 'none'}.`);
  labelPatch(L, o); if (o.ax !== undefined || o.ay !== undefined || o.arrow !== undefined) anchorTip(L); renderLabelList(); schedulePublish(); return getState();
}
function removeLabel(id) {
  if (!S.labels.some((l) => l.id === id)) throw new Error(`No label "${id}".`);
  S.labels = S.labels.filter((l) => l.id !== id); renderLabelList(); schedulePublish(); return getState();
}
function renderLabelList() {
  const el = $('label-list');
  el.innerHTML = S.labels.map((L) => `<div class="label-row"><input type="text" data-lt="${esc(L.id)}" value="${esc(L.text)}" aria-label="Text of label ${esc(L.id)}">`
    + `<label class="check"><input type="checkbox" data-la="${esc(L.id)}" ${L.arrow ? 'checked' : ''}>Arrow</label>`
    + `<button class="btn" type="button" data-ld="${esc(L.id)}" aria-label="Delete label ${esc(L.text)}">Delete</button></div>`).join('');
  el.querySelectorAll('[data-lt]').forEach((i) => i.addEventListener('change', () => { try { updateLabel(i.dataset.lt, { text: i.value }); } catch (e) { status(e.message); } }));
  el.querySelectorAll('[data-la]').forEach((i) => i.addEventListener('change', () => updateLabel(i.dataset.la, { arrow: i.checked })));
  el.querySelectorAll('[data-ld]').forEach((b) => b.addEventListener('click', () => removeLabel(b.dataset.ld)));
}
$('lab-add').addEventListener('click', () => {
  const text = $('lab-text').value.trim(); if (!text) { status('Type the label text first.'); $('lab-text').focus(); return; }
  showView('3d'); addLabel({ text, size: $('lab-size').value, arrow: $('lab-arrow').checked }); $('lab-text').value = '';
});
$('lab-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('lab-add').click(); } });
function renderWallLabelList() {
  const el = $('wall-list'), faces = ['N', 'S', 'E', 'W'];
  el.innerHTML = S.wallLabels.map((L) => `<div class="label-row"><input type="text" data-wt="${esc(L.id)}" value="${esc(L.text)}" aria-label="Text of wall label ${esc(L.id)}">`
    + `<select data-wf="${esc(L.id)}" aria-label="Face of ${esc(L.text)}">${faces.map((f) => `<option ${f === L.face ? 'selected' : ''}>${f}</option>`).join('')}</select>`
    + (S.geology.legend.length ? `<select data-wu="${esc(L.id)}" aria-label="Unit colour of ${esc(L.text)}"><option value="">No unit</option>${S.geology.legend.map((e) => `<option value="${esc(e.code)}" ${e.code === L.unit ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>` : '') // EXT hook
    + `<button class="btn" type="button" data-wd="${esc(L.id)}" aria-label="Delete wall label ${esc(L.text)}">Delete</button></div>`).join('');
  el.querySelectorAll('[data-wt]').forEach((i) => i.addEventListener('change', () => { try { updateWallLabel(i.dataset.wt, { text: i.value }); } catch (e) { status(e.message); } }));
  el.querySelectorAll('[data-wf]').forEach((i) => i.addEventListener('change', () => updateWallLabel(i.dataset.wf, { face: i.value })));
  el.querySelectorAll('[data-wu]').forEach((i) => i.addEventListener('change', () => updateWallLabel(i.dataset.wu, { unit: i.value || null }))); // EXT hook
  el.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => removeWallLabel(b.dataset.wd)));
}
$('wall-add').addEventListener('click', () => {
  const text = $('wall-text').value.trim(); if (!text) { status('Type the wall label text first.'); $('wall-text').focus(); return; }
  showView('3d'); addWallLabel({ text, face: $('wall-face').value, size: $('wall-size').value }); $('wall-text').value = '';
});
$('wall-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('wall-add').click(); } });
const raycaster = new THREE.Raycaster();
const rayAt = (e) => { const r = frameEl.getBoundingClientRect(); raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera); return raycaster.ray; };
const wallLabelAt = (e) => { if (!G?.wallLabelMeshes?.length) return null; rayAt(e); return raycaster.intersectObjects(G.wallLabelMeshes, false)[0] || null; };
// A point on a face plane, as (u, v) on that face.
function faceUV(face, P) {
  const { a, b } = faceGeom(face), x = P.x + G.cx, y = G.cy - P.z, z = P.y / S.vex + G.zref, dx = b[0] - a[0], dy = b[1] - a[1];
  const u = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), top = G.surf(Math.max(G.B.x0, Math.min(G.B.x1, x)), Math.max(G.B.y0, Math.min(G.B.y1, y)));
  return [u, (z - G.B.z0) / ((top - G.B.z0) || 1)];
}

// Dragging: caught on the frame in the capture phase, before OrbitControls on the canvas sees it, and only
// when the pointer is on a label or an arrow tip; anywhere else the camera orbits as usual.
let labelDrag = null;
function labelAt(e) {
  const r = frameEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  for (let i = labelHits.length - 1; i >= 0; i--) { const h = labelHits[i]; if (h.kind === 'tip' ? Math.hypot(x - h.x, y - h.y) <= h.r : x >= h.box[0] && x <= h.box[2] && y >= h.box[1] && y <= h.box[3]) return { h, x, y }; }
  return null;
}
frameEl.addEventListener('pointerdown', (e) => {
  if (S.view !== '3d' || e.button > 0) return; const hit = labelAt(e);
  if (!hit) {
    // A label on a block face: dragged along that face's plane.
    const wh = wallLabelAt(e); if (!wh) return;
    const mesh = wh.object, L = mesh.userData.L, [u0, v0] = faceUV(L.face, wh.point);
    e.stopPropagation(); e.preventDefault();
    labelDrag = { wall: mesh, du: u0 - L.u, dv: v0 - L.v, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(faceGeom(L.face).n, wh.point) };
    try { frameEl.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    return;
  }
  if (hit.h.kind === 'legend' || hit.h.kind === 'callout') {
    // A legend card or a callout: dragged by its top-left corner, kept (x, y) from the first move on.
    const { kind, id, box } = hit.h; e.stopPropagation(); e.preventDefault();
    labelDrag = { kind, dx: hit.x - box[0], dy: hit.y - box[1], make: () => (kind === 'legend' ? (S.legend.pos[id] = {}) : (S.coOverrides[id] ||= {})) };
    try { frameEl.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    return;
  }
  const L = S.labels.find((l) => l.id === hit.h.id); if (!L) return;
  e.stopPropagation(); e.preventDefault();
  if (hit.h.kind === 'tip') { [L.ax, L.ay] = tipAt(L).slice(0, 2).map((v, i) => clamp01(v / (i ? H : W), 0.5)); L.aw = null; } // dragged on the frame, anchored on release
  labelDrag = { L, tip: hit.h.kind === 'tip', dx: hit.x - (hit.h.kind === 'tip' ? L.ax : L.x) * W, dy: hit.y - (hit.h.kind === 'tip' ? L.ay : L.y) * H, pid: e.pointerId };
  try { frameEl.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
}, true);
frameEl.addEventListener('pointermove', (e) => {
  if (!labelDrag) { glCanvas.style.cursor = S.view === '3d' && (labelAt(e) || wallLabelAt(e)) ? 'move' : S.lockView ? 'default' : ''; return; }
  if (labelDrag.wall) {
    const P = rayAt(e).intersectPlane(labelDrag.plane, new THREE.Vector3()); if (!P) return;
    const L = labelDrag.wall.userData.L, [u, v] = faceUV(L.face, P); L.u = clamp01(u - labelDrag.du, L.u); L.v = clamp01(v - labelDrag.dv, L.v); placeWallLabel(labelDrag.wall); return;
  }
  if (labelDrag.make) { labelDrag.L = labelDrag.make(); labelDrag.make = null; extScene(); }
  const r = frameEl.getBoundingClientRect(), x = clamp01((e.clientX - r.left - labelDrag.dx) / W, 0.5), y = clamp01((e.clientY - r.top - labelDrag.dy) / H, 0.5);
  if (labelDrag.tip) { labelDrag.L.ax = x; labelDrag.L.ay = y; } else { labelDrag.L.x = x; labelDrag.L.y = y; }
}, true);
const endDrag = () => { press = null; if (labelDrag) { if (labelDrag.tip) anchorTip(labelDrag.L); if (labelDrag.wall) renderWallLabelList(); if (labelDrag.kind) renderLegendUI(); labelDrag = null; schedulePublish(); } };
frameEl.addEventListener('pointerup', endDrag, true); frameEl.addEventListener('pointercancel', endDrag, true);
// A click on or near the preview never moves the camera: the orbit controls on the canvas see no movement
// until the press has gone 4 px and lasted 150 ms (isClick). The wheel zooms only when it starts over the
// canvas (not momentum carried over from the panel), and Lock view turns orbit, zoom and pan off.
let press = null, wheelOut = 0;
frameEl.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
frameEl.addEventListener('pointermove', (e) => {
  if (!press || press.drag || labelDrag) return;
  if (isClick(e.clientX - press.x, e.clientY - press.y, performance.now() - press.t)) e.stopPropagation(); else press.drag = true;
}, true);
addEventListener('wheel', (e) => { if (e.target !== glCanvas) wheelOut = performance.now(); }, { capture: true, passive: true });
frameEl.addEventListener('wheel', (e) => { const t = performance.now(); if (t - wheelOut < 400) wheelOut = t; if (S.lockView || wheelOut === t) e.stopPropagation(); }, { capture: true, passive: true }); // a stream that began elsewhere stays ignored until it pauses
$('lock-view').addEventListener('click', () => setStyle({ lockView: !S.lockView }, false));
// Locking also stops any orbit still easing out (damping), so the view stays exactly where it is.
function stopOrbit() { const p = camera.position.clone(), t = controls.target.clone(); controls.enableDamping = false; controls.update(); controls.enableDamping = true; camera.position.copy(p); controls.target.copy(t); controls.update(); }

// Format examples come from the sample files themselves.
(() => { const s = sampleFiles(), head = (t, n) => t.split('\n').slice(0, n).join('\n');
  $('fmt-collar').textContent = `Collars\n${head(s[0].text, 4)}`; $('fmt-survey').textContent = `Surveys\n${head(s[1].text, 4)}`; $('fmt-assay').textContent = `Assays\n${head(s[2].text, 5)}`; })();

// ============================================================
// 10b. Optional layers: geology on the faces, geophysics, hole tags (EXT)
// ============================================================
// The logic lives in geology.js, geophys.js and tags.js, loaded the first time a layer is used; the
// lines marked "EXT hook" elsewhere call in here. Settings stay in S as plain data, so the account
// save keeps them (face images as data URLs, like the logo).
Object.assign(S, {
  geology: { enabled: false, title: 'Lithology', faces: 'far', opacity: 0.85, strength: 1.3, hidden: 'nearest', anisotropy: 4, search: null, smooth: 2, texture: true, section: false, legend: [], images: {}, note: 'Geology on block faces interpolated from drill logs; schematic.' },
  geophys: { mode: 'off', lines: 'auto', ramp: 'geophys', log: null, min: null, max: null, opacity: 0.85, faces: 'far', search: null, width: null, property: null, label: null, unit: null, note: 'Geophysics: illustrative inversion model' },
  tags: { at: 'toe', style: 'dark', status: {}, fadePrevious: false, newLabel: '', prevLabel: 'Previously released', plannedLabel: 'Planned', groups: [], autoGroup: false, groupRadius: 140, emphasis: 'auto', highlight: {}, highlightNew: true, idMode: 'auto', showId: {}, showTag: {}, hideRows: [], pending: 'collar' },
  histograms: false, insetStyle: 'plan',
});
const EXT = {}, extLoading = {}, EXT_IMPORT = { geology: () => import('./geology.js'), geophys: () => import('./geophys.js'), tags: () => import('./tags.js') };
const hasRole = (r) => files.some((f) => f.role === r);
function extWanted() {
  const gp = S.geophys.mode !== 'off' && hasRole('geophys'), t = S.tags;
  return { geology: (S.geology.enabled && hasRole('litho')) || Object.keys(S.geology.images || {}).length > 0 || gp, geophys: gp,
    tags: t.at !== 'toe' || t.fadePrevious || t.idMode === 'key' || (t.idMode !== 'all' && (project?.holes?.length || 0) > 12) || Object.keys(t.showId).length > 0 || Object.keys(t.showTag || {}).length > 0 || t.emphasis === 'key' || Object.keys(t.highlight || {}).length > 0
      || S.coPlacement !== 'column' || Object.values(S.coOverrides).some((o) => o.placement || o.x !== undefined) || (S.pendingLabels && t.pending === 'collar' && !!project?.holes?.some(isPending)) || t.autoGroup || t.groups.length > 0 || Object.keys(t.status).length > 0 || S.histograms || S.insetStyle !== 'plan' || S.labels.some((l) => l.kind === 'stat') };
}
let extHost = null;
const host = () => (extHost ||= {
  S, get G() { return G; }, get project() { return project; }, get root() { return root; }, get api() { return EXT_API; }, files: () => files, digest: (f) => fileDigest(f), geo: () => geo,
  camera, renderer, proj, sectionEnds, faceGeom, textOn, roundRect, fitText, esc, INK, MUTED, RULE, BIN_COLORS, binIndex, traceR, calloutLines, shownCallouts, isPending, setSpacing, drawCallout, brandTone, figureCanvas, exportLayers, canvasBlob,
  mosaic, zoomFor, lon2t, lat2t, IMG_URL, IMAGERY_CREDIT, status, redraw: () => { extScene(); drawSectionView(); schedulePublish(); },
});
const extLoad = (k) => (extLoading[k] ||= EXT_IMPORT[k]().then((m) => { m.init(host()); EXT[k] = m; return m; }));
async function extReady() {
  const want = extWanted(), hadTags = !!EXT.tags;
  await Promise.all(Object.keys(EXT_IMPORT).filter((k) => want[k]).map(extLoad));
  // Hole fade and weights are read while the scene is built: rebuild once tags.js arrives.
  if (!hadTags && EXT.tags && G) rebuildScene(true);
  extScene();
  await Promise.all([EXT.geology?.imagesReady(), EXT.tags?.syncInset()]);
  extScene(); renderExtUI(); schedulePublish();
}
function extScene() {
  if (Object.entries(extWanted()).some(([k, v]) => v && !EXT[k])) { extReady().catch((e) => status(e.message)); return; }
  if (!G) return;
  EXT.geophys?.syncCurtains(); faceWalls(); EXT.tags?.placeHistograms(); EXT.tags?.syncInset(); EXT.tags?.syncHoles();
}
const extView = () => { if (G) EXT.geology?.syncFaces(); };
const extRestyle = () => { if (G) { EXT.geophys?.syncCurtains(); faceWalls(); EXT.tags?.syncHoles(); } };
const extPainted = () => new Set(EXT.geology ? Object.keys(EXT.geology.faceState()).filter((k) => k !== 'section') : []);
const extFade = (h) => !!EXT.tags?.fade(h);
// A wall label linked to a geology unit is written in a darker shade of the unit's legend colour.
const unitInk = (code) => { const e = code && S.geology.legend.find((x) => x.code === code); return e ? toHex(hexRgb(e.color).map((v) => v * 0.55)) : null; };
// Planned holes: a status of "planned" (collar column or set by hand) and no assays. Drawn dashed in the
// brand colour, following the provisional-position pattern.
const isPlanned = (h) => (S.tags.status[h.id] ? S.tags.status[h.id] === 'planned' : /\b(planned|proposed)\b/i.test(`${h.note || ''} ${h.c.raw ? Object.values(h.c.raw).join(' ') : ''}`) && !h.ints.length);
const extCredits = () => EXT.tags?.insetCredits() || [];
const extNotes = () => [EXT.geology?.note(), EXT.geophys?.note()].filter(Boolean);
function extLegendRows() {
  const rows = project.holes.some((h) => h.planned) ? [{ label: S.tags.plannedLabel || 'Planned', draw: (ctx, x, cy, u) => { ctx.strokeStyle = S.primary; ctx.lineWidth = 2 * u; ctx.setLineDash([5 * u, 3 * u]); ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + 22 * u, cy); ctx.stroke(); ctx.setLineDash([]); } }] : [];
  return EXT.tags ? EXT.tags.legendRows().concat(rows) : rows;
}
const extSections = () => (EXT.geology ? [EXT.geology.legendBlock(), EXT.geophys?.legendBlock()].filter(Boolean).map(EXT.geology.sectionOf) : []);
const extGroups = (ctx, K, items) => (EXT.tags && (S.tags.autoGroup || S.tags.groups.length) ? EXT.tags.groupItems(ctx, K, items) : items);
function extStat(ctx, K, L, hits, forExport) {
  if (!EXT.tags) return; const { u } = K, box = EXT.tags.drawStat(ctx, K, L, W, H);
  if (forExport) return; hits.push({ id: L.id, kind: 'label', box: [box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4] });
  if (currentStep === 'layout') { ctx.setLineDash([4 * u, 3 * u]); ctx.strokeStyle = 'rgba(31,120,168,0.7)'; ctx.lineWidth = u; ctx.strokeRect(box[0] - 3 * u, box[1] - 3 * u, box[2] - box[0] + 6 * u, box[3] - box[1] + 6 * u); ctx.setLineDash([]); }
}
const extSection = (ctx, o) => { EXT.geology?.drawSection2D(ctx, o); EXT.geophys?.drawSection2D(ctx, o); };
function extAutoOn(arr) { // a lithology or geophysics file added by the user switches its layer on
  const roles = new Set(files.filter((f) => arr.some((a) => a.name === f.name)).map((f) => f.role));
  if (roles.has('litho')) S.geology.enabled = true;
  // A lithology legend file renames (and recolours) the units: legend, wall labels and section together.
  if (roles.has('lithlegend') && hasRole('litho')) extLoad('geology').then((m) => { if (G) m.legendNow(); buildWallLabels(); renderWallLabelList(); renderExtUI(); drawSectionView(); schedulePublish(); }).catch((e) => status(e.message));
  if (roles.has('geophys') && S.geophys.mode === 'off') S.geophys.mode = 'curtain';
}
function extStyle(o) {
  if (o.histograms !== undefined) S.histograms = !!o.histograms;
  if (o.insetStyle !== undefined) { if (!['plan', 'satellite', 'topo'].includes(o.insetStyle)) throw new Error('insetStyle must be "plan" (plan of drilling), "satellite" or "topo" (a map around the property; needs the coordinate system).'); S.insetStyle = o.insetStyle; }
  if (o.histograms !== undefined || o.insetStyle !== undefined) extReady().catch((e) => status(e.message));
}
function extState() {
  const imgs = (g) => ({ ...structuredClone({ ...g, images: undefined }), images: Object.fromEntries(Object.keys(g.images || {}).map((k) => [k, true])) });
  return { geology: EXT.geology ? EXT.geology.state() : imgs(S.geology), geophys: EXT.geophys ? EXT.geophys.state() : structuredClone(S.geophys), tags: EXT.tags ? EXT.tags.state() : { ...structuredClone(S.tags), histograms: S.histograms, insetStyle: S.insetStyle } };
}
function renderExtUI() {
  document.querySelectorAll('[data-ext]').forEach((el) => { const [g, k] = el.dataset.ext.split('.'), v = g === 'style' ? S[k] : S[g][k]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
  [['geology', 'geo-ui'], ['geophys', 'gp-ui'], ['tags', 'tag-ui']].forEach(([k, id]) => { if (EXT[k]) EXT[k].renderUI($(id)); });
}
const extUI = () => renderExtUI();
document.querySelectorAll('[data-ext]').forEach((el) => el.addEventListener('change', () => {
  const [g, k] = el.dataset.ext.split('.'), v = el.type === 'checkbox' ? el.checked : el.value;
  Promise.resolve().then(() => (g === 'style' ? setStyle({ [k]: v }, false) : g === 'imagery' ? setStyle({ imagery: { [k]: +v } }, false) : EXT_API[{ geology: 'setGeology', geophys: 'setGeophys', tags: 'setTags' }[g]]({ [k]: v }))).catch((e) => status(e.message));
}));
$('stat-add').addEventListener('click', () => {
  const title = $('stat-title').value.trim(); if (!title) { status('Type the stat box title first.'); $('stat-title').focus(); return; }
  showView('3d'); EXT_API.addStatBox({ title, rows: $('stat-rows').value.split('\n') }).then(() => { $('stat-title').value = ''; $('stat-rows').value = ''; }).catch((e) => status(e.message));
});
const EXT_API = {
  async setGeology(o = {}) { (await extLoad('geology')).set(o); await extReady(); if (S.wallLabels.some((L) => L.unit)) buildWallLabels(); renderWallLabelList(); return getState(); },
  async setFaceImage(face, src) { await (await extLoad('geology')).setImage(face, src ?? null); await extReady(); status(src ? `Image painted on the ${String(face).toUpperCase()} face.` : 'Face image removed.'); return getState(); },
  async setGeophys(o = {}) { await extLoad('geology'); (await extLoad('geophys')).set(o); await extReady(); return getState(); },
  async setTags(o = {}) {
    (await extLoad('tags')).set(o);
    if (o.fadePrevious !== undefined || o.status !== undefined || o.emphasis !== undefined) rebuildScene(true); else restyle();
    await extReady(); drawSectionView(); return getState();
  },
  async groupCallouts(ids) {
    const t = S.tags;
    if (ids === null || (Array.isArray(ids) && !ids.length)) t.groups = [];
    else if (ids === 'auto') t.autoGroup = true;
    else {
      if (!Array.isArray(ids) || ids.length < 2) throw new Error('groupCallouts takes two or more hole IDs, "auto" (group nearby callouts), or null to clear the groups.');
      const known = new Set((project?.holes || []).map((h) => h.id)), bad = ids.filter((id) => !known.has(id)); if (bad.length) throw new Error(`No hole ${bad.map((b) => `"${b}"`).join(', ')}.`);
      const none = ids.filter((id) => !callouts.some((c) => c.h.id === id)); if (none.length) status(`${none.join(', ')} ${none.length > 1 ? 'have' : 'has'} no interval above the broad cut-off, so no callout to group.`);
      t.groups = t.groups.map((g) => g.filter((id) => !ids.includes(id))).filter((g) => g.length > 1).concat([[...new Set(ids)]]);
      ids.forEach((id) => { if (callouts.some((c) => c.h.id === id)) S.coOverrides[id] = { ...(S.coOverrides[id] || {}), show: true }; });
    }
    await extReady(); renderCalloutEditor(); drawSectionView(); schedulePublish(); return getState();
  },
  async addStatBox(o = {}) {
    const rows = (Array.isArray(o.rows) ? o.rows : o.rows === undefined ? [] : [o.rows]).map((r) => String(r).trim()).filter(Boolean).slice(0, 12).map((r) => r.slice(0, 120));
    await extLoad('tags');
    const id = addLabel({ text: o.title ?? o.text ?? '', x: o.x, y: o.y, size: 'normal' }), L = S.labels.find((l) => l.id === id);
    L.kind = 'stat'; L.rows = rows; if (o.x === undefined && o.y === undefined && G) [L.x, L.y] = freeSpot(L);
    renderLabelList(); schedulePublish(); status(`Stat box "${L.text}" added. Drag it on the preview to place it.`); return id;
  },
  layersReady: async () => { await extReady(); return getState(); },
};
// The API notes for these layers are kept in the page (#ext-help), out of the script bundle.
const EXT_HELP = `\n${$('ext-help').textContent.trim()}`;

// ============================================================
// 11. For AI assistants and browser agents
// ============================================================
function getState() {
  const f = FORMATS[S.format], ok = project && !project.empty;
  return {
    app: 'Exploration Maps 3D', version: 3, ready: !!G, usingSample, step: currentStep, view: S.view,
    files: files.map((x) => ({ name: x.name, role: x.role, rows: x.rows ? x.rows.length : undefined,
      columns: x.cols ? Object.fromEntries(Object.entries(x.cols).map(([k, i]) => [k, x.header[i]])) : undefined, gradeColumns: x.grades && x.grades.length ? x.grades.map((g) => g.name) : undefined })),
    libRefs: structuredClone(S.libRefs),
    project: ok ? { holes: project.holes.length, holeIds: project.holes.map((h) => h.id), metresDrilled: Math.round(project.holes.reduce((s, h) => s + h.len, 0)), pendingHoles: project.holes.filter(isPending).map((h) => h.id), intervals: project.holes.reduce((s, h) => s + h.ints.length, 0), dipsPositiveDown: project.posDown, warnings: project.warnings } : null,
    grade: { column: S.valueCol, label: S.valueLabel, available: project?.cols || [], bins: S.bins, binColors: BIN_COLORS },
    callouts: { coCount: S.coCount, coMin: S.coMin, coCut: S.coCut, coIncl: S.coIncl,
      shown: shownCallouts().map((c) => { const L = calloutLines(c); return { holeId: c.h.id, line1: L.l1 + L.l1b, line2: L.l2 }; }),
      candidates: callouts.slice(0, 15).map((c) => ({ holeId: c.h.id, broad: icText(c.ic.broad, c.h), fromM: Math.round(c.ic.broad.from), incl: c.ic.incl ? icText(c.ic.incl, c.h) : null })), overrides: S.coOverrides, valueCol2: S.valueCol2 },
    brand: { company: S.company, title: S.title, subtitle: S.subtitle, footnote: S.footnote, primary: S.primary, accent: S.accent, hasLogo: !!S.logo, credit: S.credit },
    terrain: { style: S.terrain, styles: TERRAINS, source: S.terrainSource, surfaceFrom: G?.using || null, verticalExaggeration: S.vex, collarFit: S.collarFit, blockStyle: S.blockStyle,
      crs: S.crs, crsLabel: geo?.label || null, crsGuessed: !!geo?.guessed, status: realT.status, message: realT.message || null,
      dem: realT.dem ? (realT.dem.ok ? `z${realT.dem.z}, ${realT.dem.tiles} tiles` : `failed: ${realT.dem.error}`) : null,
      imagery: realT.img ? (realT.img.ok ? `z${realT.img.z}, ${realT.img.tiles} tiles` : `failed: ${realT.img.error}`) : null, imageryShown: imageryShown(), note: G?.terrainNote || null, credits: G ? terrainCredits(true) : [] },
    camera: G ? getCam() : null, section: { secAz: S.secAz, secW: S.secW, lookingAz: ((S.secAz - 90) % 360 + 360) % 360 },
    labels: S.labels.map((l) => ({ ...l })), wallLabels: S.wallLabels.map((l) => ({ ...l })),
    display: { walls: S.walls, ids: S.ids, inset: S.inset, surface: S.surf, ribbons: S.ribbons, traceWidth: S.traceWidth, pendingLabels: S.pendingLabels, pendingNoAssays: S.pendingNoAssays, elevTicks: S.elevTicks, displayCutoff: S.displayCutoff, lockView: S.lockView, imagery: { ...S.imagery }, legend: structuredClone(S.legend), coPlacement: S.coPlacement, blockMargin: S.blockMargin, blockExtent: S.blockExtent && { ...S.blockExtent } }, meshes: S.meshes,
    shell: { ...S.shell, cutoff: shellCut(), cutoffAuto: S.shell.cutoff === null, column: S.valueCol, legend: `Grade shell ≥ ${shellCutText()}`, shown: shellShown(), status: shell.status, progress: shell.progress, message: shell.message || null,
      ...(shell.status === 'ready' || shell.status === 'empty' ? { cells: shell.mesh?.stats.cells ?? 0, triangles: shell.mesh?.stats.triangles ?? 0, holesUsed: shell.mesh?.stats.holesUsed ?? 0, collarGroups: shell.mesh?.stats.groups ?? 0, composites: shell.mesh?.stats.composites ?? 0, searchUsed: shell.mesh?.stats.search ?? null, cellUsed: shell.mesh?.stats.cell ?? null, grid: shell.mesh?.stats.grid ?? null, buildMs: shell.mesh?.stats.ms ?? null } : {}) },
    equivalent: S.eq ? (() => { const i = eqInfo(); return { column: i.name, formula: i.formula, note: i.note, factors: Object.fromEntries(i.factors.map((f) => [f.metal, +f.factor.toPrecision(6)])), ...structuredClone(S.eq) }; })() : null,
    footnoteAuto: G ? autoNotes(S.view) : [], checks: getChecks(),
    ...extState(), // EXT hook: geology, geophys, tags
    figureSize: { key: S.format, width: f.w, height: f.h, label: f.label }, figureSizes: Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, `${v.label}, ${v.w}×${v.h}`])),
  };
}
let pubT = 0;
function schedulePublish() {
  if (pubT) return;
  pubT = setTimeout(() => { pubT = 0; const st = getState(); $('em3d-state').textContent = JSON.stringify(st); window.dispatchEvent(new CustomEvent('em3d:change', { detail: st })); histTick(); }, 60);
}
// The API notes are kept in the page (#core-help), out of the script bundle, like the layers' (#ext-help).
const HELP = $('core-help').textContent.trim();
$('ai-help').textContent = HELP;
const call = (fn) => (...args) => { const r = fn(...args); return r === undefined ? getState() : r; };
window.EM3D = Object.freeze({
  version: 3, help: () => HELP, getState, loadSample, clearFiles, addFiles: addUserFiles, addZip, setBrand, setLogo, setStyle: (o) => setStyle(o, true), setCallout,
  setCamera: call((o = {}) => { if (!G) throw new Error('Load data first.'); showView('3d'); if (o.view) { if (!VIEWS[o.view]) throw new Error('view must be a, b, low or plan.'); applyView(o.view, true); } else setCamera(o, true); syncCamUI(); }),
  setFigureSize, showStep: call(showStep), showView: call(showView), exportPNG,
  setCRS, terrainReady: async () => { await (realT.promise || Promise.resolve()); return getState(); },
  addLabel, updateLabel, removeLabel, exportLayers, sendToDesignDesk, addWallLabel, updateWallLabel, removeWallLabel,
  setShell, cancelShell, setEquivalent, setProvisional: call(setProvisional), getChecks,
});

// ------------------------------------------------------------
// Project snapshots: a whole figure as plain data, for saving to an account
// (src/three-d/account.js) and reopening. Generic over S, so style fields
// added later are saved without changing this block. Images (the logo)
// travel as data URLs; anything else that is not plain data is left out.
// ------------------------------------------------------------
function toPlain(v, depth = 0) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object' || depth > 12) return undefined;
  if (v instanceof HTMLImageElement) return { $image: v.currentSrc || v.src };
  if (v instanceof HTMLCanvasElement) { try { return { $image: v.toDataURL('image/png') }; } catch { return undefined; } }
  if (Array.isArray(v)) return v.map((x) => { const p = toPlain(x, depth + 1); return p === undefined ? null : p; });
  const proto = Object.getPrototypeOf(v); if (proto !== Object.prototype && proto !== null) return undefined;
  const out = {}; for (const [k, x] of Object.entries(v)) { const p = toPlain(x, depth + 1); if (p !== undefined) out[k] = p; }
  return out;
}
const S_DEFAULTS = toPlain(S);
const isImg = (v) => v && typeof v === 'object' && typeof v.$image === 'string';
const loadImg = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('A saved image could not be loaded.')); img.src = src; });
function getProject() {
  return {
    v: 1, app: 'Exploration Maps 3D', settings: toPlain(S), camera: G ? getCam() : null, usingSample, secSet: !!refresh.secSet,
    // Raw text, plus any file type or column the user picked by hand.
    files: files.map((f) => ({ name: f.name, text: f.text, role: f.role, cols: f.cols ? { ...f.cols } : undefined })),
  };
}
// A short fingerprint of every file's raw text, so a replaced file whose
// summary (name, rows, columns) is unchanged still counts as unsaved work.
// Hashed once per text: files keep their string, so later calls are lookups.
const digestCache = new WeakMap();
function fileDigest(f) {
  const hit = digestCache.get(f);
  if (hit && hit.text === f.text) return hit.d;
  let h = 0x811c9dc5; const t = f.text || '';
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const d = `${t.length}:${(h >>> 0).toString(36)}`;
  digestCache.set(f, { text: f.text, d });
  return d;
}
const filesDigest = () => files.map((f) => `${f.name}|${fileDigest(f)}`).join(',');
async function loadProject(p) {
  if (!p || p.v !== 1 || !p.settings || typeof p.settings !== 'object' || !Array.isArray(p.files)) throw new Error('loadProject expects a project from EM3D.getProject() ({ v: 1, settings, files }).');
  if (p.files.some((f) => !f || typeof f.name !== 'string' || typeof f.text !== 'string')) throw new Error('Each project file needs a name and its text.');
  const saved = { ...S_DEFAULTS, ...p.settings }, { logo, ...rest } = saved, imgs = {};
  await Promise.all(Object.entries(rest).filter(([, v]) => isImg(v)).map(async ([k, v]) => { imgs[k] = await loadImg(v.$image); }));
  if (isImg(logo)) await setLogo(logo.$image, { autoColor: false }); else await setLogo(null);
  Object.entries(rest).forEach(([k, v]) => { S[k] = imgs[k] || (v && typeof v === 'object' ? structuredClone(v) : v); });
  files = []; usingSample = !!p.usingSample; addFiles(p.files.map(({ name, text }) => ({ name, text })));
  p.files.forEach((sf) => {
    const f = files.find((x) => x.name === sf.name); if (!f) return;
    if (f.header && sf.cols && typeof sf.cols === 'object') f.cols = Object.fromEntries(Object.entries(sf.cols).filter(([, i]) => Number.isInteger(i)));
    if (sf.role && (sf.role === 'mesh' ? !!f.mesh : !!f.header && ROLE_LABEL[sf.role])) f.role = sf.role;
    if (f.header) f.grades = f.role === 'assay' ? gradeCols(f.header, f.cols, f.rows) : [];
  });
  histReset(); refresh.secSet = true; refresh(); refresh.secSet = !!p.secSet;
  await settle(p.camera);
  status(project && !project.empty ? `Figure opened · ${project.holes.length} holes.` : 'Figure opened. Add a collar file to see the holes.');
  return getState();
}
// After settings are put into S wholesale (a project opened, a history step): the panel, frame and layers.
async function settle(cam) {
  syncBrandUI(); renderSizes(); layoutFrame(); restyle(); showView(S.view === 'section' ? 'section' : '3d');
  if (cam && G) setCamera(cam, true);
  await extReady(); // EXT hook: layers, face images and the map inset
  lastCamKey = ''; syncCamUI(); drawSectionView(); schedulePublish();
}
// History (history.js, loaded on the first change): snapshots of S, settings only (no files, no logo image),
// taken 0.5 s after changes settle. Undo, redo and restore put a snapshot back and keep the camera.
let HIST = null, histP = null, histBase = null, histT = 0;
const snapS = () => toPlain({ ...S, logo: null });
function histTick() { clearTimeout(histT); histT = setTimeout(() => { histT = 0; const s = snapS(); if (HIST) HIST.note(s); else if (!histBase) histBase = s; else histLoad().then((h) => h.note(s)); }, 500); }
const histLoad = () => (histP ||= import('./history.js').then((m) => (HIST = m.init({ base: histBase || snapS(), apply: applySnap, el: $('hist') }))));
function histReset() { HIST = null; histP = null; histBase = null; clearTimeout(histT); histT = 0; }
// Undo/redo first record a change still inside the 500 ms debounce, so the latest edit is the one undone.
async function histFlush() {
  if (!histT) return histLoad();
  clearTimeout(histT); histT = 0;
  const s = snapS(), h = await histLoad(); h.note(s); return h;
}
function applySnap(snap) {
  const cam = G ? getCam() : null, sec = refresh.secSet;
  Object.entries(snap).forEach(([k, v]) => { if (k !== 'logo') S[k] = v && typeof v === 'object' ? structuredClone(v) : v; });
  refresh.secSet = true; refresh(); refresh.secSet = sec; settle(cam).catch((e) => status(e.message));
}
const TEXT_ENTRY = 'textarea, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button]):not([type=file])';
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase(); if (!(e.ctrlKey || e.metaKey) || e.altKey || (k !== 'z' && k !== 'y') || e.target.matches?.(TEXT_ENTRY)) return; // text fields keep their own undo
  e.preventDefault(); histFlush().then((h) => (k === 'y' || e.shiftKey ? h.redo() : h.undo()));
});
$('hist-btn').addEventListener('click', (e) => { e.stopPropagation(); const el = $('hist'), open = el.hidden; el.hidden = !open; $('hist-btn').setAttribute('aria-expanded', String(open)); if (open) histLoad().then((h) => h.render()); });
document.addEventListener('click', (e) => { if (!$('hist').hidden && !e.target.closest('#hist')) { $('hist').hidden = true; $('hist-btn').setAttribute('aria-expanded', 'false'); } });
// A small JPEG of the preview, for project lists.
function getThumbnail(width = 320) {
  if (!G) return null;
  const h = Math.max(1, Math.round(width * H / W)), c = document.createElement('canvas'); c.width = width; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, h);
  if (S.view === 'section') ctx.drawImage(secCanvas, 0, 0, width, h);
  else { renderer.render(scene, camera); ctx.drawImage(glCanvas, 0, 0, width, h); ctx.drawImage(ov, 0, 0, width, h); }
  return c.toDataURL('image/jpeg', 0.8);
}
const PROJECT_HELP = `${HELP}

Whole projects (to keep or move a figure):
  EM3D.getProject()               { v: 1, settings, camera, files: [{name, text, role, cols}] }
  EM3D.loadProject(project)       Promise. Reopens a getProject() result exactly
  EM3D.getThumbnail(320)          small JPEG data URL of the preview`;
$('ai-help').textContent = PROJECT_HELP;
window.EM3D = Object.freeze({ ...window.EM3D, help: () => PROJECT_HELP, getProject, loadProject, getThumbnail, filesDigest });
// EXT hook: the geology, geophysics and hole-tag methods, in one block (section 10b).
const FULL_HELP = `${PROJECT_HELP}\n${EXT_HELP}`; $('ai-help').textContent = FULL_HELP;
window.EM3D = Object.freeze({ ...window.EM3D, help: () => FULL_HELP, ...EXT_API,
  undo: async () => { (await histFlush()).undo(); return getState(); }, redo: async () => { (await histFlush()).redo(); return getState(); }, history: async () => (await histLoad()).state() });

// ============================================================
// 12. Start
// ============================================================
renderSizes(); syncBrandUI(); renderCRS(); renderLabelList(); renderWallLabelList();
layoutFrame();
loadSample();
new ResizeObserver(() => { const c = G ? getCam() : null; layoutFrame(); if (c) setCamera(c, true); }).observe(stage);
requestAnimationFrame(loop);
if (document.fonts?.ready) document.fonts.ready.then(drawSectionView);
