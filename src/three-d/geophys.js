// Geophysics: IP / MT / resistivity points shown as vertical curtains along survey lines (or along
// A–A′, or a line you choose), or painted on the block faces with the geology machinery. Loaded on first
// use by studio.js (EXT hook). Values are inverse-distance weighted near the data only, so a curtain is
// transparent where there is no data; resistivity and conductivity colour on a log scale.
import * as THREE from 'three';
import { addPainter, planeSampler, gridSize, faceWanted } from './geology.js';

// ---------- pure: property names, ramps, interpolation ----------
export function propertyInfo(name = '') {
  const n = String(name).toLowerCase();
  if (/charg|mv_?\/?v|^ip|msec/.test(n)) return { label: 'Chargeability', unit: /msec|_ms\b/.test(n) ? 'ms' : 'mV/V', log: false };
  if (/resist|^rho|ohm|^res\b|^res_/.test(n)) return { label: 'Resistivity', unit: 'Ω·m', log: true };
  if (/conduct|sigma|^cond/.test(n)) return { label: 'Conductivity', unit: /s_?m\b/.test(n) && !/ms/.test(n) ? 'S/m' : 'mS/m', log: true };
  if (/susc/.test(n)) return { label: 'Magnetic susceptibility', unit: 'SI × 10⁻³', log: false };
  if (/density/.test(n)) return { label: 'Density', unit: 'g/cm³', log: false };
  if (/^mag|tmi/.test(n)) return { label: 'Magnetics', unit: 'nT', log: false };
  return { label: String(name) || 'Value', unit: '', log: false };
}
export const RAMPS = {
  geophys: ['#2c3fb8', '#1f9fd0', '#22a556', '#f2e21b', '#f08a1c', '#e2251f', '#d22fc9'], // blue → green → yellow → red → magenta
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  grey: ['#f4f4f4', '#1e1e1e'],
};
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const RAMP_RGB = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, v.map(rgbOf)]));
export function rampRGB(name, t) {
  const st = RAMP_RGB[name] || RAMP_RGB.geophys, x = Math.max(0, Math.min(1, t)) * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map((k) => st[i][k] + (st[i + 1][k] - st[i][k]) * f);
}
const num = (s) => { const t = String(s ?? '').trim(); return t === '' ? NaN : parseFloat(t); };
export function readPoints(files) {
  const x = [], y = [], z = [], v = [], line = [];
  files.forEach((f) => f.rows.forEach((r) => {
    const c = f.cols, a = num(r[c.east]), b = num(r[c.north]), e = num(r[c.elev]), val = num(r[c.value]);
    if (![a, b, e, val].every(Number.isFinite)) return;
    x.push(a); y.push(b); z.push(e); v.push(val); line.push(c.line !== undefined ? String(r[c.line] ?? '').trim() : '');
  }));
  const lines = [...new Set(line)].filter(Boolean);
  return { x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z), v: Float64Array.from(v), line, lines, n: x.length };
}
// Principal direction of a set of plan points: origin, unit direction, and the t range along it.
export function lineFrame(xs, ys) {
  const n = xs.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); let dx = Math.cos(ang), dy = Math.sin(ang); if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
  let t0 = Infinity, t1 = -Infinity; for (let i = 0; i < n; i++) { const t = (xs[i] - mx) * dx + (ys[i] - my) * dy; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  return { ox: mx, oy: my, dx, dy, t0, t1 };
}
// Median nearest-neighbour spacing of up to 400 points (2 or 3 coordinates).
export function spacing(cs) {
  const n = cs[0].length, step = Math.max(1, Math.floor(n / 400)), d = [];
  for (let i = 0; i < n; i += step) { let best = Infinity; for (let j = 0; j < n; j++) { if (j === i) continue; let s = 0; for (const c of cs) s += (c[i] - c[j]) ** 2; if (s > 1e-9 && s < best) best = s; } if (best < Infinity) d.push(Math.sqrt(best)); }
  d.sort((a, b) => a - b); return d.length ? d[Math.floor(d.length / 2)] : 1;
}
// IDW (power 2) of values at points (any dimension) onto a grid, within radius; NaN where none in range.
// cs: coordinate arrays; vals: values; pointAt(i, j, out) fills the query coordinates (out[0] = NaN skips).
export function idwGrid(cs, vals, nx, ny, pointAt, radius) {
  const dim = cs.length, n = vals.length, cell = radius, map = new Map(), key = (k) => k.reduce((h, v, i) => h ^ Math.imul(v, [73856093, 19349663, 83492791][i]), 0);
  for (let s = 0; s < n; s++) { const k = key(cs.map((c) => Math.floor(c[s] / cell))); let b = map.get(k); if (!b) map.set(k, (b = [])); b.push(s); }
  const out = new Float32Array(nx * ny).fill(NaN), q = new Array(dim).fill(0), r2 = radius * radius, base = new Array(dim), off = [];
  const walk = (d, acc) => { if (d === dim) { off.push(acc.slice()); return; } for (const o of [-1, 0, 1]) { acc[d] = o; walk(d + 1, acc); } }; walk(0, []);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    pointAt(i, j, q); if (!Number.isFinite(q[0])) continue;
    for (let d = 0; d < dim; d++) base[d] = Math.floor(q[d] / cell);
    let sw = 0, sv = 0, exact = NaN;
    for (const o of off) {
      const b = map.get(key(base.map((v, d) => v + o[d]))); if (!b) continue;
      for (const s of b) { let d2 = 0; for (let d = 0; d < dim; d++) d2 += (cs[d][s] - q[d]) ** 2; if (d2 > r2) continue; if (d2 < 1e-6) { exact = vals[s]; break; } const w = 1 / d2; sw += w; sv += w * vals[s]; }
      if (Number.isFinite(exact)) break;
    }
    out[j * nx + i] = Number.isFinite(exact) ? exact : sw ? sv / sw : NaN;
  }
  return out;
}
// A curtain: points (t along the line, z) interpolated on an nt × nz grid over [t0, t1] × [z0, z1] (row 0 at z1).
export function curtainGrid(ts, zs, vs, nt, nz, { t0, t1, z0, z1, search }) {
  return idwGrid([ts, zs], vs, nt, nz, (i, j, o) => { o[0] = t0 + (t1 - t0) * i / (nt - 1); o[1] = z1 - (z1 - z0) * j / (nz - 1); }, search);
}
export function autoRange(vals, log) {
  const v = []; for (const x of vals) if (Number.isFinite(x) && (!log || x > 0)) v.push(log ? Math.log10(x) : x);
  if (!v.length) return [0, 1]; v.sort((a, b) => a - b);
  const lo = v[Math.floor(0.02 * (v.length - 1))], hi = v[Math.floor(0.98 * (v.length - 1))];
  return hi > lo ? [lo, hi] : [lo - 0.5, lo + 0.5];
}

