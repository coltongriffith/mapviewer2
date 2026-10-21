// Geology painted on the block faces (and the A–A′ section) from lithology or alteration logs, plus
// the face-painting machinery the geophysics layer shares. Loaded on first use by studio.js (EXT hook).
//
// Method: every logged interval is sampled every few metres along its desurveyed hole trace. At each
// point of a grid on a face, each code scores the inverse-distance-squared weight of its samples within
// the search radius, with vertical distances multiplied by the anisotropy (layers are usually
// sub-horizontal, so they reach further sideways than up and down). The per-code scores are blurred and
// the highest wins (blur-then-argmax), so contacts read as interpreted geology, not pixels. Where no
// sample is within reach the face stays plain. It is an interpretation: the footnote says so.
import * as THREE from 'three';

export const PASTEL = ['#f1dca2', '#e8b7a2', '#c7dcae', '#b4d2e6', '#d6c1e3', '#f2c7cf', '#cde3d4', '#e6d1ad', '#c5c8ea', '#efe1bd', '#bcd8cd', '#e2bfb0'];
export const FACE_KEYS = ['S', 'E', 'N', 'W'];

// ---------- pure: logs, samples, interpolation ----------
const num = (s) => { const t = String(s ?? '').trim(); return t === '' ? NaN : parseFloat(t); };
// files: [{ role: 'litho', rows, cols: { hole, from, to, code, desc } }] -> { byHole, codes }
export function readLogs(files) {
  const byHole = new Map(), info = new Map();
  files.forEach((f) => f.rows.forEach((r) => {
    const c = f.cols, id = (r[c.hole] || '').trim(), a = num(r[c.from]), b = num(r[c.to]), code = String(r[c.code] ?? '').trim();
    if (!id || !code || !(b > a)) return;
    const desc = c.desc !== undefined ? String(r[c.desc] ?? '').trim() : '';
    if (!byHole.has(id)) byHole.set(id, []);
    byHole.get(id).push({ from: a, to: b, code, desc });
    const o = info.get(code) || { code, desc: '', metres: 0, depth: 0 }; o.metres += b - a; o.depth += (a + b) / 2 * (b - a); if (!o.desc && desc) o.desc = desc; info.set(code, o);
  }));
  // Shallowest first, so a cover sequence heads the legend as on a section.
  const codes = [...info.values()].map((o) => ({ ...o, depth: o.depth / o.metres })).sort((p, q) => p.depth - q.depth);
  return { byHole, codes };
}
// Keeps the user's names, colours, visibility and order; adds new codes with a pastel colour.
export function syncLegend(legend, codes) {
  const out = (legend || []).map((e) => ({ ...e })), have = new Set(out.map((e) => e.code)), used = new Set(out.map((e) => e.color));
  let k = 0;
  codes.forEach(({ code, desc }) => {
    if (have.has(code)) return;
    while (k < PASTEL.length && used.has(PASTEL[k])) k++;
    const color = PASTEL[k % PASTEL.length] || PASTEL[out.length % PASTEL.length]; used.add(color); k++;
    out.push({ code, name: desc || code, color, show: true, order: out.length });
  });
  return out.sort((a, b) => a.order - b.order).map((e, i) => ({ ...e, order: i }));
}
// A lithology legend file (code, name, optional colour): rows -> Map code -> { name, color }.
export function readLegendFiles(files) {
  const m = new Map();
  files.forEach((f) => f.rows.forEach((r) => {
    const c = f.cols, code = String(r[c.code] ?? '').trim(); if (!code) return;
    const name = c.desc !== undefined ? String(r[c.desc] ?? '').trim() : '', raw = c.color !== undefined ? String(r[c.color] ?? '').trim().replace(/^([0-9a-f]{6})$/i, '#$1') : '';
    m.set(code, { name, color: /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : '' });
  }));
  return m;
}
// Names and colours from the file, except where set by hand in the legend editor (nameSet, colorSet).
export const applyLegendFile = (legend, file) => legend.map((e) => {
  const f = file.get(e.code); if (!f) return e;
  return { ...e, ...(f.name && !e.nameSet ? { name: f.name } : {}), ...(f.color && !e.colorSet ? { color: f.color } : {}) };
});
// Hidden codes. "nearest": their intervals are left out, so the faces are interpolated as if they did not
// exist and the nearest visible units fill in; "other": they fold into one muted "Other" unit; "clear" (figures
// made before October 2026): they still shape the faces, their own areas left unpainted (in `clear`). Returns
// the class of each code (codes left out have none) and the classes in order (codes, plus OTHER at the end).
export const OTHER = '\u0000other', OTHER_COLOR = '#d5d1c8';
export function foldCodes(legend, codes, mode = 'nearest') {
  const by = new Map((legend || []).map((e) => [e.code, e])), shown = codes.filter((c) => by.get(c)?.show !== false), index = new Map(shown.map((c, i) => [c, i]));
  if (mode === 'clear') return { index: new Map(codes.map((c, i) => [c, i])), classes: codes, other: false, clear: new Set(codes.filter((c) => !index.has(c))) };
  const other = mode === 'other' && shown.length < codes.length;
  if (other) codes.forEach((c) => { if (!index.has(c)) index.set(c, shown.length); });
  return { index, classes: other ? [...shown, OTHER] : shown, other };
}
// Colour strength: 1 is the legend colour; higher deepens it away from white (pastels read pale on a face).
export const deepen = (hex, k = 1) => `#${rgbOf(hex).map((v) => Math.round(Math.max(0, Math.min(255, 255 - (255 - v) * k))).toString(16).padStart(2, '0')).join('')}`;
// Points along each interval: { x, y, z, c (code index), n }. holes: [{ id, posAt(d) }].
export function logSamples(holes, byHole, codeIndex, maxSamples = 6000) {
  let metres = 0; holes.forEach((h) => (byHole.get(h.id) || []).forEach((it) => { metres += it.to - it.from; }));
  const step = Math.max(2, metres / maxSamples), xs = [], ys = [], zs = [], cs = [];
  holes.forEach((h) => (byHole.get(h.id) || []).forEach((it) => {
    const ci = codeIndex.get(it.code); if (ci === undefined) return;
    const n = Math.max(1, Math.round((it.to - it.from) / step));
    for (let k = 0; k < n; k++) { const p = h.posAt(it.from + (k + 0.5) * (it.to - it.from) / n); xs.push(p.x); ys.push(p.y); zs.push(p.z); cs.push(ci); }
  }));
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs), c: Int16Array.from(cs), n: xs.length };
}
// A uniform hash grid in stretched space (z multiplied by the anisotropy), cell = half the radius.
export function makeIndex(P, aniso, radius) {
  const cell = Math.max(1e-6, radius / 2), map = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let s = 0; s < P.n; s++) {
    const kk = key(Math.floor(P.x[s] / cell), Math.floor(P.y[s] / cell), Math.floor(P.z[s] * aniso / cell));
    let b = map.get(kk); if (!b) map.set(kk, (b = [])); b.push(s);
  }
  // Calls fn(sampleIndex, distance²) for every sample within the radius of (x, y, z).
  return (x, y, z, fn) => {
    const zz = z * aniso, i0 = Math.floor((x - radius) / cell), i1 = Math.floor((x + radius) / cell), j0 = Math.floor((y - radius) / cell), j1 = Math.floor((y + radius) / cell), k0 = Math.floor((zz - radius) / cell), k1 = Math.floor((zz + radius) / cell), r2 = radius * radius;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const b = map.get(key(i, j, k)); if (!b) continue;
      for (const s of b) { const dx = P.x[s] - x, dy = P.y[s] - y, dz = (P.z[s] - z) * aniso, d2 = dx * dx + dy * dy + dz * dz; if (d2 <= r2) fn(s, d2); }
    }
  };
}
// Indicator IDW on an nx × ny grid. pointAt(i, j, out) fills out = [x, y, z]; out[0] = NaN skips the cell.
// Returns per-cell code shares (w, nx·ny·nc, summing to 1 where covered) and coverage (0/1).
export function classifyGrid(P, nc, nx, ny, pointAt, { aniso = 4, search = 100, power = 2 } = {}) {
  const w = new Float32Array(nx * ny * nc), cover = new Float32Array(nx * ny), q = [0, 0, 0], acc = new Float64Array(nc);
  if (!P.n || !nc) return { w, cover, nx, ny, nc };
  const find = makeIndex(P, aniso, search), half = power / 2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    pointAt(i, j, q); if (!Number.isFinite(q[0])) continue;
    acc.fill(0); let tot = 0;
    find(q[0], q[1], q[2], (s, d2) => { const wt = 1 / Math.pow(d2 + 1, half); acc[P.c[s]] += wt; tot += wt; });
    if (!tot) continue;
    const o = (j * nx + i) * nc; cover[j * nx + i] = 1;
    for (let c = 0; c < nc; c++) w[o + c] = acc[c] / tot;
  }
  return { w, cover, nx, ny, nc };
}
// Separable box blur, two passes (close to a Gaussian), of a field with `ch` channels per cell.
function blur(a, nx, ny, ch, r) {
  if (r < 1) return a;
  let src = a;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let c = 0; c < ch; c++) {
      let s = 0, n = 0; for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r); k++) { s += src[(j * nx + k) * ch + c]; n++; } tmp[(j * nx + i) * ch + c] = s / n;
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let c = 0; c < ch; c++) {
      let s = 0, n = 0; for (let k = Math.max(0, j - r); k <= Math.min(ny - 1, j + r); k++) { s += tmp[(k * nx + i) * ch + c]; n++; } out[(j * nx + i) * ch + c] = s / n;
    }
    src = out;
  }
  return src;
}
// Blur-then-argmax: one code index per cell, -1 where uncovered (blurred coverage under one half).
export function smoothClasses(G, radius = 2) {
  const { nx, ny, nc } = G, w = blur(G.w, nx, ny, nc, radius), cov = blur(G.cover, nx, ny, 1, radius), out = new Int16Array(nx * ny).fill(-1);
  for (let k = 0; k < nx * ny; k++) {
    if (cov[k] < 0.5 || !G.cover[k] && cov[k] < 0.75) continue;
    let best = -1, bw = 0; for (let c = 0; c < nc; c++) { const v = w[k * nc + c]; if (v > bw) { bw = v; best = c; } }
    out[k] = best;
  }
  return out;
}

