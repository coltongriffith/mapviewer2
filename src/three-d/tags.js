// Hole tags and callouts in the agency style: collar ID pills (new vs previously released), grouped
// intercept boxes, free-form stat boxes, grade histogram bars along holes, and a real-map location
// inset. Loaded on first use by studio.js (EXT hook).
import * as THREE from 'three';

// ---------- pure ----------
const YES = /^(y|yes|true|1|new|x)$/i, NO = /^(n|no|false|0)$/i;
const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');
// Status of each hole: "new", "previous", "planned" or null, from a per-hole choice, then the collar
// columns: a new/released flag, the status or notes text, else the newest year or campaign is "new".
// holes: [{ id, note, raw: { header: value }, planned }]
export function holeStatuses(holes, manual = {}) {
  const out = new Map(), year = new Map(), camp = new Map();
  const colOf = (raw, re) => Object.keys(raw || {}).find((k) => re.test(norm(k)));
  holes.forEach((h) => {
    const raw = h.raw || {}, flag = colOf(raw, /^(new|is_new|new_hole|new_result|this_release)$/), rel = colOf(raw, /^(released|previously_released|prev_released|reported)$/);
    let st = null;
    if (h.planned) st = 'planned';
    else if (flag && YES.test(String(raw[flag]).trim())) st = 'new';
    else if (flag && NO.test(String(raw[flag]).trim())) st = 'previous';
    else if (rel && YES.test(String(raw[rel]).trim())) st = 'previous';
    else if (rel && NO.test(String(raw[rel]).trim())) st = 'new';
    else if (/\b(historic\w*|previous\w*|prior|legacy|re-?logged|released)\b/i.test(h.note || '')) st = 'previous';
    else if (/\b(new|this release|current)\b/i.test(h.note || '')) st = 'new';
    if (!h.planned) {
      const yc = colOf(raw, /^(year|drill_year|yr|year_drilled|season)$/), cc = colOf(raw, /^(campaign|program|programme|phase)$/);
      const y = yc ? parseInt(String(raw[yc]).match(/(19|20)\d\d/)?.[0], 10) : NaN; if (Number.isFinite(y)) year.set(h.id, y);
      const c = cc ? String(raw[cc]).trim() : ''; if (c) { camp.set(h.id, c); const cy = parseInt(c.match(/(19|20)\d\d/)?.[0], 10); if (Number.isFinite(cy) && !year.has(h.id)) year.set(h.id, cy); }
    }
    out.set(h.id, st);
  });
  const ys = [...new Set(year.values())];
  if (ys.length > 1) { const top = Math.max(...ys); year.forEach((y, id) => { if (!out.get(id)) out.set(id, y === top ? 'new' : 'previous'); }); }
  else if (!ys.length) { const cs = [...new Set(camp.values())].sort(); if (cs.length > 1) camp.forEach((c, id) => { if (!out.get(id)) out.set(id, c === cs[cs.length - 1] ? 'new' : 'previous'); }); }
  Object.entries(manual || {}).forEach(([id, st]) => { if (out.has(id) && ['new', 'previous', 'planned'].includes(st)) out.set(id, st); else if (out.has(id) && st === 'none') out.set(id, null); });
  return { status: out, newestYear: ys.length > 1 ? Math.max(...ys) : null };
}
const hits = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
// Pill placement: each { x, y, w, h } (anchor and size) tries spots above, beside and further out, and
// takes the first clear of `avoid`, the frame edge and the pills already placed; failing that, the spot
// with the least overlap. Returns { cx, cy, box, leader } per item.
export function placePills(items, avoid, { W, H, unit = 1, pad = 4 }) {
  const placed = [], out = [];
  const spots = [[0, -1], [1, -0.7], [-1, -0.7], [0, -2], [1.3, -1.7], [-1.3, -1.7], [0, 1], [1.2, 0.6], [-1.2, 0.6], [0, -3], [1.6, -2.7], [-1.6, -2.7], [0, 2], [2, 0], [-2, 0], [0, -4], [2, -3.7], [-2, -3.7]];
  for (const it of items) {
    let best = null;
    for (const [sx, sy] of spots) {
      const cx = it.x + sx * (it.w / 2 + 8 * unit), cy = it.y + sy * (it.h + 6 * unit), box = [cx - it.w / 2 - pad, cy - it.h / 2 - pad, cx + it.w / 2 + pad, cy + it.h / 2 + pad];
      if (box[0] < 0 || box[1] < 0 || box[2] > W || box[3] > H) continue;
      const cost = [...avoid, ...placed].reduce((s, b) => s + (hits(box, b) ? overlapArea(box, b) + 1 : 0), 0);
      if (!best || cost < best.cost) best = { cx, cy, box, cost, far: Math.abs(sx) > 1.1 || Math.abs(sy) > 1.1 };
      if (cost === 0) break;
    }
    if (!best) best = { cx: it.x, cy: it.y - it.h, box: [it.x - it.w / 2, it.y - it.h * 1.5, it.x + it.w / 2, it.y - it.h / 2], far: false };
    placed.push(best.box); out.push({ ...it, cx: best.cx, cy: best.cy, box: best.box, leader: best.far });
  }
  return out;
}
// Single-linkage clusters of screen points closer than r. Returns arrays of indices (singletons included).
export function clusters(pts, r) {
  const parent = pts.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < r) parent[find(i)] = find(j);
  const m = new Map(); pts.forEach((_, i) => { const k = find(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return [...m.values()];
}

// ---------- host ----------
let H = null;
export function init(host) { H = host; }
const T = () => H.S.tags;
let stCache = { key: null, res: null };
export function statuses() {
  const hs = H.project?.holes || [], key = `${hs.map((h) => h.id).join()}|${JSON.stringify(T().status)}|${hs.length}`;
  if (stCache.key !== key || stCache.holes !== hs) stCache = { key, holes: hs, res: holeStatuses(hs.map((h) => ({ id: h.id, note: h.note, raw: h.c.raw, planned: h.planned })), T().status) };
  return stCache.res;
}
export const statusOf = (h) => statuses().status.get(h.id) || null;
export const fade = (h) => !!T().fadePrevious && statusOf(h) === 'previous';
const GREY = '#8b979b';
function pillColors(st) {
  const S = H.S, dark = T().style !== 'light', c = st === 'new' ? S.accent : st === 'previous' ? GREY : S.primary;
  if (st === 'planned') return { fill: '#ffffff', text: S.primary, line: S.primary, dash: true };
  return dark ? { fill: c, text: H.textOn(c), line: c } : { fill: '#ffffff', text: st === 'previous' ? '#5f6e72' : st === 'new' ? S.accent : H.INK, line: c };
}
// Collar pills: drawn after the collars and the toe IDs; boxes added to occ so later furniture keeps clear.
export function drawPills(ctx, K, { placed, occ, W, H: Hh }) {
  const S = H.S; if (!S.ids || T().at === 'toe') return;
  const { u, font } = K; font(700, 12.5);
  const items = H.project.holes.map((h) => {
    const s = H.proj(H.G.V(h.c.x, h.c.y, h.c.z)); if (s[2] > 1) return null;
    const st = statusOf(h), pri = st === 'new' ? 0 : st === 'planned' ? 2 : st === 'previous' ? 3 : 1;
    return { hole: h, st, pri, x: s[0], y: s[1] - 4 * u, w: ctx.measureText(h.id).width + 14 * u, h: 20 * u };
  }).filter(Boolean).sort((a, b) => a.pri - b.pri || a.x - b.x);
  const collars = H.project.holes.map((h) => { const s = H.proj(H.G.V(h.c.x, h.c.y, h.c.z)); return [s[0] - 6 * u, s[1] - 6 * u, s[0] + 6 * u, s[1] + 6 * u]; });
  const res = placePills(items, [...placed, ...occ.filter((b) => b[3] - b[1] < Hh * 0.5), ...collars], { W, H: Hh, unit: u, pad: 3 * u });
  // Leaders first, then every pill, so no leader crosses a pill.
  res.forEach((p) => {
    const c = pillColors(p.st), x = p.cx - p.w / 2, y = p.cy - p.h / 2;
    if (p.leader) {
      const ex = Math.max(x, Math.min(x + p.w, p.x)), ey = p.y + 4 * u < y ? y : p.y + 4 * u > y + p.h ? y + p.h : p.cy;
      ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3.4 * u; ctx.beginPath(); ctx.moveTo(p.x, p.y + 4 * u); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = c.line; ctx.lineWidth = 1.3 * u; ctx.stroke(); ctx.lineCap = 'butt';
    }
  });
  res.forEach((p) => {
    const c = pillColors(p.st), x = p.cx - p.w / 2, y = p.cy - p.h / 2;
    H.roundRect(ctx, x, y, p.w, p.h, p.h / 2); ctx.fillStyle = c.fill; ctx.fill();
    ctx.lineWidth = (c.fill === '#ffffff' ? 1.5 : 1) * u; ctx.strokeStyle = c.fill === '#ffffff' ? c.line : 'rgba(255,255,255,0.85)'; if (c.dash) ctx.setLineDash([3 * u, 2 * u]); ctx.stroke(); ctx.setLineDash([]);
    font(700, 12.5); ctx.fillStyle = c.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.hole.id, p.cx, p.cy + 0.6 * u);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    placed.push(p.box); occ.push(p.box);
  });
}
// Legend rows for the statuses in use: [{ label, draw(ctx, x, cy, u) }].
export function legendRows() {
  if (T().at === 'toe' && !T().fadePrevious && !Object.keys(T().status).length) return [];
  const st = statuses(), used = new Set(H.project.holes.map((h) => st.status.get(h.id)));
  const pill = (kind) => (ctx, x, cy, u) => { const c = pillColors(kind); H.roundRect(ctx, x, cy - 6 * u, 22 * u, 12 * u, 6 * u); ctx.fillStyle = c.fill; ctx.fill(); ctx.lineWidth = u; ctx.strokeStyle = c.line; if (c.dash) ctx.setLineDash([3 * u, 2 * u]); ctx.stroke(); ctx.setLineDash([]); };
  const rows = [];
  if (used.has('new')) rows.push({ label: T().newLabel || (st.newestYear ? `${st.newestYear} results` : 'New results'), draw: pill('new') });
  if (used.has('previous')) rows.push({ label: T().prevLabel || 'Previously released', draw: pill('previous') });
  return rows;
}

// ---------- grouped intercept boxes ----------
function groupLines(ctx, K, it) {
  const { font, u } = K, L = H.calloutLines(it.c); font(600, 11, true); const chip = ctx.measureText(it.c.h.id).width + 12 * u;
  font(700, 14); const w1 = ctx.measureText(L.l1).width; font('italic 400', 12.5); const w1b = ctx.measureText(L.l1b).width; font(600, 13); const w2 = L.l2 ? ctx.measureText(L.l2).width : 0;
  return { L, chip, w1, w: Math.max(chip + 8 * u + w1 + w1b, chip + 8 * u + w2), h: (L.l2 ? 40 : 22) * u };
}
// Replaces callouts that belong together with one box: by the groups set with groupCallouts, then
// (with autoGroup) by intercepts whose screen positions lie within groupRadius of each other.
export function groupItems(ctx, K, items) {
  const { u } = K, t = T(), used = new Set(), out = [];
  const make = (members) => {
    const rows = members.map((it) => ({ it, ...groupLines(ctx, K, it) })), bw = Math.max(...rows.map((r) => r.w)) + 30 * u, bh = 12 * u + rows.reduce((s, r) => s + r.h, 0) + (rows.length - 1) * 8 * u + 2 * u;
    const s = [members.reduce((a, m) => a + m.s[0], 0) / members.length, members.reduce((a, m) => a + m.s[1], 0) / members.length, 0];
    return { group: true, rows, members, rank: Math.min(...members.map((m) => m.rank)), s, M: { bw, bh, leader: [] } };
  };
  (t.groups || []).forEach((ids) => { const ms = items.filter((it) => ids.includes(it.c.h.id) && !used.has(it)); if (ms.length >= 2) { ms.forEach((m) => used.add(m)); out.push(make(ms)); } });
  const rest = items.filter((it) => !used.has(it));
  if (t.autoGroup) clusters(rest.map((it) => it.s), (t.groupRadius || 140) * u).forEach((cl) => { if (cl.length >= 2) { const ms = cl.map((i) => rest[i]); ms.forEach((m) => used.add(m)); out.push(make(ms)); } });
  return items.filter((it) => !used.has(it)).concat(out).sort((a, b) => a.s[1] - b.s[1]);
}
export function drawGroup(ctx, K, x, y, g) {
  const { u, font } = K, S = H.S, { bw, bh } = g.M; g.M.leader = [];
  let yy = y + 10 * u; const targets = [];
  g.rows.forEach((r, k) => { targets.push({ y: yy + 11 * u, s: r.it.s, k }); r.y = yy; yy += r.h + 8 * u; });
  // Leaders first, so the box sits over their starts.
  const x0 = x + bw;
  targets.forEach(({ y: ty, s, k }) => {
    const xm = Math.max(x0 + 14 * u + k * 7 * u, Math.min(s[0] - 26 * u, x0 + 56 * u + k * 7 * u));
    ctx.strokeStyle = S.primary; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(xm, ty); ctx.lineTo(s[0], s[1]); ctx.stroke();
    g.M.leader.push([x0, ty, xm, ty], [xm, ty, s[0], s[1]]);
    ctx.beginPath(); ctx.arc(s[0], s[1], 3.4 * u, 0, Math.PI * 2); ctx.fillStyle = S.primary; ctx.fill(); ctx.lineWidth = 1.1 * u; ctx.strokeStyle = '#fff'; ctx.stroke();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, x, y, bw, bh, 4 * u); ctx.fill(); ctx.stroke();
  ctx.fillStyle = S.accent; ctx.fillRect(x + 7 * u, y + 7 * u, 4 * u, bh - 14 * u);
  g.rows.forEach((r, k) => {
    const tx = x + 18 * u; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    font(600, 11, true); ctx.fillStyle = S.primary; ctx.fillRect(tx, r.y + 2.5 * u, r.chip, 17 * u); ctx.fillStyle = H.textOn(S.primary); ctx.fillText(r.it.c.h.id, tx + 6 * u, r.y + 11.5 * u);
    const lx = tx + r.chip + 8 * u; font(700, 14); ctx.fillStyle = H.INK; ctx.fillText(r.L.l1, lx, r.y + 11.5 * u);
    if (r.L.l1b) { font('italic 400', 12.5); ctx.fillStyle = H.MUTED; ctx.fillText(r.L.l1b, lx + r.w1, r.y + 11.5 * u); }
    if (r.L.l2) { font(600, 13); ctx.fillStyle = H.INK; ctx.fillText(r.L.l2, lx, r.y + 30 * u); }
    if (k < g.rows.length - 1) { ctx.strokeStyle = H.RULE; ctx.lineWidth = 0.8 * u; ctx.beginPath(); ctx.moveTo(tx, r.y + r.h + 4 * u); ctx.lineTo(x + bw - 10 * u, r.y + r.h + 4 * u); ctx.stroke(); }
  });
  ctx.textBaseline = 'alphabetic';
}

// ---------- stat boxes (kept in S.labels as kind "stat", so they drag like labels) ----------
export function statSize(ctx, K, L) {
  const { u, font } = K; font(700, 13.5); let w = ctx.measureText(String(L.text).toUpperCase()).width + 1.2 * u * String(L.text).length;
  font(400, 14.5); (L.rows || []).forEach((r) => { w = Math.max(w, ctx.measureText(r).width + 8 * u); });
  return { bw: w + 32 * u, bh: 14 * u + 18 * u + (L.rows || []).length * 21 * u + 8 * u };
}
export function drawStat(ctx, K, L, Wf, Hf) {
  const { u, font } = K, S = H.S, { bw, bh } = statSize(ctx, K, L), x = L.x * Wf - bw / 2, y = L.y * Hf - bh / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, x, y, bw, bh, 5 * u); ctx.fill(); ctx.stroke();
  ctx.fillStyle = S.accent; ctx.fillRect(x, y + 6 * u, 4 * u, bh - 12 * u);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; font(700, 13.5); if ('letterSpacing' in ctx) ctx.letterSpacing = `${1.2 * u}px`;
  ctx.fillStyle = S.primary; ctx.fillText(String(L.text).toUpperCase(), x + 16 * u, y + 14 * u + 7 * u); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  let yy = y + 14 * u + 18 * u + 10.5 * u;
  (L.rows || []).forEach((r) => {
    const m = String(r).match(/^([^:]{1,40}):\s*(.*)$/);
    if (m) { font(700, 14.5); ctx.fillStyle = H.INK; ctx.fillText(`${m[1]}:`, x + 16 * u, yy); const w = ctx.measureText(`${m[1]}: `).width; font(400, 14.5); ctx.fillText(m[2], x + 16 * u + w, yy); }
    else { font(400, 14.5); ctx.fillStyle = H.INK; ctx.fillText(r, x + 16 * u, yy); }
    yy += 21 * u;
  });
  ctx.textBaseline = 'alphabetic';
  return [x, y, x + bw, y + bh];
}

// ---------- grade histogram bars along holes ----------
const hist = { G: null, mesh: null };
export function placeHistograms() {
  const G = H.G, S = H.S;
  if (!G || !S.histograms || !S.valueCol) { if (hist.mesh) hist.mesh.visible = false; return; }
  if (hist.G !== G || !hist.mesh) {
    const cap = Math.max(1, H.project.holes.reduce((s, h) => s + h.ints.length, 0));
    hist.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), cap);
    hist.mesh.frustumCulled = false; hist.mesh.renderOrder = 2; H.root.add(hist.mesh); hist.G = G;
  }
  const cam = H.camera; cam.updateMatrixWorld();
  const view = cam.getWorldDirection(new THREE.Vector3()), right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const vals = []; H.project.holes.forEach((h) => h.ints.forEach((it) => { const v = it.vals[S.valueCol]; if (Number.isFinite(v)) vals.push(v); }));
  vals.sort((a, b) => a - b); const vmax = Math.max(S.bins[3] * 1.5, vals[Math.floor(0.98 * (vals.length - 1))] || 1);
  const r = H.traceR(), off = 2.4 * r, Lmax = G.diag * 0.1, mx = new THREE.Matrix4(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), col = new THREE.Color(), white = new THREE.Color('#ffffff');
  let n = 0;
  H.project.holes.forEach((h) => h.ints.forEach((it) => {
    const v = it.vals[S.valueCol], bi = H.binIndex(v); if (!(bi >= 1) || (S.displayCutoff !== null && S.displayCutoff !== undefined && v < S.displayCutoff)) return;
    const a = h.posAt(it.from), b = h.posAt(it.to), va = G.V(a.x, a.y, a.z), vb = G.V(b.x, b.y, b.z), dir = vb.clone().sub(va), len = dir.length(); if (len < 1e-6) return; dir.divideScalar(len);
    side.crossVectors(dir, view); if (side.lengthSq() < 1e-8) side.copy(right); side.normalize(); if (side.dot(right) > 0) side.negate(); // screen-left of the trace
    nrm.crossVectors(side, dir).normalize(); if (nrm.dot(view) > 0) nrm.negate();
    const L = Math.max(r, Lmax * Math.min(1, v / vmax)), c = va.add(vb).multiplyScalar(0.5).addScaledVector(side, off + L / 2);
    mx.makeBasis(side.clone().multiplyScalar(L), dir.clone().multiplyScalar(len * 0.98), nrm).setPosition(c);
    hist.mesh.setMatrixAt(n, mx); col.set(H.BIN_COLORS[bi]); if (fade(h)) col.lerp(white, 0.55); hist.mesh.setColorAt(n, col); n++;
  }));
  hist.mesh.count = n; hist.mesh.visible = true; hist.mesh.instanceMatrix.needsUpdate = true; if (hist.mesh.instanceColor) hist.mesh.instanceColor.needsUpdate = true;
}

