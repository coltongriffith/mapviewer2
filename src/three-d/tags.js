// Hole tags and callouts in the agency style: collar ID pills (new vs previously released), grouped
// intercept boxes, free-form stat boxes, grade histogram bars along holes, and a real-map location
// inset. Loaded on first use by studio.js (EXT hook).
import * as THREE from 'three';
import { overlapArea } from './layout.js';
import { placePills } from './leaders.js';
import { uses } from './design-version.js';

export { placePills };

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
  return { status: out, newestYear: ys.length > 1 ? Math.max(...ys) : null, years: year };
}
// Single-linkage clusters of screen points closer than r. Returns arrays of indices (singletons included).
export function clusters(pts, r) {
  const parent = pts.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(...pts[i].map((v, k) => v - pts[j][k])) < r) parent[find(i)] = find(j);
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
// Hole display. emphasis "key": key holes bold, the others thin and grey; "auto" does so past 12 holes, so a
// dense figure reads with no setup. highlight: a hole's own trace colour ("brand": the brand accent).
// The holes on the figure (S.holesShown, block.js: null for all), which "auto" counts.
const holeOn = (h) => !H.S.holesShown || H.S.holesShown.includes(h.id);
const nShown = () => (H.project?.holes || []).filter(holeOn).length;
const emph = () => (T().emphasis === 'auto' || T().emphasis === undefined ? (nShown() > 12 ? 'key' : 'none') : T().emphasis);
export const fade = (h) => (!!T().fadePrevious && statusOf(h) === 'previous') || (emph() === 'key' && !keyHole(h));
export const weight = (h) => (emph() !== 'key' ? 1 : keyHole(h) ? 1.25 : 0.55);
export function highlightOf(h) {
  const v = T().highlight?.[h.id]; if (v) return v === 'brand' ? H.brandTone('highlight') : v;
  return T().highlightNew !== false && emph() === 'key' && statusOf(h) === 'new' ? H.brandTone('highlight') : null; // new holes in the brand accent
}
// Highlighted traces as thin tubes along the whole hole, rebuilt when the holes or colours change.
// Thin cylinders every 8 m (one instanced mesh, like the assay tubes), so no extra three.js code ships.
const hl = { key: null, mesh: null };
export function syncHoles() {
  const G = H.G, list = G ? H.project.holes.filter(holeOn).map((h) => [h, highlightOf(h)]).filter(([, c]) => c) : [], key = `${list.map(([h, c]) => h.id + c).join()}|${H.S.traceWidth}`;
  if (hl.G === G && hl.key === key) return;
  if (hl.mesh) { hl.mesh.parent?.remove(hl.mesh); hl.mesh.geometry.dispose(); hl.mesh.material.dispose(); hl.mesh = null; }
  hl.G = G; hl.key = key; if (!list.length) return;
  const segs = []; list.forEach(([h, c]) => { for (let d = 0; d < h.len; d += 8) segs.push([h, d, Math.min(h.len, d + 8), c]); });
  const m = hl.mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial(), segs.length), r = H.traceR() * 0.5;
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  segs.forEach(([h, a, b, c], i) => {
    const p = h.posAt(a), e = h.posAt(b), va = G.V(p.x, p.y, p.z), vb = G.V(e.x, e.y, e.z), dir = vb.clone().sub(va), len = dir.length();
    q.setFromUnitVectors(up, dir.normalize()); mx.compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r)); m.setMatrixAt(i, mx); m.setColorAt(i, col.set(c));
  });
  m.frustumCulled = false; H.root.add(m);
}
const GREY = '#8b979b';
function pillColors(st) {
  const S = H.S, dark = T().style !== 'light', c = st === 'new' ? S.accent : st === 'previous' ? GREY : S.primary;
  if (st === 'planned') return { fill: '#ffffff', text: S.primary, line: S.primary, dash: true };
  return dark ? { fill: c, text: H.textOn(c), line: c } : { fill: '#ffffff', text: st === 'previous' ? '#5f6e72' : st === 'new' ? S.accent : H.INK, line: c };
}
// Key holes: the callout holes, the new and planned holes, and any given a status by hand. "auto" picks
// all holes up to 12 and key holes beyond, so a dense figure is clean with no setup.
const keyHole = (h) => ['new', 'planned'].includes(statusOf(h)) || ['new', 'previous', 'planned'].includes(T().status[h.id]) || H.shownCallouts().some((c) => c.h === h);
const mode = () => (T().idMode === 'auto' || !T().idMode ? (nShown() > 12 ? 'key' : 'all') : T().idMode);
// Which holes carry an ID (at the end of the hole): a per-hole choice, else all or the key holes.
export function idShown(h) {
  if (!holeOn(h)) return false;
  const v = T().showId?.[h.id]; if (typeof v === 'boolean') return v;
  return mode() !== 'key' || keyHole(h);
}
// Which holes carry a pill (tag) at the collar, separately from the ID: a per-hole choice, else (with pills
// at the collar) the holes with a status (all holes when none has one), or the key holes. Status "none" means
// no pill.
export function tagShown(h) {
  if (!holeOn(h)) return false;
  const t = T(), v = t.showTag?.[h.id]; if (typeof v === 'boolean') return v;
  if (t.at === 'toe' || t.status[h.id] === 'none') return false;
  if (!uses(H.S, 'holeTags')) return idShown(h); // version 1 figures: a pill on every hole with an ID
  return mode() === 'key' ? keyHole(h) : statusOf(h) !== null || ![...statuses().status.values()].some(Boolean);
}
// Collar pills and small "ASSAYS PENDING" tags, placed before the legends (which keep clear of them): the
// pending tags first, then the pills by priority, the lowest dropped rather than drawn over another.
let drawn = new Set(); // statuses of the pills drawn last, for the legend rows
export function drawPills(ctx, K, opts) {
  const pend = H.S.pendingLabels && T().pending === 'collar' ? placePending(ctx, K, opts) : null;
  drawIdPills(ctx, K, opts);
  pend?.(); // drawn last, so no pill's leader crosses a pending tag
}
function drawIdPills(ctx, K, { placed, occ, W, H: Hh }) {
  const { u, font } = K; font(700, 12.5); drawn = new Set();
  const items = H.project.holes.filter(tagShown).map((h) => {
    const s = H.proj(H.G.V(h.c.x, h.c.y, h.c.z)); if (s[2] > 1) return null;
    const st = statusOf(h), pri = st === 'new' ? 0 : st === 'planned' ? 2 : st === 'previous' ? 3 : 1;
    return { hole: h, st, pri, x: s[0], y: s[1] - 4 * u, w: ctx.measureText(h.id).width + 14 * u, h: 20 * u };
  }).filter(Boolean).sort((a, b) => a.pri - b.pri || a.x - b.x);
  const collars = H.project.holes.map((h) => { const s = H.proj(H.G.V(h.c.x, h.c.y, h.c.z)); return [s[0] - 6 * u, s[1] - 6 * u, s[0] + 6 * u, s[1] + 6 * u]; });
  const res = placePills(items, [...placed, ...occ.filter((b) => b[3] - b[1] < Hh * 0.5), ...collars, ...(clear() ? bracketBoxes(H.shownCallouts(), u) : [])], { W, H: Hh, unit: u, pad: 3 * u, drop: true, leaders: clear() && 'far' });
  res.forEach((p) => drawn.add(p.st));
  // Leaders first, then every pill, so no leader crosses a pill.
  res.forEach((p) => {
    const c = pillColors(p.st), x = p.cx - p.w / 2, y = p.cy - p.h / 2;
    if (p.leader) {
      const ex = Math.max(x, Math.min(x + p.w, p.x)), ey = p.y + 4 * u < y ? y : p.y + 4 * u > y + p.h ? y + p.h : p.cy;
      ctx.lineCap = 'round'; ctx.strokeStyle = H.paper(0.9); ctx.lineWidth = 3.4 * u; ctx.beginPath(); ctx.moveTo(p.x, p.y + 4 * u); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = c.line; ctx.lineWidth = 1.3 * u; ctx.stroke(); ctx.lineCap = 'butt';
    }
  });
  const plain = T().style === 'plain'; // the block section's IDs: bold text with a white halo, no pill
  res.forEach((p) => {
    const c = pillColors(p.st), x = p.cx - p.w / 2, y = p.cy - p.h / 2;
    if (plain) {
      font(800, 14); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 4 * u; ctx.strokeStyle = H.paper(0.92); ctx.strokeText(p.hole.id, p.cx, p.cy + 0.6 * u);
      ctx.fillStyle = p.st === 'new' ? H.S.accent : H.INK; ctx.fillText(p.hole.id, p.cx, p.cy + 0.6 * u); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; placed.push(p.box); occ.push(p.box); return;
    }
    H.roundRect(ctx, x, y, p.w, p.h, p.h / 2); ctx.fillStyle = c.fill; ctx.fill();
    ctx.lineWidth = (c.fill === '#ffffff' ? 1.5 : 1) * u; ctx.strokeStyle = c.fill === '#ffffff' ? c.line : 'rgba(255,255,255,0.85)'; if (c.dash) ctx.setLineDash([3 * u, 2 * u]); ctx.stroke(); ctx.setLineDash([]);
    font(700, 12.5); ctx.fillStyle = c.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.hole.id, p.cx, p.cy + 0.6 * u);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    placed.push(p.box); occ.push(p.box);
  });
}
// One tag per group of pending collars within groupRadius metres (in plan) of each other, such as
// "2026 · ASSAYS PENDING" when they share a year, with a short leader to each collar.
export const pendingGroups = (pts, radius) => clusters(pts, radius);
function placePending(ctx, K, { placed, occ, W, H: Hh }) {
  const { u, font } = K, hs = H.project.holes.filter(H.isPending).map((h) => ({ h, s: H.proj(H.G.V(h.c.x, h.c.y, h.c.z)) })).filter((p) => p.s[2] < 1);
  if (!hs.length) return null;
  font(700, 9.5); H.setSpacing(ctx, 1.1 * u); const hh = 16 * u, years = statuses().years, v2 = uses(H.S, 'holeTags');
  // Version 1 figures: groups 70 px apart on screen, the plain text, under the collars.
  const groups = (v2 ? pendingGroups(hs.map((p) => [p.h.c.x, p.h.c.y]), T().groupRadius || 140) : clusters(hs.map((p) => p.s.slice(0, 2)), 70 * u)).map((g) => g.map((i) => hs[i]));
  const items = groups.map((g) => {
    const ys = new Set(g.map((p) => years.get(p.h.id))), t = `${v2 && ys.size === 1 && [...ys][0] ? `${[...ys][0]} · ` : ''}ASSAYS PENDING`;
    return { g, t, x: g.reduce((a, p) => a + p.s[0], 0) / g.length, y: Math.min(...g.map((p) => p.s[1])) + (v2 ? -6 : 14) * u, w: ctx.measureText(t).width + 14 * u, h: hh };
  });
  const res = placePills(items, [...placed, ...occ.filter((b) => b[3] - b[1] < Hh * 0.5)], { W, H: Hh, unit: u, pad: 3 * u, leaders: clear() && 'all' });
  res.forEach((p) => { placed.push(p.box); occ.push(p.box); });
  return () => res.forEach((p) => {
    font(700, 9.5); H.setSpacing(ctx, 1.1 * u);
    const w = p.w, [x0, y0, x1, y1] = [p.cx - w / 2, p.cy - hh / 2, p.cx + w / 2, p.cy + hh / 2];
    ctx.strokeStyle = H.S.accent; ctx.lineWidth = 0.9 * u; ctx.setLineDash([2 * u, 2 * u]);
    p.g.forEach(({ s }) => { const ex = Math.max(x0, Math.min(x1, s[0])), ey = Math.max(y0, Math.min(y1, s[1])); if (Math.hypot(s[0] - ex, s[1] - ey) > 4 * u) { ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(ex, ey); ctx.stroke(); } });
    ctx.setLineDash([]);
    H.roundRect(ctx, x0, y0, w, hh, hh / 2); ctx.fillStyle = H.paper(0.96); ctx.fill(); ctx.lineWidth = u; ctx.stroke();
    ctx.fillStyle = H.S.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.t, p.cx + 0.5 * u, p.cy + 0.6 * u);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; H.setSpacing(ctx, 0);
  });
}
// Legend rows for the statuses of the pills actually drawn (and faded previous holes), less any hidden
// with hideRows: [{ label, draw(ctx, x, cy, u) }].
export function legendRows() {
  const st = statuses(), used = new Set(drawn), hide = new Set(T().hideRows || []);
  if (T().fadePrevious && H.project.holes.some(fade)) used.add('previous');
  hide.forEach((k) => used.delete(k));
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
  const at = (it) => { const p = it.c.h.posAt(it.c.ic.broad.mid); return [p.x, p.y, p.z]; }, v2 = uses(H.S, 'holeTags'); // groupRadius is in metres (version 1: screen px)
  if (t.autoGroup) clusters(v2 ? rest.map(at) : rest.map((it) => it.s.slice(0, 2)), (t.groupRadius || 140) * (v2 ? 1 : u)).forEach((cl) => { if (cl.length >= 2) { const ms = cl.map((i) => rest[i]); ms.forEach((m) => used.add(m)); out.push(make(ms)); } });
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
    ctx.strokeStyle = H.pri(); ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(xm, ty); ctx.lineTo(s[0], s[1]); ctx.stroke();
    g.M.leader.push([x0, ty, xm, ty], [xm, ty, s[0], s[1]]);
    ctx.beginPath(); ctx.arc(s[0], s[1], 3.4 * u, 0, Math.PI * 2); ctx.fillStyle = H.pri(); ctx.fill(); ctx.lineWidth = 1.1 * u; ctx.strokeStyle = '#fff'; ctx.stroke();
  });
  ctx.fillStyle = H.paper(0.97); ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, x, y, bw, bh, 4 * u); ctx.fill(); ctx.stroke();
  ctx.fillStyle = S.accent; ctx.fillRect(x + 7 * u, y + 7 * u, 4 * u, bh - 14 * u);
  g.rows.forEach((r, k) => {
    const tx = x + 18 * u; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    font(600, 11, true); ctx.fillStyle = H.pri(); ctx.fillRect(tx, r.y + 2.5 * u, r.chip, 17 * u); ctx.fillStyle = H.textOn(H.pri()); ctx.fillText(r.it.c.h.id, tx + 6 * u, r.y + 11.5 * u);
    const lx = tx + r.chip + 8 * u; font(700, 14); ctx.fillStyle = H.INK; ctx.fillText(r.L.l1, lx, r.y + 11.5 * u);
    if (r.L.l1b) { font('italic 400', 12.5); ctx.fillStyle = H.MUTED; ctx.fillText(r.L.l1b, lx + r.w1, r.y + 11.5 * u); }
    if (r.L.l2) { font(600, 13); ctx.fillStyle = H.INK; ctx.fillText(r.L.l2, lx, r.y + 30 * u); }
    if (k < g.rows.length - 1) { ctx.strokeStyle = H.RULE; ctx.lineWidth = 0.8 * u; ctx.beginPath(); ctx.moveTo(tx, r.y + r.h + 4 * u); ctx.lineTo(x + bw - 10 * u, r.y + r.h + 4 * u); ctx.stroke(); }
  });
  ctx.textBaseline = 'alphabetic';
}