// A majority filter of radius r: each covered cell takes the class most common around it (ties keep its own),
// which clears the one- and two-cell blotches the argmax leaves. Uncovered cells (-1) stay so and do not vote.
export function modeFilter(cls, nx, ny, nc, r = 1) {
  const out = Int16Array.from(cls), n = new Int32Array(nc);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, own = cls[k]; if (own < 0) continue; n.fill(0);
    for (let b = Math.max(0, j - r); b <= Math.min(ny - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) { const c = cls[b * nx + a]; if (c >= 0) n[c]++; }
    let best = own; for (let c = 0; c < nc; c++) if (n[c] > n[best]) best = c; out[k] = best;
  }
  return out;
}
// Patches: 4-connected runs of one class. id per cell (-1 uncovered) and [{ c, n }] per patch.
export function patches(cls, nx, ny) {
  const id = new Int32Array(nx * ny).fill(-1), list = [], stack = [];
  for (let s = 0; s < cls.length; s++) {
    if (cls[s] < 0 || id[s] >= 0) continue;
    const p = list.length, c = cls[s]; let n = 0; id[s] = p; stack.push(s);
    while (stack.length) {
      const k = stack.pop(), i = k % nx; n++;
      for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (q >= 0 && q < cls.length && id[q] < 0 && cls[q] === c) { id[q] = p; stack.push(q); }
    }
    list.push({ c, n });
  }
  return { id, list };
}
// Patches smaller than minCells take the class that borders them most.
export function dropSpecks(cls, nx, ny, minCells) {
  const { id, list } = patches(cls, nx, ny), out = Int16Array.from(cls), votes = list.map(() => new Map());
  for (let k = 0; k < cls.length; k++) {
    const p = id[k]; if (p < 0 || list[p].n >= minCells) continue;
    const i = k % nx; for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (q >= 0 && q < cls.length && cls[q] >= 0 && id[q] !== p) votes[p].set(cls[q], (votes[p].get(cls[q]) || 0) + 1);
  }
  const to = votes.map((v) => [...v].sort((a, b) => b[1] - a[1])[0]?.[0]);
  for (let k = 0; k < cls.length; k++) { const p = id[k]; if (p >= 0 && list[p].n < minCells && to[p] !== undefined) out[k] = to[p]; }
  return out;
}
// The class grid at f times the resolution with smooth contacts: each class (and "uncovered") as a softened
// indicator, interpolated bilinearly, the highest winning. Cells whose neighbours agree are copied as they are.
export function refine(cls, nx, ny, nc, f) {
  const ch = nc + 1, oh = new Float32Array(nx * ny * ch);
  cls.forEach((c, k) => { oh[k * ch + (c < 0 ? nc : c)] = 1; });
  const w = blur(oh, nx, ny, ch, 1), NX = nx * f, NY = ny * f, out = new Int16Array(NX * NY);
  for (let J = 0; J < NY; J++) for (let I = 0; I < NX; I++) {
    const x = Math.max(0, Math.min(nx - 1.0001, (I + 0.5) / f - 0.5)), y = Math.max(0, Math.min(ny - 1.0001, (J + 0.5) / f - 0.5)), i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j;
    const k = j * nx + i, c0 = cls[k];
    if (cls[k + 1] === c0 && cls[k + nx] === c0 && cls[k + nx + 1] === c0) { out[J * NX + I] = c0; continue; }
    let best = 0, bw = -1;
    for (let c = 0; c < ch; c++) { const v = w[k * ch + c] * (1 - a) * (1 - b) + w[(k + 1) * ch + c] * a * (1 - b) + w[(k + nx) * ch + c] * (1 - a) * b + w[(k + nx + 1) * ch + c] * a * b; if (v > bw) { bw = v; best = c; } }
    out[J * NX + I] = best === nc ? -1 : best;
  }
  return out;
}
// Where to name each unit on a face: in its largest patch (if that holds minShare of the covered cells), the
// cells deepest inside it, deepest first (chamfer distance to the patch edge in metres; cells are sx × sy m).
export function labelSpots(cls, nx, ny, sx, sy, minShare = 0.03) {
  const { id, list } = patches(cls, nx, ny), covered = list.reduce((t, p) => t + p.n, 0), big = new Map();
  list.forEach((p, k) => { if (p.n >= minShare * covered && p.n > (list[big.get(p.c)]?.n || 0)) big.set(p.c, k); });
  const d = new Float32Array(nx * ny), dg = Math.hypot(sx, sy);
  for (let k = 0; k < d.length; k++) d[k] = id[k] >= 0 ? Infinity : 0;
  const pass = (i, j, steps) => {
    const k = j * nx + i; if (!d[k]) return;
    for (const [di, dj, w] of steps) { const p = i + di, q = j + dj, o = q * nx + p; d[k] = Math.min(d[k], (p < 0 || q < 0 || p >= nx || q >= ny || id[o] !== id[k] ? 0 : d[o]) + w); }
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(i, j, [[-1, 0, sx], [0, -1, sy], [-1, -1, dg], [1, -1, dg]]);
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) pass(i, j, [[1, 0, sx], [0, 1, sy], [1, 1, dg], [-1, 1, dg]]);
  return [...big].map(([c, p]) => {
    const cells = []; for (let k = 0; k < d.length; k++) if (id[k] === p) cells.push(k);
    cells.sort((a, b) => d[b] - d[a]);
    return { c, n: list[p].n, spots: cells.map((k) => ({ i: k % nx, j: Math.floor(k / nx), depth: d[k] })) };
  });
}