// ---------- state ----------
let H = null;
export function init(host) { H = host; }
const cfg = () => H.S.geophys;
const cache = { key: null, P: null, curt: {}, faces: {}, meshes: [], G: null };
function dataNow() {
  const fs = H.files().filter((f) => f.role === 'geophys'), key = fs.map((f) => `${f.name}|${H.digest(f)}|${JSON.stringify(f.cols)}`).join(';');
  if (cache.key !== key) {
    cache.key = key; cache.P = readPoints(fs); cache.curt = {}; cache.faces = {};
    const f = fs[0]; cache.prop = f ? f.header[f.cols.value] : null;
  }
  return cache.P;
}
export const hasData = () => H.files().some((f) => f.role === 'geophys') && dataNow().n > 0;
const info = () => { const g = cfg(), pi = propertyInfo(g.property || cache.prop || ''); return { ...pi, label: g.label || pi.label, unit: g.unit ?? pi.unit, log: g.log === null || g.log === undefined ? pi.log : !!g.log }; };
// Display range in display space (log10 when logarithmic).
function range() {
  const g = cfg(), I = info(), P = dataNow(), [a, b] = autoRange(P.v, I.log), tr = (v) => (I.log ? Math.log10(Math.max(1e-9, v)) : v);
  return [Number.isFinite(g.min) && g.min !== null ? tr(g.min) : a, Number.isFinite(g.max) && g.max !== null ? tr(g.max) : b];
}
function valuesCanvas(vals, nx, ny, maskAbove) {
  const g = cfg(), I = info(), [lo, hi] = range(), c = document.createElement('canvas'); c.width = nx; c.height = ny;
  const ctx = c.getContext('2d'), img = ctx.createImageData(nx, ny), d = img.data;
  for (let k = 0; k < nx * ny; k++) {
    const v = vals[k]; if (!Number.isFinite(v) || (maskAbove && maskAbove(k))) continue;
    const t = ((I.log ? Math.log10(Math.max(1e-9, v)) : v) - lo) / ((hi - lo) || 1), rgb = rampRGB(g.ramp, t);
    d[k * 4] = rgb[0]; d[k * 4 + 1] = rgb[1]; d[k * 4 + 2] = rgb[2]; d[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}
const rangeKey = () => `${range().join(',')}|${cfg().ramp}|${info().log}`;

// ---------- curtains ----------
// Each curtain: { id, a: [x, y], b: [x, y], z0, z1, idx: point indices }.
function curtainDefs() {
  const g = cfg(), P = dataNow(), G = H.G, defs = [];
  const near = (a, b, w) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, idx = [];
    for (let i = 0; i < P.n; i++) { const t = (P.x[i] - a[0]) * ux + (P.y[i] - a[1]) * uy, o = Math.abs(-(P.x[i] - a[0]) * uy + (P.y[i] - a[1]) * ux); if (o <= w && t >= -w && t <= L + w) idx.push(i); } return idx; };
  const corridor = () => (Number.isFinite(g.width) && g.width > 0 ? g.width : Math.max(H.S.secW, 2 * spacing([P.x, P.y])));
  const along = (id, a, b) => { const idx = near(a, b, corridor()); if (idx.length >= 3) defs.push({ id, a, b, idx }); };
  let lines = g.lines;
  if (lines === 'auto') lines = P.lines.length ? 'all' : 'section';
  if (lines === 'section') { const [A, Bp] = H.sectionEnds(); along('A–A′', [A.x, A.y], [Bp.x, Bp.y]); }
  else {
    const list = lines === 'all' ? P.lines : Array.isArray(lines) ? lines : [];
    list.forEach((L) => {
      if (L && typeof L === 'object') { const a = L.from || [L.x0, L.y0], b = L.to || [L.x1, L.y1]; along(L.id || `${Math.round(a[0])},${Math.round(a[1])}`, a, b); return; }
      const idx = []; for (let i = 0; i < P.n; i++) if (P.line[i] === String(L)) idx.push(i); if (idx.length < 3) return;
      const F = lineFrame(idx.map((i) => P.x[i]), idx.map((i) => P.y[i]));
      defs.push({ id: String(L), a: [F.ox + F.dx * F.t0, F.oy + F.dy * F.t0], b: [F.ox + F.dx * F.t1, F.oy + F.dy * F.t1], idx });
    });
  }
  // Each curtain is cut to the block, so it never hangs outside the model.
  const B = G.B, clipped = defs.filter((d) => {
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1]; let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, d.a[0] - B.x0], [dx, B.x1 - d.a[0]], [-dy, d.a[1] - B.y0], [dy, B.y1 - d.a[1]]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (t1 - t0 < 1e-3) return false;
    const a = [d.a[0] + dx * t0, d.a[1] + dy * t0]; d.b = [d.a[0] + dx * t1, d.a[1] + dy * t1]; d.a = a; return true;
  });
  defs.length = 0; defs.push(...clipped);
  defs.forEach((d) => { let z0 = Infinity, z1 = -Infinity; d.idx.forEach((i) => { z0 = Math.min(z0, P.z[i]); z1 = Math.max(z1, P.z[i]); }); const pad = 0.04 * (z1 - z0 || 50); d.z0 = Math.max(G.B.z0, z0 - pad); d.z1 = Math.min(G.zmax, z1 + pad); });
  return defs.filter((d) => d.z1 > d.z0);
}
function curtainCanvas(d) {
  const P = dataNow(), G = H.G, g = cfg(), L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) || 1, ux = (d.b[0] - d.a[0]) / L, uy = (d.b[1] - d.a[1]) / L;
  const nt = 256, nz = Math.max(48, Math.min(256, Math.round(256 * (d.z1 - d.z0) / L))), ts = Float64Array.from(d.idx, (i) => (P.x[i] - d.a[0]) * ux + (P.y[i] - d.a[1]) * uy), zs = Float64Array.from(d.idx, (i) => P.z[i]);
  const search = Number.isFinite(g.search) && g.search > 0 ? g.search : 2.5 * spacing([ts, zs]), key = `${d.id}|${d.a}|${d.b}|${search}|${d.idx.length}|${d.z0}|${d.z1}`;
  let e = cache.curt[d.id];
  if (!e || e.key !== key) e = cache.curt[d.id] = { key, vals: curtainGrid(ts, zs, Float64Array.from(d.idx, (i) => P.v[i]), nt, nz, { t0: 0, t1: L, z0: d.z0, z1: d.z1, search }), nt, nz, search };
  const rk = rangeKey();
  if (!e.canvas || e.rk !== rk) {
    const above = (k) => { const i = k % nt, j = Math.floor(k / nt), t = L * i / (nt - 1), z = d.z1 - (d.z1 - d.z0) * j / (nz - 1); return z > G.surf(d.a[0] + ux * t, d.a[1] + uy * t); };
    e.canvas = valuesCanvas(e.vals, nt, nz, above); e.rk = rk;
  }
  return e;
}
function dropCurtains() { cache.meshes.forEach((m) => { m.parent?.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }); cache.meshes = []; }
export function syncCurtains() {
  const G = H.G, g = cfg(); dropCurtains();
  if (!G || g.mode !== 'curtain' || !hasData()) { cache.defs = []; return; }
  cache.defs = curtainDefs();
  cache.defs.forEach((d) => {
    const e = curtainCanvas(d), V = (x, y, z) => G.V(x, y, z), p = [V(d.a[0], d.a[1], d.z1), V(d.b[0], d.b[1], d.z1), V(d.a[0], d.a[1], d.z0), V(d.b[0], d.b[1], d.z0)];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2)); geo.setIndex([0, 2, 1, 2, 3, 1]);
    const tex = new THREE.CanvasTexture(e.canvas); tex.anisotropy = H.renderer.capabilities.getMaxAnisotropy();
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: g.opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 3.5; m.userData.curtain = d.id; H.root.add(m); cache.meshes.push(m);
  });
}