// EM3D.groupCallouts: the given holes' callouts as one box (ticked on), "auto" for nearby ones, null to clear.
// callouts: the figure's candidates, every hole with an intercept.
export function group(ids, callouts) {
  const t = H.S.tags, has = (id) => callouts.some((c) => c.h.id === id);
  if (ids === null || (Array.isArray(ids) && !ids.length)) { t.groups = []; return; }
  if (ids === 'auto') { t.autoGroup = true; return; }
  if (!Array.isArray(ids) || ids.length < 2) throw new Error('groupCallouts takes two or more hole IDs, "auto" (group nearby callouts), or null to clear the groups.');
  const known = new Set((H.project?.holes || []).map((h) => h.id)), bad = ids.filter((id) => !known.has(id)); if (bad.length) throw new Error(`No hole ${bad.map((b) => `"${b}"`).join(', ')}.`);
  const none = ids.filter((id) => !has(id)); if (none.length) H.status(`${none.join(', ')} ${none.length > 1 ? 'have' : 'has'} no interval above the broad cut-off, so no callout to group.`);
  t.groups = t.groups.map((g) => g.filter((id) => !ids.includes(id))).filter((g) => g.length > 1).concat([[...new Set(ids)]]);
  ids.forEach((id) => { if (has(id)) H.S.coOverrides[id] = { ...(H.S.coOverrides[id] || {}), show: true }; });
}