// ---------- canvases ----------
function rgbOf(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
// Classes to an RGBA canvas. colors[c] = '#rrggbb' or null (hidden). Contacts are drawn a shade darker (with
// contacts: a thin dark line), and texture adds a faint bedding striation and grain, as on hand-coloured sections.
export function classCanvas(cls, nx, ny, colors, texture = true, contacts = false) {
  const c = document.createElement('canvas'); c.width = nx; c.height = ny;
  const g = c.getContext('2d'), img = g.createImageData(nx, ny), d = img.data, rgb = colors.map((h) => (h ? rgbOf(h) : null));
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, cl = cls[k], o = k * 4, col = cl >= 0 ? rgb[cl] : null; if (!col) continue;
    const line = contacts && ((i + 1 < nx && cls[k + 1] !== cl && cls[k + 1] >= 0) || (j + 1 < ny && cls[k + nx] !== cl && cls[k + nx] >= 0));
    const edge = line || (i + 1 < nx && cls[k + 1] !== cl && cls[k + 1] >= 0) || (j + 1 < ny && cls[k + nx] !== cl && cls[k + nx] >= 0) || (i > 0 && cls[k - 1] !== cl && cls[k - 1] >= 0) || (j > 0 && cls[k - nx] !== cl && cls[k - nx] >= 0);
    let f = line ? 0.4 : edge ? (contacts ? 0.86 : 0.72) : 1;
    if (texture && !edge) f *= 1 + 0.018 * Math.sin(j * 0.9 + Math.sin(i * 0.05) * 3) + 0.03 * (rnd() - 0.5);
    d[o] = Math.min(255, col[0] * f); d[o + 1] = Math.min(255, col[1] * f); d[o + 2] = Math.min(255, col[2] * f); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

// ---------- the faces and the section plane ----------
let H = null; // host (studio.js), set by init
export function init(host) { H = host; }
const cfg = () => H.S.geology;
// Mesh following a vertical plane from a to b, from the block base to the terrain, with u along the
// plane and v = elevation between the base (0) and the block top (1), so a texture is in true depth.
function planeMesh(a, b) {
  const G = H.G, NI = 100, NJ = 30, pos = [], uv = [], idx = [], z0 = G.B.z0, zt = G.zmax;
  for (let i = 0; i <= NI; i++) {
    const x = a[0] + (b[0] - a[0]) * i / NI, y = a[1] + (b[1] - a[1]) * i / NI, top = G.surf(x, y);
    for (let j = 0; j <= NJ; j++) { const z = z0 + (top - z0) * j / NJ, v = G.V(x, y, z); pos.push(v.x, v.y, v.z); uv.push(i / NI, (z - z0) / (zt - z0)); }
  }
  for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) { const p = i * (NJ + 1) + j, q = p + NJ + 1; idx.push(p, q, p + 1, q, q + 1, p + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.matrixAutoUpdate = true; return m;
}
// Grid point on a vertical plane a→b: column i of nx, row j of ny (row 0 at the block top).
export function planeSampler(a, b) {
  const G = H.G, z0 = G.B.z0, zt = G.zmax;
  return (nx, ny) => (i, j, out) => {
    const u = i / (nx - 1), x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = zt - (zt - z0) * j / (ny - 1);
    if (z > G.surf(x, y) + (zt - z0) / ny) { out[0] = NaN; return; } out[0] = x; out[1] = y; out[2] = z;
  };
}
const faceEnds = (f) => { const g = H.faceGeom(f); return [g.a, g.b]; };
export const gridSize = (a, b) => { const G = H.G, len = Math.hypot(b[0] - a[0], b[1] - a[1]), h = G.zmax - G.B.z0, nx = 256; return [nx, Math.max(64, Math.min(256, Math.round(nx * h / Math.max(1, len))))]; };
// Which faces a layer paints: "far" (the two turned from the camera), "all", or a list such as ["N", "E"].
export function faceWanted(sel, face) {
  if (sel === 'all') return true;
  if (Array.isArray(sel)) return sel.includes(face);
  const g = H.faceGeom(face), G = H.G, c = G.V((g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, (G.B.z0 + G.zmax) / 2);
  return g.n.dot(H.camera.position.clone().sub(c)) <= 0;
}

// Face layers: one textured mesh per face plus the section plane. Painters, in priority order, return
// { canvas, opacity } or null for a face: a user image, then geophysics, then geology.
const layer = { meshes: {}, G: null };
const painters = [];
export function addPainter(p) { if (!painters.includes(p)) painters.push(p); painters.sort((a, b) => a.rank - b.rank); }
function dropMeshes() { Object.values(layer.meshes).forEach((m) => { m.parent?.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }); layer.meshes = {}; }
export function syncFaces() {
  const G = H.G; if (!G) { dropMeshes(); return; }
  if (layer.G !== G) { dropMeshes(); layer.G = G; }
  const [A, Bp] = H.sectionEnds(), secKey = `${A.x},${A.y},${Bp.x},${Bp.y}`;
  for (const key of [...FACE_KEYS, 'section']) {
    let hit = null;
    for (const p of painters) { hit = p.paint(key); if (hit) break; }
    let m = layer.meshes[key];
    if (m && key === 'section' && m.userData.secKey !== secKey) { m.parent?.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); delete layer.meshes[key]; m = null; }
    if (!hit) { if (m) m.visible = false; continue; }
    if (!m) {
      const [a, b] = key === 'section' ? [[A.x, A.y], [Bp.x, Bp.y]] : faceEnds(key);
      m = planeMesh(a, b); m.userData.secKey = secKey; m.renderOrder = key === 'section' ? 3 : 1.5; H.root.add(m); layer.meshes[key] = m;
    }
    if (m.userData.canvas !== hit.canvas) {
      m.material.map?.dispose(); const t = new THREE.CanvasTexture(hit.canvas); t.anisotropy = H.renderer.capabilities.getMaxAnisotropy();
      m.material.map = t; m.material.needsUpdate = true; m.userData.canvas = hit.canvas;
    }
    m.material.opacity = hit.opacity; m.visible = true; m.userData.owner = hit.owner;
    if (key !== 'section') { const near = !faceWanted('far', key); m.renderOrder = near ? 5.5 : 1.5; }
  }
}
export function faceState() { return Object.fromEntries(Object.entries(layer.meshes).filter(([, m]) => m.visible).map(([k, m]) => [k, m.userData.owner || true])); }

// ---------- geology painter ----------
const cache = { logsKey: null, logs: null, samples: null, samplesKey: null, grids: {} };
function logsNow() {
  const fs = H.files().filter((f) => f.role === 'litho'), key = fs.map((f) => `${f.name}|${H.digest(f)}|${JSON.stringify(f.cols)}`).join(';');
  if (cache.logsKey !== key) { cache.logsKey = key; cache.logs = readLogs(fs); cache.samplesKey = null; }
  return cache.logs;
}
export function legendNow() {
  const L = logsNow(); cfg().legend = applyLegendFile(syncLegend(cfg().legend, L.codes), readLegendFiles(H.files().filter((f) => f.role === 'lithlegend'))); return cfg().legend;
}
export const autoSearch = () => { const G = H.G; return Math.round(Math.max(40, 0.55 * Math.max(G.bw, G.bh))); };
const searchNow = () => (Number.isFinite(cfg().search) && cfg().search > 0 ? cfg().search : autoSearch());
function samplesNow() {
  const L = logsNow(), G = H.G, codes = L.codes.map((c) => c.code), fold = foldCodes(cfg().legend, codes, cfg().hidden), key = `${cache.logsKey}|${[...fold.index].join(',')}`;
  if (cache.samplesKey !== key || cache.samplesG !== G) {
    cache.samples = logSamples(H.project.holes.filter((h) => h.path), L.byHole, fold.index); cache.samplesKey = key; cache.samplesG = G; cache.codes = codes; cache.grids = {};
  }
  cache.fold = fold; // the same classes for the same key; "clear" can still change which are unpainted
  return cache.samples;
}
// The code index of every cell on a plane, cached by plane and method settings.
export function planeClasses(key, a, b, sizeOverride) {
  const P = samplesNow(), g = cfg(), [nx, ny] = sizeOverride || gridSize(a, b), k = `${key}|${a}|${b}|${nx}x${ny}|${g.anisotropy}|${searchNow()}|${g.smooth}|${g.clean}`;
  let hit = cache.grids[key]; if (hit && hit.k === k) return hit;
  const grid = classifyGrid(P, cache.fold.classes.length, nx, ny, planeSampler(a, b)(nx, ny), { aniso: Math.max(1, g.anisotropy || 1), search: searchNow() });
  // clean: blotches cleared (a majority filter, then patches under 0.3% of the face merged into their
  // surroundings), and the grid refined to about 1000 px across with smooth contacts for the face texture.
  const nc = cache.fold.classes.length, sm = smoothClasses(grid, g.smooth ?? 2), clean = g.clean !== false;
  const cls = clean ? dropSpecks(modeFilter(sm, nx, ny, nc, 1), nx, ny, Math.max(4, nx * ny * 0.003)) : sm, f = clean ? Math.max(1, Math.round(1000 / nx)) : 1;
  hit = { k, nx, ny, cls, f, fine: f > 1 ? refine(cls, nx, ny, nc, f) : cls, canvas: null, ck: null, covered: grid.cover.reduce((s, v) => s + v, 0) / (nx * ny) };
  cache.grids[key] = hit; return hit;
}
// Face colours: the legend colour at the wall colour strength, the same as the legend swatches.
const strength = () => cfg().strength ?? 1.3;
const colorOf = (code) => deepen(code === OTHER ? OTHER_COLOR : cfg().legend.find((e) => e.code === code)?.color || OTHER_COLOR, strength());
function colorsNow() { return cache.fold.classes.map((c) => (cache.fold.clear?.has(c) ? null : colorOf(c))); }
const fill = (hit, cols) => classCanvas(hit.fine, hit.nx * hit.f, hit.ny * hit.f, cols, cfg().texture !== false, cfg().contacts !== false);
function geologyCanvas(key, a, b) {
  const hit = planeClasses(key, a, b), cols = colorsNow(), ck = `${cols.join()}|${cfg().texture}|${cfg().contacts}`;
  if (!hit.base || hit.ck !== ck) { hit.base = fill(hit, cols); hit.ck = ck; hit.lk = null; }
  if (key === 'section' || cfg().labels === false) return hit.base;
  // Unit names in about 22 px type in the export, mirrored on a face seen from inside the block; none on a
  // face seen nearly edge-on (under 300 px across in the export, foreshortened to under 45%, or receding so
  // steeply that its names would slope by more than about 50°).
  const G = H.G, len = Math.hypot(b[0] - a[0], b[1] - a[1]), ht = G.zmax - G.B.z0, zm = G.B.z0 + ht / 2, at = (u, z) => H.proj(G.V(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, z));
  const p0 = at(0.5, zm), p1 = at(0.5, zm + 10), pv = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 10, e0 = at(0, zm), e1 = at(1, zm), ph = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / len, k = H.exportScale();
  if (ph * len * k < 300 || ph < 0.45 * pv / H.S.vex || Math.abs(e1[1] - e0[1]) > 1.2 * Math.abs(e1[0] - e0[0])) return hit.base; // and none sloping steeply
  const size = Math.min(ht * 0.06, Math.max(ht * 0.015, 22 / (pv * k || 1))), bucket = Math.round(Math.log(size) / Math.log(1.2));
  const mirror = faceWanted('far', key), lk = `${ck}|${bucket}|${mirror}|${cfg().legend.map((e) => e.name).join()}|${viewKey()}`;
  if (hit.lk !== lk) { hit.canvas = labelCanvas(hit, cols, 1.2 ** bucket, len, ht, mirror, { at, ph, pv }); hit.lk = lk; }
  return hit.canvas;
}
// Each name goes where it fits inside its unit's largest patch and lies farthest from the holes, collars,
// pills and cards over the face (as last drawn); a unit with no clear spot goes unnamed.
// A short fingerprint of the overlay's boxes to the nearest 8 px: names are re-placed when a card, label or
// pill moves, not only when one comes or goes.
export function boxesKey(boxes) {
  let h = 0x811c9dc5; for (const b of boxes) for (const v of b) h = Math.imul(h ^ Math.round(v / 8), 0x01000193);
  return `${boxes.length}:${(h >>> 0).toString(36)}`;
}
// Names are re-placed when the view turns 5°, zooms 10% or the overlay changes.
const viewKey = () => { const c = H.getCam(); return `${Math.round(c.azimuth / 5)}|${Math.round(c.plunge / 5)}|${Math.round(c.zoom / 10)}|${boxesKey(H.occ)}|${H.frame()}`; };
function labelCanvas(hit, cols, size, len, ht, mirror, scr) {
  const c = document.createElement('canvas'), { nx, ny, f } = hit; c.width = hit.base.width; c.height = hit.base.height;
  const g = c.getContext('2d'), kx = c.width / len, ky = c.height / ht, names = cache.fold.classes.map((code) => (code === OTHER ? null : cfg().legend.find((e) => e.code === code)?.name || code));
  // What a name keeps clear of: the key, highlighted and new holes and the grade shell on screen, and the
  // collars, pills, cards and brackets as last drawn. Plain and faded traces may pass over a name, as on
  // hand-drawn sections.
  const pts = H.project.holes.filter(H.prominent).flatMap((h) => h.path.filter((p, i) => i % 2 === 0).map((p) => H.proj(H.G.V(p.x, p.y, p.z)))), v = new THREE.Vector3();
  (H.G.shellMesh?.children || []).forEach((m) => { const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i += 2) pts.push(H.proj(v.fromBufferAttribute(a, i))); });
  const boxes = H.occ.filter((b) => b[2] - b[0] < H.frame()[0] - 1), zt = H.G.zmax;
  g.drawImage(hit.base, 0, 0); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${size * kx}px "Source Sans 3", "Segoe UI", sans-serif`;
  labelSpots(hit.cls, nx, ny, len / nx, ht / ny).forEach(({ c: cl, spots }) => {
    if (!names[cl] || !cols[cl]) return;
    // On one line, else on two (split at the space nearest the middle), so a name fits between the holes.
    const words = names[cl].split(' '), cut = words.reduce((bk, w, i) => (i && Math.abs(words.slice(0, i).join(' ').length - names[cl].length / 2) < Math.abs(words.slice(0, bk).join(' ').length - names[cl].length / 2) ? i : bk), 1);
    for (const lines of [[names[cl]], ...(words.length > 1 ? [[words.slice(0, cut).join(' '), words.slice(cut).join(' ')]] : [])]) {
      const hw = Math.max(...lines.map((t) => g.measureText(t).width)) / kx / 2 + size * 0.3, hh = size * (0.75 + 0.55 * (lines.length - 1)), ri = Math.ceil(hw / (len / nx)), rj = Math.ceil(hh / (ht / ny));
      const fits = ({ i, j }) => { for (let q = j - rj; q <= j + rj; q++) for (let p = i - ri; p <= i + ri; p++) if (p < 0 || q < 0 || p >= nx || q >= ny || hit.cls[q * nx + p] !== cl) return false; return true; };
      const sw = (hw - size * 0.2) * scr.ph + 3, sh = hh * 0.9 * scr.pv + 6; // the text's own box on screen, a hair wider
      const room = ({ i, j }) => { // screen distance from the name's box to the nearest obstacle; negative: covered
        const [x, y] = scr.at((i + 0.5) / nx, zt - (j + 0.5) / ny * ht), box = [x - sw, y - sh, x + sw, y + sh];
        if (boxes.some((o) => !(box[2] < o[0] || box[0] > o[2] || box[3] < o[1] || box[1] > o[3]))) return -1;
        let d = Infinity; for (const [px, py] of pts) d = Math.min(d, Math.max(Math.abs(px - x) - sw, Math.abs(py - y) - sh)); return d;
      };
      const deep = spots.filter((p) => p.depth >= hh * 0.8), step = Math.max(1, Math.floor(deep.length / 300));
      let best = null; for (let n = 0, k = 0; k < deep.length && n < 80; k += step) { const p = deep[k]; if (!fits(p)) continue; n++; const r = room(p); if (r > 0 && (!best || r > best.r)) best = { ...p, r }; }
      if (!best) continue;
      g.save(); g.translate((best.i + 0.5) * f, (best.j + 0.5) * f); g.scale(mirror ? -1 : 1, ky / kx);
      g.fillStyle = `#${rgbOf(cols[cl]).map((v) => Math.round(v * 0.45).toString(16).padStart(2, '0')).join('')}`;
      lines.forEach((t, i) => g.fillText(t, 0, (i - (lines.length - 1) / 2) * size * 1.1 * kx)); g.restore();
      return;
    }
  });
  return c;
}
export const hasLogs = () => H.files().some((f) => f.role === 'litho') && logsNow().codes.length > 0;
// Face images: a geologist's drawn section stretched over a face from its base to its highest point.
const images = {};
function imageCanvas(face) {
  const src = cfg().images?.[face]; if (!src) return null;
  let e = images[face];
  if (!e || e.src !== src) {
    e = images[face] = { src, img: null, canvas: null };
    e.ready = new Promise((res) => { const im = new Image(); im.onload = () => { e.img = im; res(); H.redraw(); }; im.onerror = () => { H.status(`The image for the ${face} face could not be read.`); res(); }; im.src = src; });
  }
  if (!e.img || !H.G) return null;
  if (!e.canvas || e.G !== H.G) {
    const G = H.G, [a, b] = faceEnds(face); let top = -Infinity; for (let i = 0; i <= 50; i++) top = Math.max(top, G.surf(a[0] + (b[0] - a[0]) * i / 50, a[1] + (b[1] - a[1]) * i / 50));
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d'), f = (top - G.B.z0) / (G.zmax - G.B.z0);
    g.drawImage(e.img, 0, c.height * (1 - f), c.width, c.height * f); e.canvas = c; e.G = G;
  }
  return e.canvas;
}
export const imagesReady = () => Promise.all(Object.keys(cfg().images || {}).map((f) => { imageCanvas(f); return images[f]?.ready; }));
addPainter({ rank: 0, paint: (key) => { if (key === 'section') return null; const c = imageCanvas(key); return c ? { canvas: c, opacity: Math.max(cfg().opacity, 0.9), owner: 'image' } : null; } });
addPainter({ rank: 2, paint: (key) => {
  const g = cfg(); if (!g.enabled || !hasLogs()) return null;
  legendNow();
  if (key === 'section') { if (!g.section) return null; const [A, Bp] = H.sectionEnds(); return { canvas: geologyCanvas('section', [A.x, A.y], [Bp.x, Bp.y]), opacity: g.opacity, owner: 'geology' }; }
  if (!faceWanted(g.faces, key)) return null;
  const [a, b] = faceEnds(key); return { canvas: geologyCanvas(key, a, b), opacity: g.opacity, owner: 'geology' };
} });
export const geologyShown = () => cfg().enabled && hasLogs() && Object.values(layer.meshes).some((m) => m.visible && m.userData.owner === 'geology');