// ---------- faces ----------
function faceCanvas(key, a, b) {
  const P = dataNow(), g = cfg(), [nx, ny] = gridSize(a, b), search = Number.isFinite(g.search) && g.search > 0 ? g.search : 3 * spacing([P.x, P.y, P.z]);
  const k = `${a}|${b}|${nx}x${ny}|${search}|${H.G.B.z0}|${H.G.zmax}`; let e = cache.faces[key];
  if (!e || e.k !== k) e = cache.faces[key] = { k, vals: idwGrid([P.x, P.y, P.z], P.v, nx, ny, planeSampler(a, b)(nx, ny), search), nx, ny, search };
  const rk = rangeKey(); if (!e.canvas || e.rk !== rk) { e.canvas = valuesCanvas(e.vals, nx, ny); e.rk = rk; }
  return e.canvas;
}
addPainter({ rank: 1, paint: (key) => {
  const g = H.S.geophys; if (g.mode !== 'faces' || !hasData()) return null;
  if (key === 'section') return null;
  if (!faceWanted(g.faces, key)) return null;
  const f = H.faceGeom(key); return { canvas: faceCanvas(key, f.a, f.b), opacity: g.opacity, owner: 'geophysics' };
} });

// ---------- legend, section view, footnote, state ----------
export const shown = () => cfg().mode !== 'off' && hasData() && (cfg().mode === 'faces' || cache.meshes.length > 0);
export function legendBlock() {
  if (!shown()) return null; const I = info(), [lo, hi] = range();
  const ramp = cfg().ramp; return { title: I.unit ? `${I.label} (${I.unit})` : I.label, bar: { lo, hi, log: I.log, color: (t) => rampRGB(ramp, t) } };
}
export function drawSection2D(ctx, { A, Bp, X, Y, L, clip }) {
  const g = cfg(); if (g.mode === 'off' || !hasData()) return;
  const P = dataNow(), w = Number.isFinite(g.width) && g.width > 0 ? g.width : Math.max(H.S.secW, 2 * spacing([P.x, P.y])), ux = (Bp.x - A.x) / L, uy = (Bp.y - A.y) / L, idx = [];
  for (let i = 0; i < P.n; i++) { const t = (P.x[i] - A.x) * ux + (P.y[i] - A.y) * uy, o = Math.abs(-(P.x[i] - A.x) * uy + (P.y[i] - A.y) * ux); if (o <= w && t >= -w && t <= L + w) idx.push(i); }
  if (idx.length < 3) return;
  let z0 = Infinity, z1 = -Infinity; idx.forEach((i) => { z0 = Math.min(z0, P.z[i]); z1 = Math.max(z1, P.z[i]); });
  const e = curtainCanvas({ id: '§section2d', a: [A.x, A.y], b: [Bp.x, Bp.y], idx, z0, z1 });
  ctx.save(); clip(); ctx.globalAlpha = g.opacity; ctx.drawImage(e.canvas, X(0), Y(z1), X(L) - X(0), Y(z0) - Y(z1)); ctx.restore();
}
export const note = () => (shown() && cfg().note ? cfg().note : null);
export function state() {
  const g = cfg(), ok = H.G && hasData(), I = ok ? info() : null, r = ok ? range() : null, un = (v) => (I.log ? 10 ** v : v);
  return { ...structuredClone(g), property: ok ? (g.property || cache.prop) : g.property, label: I?.label ?? null, unit: I?.unit ?? null, logUsed: I?.log ?? null,
    minUsed: r ? +un(r[0]).toPrecision(4) : null, maxUsed: r ? +un(r[1]).toPrecision(4) : null, points: ok ? dataNow().n : 0, lineIds: ok ? dataNow().lines : [],
    curtains: (cache.defs || []).map((d) => ({ id: d.id, points: d.idx.length, from: d.a.map(Math.round), to: d.b.map(Math.round) })), shown: ok ? shown() : false };
}
export function set(o = {}) {
  const g = cfg();
  if (o.mode !== undefined) { if (!['off', 'curtain', 'faces'].includes(o.mode)) throw new Error('mode must be "curtain", "faces" or "off".'); g.mode = o.mode; }
  if (o.lines !== undefined) {
    const l = o.lines;
    if (!(l === 'auto' || l === 'section' || l === 'all' || (Array.isArray(l) && l.every((x) => typeof x === 'string' || typeof x === 'number' || (x && typeof x === 'object' && (Array.isArray(x.from) || Number.isFinite(x.x0)))))))
      throw new Error('lines must be "auto" (survey lines, else A–A′), "section", "all", a list of line IDs, or lines as [{ from: [x, y], to: [x, y] }].');
    g.lines = Array.isArray(l) ? l.map((x) => (typeof x === 'object' ? { ...x } : String(x))) : l;
  }
  if (o.ramp !== undefined) { if (!RAMPS[o.ramp]) throw new Error(`ramp must be one of: ${Object.keys(RAMPS).join(', ')}.`); g.ramp = o.ramp; }
  if (o.log !== undefined) g.log = o.log === null || o.log === 'auto' ? null : !!o.log;
  ['min', 'max', 'search', 'width'].forEach((k) => { if (o[k] === undefined) return; if (o[k] === null || o[k] === '' || o[k] === 'auto') { g[k] = null; return; } const v = +o[k]; if (!Number.isFinite(v)) throw new Error(`${k} must be a number, or null for automatic.`); g[k] = v; });
  if (o.opacity !== undefined) { const v = +o.opacity; if (!Number.isFinite(v)) throw new Error('opacity must be 0.1-1.'); g.opacity = Math.max(0.1, Math.min(1, v > 1 ? v / 100 : v)); }
  if (o.faces !== undefined) {
    const f = typeof o.faces === 'string' && !['far', 'all'].includes(o.faces) ? o.faces.toUpperCase().split(/[\s,]+/).filter(Boolean) : o.faces;
    if (!(f === 'far' || f === 'all' || (Array.isArray(f) && f.every((x) => ['N', 'S', 'E', 'W'].includes(x))))) throw new Error('faces must be "far", "all" or a list such as ["S", "W"].');
    g.faces = f;
  }
  ['label', 'unit', 'property'].forEach((k) => { if (o[k] !== undefined) g[k] = o[k] === null ? null : String(o[k]).slice(0, 60); });
  if (o.note !== undefined) g.note = o.note === null ? '' : String(o.note).slice(0, 200);
}