// ---------- callouts off the column: beside the hole, as a bracket on it, or where dragged ----------
// The callouts whose placement (per hole, else S.coPlacement) is not the left column, or which were
// dragged (x, y in 0-1 of the frame), apart from the column's: { col, free }. The page draws the column
// first, then drawFree places these clear of it and of its leaders.
const placementOf = (it) => { const o = it.c ? H.coOv(it.c) : {}; // per hole, or per result in published mode
  return Number.isFinite(o.x) && Number.isFinite(o.y) ? 'free' : it.group ? 'column' : o.placement || H.S.coPlacement || 'column'; };
export const splitCallouts = (items) => ({ col: items.filter((it) => placementOf(it) === 'column'), free: items.filter((it) => placementOf(it) !== 'column') });
export function drawFree(ctx, K, items, { lay, W, H: Hh, hits }) {
  const { u } = K, cl = clear();
  // The brackets' lines first, so a box set beside its hole keeps off them; then the brackets (they sit on
  // their hole), so the boxes beside a hole keep clear of their text.
  if (cl) bracketBoxes(items.map((it) => it.c), u).forEach((b) => lay.add(b));
  (cl ? items.slice().sort((a, b) => (placementOf(b) === 'bracket') - (placementOf(a) === 'bracket')) : items).forEach((it) => {
    const o = H.coOv(it.c), free = placementOf(it) === 'free';
    if (placementOf(it) === 'bracket') { hits.push({ kind: 'callout', id: it.c.key, box: drawBracket(ctx, K, it, lay) }); return; }
    const { M, s } = it, tag = 18 * u, at = (x, y) => [x, y, x + M.bw, y + M.bh + tag];
    const cands = free ? [at(Math.min(o.x * W, W - M.bw), Math.min(o.y * Hh, Hh - M.bh - tag))]
      : [[1, -0.5], [-1, -0.5], [1, -1.4], [-1, -1.4], [1, 0.4], [-1, 0.4], [1.8, -0.5], [-1.8, -0.5], ...(cl ? [[1, 1.4], [-1, 1.4], [1, -2.4], [-1, -2.4], [3, -0.5], [-3, -0.5], [3, 0.8], [-3, 0.8], [3, -1.8], [-3, -1.8]] : [])].map(([sx, sy]) => at(sx > 0 ? s[0] + 40 * u * sx : s[0] + 40 * u * sx - M.bw, s[1] + sy * M.bh));
    // With no clear spot, the one overlapping least (leaders, brackets and arrows included).
    const fit = cands.filter((b) => b[0] >= 0 && b[1] >= 0 && b[2] <= W && b[3] <= Hh), least = () => (fit.length ? fit : cands).reduce((a, b) => { const on = (x) => lay.boxes.reduce((t, o) => t + overlapArea(x, o), 0); return on(b) < on(a) ? b : a; });
    const box = free ? lay.add(cands[0]) : lay.place(cands, Infinity) || lay.add(cl ? least() : cands[0]);
    H.drawCallout(ctx, K, box[0], box[1], it.c, M, s); hits.push({ kind: 'callout', id: it.c.key, box });
  });
}
// Small boxes along each bracket's line (callouts drawn as a bracket on their hole): the pills and the boxes
// beside a hole keep off them.
const clear = () => uses(H.S, 'clearLeaders'); // round 5's layout rules, for figures of version 3 on
function bracketBoxes(cs, u) {
  return cs.filter((c) => placementOf({ c }) === 'bracket').flatMap((c) => Array.from({ length: 9 }, (_, k) => {
    const p = c.h.posAt(c.ic.broad.from + c.ic.broad.len * k / 8), q = H.proj(H.G.V(p.x, p.y, p.z)); return [q[0] - 12 * u, q[1] - 4 * u, q[0] + 12 * u, q[1] + 4 * u];
  }));
}
// A bracket along the reported interval, a hair to the side of the hole, with the hole ID and the grade
// text beside it (the side with room).
function drawBracket(ctx, K, it, lay) {
  if (H.S.block?.brackets === 'plain') return plainBracket(ctx, K, it, lay);
  const { u, font } = K, c = it.c, b = c.ic.broad, L = H.calloutLines(c);
  const P = (d) => { const p = c.h.posAt(d); return H.proj(H.G.V(p.x, p.y, p.z)); }, a = P(b.from), e = P(b.from + b.len);
  let dx = e[0] - a[0], dy = e[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  font(700, 14); const w1 = ctx.measureText(L.l1).width; font(600, 13); const w2 = L.l2 ? ctx.measureText(L.l2).width : 0;
  font(600, 11, true); const chip = ctx.measureText(c.h.id).width + 12 * u, tw = Math.max(w1, w2, chip) + 12 * u, th = (L.l2 ? 64 : 46) * u, mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
  const off = 9 * u, x0Of = (side) => (side > 0 ? Math.max(a[0], e[0]) + off + 12 * u : Math.min(a[0], e[0]) - off - 12 * u - tw), boxOf = (side) => [x0Of(side) - 4 * u, mid[1] - th / 2, x0Of(side) + tw + 4 * u, mid[1] + th / 2];
  const side = [1, -1].find((sd) => lay.clear(boxOf(sd))) || 1, box = lay.add(boxOf(side)), x0 = x0Of(side) + 6 * u;
  let nx = -dy, ny = dx; if (nx * side < 0) { nx = -nx; ny = -ny; }
  // The bracket: the brand colour over a white halo, so it reads on any face; end ticks point at the hole.
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
  ctx.moveTo(a[0] + nx * (off - 8 * u), a[1] + ny * (off - 8 * u)); ctx.lineTo(a[0] + nx * off, a[1] + ny * off); ctx.lineTo(e[0] + nx * off, e[1] + ny * off); ctx.lineTo(e[0] + nx * (off - 8 * u), e[1] + ny * (off - 8 * u));
  ctx.strokeStyle = H.paper(0.95); ctx.lineWidth = 5.5 * u; ctx.stroke(); ctx.strokeStyle = H.pri(); ctx.lineWidth = 2.4 * u; ctx.stroke(); ctx.lineCap = 'butt';
  // A white card behind the text, so it reads over a busy block face.
  ctx.fillStyle = H.paper(0.94); ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, box[0], box[1], box[2] - box[0], box[3] - box[1], 4 * u); ctx.fill(); ctx.stroke();
  const halo = (t, x, y) => ctx.fillText(t, x, y);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; let y = box[1] + 13 * u;
  font(600, 11, true); ctx.fillStyle = H.pri(); ctx.fillRect(x0, y - 8.5 * u, chip, 17 * u); ctx.fillStyle = H.textOn(H.pri()); ctx.fillText(c.h.id, x0 + 6 * u, y);
  y += 20 * u; font(700, 14); ctx.fillStyle = H.INK; halo(L.l1, x0, y);
  if (L.l2) { y += 18 * u; font(600, 13); ctx.fillStyle = H.INK; halo(L.l2, x0, y); }
  ctx.textBaseline = 'alphabetic';
  return box;
}