// ---------- location inset: satellite or topographic tiles around the property ----------
const TOPO_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
export const TOPO_CREDIT = 'Basemap: Esri';
const inset = { key: null, canvas: null, status: 'off', message: '', promise: null, frame: null };
export function syncInset() {
  const S = H.S, G = H.G, geo = H.geo();
  if (S.insetStyle === 'plan' || !G || !geo) { inset.status = S.insetStyle === 'plan' ? 'off' : 'needs-crs'; inset.message = S.insetStyle !== 'plan' && !geo ? 'A map inset needs the coordinate system (step 1).' : ''; return Promise.resolve(); }
  const key = `${S.insetStyle}|${S.crs}|${[G.B.x0, G.B.x1, G.B.y0, G.B.y1].map(Math.round)}`;
  if (inset.key === key) return inset.promise || Promise.resolve();
  inset.key = key; inset.canvas = null; inset.status = 'loading';
  inset.promise = (async () => {
    try {
      const half = Math.max(2000, 3.5 * Math.max(G.bw, G.bh)), cx = (G.B.x0 + G.B.x1) / 2, cy = (G.B.y0 + G.B.y1) / 2;
      const corners = [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]].map(([x, y]) => geo.fwd(x, y));
      const bb = { w: Math.min(...corners.map((c) => c[0])), e: Math.max(...corners.map((c) => c[0])), s: Math.min(...corners.map((c) => c[1])), n: Math.max(...corners.map((c) => c[1])) };
      const M = await H.mosaic(S.insetStyle === 'topo' ? TOPO_URL : H.IMG_URL, bb, H.zoomFor(bb, 640, 16));
      if (inset.key !== key) return;
      const src = document.createElement('canvas'); src.width = M.w; src.height = M.h; src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(M.data), M.w, M.h), 0, 0);
      const px = (lon, lat) => [(H.lon2t(lon, M.z) - M.x0) * 256, (H.lat2t(lat, M.z) - M.y0) * 256];
      // A square, north-up crop centred on the block.
      const [mx, my] = px(...geo.fwd(cx, cy)), e1 = px(...geo.fwd(cx + half, cy)), r = Math.hypot(e1[0] - mx, e1[1] - my), out = document.createElement('canvas'); out.width = out.height = 512;
      out.getContext('2d').drawImage(src, mx - r, my - r, 2 * r, 2 * r, 0, 0, 512, 512);
      inset.canvas = out; inset.frame = { toInset: (x, y) => { const [a, b] = px(...geo.fwd(x, y)); return [(a - (mx - r)) / (2 * r), (b - (my - r)) / (2 * r)]; }, half };
      inset.status = 'ready'; inset.message = `Inset: ${S.insetStyle === 'topo' ? 'topographic map' : 'satellite imagery'} (z${M.z}, ${M.ok}/${M.total} tiles).`;
    } catch (e) { if (inset.key === key) { inset.status = 'failed'; inset.message = `The map inset could not load (${e.message}); showing the plan of drilling.`; } }
    H.redraw();
  })();
  return inset.promise;
}
export const insetCredits = () => (H.S.inset && inset.status === 'ready' && inset.canvas ? [H.S.insetStyle === 'topo' ? TOPO_CREDIT : H.IMAGERY_CREDIT] : []);
// Draws the map inset under the logo; false when it is not ready (the plan inset is drawn instead).
export function drawInset(ctx, K, { W, top, occ }) {
  const S = H.S; if (!S.inset || S.insetStyle === 'plan' || inset.status !== 'ready' || !inset.canvas) return false;
  const { u, m, font, narrow } = K, iw = (narrow ? 130 : 168) * u, ix = W - m - iw, iy = top;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, ix - 6 * u, iy - 6 * u, iw + 12 * u, iw + 30 * u, 5 * u); ctx.fill(); ctx.stroke();
  occ.push([ix - 8 * u, 0, W, iy + iw + 26 * u]);
  ctx.drawImage(inset.canvas, ix, iy, iw, iw);
  const P = (x, y) => { const [a, b] = inset.frame.toInset(x, y); return [ix + a * iw, iy + b * iw]; }, G = H.G;
  ctx.beginPath(); [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]].forEach(([x, y], i) => { const p = P(x, y); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }); ctx.closePath();
  ctx.lineWidth = 3.2 * u; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke(); ctx.lineWidth = 1.6 * u; ctx.strokeStyle = S.accent; ctx.stroke();
  // North arrow (the inset is north-up) and a scale bar.
  const nx = ix + iw - 16 * u, ny = iy + 22 * u;
  ctx.beginPath(); ctx.moveTo(nx, ny - 13 * u); ctx.lineTo(nx + 6 * u, ny + 5 * u); ctx.lineTo(nx, ny + 2 * u); ctx.lineTo(nx - 6 * u, ny + 5 * u); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = H.INK; ctx.lineWidth = u; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(nx, ny - 13 * u); ctx.lineTo(nx + 6 * u, ny + 5 * u); ctx.lineTo(nx, ny + 2 * u); ctx.closePath(); ctx.fillStyle = H.INK; ctx.fill();
  font(700, 10); ctx.textAlign = 'center'; ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText('N', nx, ny + 15 * u); ctx.fillStyle = H.INK; ctx.fillText('N', nx, ny + 15 * u);
  const metres = [500, 1000, 2000, 5000, 10000].find((d) => d / (2 * inset.frame.half) * iw >= 34 * u) || 10000, bl = metres / (2 * inset.frame.half) * iw, bx = ix + 8 * u, by = iy + iw - 10 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(bx - 4 * u, by - 14 * u, bl + 8 * u, 20 * u); ctx.fillStyle = H.INK; ctx.fillRect(bx, by, bl, 3 * u);
  font(500, 9.5, true); ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, bx + bl / 2, by - 4 * u);
  font(400, 11); ctx.fillStyle = H.MUTED; ctx.fillText('Location of the model', ix + iw / 2, iy + iw + 16 * u); ctx.textAlign = 'left';
  return true;
}