// ---------- figure furniture: legend block, 2D section, footnote, state ----------
export function legendBlock() {
  if (!geologyShown()) return null;
  const present = new Set(cache.codes || []), rows = cfg().legend.filter((e) => e.show !== false && present.has(e.code)).map((e) => ({ label: e.name || e.code, color: colorOf(e.code) }));
  if (cache.fold?.other) rows.push({ label: 'Other', color: colorOf(OTHER) });
  if (!rows.length) return null;
  return { title: cfg().title || 'Lithology', rows };
}
// Paints the section view: the plane A→A′ classified at the section's own resolution, clipped by the profile.
export function drawSection2D(ctx, { A, Bp, X, Y, L, clip }) {
  const g = cfg(); if (!g.enabled || !hasLogs()) return;
  const G = H.G, hit = planeClasses('section2d', [A.x, A.y], [Bp.x, Bp.y], [320, 200]), cols = colorsNow(), ck = `${cols.join()}|${g.texture}|${g.contacts}`;
  if (!hit.canvas || hit.ck !== ck) { hit.canvas = fill(hit, cols); hit.ck = ck; }
  ctx.save(); clip(); ctx.globalAlpha = Math.min(1, g.opacity + 0.1); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(hit.canvas, X(0), Y(G.zmax), X(L) - X(0), Y(G.B.z0) - Y(G.zmax)); ctx.restore();
}
export const note = () => (geologyShown() && cfg().note ? cfg().note : null);
export function state() {
  const g = cfg(), L = H.G ? logsNow() : { codes: [], byHole: new Map() };
  return { ...structuredClone({ ...g, images: undefined }), images: Object.fromEntries(Object.entries(g.images || {}).filter(([, v]) => v).map(([k]) => [k, true])),
    searchUsed: H.G ? searchNow() : null, logs: { holes: L.byHole.size, codes: L.codes.map((c) => ({ code: c.code, metres: Math.round(c.metres) })) },
    shown: H.G ? geologyShown() : false, facesPainted: Object.keys(faceState()), coverage: Object.fromEntries(Object.entries(cache.grids).map(([k, v]) => [k, +v.covered.toFixed(2)])) };
}