// The block section's bracket (S.block.brackets "plain"): a square bracket beside the hole over the reported
// interval, "154 m @" over "0.51% Cu" in bold beside it (no card, no ID chip, no "incl." line), on the side with
// room, the left first (the grade bars run to the right). Returns its box.
export const bracketLines = (L) => { const t = L.l1.replace(/\s+/g, ' ').trim(), k = t.indexOf(' @ '); return k > 0 ? [t.slice(0, k + 2), t.slice(k + 3)] : [t]; };
function plainBracket(ctx, K, it, lay) {
  const { u, font } = K, c = it.c, b = c.ic.broad, lines = bracketLines(H.calloutLines(c));
  const P = (d) => { const p = c.h.posAt(d); return H.proj(H.G.V(p.x, p.y, p.z)); }, a = P(b.from), e = P(b.from + b.len), mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
  let dx = e[0] - a[0], dy = e[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const ws = lines.map((t) => { font(800, 15); return ctx.measureText(t).width; }), tw = Math.max(...ws), lh = 16.5 * u, th = lines.length * lh + 4 * u;
  // Level with the bracket's middle, else nudged up or down along it (within its length), else the spot overlapping least.
  const off = 9 * u, x0Of = (side) => (side > 0 ? Math.max(a[0], e[0]) + off + 9 * u : Math.min(a[0], e[0]) - off - 9 * u - tw), boxOf = ([side, k]) => [x0Of(side) - 3 * u, mid[1] + k * th - th / 2, x0Of(side) + tw + 3 * u, mid[1] + k * th + th / 2];
  const reach = Math.abs(e[1] - a[1]) / 2 / th + 0.5, cands = [0, -0.7, 0.7, -1.4, 1.4, -2.1, 2.1].filter((k) => !k || Math.abs(k) <= reach).flatMap((k) => [[-1, k], [1, k]]);
  const on = (bx) => lay.boxes.reduce((t, o) => t + overlapArea(bx, o), 0), pick = cands.find((c) => lay.clear(boxOf(c))) || cands.reduce((m, c) => (on(boxOf(c)) < on(boxOf(m)) ? c : m)), side = pick[0], box = lay.add(boxOf(pick));
  let nx = -dy, ny = dx; if (nx * side < 0) { nx = -nx; ny = -ny; }
  const tick = 7 * u, q = (p, k) => [p[0] + nx * k, p[1] + ny * k];
  ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(...q(a, off - tick)); ctx.lineTo(...q(a, off)); ctx.lineTo(...q(e, off)); ctx.lineTo(...q(e, off - tick));
  ctx.strokeStyle = H.paper(0.9); ctx.lineWidth = 5 * u; ctx.stroke(); ctx.strokeStyle = H.INK; ctx.lineWidth = 2.2 * u; ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.textAlign = side > 0 ? 'left' : 'right'; ctx.lineJoin = 'round';
  const x = side > 0 ? box[0] + 3 * u : box[2] - 3 * u;
  lines.forEach((t, i) => {
    const y = box[1] + 2 * u + lh * (i + 0.5); font(800, 15);
    ctx.lineWidth = 4 * u; ctx.strokeStyle = H.paper(0.9); ctx.strokeText(t, x, y); ctx.fillStyle = H.INK; ctx.fillText(t, x, y);
  });
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return box;
}

// ---------- stat boxes (kept in S.labels as kind "stat", so they drag like labels) ----------
export function statSize(ctx, K, L) {
  const { u, font } = K; font(700, 13.5); let w = ctx.measureText(String(L.text).toUpperCase()).width + 1.2 * u * String(L.text).length;
  font(400, 14.5); (L.rows || []).forEach((r) => { w = Math.max(w, ctx.measureText(r).width + 8 * u); });
  return { bw: w + 32 * u, bh: 14 * u + 18 * u + (L.rows || []).length * 21 * u + 8 * u };
}
export function drawStat(ctx, K, L, Wf, Hf) {
  const { u, font } = K, S = H.S, { bw, bh } = statSize(ctx, K, L), x = L.x * Wf - bw / 2, y = L.y * Hf - bh / 2;
  ctx.fillStyle = H.paper(0.97); ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, x, y, bw, bh, 5 * u); ctx.fill(); ctx.stroke();
  ctx.fillStyle = S.accent; ctx.fillRect(x, y + 6 * u, 4 * u, bh - 12 * u);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; font(700, 13.5); if ('letterSpacing' in ctx) ctx.letterSpacing = `${1.2 * u}px`;
  ctx.fillStyle = H.pri(); ctx.fillText(String(L.text).toUpperCase(), x + 16 * u, y + 14 * u + 7 * u); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
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
// The block section's bars (S.block.hist): side "face" lays them in the plane of the face toward the camera, to the
// screen-right of the trace and starting at it, thinner, with a white halo; scale "log" lengthens the lower grades.
// With the block's traces over the faces (S.block.traces "overlay") they draw over the opaque faces too.
const hist = { G: null, mesh: null, halo: null };
export const histLength = (v, lo, hi, log) => (log ? Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo || 10) : v / hi);
function frontAlong(view) {
  const f = ['S', 'E', 'N', 'W'].map((k) => H.faceGeom(k)).sort((p, q) => p.n.dot(view) - q.n.dot(view))[0];
  return new THREE.Vector3(f.b[0] - f.a[0], 0, -(f.b[1] - f.a[1])).normalize();
}
export function placeHistograms() {
  const G = H.G, S = H.S, B = S.block?.hist, face = B?.side === 'face', over = S.block?.traces === 'overlay';
  if (!G || !S.histograms || !S.valueCol) { if (hist.mesh) hist.mesh.visible = false; if (hist.halo) hist.halo.visible = false; return; }
  if (hist.G !== G || !hist.mesh) {
    const cap = Math.max(1, H.project.holes.reduce((s, h) => s + h.ints.length, 0));
    hist.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), cap);
    hist.mesh.frustumCulled = false; hist.mesh.renderOrder = 2; H.root.add(hist.mesh); hist.G = G; hist.halo = null;
  }
  if (face && B.halo !== false && !hist.halo) {
    hist.halo = new THREE.InstancedMesh(hist.mesh.geometry, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }), hist.mesh.instanceMatrix.count);
    hist.halo.frustumCulled = false; H.root.add(hist.halo);
  }
  [hist.mesh, hist.halo].forEach((m, i) => { if (!m) return; const mt = m.material; if (mt.depthTest === over || (i === 0 && mt.transparent !== over)) { mt.depthTest = !over; if (!i) mt.transparent = over; mt.needsUpdate = true; } m.renderOrder = over ? 9 - i * 0.5 : 2 - i * 0.1; });
  const cam = H.camera; cam.updateMatrixWorld();
  const view = cam.getWorldDirection(new THREE.Vector3()), right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize(), along = face && frontAlong(view);
  const vals = []; H.project.holes.forEach((h) => h.ints.forEach((it) => { const v = it.vals[S.valueCol]; if (Number.isFinite(v)) vals.push(v); }));
  vals.sort((a, b) => a - b); const vmax = Math.max(S.bins[3] * 1.5, vals[Math.floor(0.98 * (vals.length - 1))] || 1), vlo = S.bins[0] > 0 ? S.bins[0] : vmax / 100;
  const r = H.traceR(), off = face ? 0.6 * r : 2.4 * r, Lmax = G.diag * (face ? 0.075 * (B.length || 1) : 0.1), mx = new THREE.Matrix4(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), col = new THREE.Color(), white = new THREE.Color('#ffffff');
  let n = 0, hn = 0;
  H.project.holes.filter(holeOn).forEach((h) => h.ints.forEach((it) => {
    const v = it.vals[S.valueCol], bi = H.binIndex(v); if (!(bi >= 1) || (S.displayCutoff !== null && S.displayCutoff !== undefined && v < S.displayCutoff)) return;
    const a = h.posAt(it.from), b = h.posAt(it.to), va = G.V(a.x, a.y, a.z), vb = G.V(b.x, b.y, b.z), dir = vb.clone().sub(va), len = dir.length(); if (len < 1e-6) return; dir.divideScalar(len);
    if (face) { side.copy(along).addScaledVector(dir, -along.dot(dir)); if (side.lengthSq() < 1e-6) side.copy(right); side.normalize(); if (side.dot(right) < 0) side.negate(); } // in the face's plane, screen-right
    else { side.crossVectors(dir, view); if (side.lengthSq() < 1e-8) side.copy(right); side.normalize(); if (side.dot(right) > 0) side.negate(); } // screen-left of the trace
    nrm.crossVectors(side, dir).normalize(); if (nrm.dot(view) > 0) nrm.negate();
    const L = Math.max(r, Lmax * Math.min(1, face ? histLength(v, vlo, vmax, B.scale === 'log') : v / vmax)), c = va.add(vb).multiplyScalar(0.5).addScaledVector(side, off + L / 2), th = len * (face ? 0.82 : 0.98);
    mx.makeBasis(side.clone().multiplyScalar(L), dir.clone().multiplyScalar(th), nrm).setPosition(c);
    hist.mesh.setMatrixAt(n, mx); col.set(H.BIN_COLORS[bi]); if (fade(h)) col.lerp(white, 0.55); hist.mesh.setColorAt(n, col); n++;
    if (hist.halo && hn < hist.halo.instanceMatrix.count) { const e = 0.9 * r; mx.makeBasis(side.clone().multiplyScalar(L + 2 * e), dir.clone().multiplyScalar(len + 2 * e), nrm).setPosition(c.addScaledVector(nrm, -0.2 * r)); hist.halo.setMatrixAt(hn++, mx); }
  }));
  hist.mesh.count = n; hist.mesh.visible = true; hist.mesh.instanceMatrix.needsUpdate = true; if (hist.mesh.instanceColor) hist.mesh.instanceColor.needsUpdate = true;
  if (hist.halo) { hist.halo.count = hn; hist.halo.visible = face && B.halo !== false; hist.halo.instanceMatrix.needsUpdate = true; }
}

