// Exploration Maps 3D: drill CSVs in, a branded 3D drilling figure and section out.
// A standalone page (/3d), deliberately separate from the map editor bundle.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
};
const BIN_COLORS = ['#a3abaf', '#e2dc4f', '#ff9a1f', '#ef3b2c', '#e93ad1'];
const MESH_COLORS = ['#ff9a1f', '#e93ad1', '#2b8fd6', '#6aa84f', '#8e5bd6'];

function addFiles(list) {
  for (const f of list) {
    const entry = { name: f.name, text: f.text };
    if (/\.obj$/i.test(f.name)) { entry.role = 'mesh'; entry.mesh = parseOBJ(f.text); }
    else {
      const { header, rows } = parseCSV(f.text);
      Object.assign(entry, { header, rows, cols: matchCols(header) });
      entry.role = roleOf(entry.cols, f.name);
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
  const collars = new Map(); let latlon = false;
  collarF.forEach((f) => f.rows.forEach((r) => {
    const c = f.cols, id = (r[c.hole] || '').trim(); if (!id) return;
    let x = num(r[c.east]), y = num(r[c.north]);
    if ((!Number.isFinite(x) || !Number.isFinite(y)) && c.lat !== undefined) { x = num(r[c.lon]); y = num(r[c.lat]); latlon = true; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    collars.set(id, { id, x, y, z: num(r[c.elev]), depth: num(r[c.depth]), az: num(r[c.az]), dip: num(r[c.dip]) });
  }));
  if (latlon) {
    const arr = [...collars.values()], lat0 = arr.reduce((s, c) => s + c.y, 0) / arr.length, lon0 = arr.reduce((s, c) => s + c.x, 0) / arr.length;
    arr.forEach((c) => { c.x = (c.x - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320; c.y = (c.y - lat0) * 110540; });
    warnings.push('Collars are in latitude/longitude; converted to metres. Topography and model files need UTM metres to line up.');
  }
  // Surveys
  const surveys = new Map();
  surveyF.forEach((f) => f.rows.forEach((r) => {
    const c = f.cols, id = (r[c.hole] || '').trim(), d = num(r[c.depth]); if (!id || !Number.isFinite(d)) return;
    if (!surveys.has(id)) surveys.set(id, []);
    surveys.get(id).push({ d, az: num(r[c.az]), dip: num(r[c.dip]) });
  }));
  // Dip convention: if nearly every dip is positive, positive means down.
  const dips = [...[...surveys.values()].flat().map((s) => s.dip), ...[...collars.values()].map((c) => c.dip)].filter(Number.isFinite);
  const posDown = dips.length > 0 && dips.filter((d) => d > 0).length / dips.length > 0.9;
  const fixDip = (d) => (Number.isFinite(d) ? (posDown ? -Math.abs(d) : d) : NaN);
  // Assays
  const assays = new Map(); let cols = [];
  assayF.forEach((f) => {
    cols = cols.concat(f.grades.map((g) => g.name));
    f.rows.forEach((r) => {
      const c = f.cols, id = (r[c.hole] || '').trim(), a = num(r[c.from]), b = num(r[c.to]);
      if (!id || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
      const vals = {}; f.grades.forEach((g) => { vals[g.name] = num(r[g.i]); });
      if (!assays.has(id)) assays.set(id, []);
      assays.get(id).push({ from: a, to: b, vals });
    });
  });
  cols = [...new Set(cols)];
  if (!S.valueCol || !cols.includes(S.valueCol)) { S.valueCol = cols[0] || null; S.valueLabel = labelFor(S.valueCol); autoBins(assays); }
  const missing = [...assays.keys()].filter((id) => !collars.has(id));
  if (missing.length) warnings.push(`${missing.length} hole${missing.length > 1 ? 's' : ''} in the assays ${missing.length > 1 ? 'have' : 'has'} no collar (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}).`);
  if (!collars.size) return { warnings, empty: true };
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
    holes.push({ id: c.id, c, ints, len, dirAt, path: null });
  }
  return { warnings, holes, topoPts, meshF, cols, posDown };
}
function labelFor(col) {
  if (!col) return '';
  const el = (col.match(/(cueq|aueq|ageq|li2o|u3o8|cu|au|ag|zn|pb|ni|co|mo|pt|pd)/i) || [col])[0];
  const pretty = { cueq: 'CuEq', aueq: 'AuEq', ageq: 'AgEq', li2o: 'Li₂O', u3o8: 'U₃O₈' }[el.toLowerCase()] || el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
  const unit = /pct|%|_pc\b|percent/i.test(col) ? '%' : /gpt|g_t|gt\b|g\/t/i.test(col) ? 'g/t' : /ppm/i.test(col) ? 'ppm' : /ppb/i.test(col) ? 'ppb' : '';
  return unit ? `${pretty} ${unit}` : pretty;
}
function niceRound(v) { if (!(v > 0)) return 0; const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 3 : m < 7.5 ? 5 : 10) * p; }
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
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
let DPR = Math.min(window.devicePixelRatio || 1, 2); renderer.setPixelRatio(DPR);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
const camera = new THREE.PerspectiveCamera(32, 1, 1, 1e6);
scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4bb', 0.9));
const sun = new THREE.DirectionalLight('#ffffff', 0.55); sun.position.set(-1, 2, 1.2); scene.add(sun);
const controls = new OrbitControls(camera, glCanvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49;
let root = new THREE.Group(); scene.add(root);
let G = null; // geometry context: origin, block, surface, holes w/ paths, meshes

function rebuildScene() {
  scene.remove(root); root.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }); root = new THREE.Group(); scene.add(root);
  if (!project || project.empty) { G = null; return; }
  const holes = project.holes;
  // Paths every 2 m
  holes.forEach((h) => {
    const pts = [{ d: 0, x: h.c.x, y: h.c.y, z: h.c.z }]; let p = { x: h.c.x, y: h.c.y, z: h.c.z };
    for (let d = 0; d < h.len; d += 2) { const s = Math.min(2, h.len - d), v = h.dirAt(d + s / 2); p = { x: p.x + v[0] * s, y: p.y + v[1] * s, z: p.z + v[2] * s }; pts.push({ d: d + s, ...p }); }
    h.path = pts;
    h.posAt = (d) => { const i = Math.max(0, Math.min(pts.length - 2, Math.floor(d / 2))), a = pts[i], b = pts[i + 1], t = Math.max(0, Math.min(1, (d - a.d) / ((b.d - a.d) || 1))); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; };
  });
  // Block extent from the holes
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zmin = Infinity;
  holes.forEach((h) => h.path.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); if (Number.isFinite(p.z)) zmin = Math.min(zmin, p.z); }));
  const pad = Math.max(60, 0.14 * Math.max(x1 - x0, y1 - y0));
  const B = { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad };
  const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, bw = B.x1 - B.x0, bh = B.y1 - B.y0, diag = Math.hypot(bw, bh);
  // Surface: inverse-distance fit to topography points, or to collar elevations.
  let src = project.topoPts.filter(([x, y]) => x > B.x0 - pad && x < B.x1 + pad && y > B.y0 - pad && y < B.y1 + pad);
  if (src.length < 4) src = holes.filter((h) => Number.isFinite(h.c.z)).map((h) => [h.c.x, h.c.y, h.c.z]);
  if (!src.length) src = [[cx, cy, 0]];
  const NG = 110, grid = new Float32Array((NG + 1) * (NG + 1));
  for (let j = 0; j <= NG; j++) for (let i = 0; i <= NG; i++) {
    const x = B.x0 + bw * i / NG, y = B.y0 + bh * j / NG; let sw = 0, sz = 0, exact = null;
    for (const [px, py, pz] of src) { const d2 = (px - x) ** 2 + (py - y) ** 2; if (d2 < 1) { exact = pz; break; } const w = 1 / d2; sw += w; sz += w * pz; }
    grid[j * (NG + 1) + i] = exact ?? sz / sw;
  }
  if (src.length > 60) for (let pass = 0; pass < 2; pass++) { const r = NG + 1, cp = grid.slice();
    for (let j = 1; j < NG; j++) for (let i = 1; i < NG; i++) { const k = j * r + i; grid[k] = (cp[k] * 4 + cp[k - 1] + cp[k + 1] + cp[k - r] + cp[k + r]) / 8; } }
  const surf = (x, y) => {
    const fi = Math.max(0, Math.min(NG - 1e-6, (x - B.x0) / bw * NG)), fj = Math.max(0, Math.min(NG - 1e-6, (y - B.y0) / bh * NG)), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, r = NG + 1;
    return grid[j * r + i] * (1 - a) * (1 - b) + grid[j * r + i + 1] * a * (1 - b) + grid[(j + 1) * r + i] * (1 - a) * b + grid[(j + 1) * r + i + 1] * a * b;
  };
  // Collars with no elevation take the surface; then shift their paths.
  holes.forEach((h) => { if (!Number.isFinite(h.c.z)) { const z = surf(h.c.x, h.c.y); h.path.forEach((p) => { p.z = z + (p.z - (Number.isFinite(h.c.z) ? h.c.z : 0)); }); h.c.z = z; } });
  zmin = Math.min(...holes.flatMap((h) => h.path.map((p) => p.z)));
  let zmax = -Infinity; for (const v of grid) zmax = Math.max(zmax, v);
  B.z0 = zmin - Math.max(25, 0.05 * diag);
  const zref = (zmax + B.z0) / 2;
  const V = (x, y, z) => new THREE.Vector3(x - cx, z - zref, -(y - cy));
  // diag sizes marks (tubes, labels) by the whole block; the camera distance
  // (baseDist) adds the depth only as far as it shows at the view's plunge, so a
  // tight collar pattern with 600 m holes (Star Main) is framed from the side
  // without shrinking the plan view.
  G = { B, cx, cy, bw, bh, diag: Math.max(diag, Math.hypot(bw, bh, zmax - B.z0)), diagH: diag, depth: zmax - B.z0, surf, V, zref, zmax };

  // Terrain top
  const TW = 768, TH = Math.max(64, Math.round(768 * bh / bw));
  const base = document.createElement('canvas'); base.width = TW; base.height = TH;
  {
    const ctx = base.getContext('2d'), img = ctx.createImageData(TW, TH), cell = bw / TW, hs = new Float32Array(TW * TH);
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) hs[py * TW + px] = surf(B.x0 + px * cell, B.y1 - py * bh / TH);
    let lo = Infinity, hi = -Infinity; hs.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const sunv = [-0.5, 0.5, 0.71], rng = mulberry32(7);
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const i = py * TW + px, hx = hs[py * TW + Math.min(px + 1, TW - 1)] - hs[py * TW + Math.max(px - 1, 0)], hy = hs[Math.max(py - 1, 0) * TW + px] - hs[Math.min(py + 1, TH - 1) * TW + px];
      const nx = -hx / (2 * cell), ny = -hy / (2 * bh / TH), l = Math.hypot(nx, ny, 1), sh = Math.max(0, (nx * sunv[0] + ny * sunv[1] + sunv[2]) / l);
      const t = (hs[i] - lo) / ((hi - lo) || 1), f = (0.42 + 0.8 * sh) * (rng() < 0.2 ? 0.9 : 1);
      const c = [78 + 96 * t, 100 + 74 * t, 66 + 82 * t];
      const contour = Math.floor(hs[i] / 25) !== Math.floor(hs[Math.min(i + 1, hs.length - 1)] / 25) ? 0.82 : 1;
      img.data[i * 4] = Math.min(255, c[0] * f * contour); img.data[i * 4 + 1] = Math.min(255, c[1] * f * contour); img.data[i * 4 + 2] = Math.min(255, c[2] * f * contour); img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  G.topBase = base; G.topCanvas = document.createElement('canvas'); G.topCanvas.width = TW; G.topCanvas.height = TH;
  G.topTex = new THREE.CanvasTexture(G.topCanvas); G.topTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const tg = new THREE.PlaneGeometry(bw, bh, 140, Math.max(20, Math.round(140 * bh / bw)));
  { const pos = tg.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + cx, y = pos.getY(i) + cy, v = V(x, y, surf(x, y)); pos.setXYZ(i, v.x, v.y, v.z); } }
  G.top = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: G.topTex, side: THREE.DoubleSide, transparent: true })); G.top.renderOrder = 6; root.add(G.top);

  // Walls, base, edges, shadow
  G.walls = [];
  const wall = (p0, p1) => {
    const NI = 100, NJ = 30, pos = [], col = [], idx = [];
    for (let i = 0; i <= NI; i++) { const x = p0[0] + (p1[0] - p0[0]) * i / NI, y = p0[1] + (p1[1] - p0[1]) * i / NI, top = surf(x, y);
      for (let j = 0; j <= NJ; j++) { const z = B.z0 + (top - B.z0) * j / NJ, v = V(x, y, z); pos.push(v.x, v.y, v.z); const t = 0.92 + 0.07 * j / NJ; col.push(t * 0.98, t, t * 0.99); } }
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) { const a = i * (NJ + 1) + j, b = a + NJ + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })); m.renderOrder = 5; root.add(m); G.walls.push(m);
  };
  const C = [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]];
  C.forEach((p, i) => wall(p, C[(i + 1) % 4]));
  const baseM = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ color: '#e9ecea', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  baseM.rotation.x = -Math.PI / 2; baseM.position.copy(V(cx, cy, B.z0)); root.add(baseM); G.walls.push(baseM);
  const seg = [];
  C.forEach(([x, y], i) => { const [x2, y2] = C[(i + 1) % 4]; seg.push(V(x, y, B.z0), V(x2, y2, B.z0), V(x, y, B.z0), V(x, y, surf(x, y)));
    for (let k = 0; k < 50; k++) { const a = k / 50, b = (k + 1) / 50; seg.push(V(x + (x2 - x) * a, y + (y2 - y) * a, surf(x + (x2 - x) * a, y + (y2 - y) * a)), V(x + (x2 - x) * b, y + (y2 - y) * b, surf(x + (x2 - x) * b, y + (y2 - y) * b))); } });
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: '#8f9a9f' })));
  {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(40,45,50,0.4)'); grd.addColorStop(0.55, 'rgba(40,45,50,0.15)'); grd.addColorStop(1, 'rgba(40,45,50,0)'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(bw * 1.7, bh * 1.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.copy(V(cx + bw * 0.04, cy - bh * 0.04, B.z0 - diag * 0.08)); root.add(sh);
  }

  // Holes: grey trace, then coloured assay intervals
  const traceSeg = [];
  holes.forEach((h) => { for (let i = 0; i + 1 < h.path.length; i++) traceSeg.push(V(h.path[i].x, h.path[i].y, h.path[i].z), V(h.path[i + 1].x, h.path[i + 1].y, h.path[i + 1].z)); });
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(traceSeg), new THREE.LineBasicMaterial({ color: '#59646a' })));
  const nInt = holes.reduce((s, h) => s + h.ints.length, 0);
  G.tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshLambertMaterial(), Math.max(1, nInt)); root.add(G.tubes);
  // Meshes
  G.meshes = [];
  project.meshF.forEach((f, k) => {
    const st = S.meshes[f.name] || (S.meshes[f.name] = { color: MESH_COLORS[k % MESH_COLORS.length], show: true, opacity: 0.25 });
    const pos = []; f.mesh.v.forEach(([x, y, z]) => { const v = V(x, y, z); pos.push(v.x, v.y, v.z); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(f.mesh.f); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: st.color, transparent: true, opacity: st.opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 4; m.visible = st.show; root.add(m); G.meshes.push({ name: f.name, m });
  });
  restyle();
  applyView('a', true);
}

const binIndex = (v) => { if (!Number.isFinite(v)) return -1; let k = 0; S.bins.forEach((b, i) => { if (v >= b) k = i + 1; }); return k; };
function restyle() {
  if (!G) return;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const r = Math.max(1.5, G.diag / 330); let k = 0;
  project.holes.forEach((h) => h.ints.forEach((it) => {
    const v = it.vals[S.valueCol], bi = binIndex(v);
    const a = h.posAt(it.from), b = h.posAt(it.to), va = G.V(a.x, a.y, a.z), vb = G.V(b.x, b.y, b.z), dir = vb.clone().sub(va), len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    sc.set(bi < 0 ? 0.001 : r, Math.max(0.01, len), bi < 0 ? 0.001 : r);
    m.compose(va.clone().add(vb).multiplyScalar(0.5), q, sc);
    G.tubes.setMatrixAt(k, m); G.tubes.setColorAt(k, col.set(BIN_COLORS[Math.max(0, bi)])); k++;
  }));
  G.tubes.count = k; G.tubes.instanceMatrix.needsUpdate = true; if (G.tubes.instanceColor) G.tubes.instanceColor.needsUpdate = true;
  G.walls.forEach((w) => { w.visible = S.walls; });
  G.top.material.opacity = S.surf; G.top.material.depthWrite = S.surf >= 0.99;
  G.meshes.forEach(({ name, m: mesh }) => { const st = S.meshes[name]; mesh.visible = st.show; mesh.material.color.set(st.color); mesh.material.opacity = st.opacity; });
  // Section line on the top surface
  const ctx = G.topCanvas.getContext('2d'); ctx.drawImage(G.topBase, 0, 0);
  const [A, Bp] = sectionEnds(), P = (p) => [(p.x - G.B.x0) / G.bw * G.topCanvas.width, (G.B.y1 - p.y) / G.bh * G.topCanvas.height];
  ctx.setLineDash([14, 9]); ctx.lineWidth = 5; ctx.strokeStyle = S.primary; ctx.beginPath(); ctx.moveTo(...P(A)); ctx.lineTo(...P(Bp)); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([]); G.topTex.needsUpdate = true;
  computeCallouts();
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
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const unitOf = () => (S.valueLabel.match(/(%|g\/t|ppm|ppb)$/) || [''])[0];
const elOf = () => S.valueLabel.replace(/\s*(%|g\/t|ppm|ppb)$/, '');
const icText = (x) => `${x.len.toFixed(x.len < 10 ? 1 : 0)} m @ ${fmt(x.avg)}${unitOf() === '%' ? '%' : ' ' + unitOf()} ${elOf()}`.replace(/\s+/g, ' ').trim();


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
  return Math.hypot(G.diagH, G.depth * Math.cos(r)) * (1 + 0.25 * Math.sin(r)) * 1.65 * Math.pow(Math.max(1, 1.6 / (W / H)), 0.85);
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
function applyView(which, instant) { if (G) setCamera((VIEWS[which] || VIEWS.a)(), instant); }
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
function drawFooter(ctx, K, Wc, Hc) {
  const { u, m, font } = K, y = Hc - 17 * u, rule = y - 16 * u;
  ctx.strokeStyle = RULE; ctx.lineWidth = u; ctx.beginPath(); ctx.moveTo(m, rule); ctx.lineTo(Wc - m, rule); ctx.stroke();
  ctx.textBaseline = 'alphabetic'; let creditW = 0;
  if (S.credit) {
    font(600, 11.5); ctx.textAlign = 'right'; ctx.fillStyle = '#7c898c'; const t = 'Made with Exploration Maps'; creditW = ctx.measureText(t).width + 17 * u; ctx.fillText(t, Wc - m, y);
    const s = 10 * u, mx = Wc - m - creditW, my = y - s + u; ctx.fillStyle = INK; ctx.fillRect(mx, my, s, s); ctx.fillStyle = '#c65322'; ctx.fillRect(mx + s * 0.52, my + s * 0.18, s * 0.3, s * 0.3);
  }
  if (S.footnote) { font(400, 11.5); ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.fillText(fitText(ctx, S.footnote, Wc - 2 * m - creditW - 24 * u), m, y); }
  ctx.textAlign = 'left';
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
  return { l1: o.line1 || icText(c.ic.broad), l1b: o.line1 ? '' : ` from ${Math.round(c.ic.broad.from)} m`, l2: o.incl === false ? null : (o.line2 || (c.ic.incl ? `incl. ${icText(c.ic.incl)}` : null)) };
}
function measureCallout(ctx, K, c) {
  const { font, u } = K, L = calloutLines(c);
  font(700, 15); const w1 = ctx.measureText(L.l1).width; font('italic 400', 13); const w1b = ctx.measureText(L.l1b).width; font(600, 13.5); const w2 = L.l2 ? ctx.measureText(L.l2).width : 0;
  return { L, w1, bw: Math.max(w1 + w1b, w2) + 30 * u, bh: (L.l2 ? 50 : 31) * u };
}
function drawCallout(ctx, K, x, y, c, M, target) {
  const { u, font } = K, { L, w1, bw, bh } = M;
  const x0 = x + bw, y0 = y + bh / 2, xm = Math.max(x0 + 16 * u, Math.min(target[0] - 30 * u, x0 + 60 * u));
  ctx.strokeStyle = S.primary; ctx.lineWidth = 1.3 * u; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(xm, y0); ctx.lineTo(target[0], target[1]); ctx.stroke();
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
function legendRows() {
  return S.bins.map((b, i) => [i === 3 ? `≥ ${b}` : `${b} – ${S.bins[i + 1]}`, BIN_COLORS[i + 1]]).reverse().concat([[`< ${S.bins[0]}`, BIN_COLORS[0]]]);
}
const meshName = (n) => n.replace(/\.obj$/i, '').replace(/^sample_/, '').replace(/_/g, ' ');

// Scale bar along a base edge of the block: the nearest edge that reads roughly horizontal and whose bar
// fits inside the frame, under the edge if there is room and otherwise just above it.
function drawScaleBar(ctx, K, footTop) {
  const { u, m, font } = K, C = [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]];
  const edges = C.map((p, i) => { const q = C[(i + 1) % 4]; return { p, q, d: G.V((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, G.B.z0).distanceTo(camera.position) }; }).sort((a, b) => a.d - b.d).slice(0, 2);
  for (const off of [22, -24]) for (const { p, q } of edges) {
    let e0 = p, e1 = q, s0 = proj(G.V(e0[0], e0[1], G.B.z0)), s1 = proj(G.V(e1[0], e1[1], G.B.z0));
    if (s0[0] > s1[0]) { [e0, e1] = [e1, e0]; [s0, s1] = [s1, s0]; }
    const el = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), ud = [(e1[0] - e0[0]) / el, (e1[1] - e0[1]) / el], ppm = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) / el;
    if (!(ppm > 0) || s0[2] > 1 || s1[2] > 1 || Math.abs(s1[1] - s0[1]) > 0.7 * Math.abs(s1[0] - s0[0])) continue;
    const D = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * ppm >= 120 * u) || 5000, st = [e0[0] + ud[0] * el * 0.05, e0[1] + ud[1] * el * 0.05];
    if (D > el * 0.9) continue;
    const sp = [0, 0.5, 1].map((f) => { const r = proj(G.V(st[0] + ud[0] * D * f, st[1] + ud[1] * D * f, G.B.z0)); return [r[0], r[1] + off * u]; });
    const lab = off > 0 ? 19 : -9;
    if (sp.some(([x, y]) => x < m || x > W - m || Math.max(y, y + lab * u) + 4 * u > footTop || Math.min(y, y + lab * u) < 12 * u)) continue;
    ctx.lineCap = 'butt'; ctx.lineWidth = 6 * u; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(...sp[0]); ctx.lineTo(...sp[1]); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(...sp[1]); ctx.lineTo(...sp[2]); ctx.stroke();
    ctx.lineWidth = u; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1] - 3 * u); ctx.lineTo(sp[2][0], sp[2][1] - 3 * u); ctx.lineTo(sp[2][0], sp[2][1] + 3 * u); ctx.lineTo(sp[0][0], sp[0][1] + 3 * u); ctx.closePath(); ctx.stroke();
    font(400, 12, true); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', sp[0][0], sp[0][1] + lab * u); ctx.fillText(String(D / 2), sp[1][0], sp[1][1] + lab * u); ctx.fillText(`${D} m`, sp[2][0], sp[2][1] + lab * u); ctx.textAlign = 'left';
    return;
  }
  // No near edge has room: a flat bar at the scale of the block centre.
  // Measured along the screen's own horizontal, so a view looking along an axis is not foreshortened.
  const across = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(G.diag * 0.1);
  const c0 = proj(controls.target), c1 = proj(controls.target.clone().add(across)), ppm = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) / (G.diag * 0.1);
  if (!(ppm > 0)) return;
  const D = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * ppm >= 120 * u) || 5000, len = D * ppm, x = (W - len) / 2, y = footTop - 26 * u;
  ctx.fillStyle = INK; ctx.fillRect(x, y, len / 2, 6 * u); ctx.fillStyle = '#fff'; ctx.fillRect(x + len / 2, y, len / 2, 6 * u); ctx.strokeStyle = INK; ctx.lineWidth = u; ctx.strokeRect(x, y, len, 6 * u);
  font(400, 12, true); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText('0', x, y - 5 * u); ctx.fillText(`${D} m (at block centre)`, x + len, y - 5 * u); ctx.textAlign = 'left';
}
function drawOverlay(ctx, k, forExport) {
  ctx.save(); ctx.scale(k, k); if (!forExport) ctx.clearRect(0, 0, W, H);
  const K = kit(ctx, W, H), { u, m, font, narrow } = K;
  if (!G) { font(600, 18); ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.fillText('Add a collar file and an assay file to build the figure.', W / 2, H / 2); ctx.restore(); return; }
  // Collars and hole IDs
  const placed = [];
  project.holes.forEach((h) => {
    const [cx, cy] = proj(G.V(h.c.x, h.c.y, h.c.z)), e = h.path[h.path.length - 1], [ex, ey] = proj(G.V(e.x, e.y, e.z));
    ctx.beginPath(); ctx.arc(cx, cy, 5 * u, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.4 * u; ctx.strokeStyle = INK; ctx.stroke();
    if (!S.ids) return;
    const ang = Math.atan2(ey - cy, ex - cx), flip = Math.abs(ang) > Math.PI / 2, r = 26 * u, box = [ex - r, ey - r, ex + r, ey + r];
    if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) return; placed.push(box);
    ctx.save(); ctx.translate(ex + Math.cos(ang) * 6 * u, ey + Math.sin(ang) * 6 * u); ctx.rotate(flip ? ang + Math.PI : ang);
    font(500, 11.5, true); ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.textAlign = flip ? 'right' : 'left';
    ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(h.id, 0, 0); ctx.fillText(h.id, 0, 0); ctx.restore();
  });
  // Section ends
  const [A, Bp] = sectionEnds();
  [[A, 'A'], [Bp, 'A′']].forEach(([p, t]) => { const [x, y] = proj(G.V(p.x, p.y, G.surf(p.x, p.y) + G.diag * 0.035)); tagLabel(ctx, K, t, x, y); });
  // Frame furniture
  const logo = drawLogo(ctx, K, W, forExport);
  const headBottom = drawHeader(ctx, K, W, S.title, S.subtitle, logo.w);
  const footTop = drawFooter(ctx, K, W, H);
  drawScaleBar(ctx, K, footTop);
  // Plan inset under the logo
  if (S.inset) {
    const iw = (narrow ? 118 : 150) * u, sc = iw / Math.max(G.bw, G.bh), bw = G.bw * sc, bh = G.bh * sc, ix = W - m - iw, iy = logo.bottom + 16 * u, P = (x, y) => [ix + (iw - bw) / 2 + (x - G.B.x0) * sc, iy + (G.B.y1 - y) * sc];
    ctx.fillStyle = '#fff'; ctx.strokeStyle = RULE; ctx.lineWidth = u; roundRect(ctx, ix - 8 * u, iy - 8 * u, iw + 16 * u, bh + 34 * u, 5 * u); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = S.primary; ctx.lineWidth = 1.4 * u; ctx.strokeRect(ix + (iw - bw) / 2, iy, bw, bh);
    project.holes.forEach((h) => { ctx.strokeStyle = '#7c898c'; ctx.lineWidth = u; ctx.beginPath(); h.path.forEach((p, i) => { const [X, Y] = P(p.x, p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
      const [X, Y] = P(h.c.x, h.c.y); ctx.fillStyle = INK; ctx.fillRect(X - 1.5 * u, Y - 1.5 * u, 3 * u, 3 * u); });
    ctx.setLineDash([5 * u, 3 * u]); ctx.strokeStyle = S.accent; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.moveTo(...P(A.x, A.y)); ctx.lineTo(...P(Bp.x, Bp.y)); ctx.stroke(); ctx.setLineDash([]);
    font(700, 11); ctx.fillStyle = S.primary; ctx.fillText('N ↑', ix + (iw - bw) / 2 + 3 * u, iy + 12 * u);
    font(400, 11); ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.fillText('Plan of drilling', ix + iw / 2, iy + bh + 18 * u); ctx.textAlign = 'left';
  }
  // Legend card, bottom right
  const rows = legendRows(), meshRows = G.meshes.filter(({ name }) => S.meshes[name].show).map(({ name }) => [meshName(name), S.meshes[name].color]);
  const R = 19 * u, lw = 192 * u, lh = 12 * u + R + 6 * u + R + rows.length * R + (meshRows.length ? 6 * u + R + meshRows.length * R : 0) + 6 * u;
  const lx = W - m - lw, ly = footTop - 12 * u - lh;
  ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.strokeStyle = RULE; ctx.lineWidth = u; roundRect(ctx, lx, ly, lw, lh, 5 * u); ctx.fill(); ctx.stroke();
  let yy = ly + 12 * u; const row = (draw, t, bold, mono) => { draw(yy + R / 2); bold ? font(700, 13) : font(400, mono ? 12 : 13, mono); ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.fillText(fitText(ctx, t, lw - 52 * u), lx + (bold ? 12 : 44) * u, yy + R / 2); ctx.textBaseline = 'alphabetic'; yy += R; };
  row((cy) => { ctx.beginPath(); ctx.arc(lx + 23 * u, cy, 5 * u, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.4 * u; ctx.strokeStyle = INK; ctx.stroke(); }, 'Drill hole collar');
  yy += 6 * u; row(() => {}, `Assay · ${S.valueLabel}`, true);
  rows.forEach(([t, c]) => row((cy) => { ctx.fillStyle = c; roundRect(ctx, lx + 12 * u, cy - 4 * u, 22 * u, 8 * u, 4 * u); ctx.fill(); }, t, false, true));
  if (meshRows.length) { yy += 6 * u; row(() => {}, 'Model', true); meshRows.forEach(([t, c]) => row((cy) => { ctx.globalAlpha = 0.6; ctx.fillStyle = c; ctx.fillRect(lx + 12 * u, cy - 6 * u, 22 * u, 12 * u); ctx.globalAlpha = 1; }, t)); }
  // Orientation, bottom left: north arrow plus view direction
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
  font(400, 12, true); ctx.fillStyle = MUTED; ctx.fillText(`plunge ${cam.plunge}°`, ox + 36 * u, oy + 14 * u);
  // Intercept callouts, left column between the title and the orientation box
  const maxY = oy - 36 * u; let y = headBottom + 18 * u;
  shownCallouts().map((c) => { const p = c.h.posAt(c.ic.broad.mid); return { c, s: proj(G.V(p.x, p.y, p.z)) }; }).filter(({ s }) => s[2] < 1).sort((a, b) => a.s[1] - b.s[1]).forEach(({ c, s }) => {
    const M = measureCallout(ctx, K, c); y = Math.max(y, Math.min(s[1] - M.bh / 2, maxY - M.bh - 18 * u));
    if (y + M.bh + 18 * u > maxY + 1) return;
    drawCallout(ctx, K, m, y, c, M, s); y += M.bh + 30 * u;
  });
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
  const footTop = drawFooter(ctx, K, Wc, Hc);
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
  ctx.strokeStyle = S.primary; ctx.lineWidth = 1.8 * u; ctx.beginPath(); profile.forEach(([t, z], i) => (i ? ctx.lineTo(X(t), Y(z)) : ctx.moveTo(X(t), Y(z)))); ctx.stroke();
  // Elevation ticks
  font(400, 11, true); ctx.fillStyle = MUTED; ctx.strokeStyle = RULE; ctx.lineWidth = u;
  const stepZ = niceRound((zTop - zBot) / 5);
  for (let z = Math.ceil(zBot / stepZ) * stepZ; z < zTop; z += stepZ) { ctx.beginPath(); ctx.moveTo(X(L) + 4 * u, Y(z)); ctx.lineTo(X(L) + 10 * u, Y(z)); ctx.stroke(); ctx.fillText(`${Math.round(z)} m`, X(L) + 14 * u, Y(z) + 4 * u); }
  const barW = Math.max(6 * u, Math.min(12 * u, s * 7));
  shown.forEach(({ h, pts }) => {
    ctx.strokeStyle = '#2c3d42'; ctx.lineWidth = u; ctx.beginPath(); let on = false;
    pts.forEach((p) => { if (Math.abs(p.off) > S.secW) { on = false; return; } on ? ctx.lineTo(X(p.t), Y(p.z)) : ctx.moveTo(X(p.t), Y(p.z)); on = true; }); ctx.stroke();
    h.ints.forEach((it) => {
      const bi = binIndex(it.vals[S.valueCol]); if (bi < 1) return;
      const a = h.posAt(it.from), b = h.posAt(it.to), pa = pr(a), pb = pr(b); if (Math.abs(pa.off) > S.secW) return;
      const x0 = X(pa.t), y0 = Y(a.z), x1 = X(pb.t), y1 = Y(b.z), ang = Math.atan2(y1 - y0, x1 - x0), len = Math.max(1.5 * u, Math.hypot(x1 - x0, y1 - y0));
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(ang); ctx.fillStyle = BIN_COLORS[bi]; ctx.fillRect(0, -barW / 2, len + 0.5 * u, barW); ctx.restore();
    });
    const c = pr(h.c);
    if (Math.abs(c.off) <= S.secW) { ctx.save(); ctx.translate(X(c.t), Y(h.c.z) - 8 * u); ctx.rotate(-Math.PI / 4); ctx.fillStyle = INK; font(500, 12, true); ctx.fillText(h.id, 0, 0); ctx.restore(); }
  });
  // Callouts for holes on this section
  let by = mt; const maxY = Hc - mb;
  shownCallouts().filter((c) => shown.some((x) => x.h === c.h)).slice(0, narrow ? 2 : 4).forEach((c) => {
    const M = measureCallout(ctx, K, c); if (by + M.bh + 18 * u > maxY) return;
    const p = c.h.posAt(c.ic.broad.mid), q = pr(p); drawCallout(ctx, K, m, by, c, M, [X(q.t), Y(p.z)]); by += M.bh + 34 * u;
  });
  tagLabel(ctx, K, 'A', X(0), Y(profile[0][1]) - 24 * u); tagLabel(ctx, K, 'A′', X(L), Y(profile[200][1]) - 24 * u);
  // Bottom strip: scale bar left, horizontal legend right
  const sy = footTop - 18 * u, sb = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((d) => d * s >= 120 * u) || niceRound(L / 3);
  ctx.fillStyle = INK; ctx.fillRect(m, sy, sb * s / 2, 6 * u); ctx.fillStyle = '#fff'; ctx.fillRect(m + sb * s / 2, sy, sb * s / 2, 6 * u); ctx.strokeStyle = INK; ctx.lineWidth = u; ctx.strokeRect(m, sy, sb * s, 6 * u);
  font(400, 12, true); ctx.fillStyle = INK; ctx.fillText('0', m, sy - 6 * u); ctx.textAlign = 'right'; ctx.fillText(`${sb} m`, m + sb * s, sy - 6 * u); ctx.textAlign = 'left';
  const items = legendRows().slice(0, 4).reverse(); font(400, 12, true);
  const iw = items.map(([t]) => ctx.measureText(t).width + 36 * u); font(700, 13); const hw = ctx.measureText(S.valueLabel).width + 14 * u;
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
  if (S.view === '3d') { renderer.render(scene, camera); drawOverlay(ov.getContext('2d'), DPR, false); syncCamUI(); }
  requestAnimationFrame(loop);
}
function exportPNG(opts = {}) {
  if (!G) throw new Error('Nothing to export yet: add a collar file and an assay file.');
  const view = opts.view === 'section' ? 'section' : opts.view === '3d' ? '3d' : S.view, f = FORMATS[S.format];
  const out = document.createElement('canvas'); out.width = f.w; out.height = f.h; const ctx = out.getContext('2d');
  if (view === 'section') { ctx.scale(f.w / W, f.h / H); drawSection(ctx, W, H, true); }
  else {
    const k = f.w / W; tween = null; controls.update();
    renderer.setPixelRatio(k); renderer.setSize(W, H, false); renderer.render(scene, camera);
    ctx.drawImage(glCanvas, 0, 0, f.w, f.h); drawOverlay(ctx, k, true);
    renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
  }
  const url = out.toDataURL('image/png');
  if (opts.download) {
    const a = document.createElement('a'), slug = (S.title.split('·')[0].trim() || 'figure').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.href = url; a.download = `${slug || 'figure'}-${view === 'section' ? 'section' : '3d'}-${S.format}.png`; document.body.appendChild(a); a.click(); a.remove();
  }
  status(`Exported ${view === 'section' ? 'section A–A′' : 'the 3D figure'} at ${f.w} × ${f.h} px.`);
  return url;
}
$('export-3d').addEventListener('click', () => exportPNG({ view: '3d', download: true }));
$('export-section').addEventListener('click', () => exportPNG({ view: 'section', download: true }));

// ============================================================
// 9. Logo colours
// ============================================================
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
function hslOf([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s, l]; }
const contrastWhite = (rgb) => 1.05 / (lumOf(rgb) + 0.05);
// Primary: the most common logo colour dark enough for text on white (darkened if none is).
// Accent: the most common saturated colour with a different hue; one-colour logos use it for both.
function brandFromLogo(img) {
  const c = document.createElement('canvas'), n = 80, r = (img.naturalWidth / img.naturalHeight) || 1;
  c.width = r >= 1 ? n : Math.max(8, Math.round(n * r)); c.height = r >= 1 ? Math.max(8, Math.round(n / r)) : n;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height);
  let data; try { data = g.getImageData(0, 0, c.width, c.height).data; } catch { return null; }
  const bins = new Map(); let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; const R = data[i], Gc = data[i + 1], B = data[i + 2];
    if (Math.min(R, Gc, B) > 225) continue;
    const key = ((R >> 4) << 8) | ((Gc >> 4) << 4) | (B >> 4), b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += R; b.g += Gc; b.b += B; bins.set(key, b); total++;
  }
  const cols = [...bins.values()].filter((b) => b.n >= Math.max(2, total * 0.004)).map((b) => { const rgb = [b.r / b.n, b.g / b.n, b.b / b.n]; return { n: b.n, rgb, hsl: hslOf(rgb), con: contrastWhite(rgb) }; }).sort((a, b) => b.n - a.n);
  if (!cols.length) return null;
  let primary = cols.find((x) => x.con >= 4.5 && x.n >= cols[0].n * 0.12);
  if (!primary) { let rgb = cols[0].rgb.slice(); for (let i = 0; i < 30 && contrastWhite(rgb) < 4.5; i++) rgb = rgb.map((v) => v * 0.9); primary = { rgb, hsl: hslOf(rgb) }; }
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const sat = cols.filter((x) => x.hsl[1] >= 0.35 && x.hsl[2] > 0.2 && x.hsl[2] < 0.78 && x.n >= total * 0.02);
  let accent = sat.find((x) => primary.hsl[1] < 0.2 || hueGap(x.hsl[0], primary.hsl[0]) >= 25), note;
  if (accent) note = 'Colours picked from your logo. Change them if they are not quite right.';
  else if (sat.length) { accent = sat[0]; note = 'Your logo has one main colour, so it is used for both.'; }
  else { accent = primary; note = 'Your logo has no strong colour, so the dark logo colour is used for both. Pick an accent if you have one.'; }
  return { primary: toHex(primary.rgb), accent: toHex(accent.rgb), note };
}
function setLogo(src, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!src) { S.logo = null; $('logo-prev').textContent = 'No logo'; drawSectionView(); schedulePublish(); status('Logo removed.'); resolve(getState()); return; }
    const img = new Image();
    img.onload = () => {
      S.logo = img; $('logo-prev').innerHTML = ''; const pv = new Image(); pv.src = src; pv.alt = 'Your logo'; $('logo-prev').appendChild(pv);
      const picked = opts.autoColor === false ? null : brandFromLogo(img);
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
    const roles = ['collar', 'survey', 'assay', 'topo', 'mesh', 'unknown'];
    let html = `<div class="file-head"><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
      <select data-role="${fi}" aria-label="File type for ${esc(f.name)}">${roles.map((r) => `<option value="${r}" ${r === f.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>`;
    if (f.role === 'mesh') html += `<span class="muted">${f.mesh.v.length.toLocaleString()} vertices · ${(f.mesh.f.length / 3).toLocaleString()} triangles</span>`;
    else {
      html += `<span class="muted">${f.rows.length.toLocaleString()} rows</span>`;
      const fields = ROLE_FIELDS[f.role] || [];
      if (fields.length) {
        html += '<div class="maps">' + fields.map((k) => `<label for="m-${fi}-${k}">${FIELD_LABEL[k]}</label><select id="m-${fi}-${k}" data-map="${fi}" data-key="${k}"><option value="">—</option>${f.header.map((h, i) => `<option value="${i}" ${f.cols[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('') + '</div>';
        const req = { collar: ['hole', 'east', 'north'], survey: ['hole', 'depth'], assay: ['hole', 'from', 'to'], topo: ['east', 'north', 'elev'] }[f.role] || [];
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
  ['collar', 'assay', 'survey', 'topo', 'mesh'].forEach((r) => $(`need-${r}`).classList.toggle('ok', roles.has(r)));
  if (!project || project.empty) { sum.innerHTML = '<span class="bad">Add a collar file to see your holes.</span>'; return; }
  const mt = project.holes.reduce((s, h) => s + h.len, 0), n = project.holes.reduce((s, h) => s + h.ints.length, 0);
  sum.innerHTML = [usingSample ? 'sample project' : null, `${project.holes.length} holes`, `${Math.round(mt).toLocaleString()} m drilled`, `${n.toLocaleString()} assay intervals`, project.posDown ? 'dips read as positive-down' : null].filter(Boolean).map((t) => `<span class="pill">${t}</span>`).join('')
    + project.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join('');
}
function renderStyle() {
  const sel = $('value-col'); sel.innerHTML = (project?.cols || []).map((c) => `<option ${c === S.valueCol ? 'selected' : ''}>${esc(c)}</option>`).join('') || '<option>—</option>';
  $('value-label').value = S.valueLabel;
  $('bins').innerHTML = S.bins.map((b, i) => `<label class="field"><i style="background:${BIN_COLORS[i + 1]}"></i><input type="number" step="any" data-bin="${i}" value="${b}" aria-label="Lower limit of colour ${i + 1}"></label>`).join('');
  $('bins').querySelectorAll('[data-bin]').forEach((inp) => inp.addEventListener('change', () => { const b = S.bins.slice(); b[+inp.dataset.bin] = parseFloat(inp.value) || 0; setStyle({ bins: b }); }));
  $('co-cut').value = S.coCut; $('co-incl').value = S.coIncl; $('co-count').value = S.coCount; $('co-min').value = S.coMin;
  $('sec-az').value = S.secAz; $('sec-az-out').textContent = `${pad3(S.secAz)}°`; $('sec-w').value = S.secW;
  $('opt-walls').checked = S.walls; $('opt-ids').checked = S.ids; $('opt-inset').checked = S.inset;
  $('surf').value = Math.round(S.surf * 100); $('surf-out').textContent = `${Math.round(S.surf * 100)}%`;
  const ml = $('mesh-list'); ml.innerHTML = '';
  (project?.meshF || []).forEach((f) => { const st = S.meshes[f.name]; if (!st) return;
    const d = document.createElement('label'); d.className = 'mesh';
    d.innerHTML = `<input type="checkbox" ${st.show ? 'checked' : ''} aria-label="Show ${esc(f.name)}"><span>${esc(meshName(f.name))}</span><input type="color" value="${st.color}" aria-label="Colour of ${esc(f.name)}">`;
    const [cb, , cp] = d.children; cb.addEventListener('change', () => { st.show = cb.checked; restyle(); schedulePublish(); }); cp.addEventListener('input', () => { st.color = cp.value; restyle(); schedulePublish(); });
    ml.appendChild(d); });
}
function renderCalloutEditor() {
  const el = $('callout-editor'), shownIds = new Set(shownCallouts().map((c) => c.h.id)), cands = callouts.slice(0, Math.max(6, S.coCount + 3));
  callouts.forEach((c) => { if (shownIds.has(c.h.id) && !cands.includes(c)) cands.push(c); });
  if (!cands.length) { el.innerHTML = '<p class="muted">No hole has an interval above the broad cut-off over the minimum length. Lower either one.</p>'; return; }
  el.innerHTML = '<p class="muted">Tick to show. Type over a line to reword it; leave it blank for the automatic text.</p>' + cands.map((c) => {
    const id = esc(c.h.id), o = S.coOverrides[c.h.id] || {}, a1 = `${icText(c.ic.broad)} from ${Math.round(c.ic.broad.from)} m`, a2 = c.ic.incl ? `incl. ${icText(c.ic.incl)}` : '(no "incl." line)';
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
  project = build();
  if (!project.empty && project.holes.length) { const az = principalAz(project.holes); if (az !== null && !refresh.secSet) S.secAz = az; }
  rebuildScene(); renderFiles(); renderSummary(); renderStyle(); renderCalloutEditor(); schedulePublish();
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
  if (usingSample) { files = []; usingSample = false; S.meshes = {}; S.valueCol = null; S.coOverrides = {}; }
  refresh.secSet = false; addFiles(arr); refresh();
  const added = files.filter((f) => arr.some((a) => a.name === f.name)).map((f) => `${f.name} → ${ROLE_LABEL[f.role]}`);
  status(project.empty ? `Added ${added.join(', ')}. Still need a collar file.` : `Added ${added.join(', ')}. ${project.holes.length} holes on the figure.`);
  return getState();
}
// A .zip is unpacked here, in the browser: its CSV, TXT and OBJ files load as if
// dropped one by one. Folders, Mac resource forks, READMEs and anything else are skipped.
const DATA_FILE = /\.(csv|txt|obj)$/i;
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
  files = []; usingSample = true; S.valueCol = null; S.meshes = {}; S.coOverrides = {}; refresh.secSet = false;
  addFiles(sampleFiles()); refresh(); status('Sample project loaded · illustrative data. Add your CSVs in step 1 to replace it.');
  return getState();
}
function clearFiles() { files = []; usingSample = false; S.meshes = {}; S.coOverrides = {}; refresh(); status('Files cleared. Add a collar file and an assay file.'); return getState(); }
$('load-sample').addEventListener('click', loadSample);
$('clear-files').addEventListener('click', clearFiles);

// Brand inputs
function setBrand(o = {}) {
  const hex = (v, k) => { const t = String(v).trim().toLowerCase(), m3 = t.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/); if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`; if (/^#[0-9a-f]{6}$/.test(t)) return t; throw new Error(`${k} must be a hex colour like #142126.`); };
  ['company', 'title', 'subtitle', 'footnote'].forEach((k) => { if (o[k] !== undefined) S[k] = String(o[k]); });
  if (o.credit !== undefined) S.credit = !!o.credit;
  if (o.primary !== undefined) S.primary = hex(o.primary, 'primary');
  if (o.accent !== undefined) S.accent = hex(o.accent, 'accent');
  syncBrandUI(); if (o.primary !== undefined) restyle(); drawSectionView(); schedulePublish();
  return getState();
}
[['company', 'company'], ['title', 'title'], ['subtitle', 'subtitle'], ['footnote', 'footnote']].forEach(([id, k]) => $(id).addEventListener('input', (e) => { S[k] = e.target.value; drawSectionView(); schedulePublish(); }));
$('credit').addEventListener('change', (e) => { S.credit = e.target.checked; drawSectionView(); schedulePublish(); });
$('col-primary').addEventListener('input', (e) => { S.primary = e.target.value; $('col-note').textContent = 'Custom colours.'; restyle(); schedulePublish(); });
$('col-accent').addEventListener('input', (e) => { S.accent = e.target.value; $('col-note').textContent = 'Custom colours.'; drawSectionView(); schedulePublish(); });

// Layout inputs
function rebin() { const assays = new Map(); (project?.holes || []).forEach((h) => assays.set(h.id, h.ints)); autoBins(assays); }
function setStyle(o = {}, render = true) {
  if (o.valueCol !== undefined) {
    const av = project?.cols || []; if (!av.includes(o.valueCol)) throw new Error(`Unknown grade column "${o.valueCol}". Available: ${av.join(', ') || 'none'}.`);
    S.valueCol = o.valueCol; S.valueLabel = labelFor(o.valueCol); rebin();
  }
  if (o.valueLabel !== undefined) S.valueLabel = String(o.valueLabel);
  if (o.bins !== undefined) { if (!Array.isArray(o.bins) || o.bins.length !== 4 || o.bins.some((b) => !Number.isFinite(+b))) throw new Error('bins must be four numbers: the lower limit of each colour.'); S.bins = o.bins.map(Number).sort((a, b) => a - b); }
  if (o.autoBins) rebin();
  [['coCount', 0, 12], ['coMin', 1, 1000], ['coCut', 0, 1e9], ['coIncl', 0, 1e9], ['secW', 5, 5000]].forEach(([k, lo, hi]) => { if (o[k] !== undefined) { const v = +o[k]; if (!Number.isFinite(v)) throw new Error(`${k} must be a number.`); S[k] = Math.max(lo, Math.min(hi, v)); } });
  if (o.secAz !== undefined) { S.secAz = ((Math.round(+o.secAz) % 180) + 180) % 180; refresh.secSet = true; }
  ['walls', 'ids', 'inset'].forEach((k) => { if (o[k] !== undefined) S[k] = !!o[k]; });
  if (o.surface !== undefined) S.surf = Math.max(0.15, Math.min(1, +o.surface > 1 ? +o.surface / 100 : +o.surface));
  if (o.meshes) Object.entries(o.meshes).forEach(([name, v]) => { if (!S.meshes[name]) throw new Error(`No model shape named "${name}". Loaded: ${Object.keys(S.meshes).join(', ') || 'none'}.`); Object.assign(S.meshes[name], v); });
  restyle(); if (render) renderStyle(); renderCalloutEditor(); schedulePublish();
  return getState();
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
$('surf').addEventListener('input', (e) => { setStyle({ surface: +e.target.value / 100 }, false); $('surf-out').textContent = `${e.target.value}%`; });
function setCallout(holeId, o = {}) {
  if (!project?.holes?.some((h) => h.id === holeId)) throw new Error(`No hole "${holeId}".`);
  const cur = S.coOverrides[holeId] || {};
  ['show', 'line1', 'line2', 'incl'].forEach((k) => { if (o[k] === null) delete cur[k]; else if (o[k] !== undefined) cur[k] = k === 'show' || k === 'incl' ? !!o[k] : String(o[k]); });
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

// Format examples come from the sample files themselves.
(() => { const s = sampleFiles(), head = (t, n) => t.split('\n').slice(0, n).join('\n');
  $('fmt-collar').textContent = `Collars\n${head(s[0].text, 4)}`; $('fmt-survey').textContent = `Surveys\n${head(s[1].text, 4)}`; $('fmt-assay').textContent = `Assays\n${head(s[2].text, 5)}`; })();

// ============================================================
// 11. For AI assistants and browser agents
// ============================================================
function getState() {
  const f = FORMATS[S.format], ok = project && !project.empty;
  return {
    app: 'Exploration Maps 3D', version: 3, ready: !!G, usingSample, step: currentStep, view: S.view,
    files: files.map((x) => ({ name: x.name, role: x.role, rows: x.rows ? x.rows.length : undefined,
      columns: x.cols ? Object.fromEntries(Object.entries(x.cols).map(([k, i]) => [k, x.header[i]])) : undefined, gradeColumns: x.grades && x.grades.length ? x.grades.map((g) => g.name) : undefined })),
    project: ok ? { holes: project.holes.length, holeIds: project.holes.map((h) => h.id), metresDrilled: Math.round(project.holes.reduce((s, h) => s + h.len, 0)), intervals: project.holes.reduce((s, h) => s + h.ints.length, 0), dipsPositiveDown: project.posDown, warnings: project.warnings } : null,
    grade: { column: S.valueCol, label: S.valueLabel, available: project?.cols || [], bins: S.bins, binColors: BIN_COLORS },
    callouts: { coCount: S.coCount, coMin: S.coMin, coCut: S.coCut, coIncl: S.coIncl,
      shown: shownCallouts().map((c) => { const L = calloutLines(c); return { holeId: c.h.id, line1: L.l1 + L.l1b, line2: L.l2 }; }),
      candidates: callouts.slice(0, 15).map((c) => ({ holeId: c.h.id, broad: icText(c.ic.broad), fromM: Math.round(c.ic.broad.from), incl: c.ic.incl ? icText(c.ic.incl) : null })), overrides: S.coOverrides },
    brand: { company: S.company, title: S.title, subtitle: S.subtitle, footnote: S.footnote, primary: S.primary, accent: S.accent, hasLogo: !!S.logo, credit: S.credit },
    camera: G ? getCam() : null, section: { secAz: S.secAz, secW: S.secW, lookingAz: ((S.secAz - 90) % 360 + 360) % 360 },
    display: { walls: S.walls, ids: S.ids, inset: S.inset, surface: S.surf }, meshes: S.meshes,
    figureSize: { key: S.format, width: f.w, height: f.h, label: f.label }, figureSizes: Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, `${v.label}, ${v.w}×${v.h}`])),
  };
}
let pubT = 0;
function schedulePublish() {
  if (pubT) return;
  pubT = setTimeout(() => { pubT = 0; const st = getState(); $('em3d-state').textContent = JSON.stringify(st); window.dispatchEvent(new CustomEvent('em3d:change', { detail: st })); }, 60);
}
const HELP = `Exploration Maps 3D can be driven by an AI assistant or browser agent.

JavaScript API (run in the page console or via your agent's evaluate tool):
  EM3D.help()                     this text
  EM3D.getState()                 files, holes, grade columns, callouts, brand, camera, size
  EM3D.loadSample()               illustrative project
  EM3D.clearFiles()
  EM3D.addZip(dataUrlOrBase64)    Promise. Unpacks a ZIP and adds its CSV/TXT/OBJ files
  EM3D.addFiles([{name, text}])   CSV or OBJ text. The file name helps detect the type:
                                  collars, surveys, assays, topography, or a .obj model shape
  EM3D.setBrand({company, title, subtitle, footnote, primary, accent, credit})
                                  colours as hex, e.g. primary: "#0b3954"
  EM3D.setLogo(dataUrl)           Promise. Also picks primary and accent from the logo
  EM3D.setStyle({valueCol, valueLabel, bins: [4 lower limits], autoBins: true,
                 coCount, coMin, coCut, coIncl, secAz (0-179), secW,
                 walls, ids, inset, surface (0.15-1), meshes: {name: {show, color, opacity}}})
  EM3D.setCallout(holeId, {show, line1, line2, incl: false})   null resets a field
  EM3D.setCamera({view: "a" | "b" | "low" | "plan"}) or ({azimuth, plunge, zoom})
  EM3D.setFigureSize("slide" | "release" | "square" | "portrait" | "a4")
  EM3D.showStep("data" | "brand" | "layout" | "export")
  EM3D.showView("3d" | "section")
  EM3D.exportPNG({view: "3d" | "section", download: false})   returns a PNG data URL;
                                  download: true also saves the file

Every setter returns the new state. The state is also kept as JSON in
<script id="em3d-state">, and an "em3d:change" event fires on window after each change.
Errors are thrown with a plain-language message that names the valid options.

Without the API: every control has a visible label. The four steps are tabs
(Data, Brand, Layout, Export) and each pane ends with a Next button.
The status message under the preview announces each change.

Example: a branded news-release figure from pasted CSVs
  EM3D.addFiles([{name: "collars.csv", text: COLLARS}, {name: "assays.csv", text: ASSAYS}])
  EM3D.setBrand({company: "Star Copper", title: "STAR PROJECT · RAILS ZONE", subtitle: "3D drilling, looking northeast"})
  EM3D.setStyle({valueCol: "Cu_pct", coCount: 4})
  EM3D.setFigureSize("release"); EM3D.setCamera({view: "a"})
  EM3D.exportPNG({view: "3d"})`;
$('ai-help').textContent = HELP;
const call = (fn) => (...args) => { const r = fn(...args); return r === undefined ? getState() : r; };
window.EM3D = Object.freeze({
  version: 3, help: () => HELP, getState, loadSample, clearFiles, addFiles: addUserFiles, addZip, setBrand, setLogo, setStyle: (o) => setStyle(o, true), setCallout,
  setCamera: call((o = {}) => { if (!G) throw new Error('Load data first.'); showView('3d'); if (o.view) { if (!VIEWS[o.view]) throw new Error('view must be a, b, low or plan.'); applyView(o.view, true); } else setCamera(o, true); syncCamUI(); }),
  setFigureSize, showStep: call(showStep), showView: call(showView), exportPNG,
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
  refresh.secSet = true; refresh(); refresh.secSet = !!p.secSet;
  syncBrandUI(); renderSizes(); layoutFrame(); restyle(); showView(S.view === 'section' ? 'section' : '3d');
  if (p.camera && G) setCamera(p.camera, true);
  lastCamKey = ''; syncCamUI(); drawSectionView(); schedulePublish();
  status(project && !project.empty ? `Figure opened · ${project.holes.length} holes.` : 'Figure opened. Add a collar file to see the holes.');
  return getState();
}
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

// ============================================================
// 12. Start
// ============================================================
renderSizes(); syncBrandUI();
layoutFrame();
loadSample();
new ResizeObserver(() => { const c = G ? getCam() : null; layoutFrame(); if (c) setCamera(c, true); }).observe(stage);
requestAnimationFrame(loop);
if (document.fonts?.ready) document.fonts.ready.then(drawSectionView);