// ---------- the API (validated here; studio.js keeps only the defaults in S) ----------
export function set(o = {}) {
  const g = cfg();
  if (o.enabled !== undefined) g.enabled = !!o.enabled;
  if (o.faces !== undefined) {
    const f = typeof o.faces === 'string' && !['far', 'all'].includes(o.faces) ? o.faces.toUpperCase().split(/[\s,]+/).filter(Boolean) : o.faces;
    if (!(f === 'far' || f === 'all' || (Array.isArray(f) && f.every((x) => FACE_KEYS.includes(x))))) throw new Error('faces must be "far" (the two turned from the camera), "all", or a list such as ["N", "E"].');
    g.faces = Array.isArray(f) ? [...new Set(f)] : f;
  }
  if (o.opacity !== undefined) { const v = +o.opacity; if (!Number.isFinite(v)) throw new Error('opacity must be 0.1-1.'); g.opacity = Math.max(0.1, Math.min(1, v > 1 ? v / 100 : v)); }
  if (o.anisotropy !== undefined) { const v = +o.anisotropy; if (!Number.isFinite(v)) throw new Error('anisotropy must be 1-20 (how much further layers reach sideways than up and down).'); g.anisotropy = Math.max(1, Math.min(20, v)); }
  if (o.search !== undefined) { if (o.search === null || o.search === 'auto' || o.search === '') g.search = null; else { const v = +o.search; if (!(v > 0)) throw new Error('search must be a distance in metres, or null for automatic.'); g.search = Math.min(20000, v); } }
  if (o.smooth !== undefined) g.smooth = Math.max(0, Math.min(8, Math.round(+o.smooth) || 0));
  if (o.strength !== undefined) { const v = +o.strength; if (!Number.isFinite(v)) throw new Error('strength must be 0.5-2 (1: the legend colour; higher: deeper).'); g.strength = Math.max(0.5, Math.min(2, v)); }
  if (o.hidden !== undefined) { if (!['nearest', 'other', 'clear'].includes(o.hidden)) throw new Error('hidden must be "nearest" (hidden codes give way to the nearest visible unit), "other" (one muted "Other" unit) or "clear" (left unpainted).'); g.hidden = o.hidden; }
  ['texture', 'section', 'contacts', 'labels', 'clean'].forEach((k) => { if (o[k] !== undefined) g[k] = !!o[k]; });
  if (o.title !== undefined) g.title = String(o.title).slice(0, 40) || 'Lithology';
  if (o.note !== undefined) g.note = o.note === null ? '' : String(o.note).slice(0, 200);
  if (o.legend !== undefined) {
    if (!Array.isArray(o.legend)) throw new Error('legend must be a list of { code, name, color, show, order }.');
    const cur = new Map(g.legend.map((e) => [e.code, e]));
    o.legend.forEach((e, i) => {
      if (!e || e.code === undefined) throw new Error('Each legend entry needs its code.');
      if (e.color !== undefined && !/^#[0-9a-f]{6}$/i.test(e.color)) throw new Error(`Colour for ${e.code} must be a hex colour like #f1dca2.`);
      const t = cur.get(String(e.code)) || { code: String(e.code), name: String(e.code), color: PASTEL[cur.size % PASTEL.length], show: true, order: g.legend.length + i };
      if (e.name !== undefined) { t.name = String(e.name).slice(0, 60); t.nameSet = true; } if (e.color !== undefined) { t.color = e.color.toLowerCase(); t.colorSet = true; } if (e.show !== undefined) t.show = !!e.show; if (e.order !== undefined) t.order = +e.order;
      cur.set(t.code, t);
    });
    g.legend = [...cur.values()].sort((a, b) => a.order - b.order).map((e, i) => ({ ...e, order: i }));
  }
  if (H.G && hasLogs()) legendNow();
}
export function setImage(face, src) {
  const f = String(face).toUpperCase(); if (!FACE_KEYS.includes(f)) throw new Error('face must be "N", "S", "E" or "W".');
  if (src !== null && (typeof src !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(src))) throw new Error('The image must be a PNG, JPG or WebP data URL (data:image/png;base64,...), or null to remove it.');
  const g = cfg(); g.images = { ...(g.images || {}) }; if (src) g.images[f] = src; else delete g.images[f];
  if (!src) delete images[f];
  return imagesReady();
}

// ---------- panel controls (rendered into #geo-ui once loaded) ----------
export function renderUI(el) {
  const g = cfg(), esc = H.esc, faces = Array.isArray(g.faces) ? 'chosen' : g.faces, logs = H.G ? hasLogs() : false;
  const legend = logs ? legendNow() : g.legend, present = new Set(logs ? cache.codes || logsNow().codes.map((c) => c.code) : []);
  el.innerHTML = `${logs ? '' : '<p class="muted">No lithology or alteration log loaded yet: add a CSV with Hole ID, From, To and a code column in step 1 (or an image per face below).</p>'}
    <div class="grid2">
      <label class="field"><span>Legend title</span><input type="text" data-g="title" value="${esc(g.title)}" list="geo-titles"></label>
      <label class="field"><span>Faces painted</span><select data-g="faces"><option value="far" ${faces === 'far' ? 'selected' : ''}>The far two</option><option value="all" ${faces === 'all' ? 'selected' : ''}>All four</option><option value="chosen" ${faces === 'chosen' ? 'selected' : ''}>Chosen faces</option></select></label>
    </div>
    <datalist id="geo-titles"><option value="Lithology"><option value="Alteration"><option value="Geology"></datalist>
    <div class="row" ${faces === 'chosen' ? '' : 'hidden'} style="gap:12px;margin-top:6px">${FACE_KEYS.map((f) => `<label class="check"><input type="checkbox" data-gf="${f}" ${Array.isArray(g.faces) && g.faces.includes(f) ? 'checked' : ''}>${f}</label>`).join('')}</div>
    <div class="grid2" style="margin-top:8px">
      <label class="field"><span>Opacity <output class="mono">${Math.round(g.opacity * 100)}%</output></span><input type="range" min="10" max="100" data-g="opacity" value="${Math.round(g.opacity * 100)}"></label>
      <label class="field"><span>Colour strength <output class="mono">${(g.strength ?? 1.3).toFixed(1)}×</output></span><input type="range" min="50" max="200" step="10" data-g="strength" value="${Math.round((g.strength ?? 1.3) * 100)}"></label>
    </div>
    <details style="margin-top:8px"><summary>Advanced</summary>
    <label class="field" style="margin-top:6px"><span>Hidden codes</span><select data-g="hidden"><option value="nearest" ${!['other', 'clear'].includes(g.hidden) ? 'selected' : ''}>Give way to the nearest visible unit</option><option value="other" ${g.hidden === 'other' ? 'selected' : ''}>One muted "Other" unit</option><option value="clear" ${g.hidden === 'clear' ? 'selected' : ''}>Left unpainted</option></select></label>
    <div class="grid2" style="margin-top:6px">
      <label class="field"><span>Anisotropy (sideways ÷ vertical reach)</span><input type="number" min="1" max="20" step="0.5" data-g="anisotropy" value="${esc(g.anisotropy)}"></label>
      <label class="field"><span>Search radius (m)</span><input type="number" min="5" data-g="search" value="${esc(g.search ?? '')}" placeholder="auto${H.G ? ` (${searchNow()} m)` : ''}"></label>
    </div>
    <div class="row" style="gap:14px;margin-top:6px"><label class="check"><input type="checkbox" data-g="texture" ${g.texture !== false ? 'checked' : ''}>Subtle texture</label><label class="check"><input type="checkbox" data-g="section" ${g.section ? 'checked' : ''}>Also on the A–A′ plane</label>
      <label class="check"><input type="checkbox" data-g="contacts" ${g.contacts !== false ? 'checked' : ''}>Contact lines</label><label class="check"><input type="checkbox" data-g="labels" ${g.labels !== false ? 'checked' : ''}>Unit names on the faces</label><label class="check"><input type="checkbox" data-g="clean" ${g.clean !== false ? 'checked' : ''}>Clear small blotches</label></div>
    </details>
    ${legend.length ? `<div class="files geo-legend" style="margin-top:8px">${legend.map((e, i) => `<div class="label-row" style="${present.size && !present.has(e.code) ? 'opacity:.55' : ''}">
      <input type="checkbox" data-gs="${i}" ${e.show !== false ? 'checked' : ''} aria-label="Show ${esc(e.code)}"><input type="color" data-gc="${i}" value="${esc(e.color)}" aria-label="Colour of ${esc(e.code)}">
      <input type="text" data-gn="${i}" value="${esc(e.name)}" aria-label="Name of ${esc(e.code)}" title="Code ${esc(e.code)}">
      <span style="display:flex;gap:2px"><button class="btn" type="button" data-gu="${i}" aria-label="Move ${esc(e.code)} up" ${i ? '' : 'disabled'}>↑</button><button class="btn" type="button" data-gd="${i}" aria-label="Move ${esc(e.code)} down" ${i < legend.length - 1 ? '' : 'disabled'}>↓</button></span></div>`).join('')}</div>` : ''}
    <div class="grid2" style="margin-top:8px"><label class="field"><span>Section image on a face</span><select id="geo-img-face">${FACE_KEYS.map((f) => `<option>${f}</option>`).join('')}</select></label>
      <span class="field"><span>Image (PNG or JPG)</span><input type="file" id="geo-img" accept="image/png,image/jpeg,image/webp"></span></div>
    ${Object.keys(g.images || {}).length ? `<div class="row" style="margin-top:6px">${Object.keys(g.images).map((f) => `<button class="btn" type="button" data-gx="${esc(f)}">Remove ${esc(f)} image</button>`).join('')}</div>` : ''}`;
  const apply = (o) => H.api.setGeology(o).catch((e) => H.status(e.message));
  el.querySelectorAll('[data-g]').forEach((inp) => inp.addEventListener(inp.type === 'range' || inp.type === 'text' ? 'change' : 'change', () => {
    const k = inp.dataset.g; let v = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (k === 'opacity' || k === 'strength') v = +v / 100; if (k === 'anisotropy') v = +v; if (k === 'search') v = v === '' ? null : +v;
    if (k === 'faces' && v === 'chosen') v = Array.isArray(g.faces) ? g.faces : ['N', 'E'];
    apply({ [k]: v });
  }));
  el.querySelector('[data-g="opacity"]').addEventListener('input', (e) => { e.target.previousElementSibling.querySelector('output').textContent = `${e.target.value}%`; });
  el.querySelector('[data-g="strength"]').addEventListener('input', (e) => { e.target.previousElementSibling.querySelector('output').textContent = `${(e.target.value / 100).toFixed(1)}×`; });
  el.querySelectorAll('[data-gf]').forEach((cb) => cb.addEventListener('change', () => apply({ faces: FACE_KEYS.filter((f) => el.querySelector(`[data-gf="${f}"]`).checked) })));
  const L = () => cfg().legend;
  el.querySelectorAll('[data-gs]').forEach((cb) => cb.addEventListener('change', () => apply({ legend: [{ code: L()[+cb.dataset.gs].code, show: cb.checked }] })));
  el.querySelectorAll('[data-gc]').forEach((cp) => cp.addEventListener('change', () => apply({ legend: [{ code: L()[+cp.dataset.gc].code, color: cp.value }] })));
  el.querySelectorAll('[data-gn]').forEach((t) => t.addEventListener('change', () => apply({ legend: [{ code: L()[+t.dataset.gn].code, name: t.value }] })));
  const move = (i, d) => { const l = L().map((e) => ({ code: e.code, order: e.order })); [l[i].order, l[i + d].order] = [l[i + d].order, l[i].order]; apply({ legend: l }); };
  el.querySelectorAll('[data-gu]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.gu, -1)));
  el.querySelectorAll('[data-gd]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.gd, 1)));
  el.querySelector('#geo-img').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => H.api.setFaceImage(el.querySelector('#geo-img-face').value, r.result).catch((err) => H.status(err.message)); r.readAsDataURL(f); e.target.value = '';
  });
  el.querySelectorAll('[data-gx]').forEach((b) => b.addEventListener('click', () => H.api.setFaceImage(b.dataset.gx, null)));
}

// ---------- legend sections (geology rows, geophysics colour bar), drawn in the page's legend cards ----------
// blocks: { title, rows: [{ label, color }] } or { title, bar: { lo, hi, log, color(t) -> [r, g, b] } }.
const niceStep = (span, n) => { const r = span / n, p = 10 ** Math.floor(Math.log10(r)), m = r / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
export function barTicks(lo, hi, log) {
  if (log) {
    const out = []; for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) for (const m of [1, 2, 5]) { const v = Math.log10(m) + e; if (v >= lo - 1e-9 && v <= hi + 1e-9) out.push(v); }
    return out.length > 7 ? out.filter((v) => Math.abs(v - Math.round(v)) < 1e-9) : out;
  }
  const st = niceStep(hi - lo, 4), out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toPrecision(6)); return out;
}
const tickText = (v, log) => { const x = log ? 10 ** v : v, a = Math.abs(x); return a >= 1000 ? `${+(x / 1000).toPrecision(3)}k` : a >= 10 || a === 0 ? String(Math.round(x)) : a >= 1 ? String(+x.toFixed(1)) : String(+x.toPrecision(2)); };
// A legend block as a section of the page's legend card: unit swatches, or the geophysics colour bar.
export function sectionOf(b) {
  if (!b.bar) return { key: 'lithology', title: b.title, rows: b.rows.map((r) => ({ label: r.label, draw: (ctx, x, cy, u) => { ctx.fillStyle = r.color; ctx.fillRect(x, cy - 6 * u, 24 * u, 12 * u); ctx.strokeStyle = 'rgba(20,33,38,0.25)'; ctx.lineWidth = 0.8 * u; ctx.strokeRect(x, cy - 6 * u, 24 * u, 12 * u); } })) };
  return { key: 'geophys', title: b.title, rows: [{ h: 36, full: (ctx, { u, font }, bx, y, bw) => {
    const by = y + 2 * u, bh = 13 * u, { lo, hi, log } = b.bar;
    for (let i = 0; i < Math.ceil(bw); i++) { const c = b.bar.color(i / bw); ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; ctx.fillRect(bx + i, by, 1.5, bh); }
    ctx.strokeStyle = H.RULE; ctx.lineWidth = u; ctx.strokeRect(bx, by, bw, bh);
    font(400, 11, true); ctx.fillStyle = H.INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let last = -Infinity;
    barTicks(lo, hi, log).forEach((v) => {
      const tx = bx + (v - lo) / ((hi - lo) || 1) * bw, t = tickText(v, log), tw2 = ctx.measureText(t).width; if (tx - tw2 / 2 < last + 4 * u) return; last = tx + tw2 / 2;
      ctx.fillRect(tx - 0.5 * u, by + bh, u, 4 * u); ctx.fillText(t, Math.max(bx + tw2 / 2, Math.min(bx + bw - tw2 / 2, tx)), by + bh + 15 * u);
    });
    ctx.textAlign = 'left';
  } }] };
}