// ---------- location inset: satellite or topographic tiles around the property ----------
const TOPO_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
export const TOPO_CREDIT = 'Basemap: Esri';
const inset = { key: null, canvas: null, status: 'off', message: '', promise: null, frame: null };
export function syncInset() {
  const S = H.S, G = H.G, geo = H.geo();
  if (S.insetStyle === 'plan' || !G || !geo) { inset.key = null; inset.status = S.insetStyle === 'plan' ? 'off' : 'needs-crs'; inset.message = S.insetStyle !== 'plan' && !geo ? 'A map inset needs the coordinate system (step 1).' : ''; return Promise.resolve(); }
  const key = `${S.insetStyle}|${S.crs}|${[G.B.x0, G.B.x1, G.B.y0, G.B.y1].map(Math.round)}`;
  if (inset.key === key) return inset.promise || Promise.resolve();
  inset.key = key; inset.canvas = null; inset.status = 'loading';
  inset.promise = (async () => {
    try {
      const half = Math.max(2000, 3.5 * Math.max(G.bw, G.bh)), cx = (G.B.x0 + G.B.x1) / 2, cy = (G.B.y0 + G.B.y1) / 2;
      const corners = [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]].map(([x, y]) => geo.fwd(x, y));
      const bb = { w: Math.min(...corners.map((c) => c[0])), e: Math.max(...corners.map((c) => c[0])), s: Math.min(...corners.map((c) => c[1])), n: Math.max(...corners.map((c) => c[1])) };
      const T = await H.terrain(), M = await T.mosaic(S.insetStyle === 'topo' ? TOPO_URL : T.IMG_URL, bb, T.zoomFor(bb, 640, 16));
      if (inset.key !== key) return;
      const src = document.createElement('canvas'); src.width = M.w; src.height = M.h; src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(M.data), M.w, M.h), 0, 0);
      const px = (lon, lat) => [(T.lon2t(lon, M.z) - M.x0) * 256, (T.lat2t(lat, M.z) - M.y0) * 256];
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
  ctx.fillStyle = H.paper(); ctx.strokeStyle = H.RULE; ctx.lineWidth = u; H.roundRect(ctx, ix - 6 * u, iy - 6 * u, iw + 12 * u, iw + 30 * u, 5 * u); ctx.fill(); ctx.stroke();
  occ.push([ix - 8 * u, 0, W, iy + iw + 26 * u]);
  ctx.drawImage(inset.canvas, ix, iy, iw, iw);
  const P = (x, y) => { const [a, b] = inset.frame.toInset(x, y); return [ix + a * iw, iy + b * iw]; }, G = H.G;
  H.ext('overlays')?.inset(ctx, P, u, [ix, iy, iw, iw]); // claims outlined (overlays.js)
  ctx.beginPath(); [[G.B.x0, G.B.y0], [G.B.x1, G.B.y0], [G.B.x1, G.B.y1], [G.B.x0, G.B.y1]].forEach(([x, y], i) => { const p = P(x, y); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }); ctx.closePath();
  ctx.lineWidth = 3.2 * u; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke(); ctx.lineWidth = 1.6 * u; ctx.strokeStyle = S.accent; ctx.stroke();
  // North arrow (the inset is north-up) and a scale bar, in dark ink on the map whatever the theme.
  const INK = '#142126';
  const nx = ix + iw - 16 * u, ny = iy + 22 * u;
  ctx.beginPath(); ctx.moveTo(nx, ny - 13 * u); ctx.lineTo(nx + 6 * u, ny + 5 * u); ctx.lineTo(nx, ny + 2 * u); ctx.lineTo(nx - 6 * u, ny + 5 * u); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = u; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(nx, ny - 13 * u); ctx.lineTo(nx + 6 * u, ny + 5 * u); ctx.lineTo(nx, ny + 2 * u); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
  font(700, 10); ctx.textAlign = 'center'; ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText('N', nx, ny + 15 * u); ctx.fillStyle = INK; ctx.fillText('N', nx, ny + 15 * u);
  const metres = [500, 1000, 2000, 5000, 10000].find((d) => d / (2 * inset.frame.half) * iw >= 34 * u) || 10000, bl = metres / (2 * inset.frame.half) * iw, bx = ix + 8 * u, by = iy + iw - 10 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(bx - 4 * u, by - 14 * u, bl + 8 * u, 20 * u); ctx.fillStyle = INK; ctx.fillRect(bx, by, bl, 3 * u);
  font(500, 9.5, true); ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, bx + bl / 2, by - 4 * u);
  font(400, 11); ctx.fillStyle = H.MUTED; ctx.fillText('Location of the model', ix + iw / 2, iy + iw + 16 * u); ctx.textAlign = 'left';
  return true;
}