// ---------- panel controls (#gp-ui) ----------
export function renderUI(el) {
  const g = cfg(), ok = H.G && hasData(), I = ok ? info() : null, esc = H.esc, lines = Array.isArray(g.lines) ? g.lines.filter((x) => typeof x === 'string').join(', ') : '';
  el.innerHTML = `${ok ? `<p class="muted">${dataNow().n.toLocaleString()} points · ${esc(I.label)}${I.unit ? ` (${esc(I.unit)})` : ''}${dataNow().lines.length ? ` · ${dataNow().lines.length} survey lines` : ''}</p>` : '<p class="muted">No geophysics loaded yet: add X, Y, Z and value points (CSV, or Geosoft XYZ) in step 1.</p>'}
    <div class="grid2">
      <label class="field"><span>Curtains along</span><select data-p="lines"><option value="auto" ${g.lines === 'auto' ? 'selected' : ''}>Survey lines, else A–A′</option><option value="section" ${g.lines === 'section' ? 'selected' : ''}>Section A–A′</option><option value="all" ${g.lines === 'all' ? 'selected' : ''}>Every survey line</option><option value="list" ${Array.isArray(g.lines) ? 'selected' : ''}>Chosen lines</option></select></label>
      <label class="field"><span>Line IDs (comma)</span><input type="text" data-p="lineIds" value="${esc(lines)}" placeholder="e.g. 6458300N"></label>
      <label class="field"><span>Colour ramp</span><select data-p="ramp">${Object.keys(RAMPS).map((r) => `<option value="${r}" ${g.ramp === r ? 'selected' : ''}>${{ geophys: 'Geophysics rainbow', viridis: 'Viridis', grey: 'Greyscale' }[r]}</option>`).join('')}</select></label>
      <label class="field"><span>Scale</span><select data-p="log"><option value="auto" ${g.log === null ? 'selected' : ''}>Automatic${I ? ` (${I.log ? 'log' : 'linear'})` : ''}</option><option value="lin" ${g.log === false ? 'selected' : ''}>Linear</option><option value="log" ${g.log === true ? 'selected' : ''}>Logarithmic</option></select></label>
      <label class="field"><span>Minimum</span><input type="number" step="any" data-p="min" value="${esc(g.min ?? '')}" placeholder="auto"></label>
      <label class="field"><span>Maximum</span><input type="number" step="any" data-p="max" value="${esc(g.max ?? '')}" placeholder="auto"></label>
      <label class="field"><span>Faces (on the block)</span><select data-p="faces"><option value="far" ${g.faces === 'far' ? 'selected' : ''}>The far two</option><option value="all" ${g.faces === 'all' ? 'selected' : ''}>All four</option>${['S', 'E', 'N', 'W'].map((f) => `<option value="${f}" ${Array.isArray(g.faces) && g.faces.join() === f ? 'selected' : ''}>${f} only</option>`).join('')}</select></label>
      <label class="field"><span>Search radius (m)</span><input type="number" min="1" data-p="search" value="${esc(g.search ?? '')}" placeholder="auto"></label>
    </div>
    <label class="field" style="margin-top:6px"><span>Opacity <output class="mono">${Math.round(g.opacity * 100)}%</output></span><input type="range" min="10" max="100" data-p="opacity" value="${Math.round(g.opacity * 100)}"></label>`;
  const apply = (o) => H.api.setGeophys(o).catch((e) => H.status(e.message));
  el.querySelectorAll('[data-p]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.p, v = inp.value;
    if (k === 'lines') apply({ lines: v === 'list' ? (el.querySelector('[data-p="lineIds"]').value.split(',').map((s) => s.trim()).filter(Boolean)) : v });
    else if (k === 'lineIds') apply({ lines: v.split(',').map((s) => s.trim()).filter(Boolean) });
    else if (k === 'log') apply({ log: v === 'auto' ? null : v === 'log' });
    else if (k === 'opacity') apply({ opacity: +v / 100 });
    else if (k === 'faces') apply({ faces: ['far', 'all'].includes(v) ? v : [v] });
    else if (['min', 'max', 'search'].includes(k)) apply({ [k]: v === '' ? null : +v });
    else apply({ [k]: v });
  }));
  el.querySelector('[data-p="opacity"]').addEventListener('input', (e) => { e.target.previousElementSibling.querySelector('output').textContent = `${e.target.value}%`; });
}