// ---------- state, API, panel ----------
export function state() {
  const t = T(), ok = !!H.project?.holes, st = ok ? statuses() : null;
  return { ...structuredClone(t), holeStatus: ok ? Object.fromEntries(H.project.holes.map((h) => [h.id, st.status.get(h.id) || null])) : {}, newestYear: st?.newestYear ?? null,
    statBoxes: H.S.labels.filter((l) => l.kind === 'stat').map((l) => l.id), histograms: H.S.histograms, insetStyle: H.S.insetStyle, inset: { status: inset.status, message: inset.message || null } };
}
export function set(o = {}) {
  const t = T();
  if (o.at !== undefined) { if (!['toe', 'collar', 'both'].includes(o.at)) throw new Error('at must be "collar" (pills at the collar), "toe" (IDs at the end of the hole) or "both".'); t.at = o.at; }
  if (o.style !== undefined) { if (!['dark', 'light'].includes(o.style)) throw new Error('style must be "dark" (filled pills, white text) or "light" (white pills, coloured text).'); t.style = o.style; }
  if (o.fadePrevious !== undefined) t.fadePrevious = !!o.fadePrevious;
  if (o.autoGroup !== undefined) t.autoGroup = !!o.autoGroup;
  if (o.groupRadius !== undefined) t.groupRadius = Math.max(30, Math.min(600, +o.groupRadius || 140));
  ['newLabel', 'prevLabel', 'plannedLabel'].forEach((k) => { if (o[k] !== undefined) t[k] = o[k] === null ? '' : String(o[k]).slice(0, 60); });
  if (o.status !== undefined) {
    if (!o.status || typeof o.status !== 'object') throw new Error('status must be { holeId: "new" | "previous" | "planned" | "none" | null }.');
    const ids = new Set((H.project?.holes || []).map((h) => h.id));
    Object.entries(o.status).forEach(([id, v]) => {
      if (!ids.has(id)) throw new Error(`No hole "${id}".`);
      if (v === null || v === 'auto') delete t.status[id]; else if (['new', 'previous', 'planned', 'none'].includes(v)) t.status[id] = v; else throw new Error('A hole status must be "new", "previous", "planned", "none", or null for automatic.');
    });
  }
}
export function renderUI(el) {
  const t = T(), esc = H.esc, hs = H.project?.holes || [], st = hs.length ? statuses() : null;
  el.innerHTML = `<div class="grid2">
      <label class="field"><span>Pill style</span><select data-t="style"><option value="dark" ${t.style !== 'light' ? 'selected' : ''}>Filled, white text</option><option value="light" ${t.style === 'light' ? 'selected' : ''}>White, coloured text</option></select></label>
      <label class="field"><span>"New" legend row</span><input type="text" data-t="newLabel" value="${esc(t.newLabel)}" placeholder="${st?.newestYear ? `${st.newestYear} results` : 'New results'}"></label>
      <label class="field"><span>"Previous" legend row</span><input type="text" data-t="prevLabel" value="${esc(t.prevLabel)}"></label>
      <label class="field"><span>"Planned" legend row</span><input type="text" data-t="plannedLabel" value="${esc(t.plannedLabel)}"></label>
    </div>
    <div class="row" style="gap:14px;margin-top:6px"><label class="check"><input type="checkbox" data-t="fadePrevious" ${t.fadePrevious ? 'checked' : ''}>Fade previously released holes</label>
      <label class="check"><input type="checkbox" data-t="autoGroup" ${t.autoGroup ? 'checked' : ''}>Group nearby intercept callouts</label>
      ${(t.groups || []).length ? '<button class="btn" type="button" data-tx="groups">Clear callout groups</button>' : ''}</div>
    ${hs.length ? `<details style="margin-top:6px"><summary>Hole status (new, previous, planned)</summary><p class="muted">Read from the collar status, year or campaign columns; change any here.</p>
      <div class="files">${hs.map((h) => `<label class="field" style="grid-template-columns:1fr auto;display:grid;align-items:center;gap:6px"><span class="mono">${esc(h.id)}</span><select data-ts="${esc(h.id)}">${['auto', 'new', 'previous', 'planned', 'none'].map((v) => `<option value="${v}" ${(t.status[h.id] || 'auto') === v ? 'selected' : ''}>${v === 'auto' ? `Auto (${st.status.get(h.id) || 'none'})` : v}</option>`).join('')}</select></label>`).join('')}</div></details>` : ''}`;
  const apply = (o) => H.api.setTags(o).catch((e) => H.status(e.message));
  el.querySelectorAll('[data-t]').forEach((i) => i.addEventListener('change', () => apply({ [i.dataset.t]: i.type === 'checkbox' ? i.checked : i.value })));
  el.querySelectorAll('[data-ts]').forEach((s) => s.addEventListener('change', () => apply({ status: { [s.dataset.ts]: s.value === 'auto' ? null : s.value } })));
  el.querySelector('[data-tx="groups"]')?.addEventListener('click', () => H.api.groupCallouts(null));
}