// ---------- state, API, panel ----------
export function state() {
  const t = T(), ok = !!H.project?.holes, st = ok ? statuses() : null;
  return { ...structuredClone(t), holeStatus: ok ? Object.fromEntries(H.project.holes.map((h) => [h.id, st.status.get(h.id) || null])) : {}, newestYear: st?.newestYear ?? null,
    tagged: ok && H.G ? H.project.holes.filter(tagShown).map((h) => h.id) : [], idsShown: ok && H.G ? H.project.holes.filter(idShown).map((h) => h.id) : [],
    statBoxes: H.S.labels.filter((l) => l.kind === 'stat').map((l) => l.id), histograms: H.S.histograms, insetStyle: H.S.insetStyle, inset: { status: inset.status, message: inset.message || null } };
}
export function set(o = {}) {
  const t = T();
  if (o.at !== undefined) { if (!['toe', 'collar', 'both'].includes(o.at)) throw new Error('at must be "collar" (pills at the collar), "toe" (IDs at the end of the hole) or "both".'); t.at = o.at; }
  if (o.style !== undefined) { if (!['dark', 'light', 'plain'].includes(o.style)) throw new Error('style must be "dark" (filled pills, white text), "light" (white pills, coloured text) or "plain" (bold IDs, no pill).'); t.style = o.style; }
  if (o.idMode !== undefined) { if (!['auto', 'all', 'key'].includes(o.idMode)) throw new Error('idMode must be "auto" (all holes up to 12, else key holes), "all" or "key" (the callout holes, the new and planned holes and any given a status or ticked by hand).'); t.idMode = o.idMode; }
  if (o.hideRows !== undefined) { if (!Array.isArray(o.hideRows) || o.hideRows.some((k) => !['new', 'previous'].includes(k))) throw new Error('hideRows must be a list of "new" and/or "previous" legend rows to leave out.'); t.hideRows = [...new Set(o.hideRows)]; }
  if (o.pending !== undefined) { if (!['collar', 'trace'].includes(o.pending)) throw new Error('pending must be "collar" (a small tag per group of pending holes) or "trace" (along each hole).'); t.pending = o.pending; }
  ['showId', 'showTag'].forEach((k) => {
    if (o[k] === undefined) return;
    if (!o[k] || typeof o[k] !== 'object') throw new Error(`${k} must be { holeId: true | false | null }.`);
    const ids = new Set((H.project?.holes || []).map((h) => h.id)); t[k] = { ...(t[k] || {}) };
    Object.entries(o[k]).forEach(([id, v]) => { if (!ids.has(id)) throw new Error(`No hole "${id}".`); if (v === null) delete t[k][id]; else t[k][id] = !!v; });
  });
  if (o.fadePrevious !== undefined) t.fadePrevious = !!o.fadePrevious;
  if (o.emphasis !== undefined) { if (!['auto', 'none', 'key'].includes(o.emphasis)) throw new Error('emphasis must be "key" (key holes bold, the others thin and grey), "none", or "auto" (key past 12 holes).'); t.emphasis = o.emphasis; }
  const hex = (v, k) => { if (v === null || v === 'brand' || /^#[0-9a-f]{6}$/i.test(v)) return v; throw new Error(`${k} must be a hex colour like #c9a227, "brand" (the brand accent) or null.`); };
  if (o.highlight !== undefined) {
    if (!o.highlight || typeof o.highlight !== 'object') throw new Error('highlight must be { holeId: "#hex" | "brand" | null }.');
    const ids = new Set((H.project?.holes || []).map((h) => h.id)); t.highlight = { ...(t.highlight || {}) };
    Object.entries(o.highlight).forEach(([id, v]) => { if (!ids.has(id)) throw new Error(`No hole "${id}".`); if (hex(v, 'A highlight') === null) delete t.highlight[id]; else t.highlight[id] = v; });
  }
  if (o.highlightNew !== undefined) { // every hole of status "new", at once
    const v = hex(o.highlightNew === true ? 'brand' : o.highlightNew || null, 'highlightNew'); t.highlight = { ...(t.highlight || {}) };
    t.highlightNew = !!v; // false also turns off the automatic highlight of key-hole mode
    (H.project?.holes || []).filter((h) => statusOf(h) === 'new').forEach((h) => { if (v) t.highlight[h.id] = v; else delete t.highlight[h.id]; });
  }
  if (o.autoGroup !== undefined) t.autoGroup = !!o.autoGroup;
  if (o.groupRadius !== undefined) t.groupRadius = Math.max(5, Math.min(5000, +o.groupRadius || 140));
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
      <label class="field"><span>Pill style</span><select data-t="style"><option value="dark" ${t.style !== 'light' ? 'selected' : ''}>Filled, white text</option><option value="light" ${t.style === 'light' ? 'selected' : ''}>White, coloured text</option><option value="plain" ${t.style === 'plain' ? 'selected' : ''}>Bold IDs, no pill</option></select></label>
      <label class="field"><span>"New" legend row</span><input type="text" data-t="newLabel" value="${esc(t.newLabel)}" placeholder="${st?.newestYear ? `${st.newestYear} results` : 'New results'}"></label>
      <label class="field"><span>"Previous" legend row</span><input type="text" data-t="prevLabel" value="${esc(t.prevLabel)}"></label>
      <label class="field"><span>"Planned" legend row</span><input type="text" data-t="plannedLabel" value="${esc(t.plannedLabel)}"></label>
    </div>
    <div class="row" style="gap:14px;margin-top:6px"><label class="check"><input type="checkbox" data-t="fadePrevious" ${t.fadePrevious ? 'checked' : ''}>Fade previously released holes</label>
      <label class="check"><input type="checkbox" data-t="autoGroup" ${t.autoGroup ? 'checked' : ''}>Group nearby intercept callouts</label>
      ${(t.groups || []).length ? '<button class="btn" type="button" data-tx="groups">Clear callout groups</button>' : ''}</div>
    <div class="grid2" style="margin-top:6px">
      <label class="field"><span>Hole display</span><select data-t="emphasis"><option value="auto" ${(t.emphasis || 'auto') === 'auto' ? 'selected' : ''}>Automatic (key holes bold past 12 holes)</option><option value="key" ${t.emphasis === 'key' ? 'selected' : ''}>Key holes bold, others thin and grey</option><option value="none" ${t.emphasis === 'none' ? 'selected' : ''}>All the same</option></select></label>
      <label class="field"><span>Group pending holes and callouts within (m)</span><input type="number" min="5" step="10" data-t="groupRadius" value="${esc(t.groupRadius)}"></label>
    </div>
    <label class="check" style="margin-top:6px"><input type="checkbox" data-t="highlightNew" ${hs.some((h) => statusOf(h) === 'new') && hs.filter((h) => statusOf(h) === 'new').every((h) => highlightOf(h)) ? 'checked' : ''}>New holes in the brand colour</label>
    ${hs.length ? `<details style="margin-top:6px"><summary>Holes: ID, tag and status</summary><p class="muted">ID: the hole ID at the end of the hole. Tag: a pill at the collar. Status from the collar status, year or campaign columns; "none" means no status pill.</p>
      <div class="files">${hs.map((h) => `<div style="grid-template-columns:auto auto 1fr auto auto;display:grid;align-items:center;gap:6px"><input type="checkbox" data-tid="${esc(h.id)}" ${idShown(h) ? 'checked' : ''} aria-label="Show the ID of ${esc(h.id)}" title="ID"><input type="checkbox" data-tg="${esc(h.id)}" ${tagShown(h) ? 'checked' : ''} aria-label="Tag ${esc(h.id)} at the collar" title="Tag"><span class="mono">${esc(h.id)}</span><select data-ts="${esc(h.id)}" aria-label="Status of ${esc(h.id)}">${['auto', 'new', 'previous', 'planned', 'none'].map((v) => `<option value="${v}" ${(t.status[h.id] || 'auto') === v ? 'selected' : ''}>${v === 'auto' ? `Auto (${st.status.get(h.id) || 'none'})` : v}</option>`).join('')}</select><input type="checkbox" data-th="${esc(h.id)}" ${t.highlight?.[h.id] ? 'checked' : ''} aria-label="Highlight ${esc(h.id)} in the brand colour" title="Highlight"></div>`).join('')}</div></details>` : ''}`;
  const apply = (o) => H.api.setTags(o).catch((e) => H.status(e.message));
  el.querySelectorAll('[data-t]').forEach((i) => i.addEventListener('change', () => apply({ [i.dataset.t]: i.type === 'checkbox' ? i.checked : i.value })));
  el.querySelectorAll('[data-ts]').forEach((s) => s.addEventListener('change', () => apply({ status: { [s.dataset.ts]: s.value === 'auto' ? null : s.value } })));
  el.querySelectorAll('[data-tid]').forEach((c) => c.addEventListener('change', () => apply({ showId: { [c.dataset.tid]: c.checked } })));
  el.querySelectorAll('[data-tg]').forEach((c) => c.addEventListener('change', () => apply({ showTag: { [c.dataset.tg]: c.checked } })));
  el.querySelectorAll('[data-th]').forEach((c) => c.addEventListener('change', () => apply({ highlight: { [c.dataset.th]: c.checked ? 'brand' : null } })));
  el.querySelector('[data-tx="groups"]')?.addEventListener('click', () => H.api.groupCallouts(null));
}
